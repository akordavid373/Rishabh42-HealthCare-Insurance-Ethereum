const EventEmitter = require('events');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const Redis = require('redis');
const NodeCache = require('node-cache');
const crypto = require('crypto');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../database/healthcare.db');

class AdvancedRateLimitingService extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.redis = null;
    this.cache = new NodeCache({ stdTTL: 300 }); // 5 minutes default TTL
    this.rateLimits = new Map();
    this.ddosProtection = new Map();
    this.whitelist = new Map();
    this.metrics = {
      totalRequests: 0,
      blockedRequests: 0,
      activeLimits: 0,
      ddosBlocks: 0,
      whitelistEntries: 0,
      averageResponseTime: 0,
      lastUpdated: new Date()
    };
    
    this.initializeService();
  }

  getDatabase() {
    if (!this.db) {
      this.db = new sqlite3.Database(DB_PATH);
    }
    return this.db;
  }

  async initializeService() {
    try {
      await this.initializeDatabase();
      await this.initializeRedis();
      await this.loadRateLimits();
      await this.loadWhitelist();
      await this.startMetricsCollector();
      
      console.log('Advanced Rate Limiting Service initialized successfully');
    } catch (error) {
      console.error('Error initializing Advanced Rate Limiting Service:', error);
    }
  }

  // Initialize database tables
  async initializeDatabase() {
    const db = this.getDatabase();
    
    const tables = [
      // Rate limit configurations
      `CREATE TABLE IF NOT EXISTS rate_limit_configs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        scope TEXT NOT NULL, -- global, per_user, per_endpoint, per_user_endpoint
        limit_type TEXT NOT NULL, -- per_second, per_minute, per_hour, per_day
        max_requests INTEGER NOT NULL,
        window_size INTEGER NOT NULL,
        endpoint TEXT,
        user_role TEXT,
        is_active BOOLEAN DEFAULT 1,
        priority INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      
      // Dynamic rate limits
      `CREATE TABLE IF NOT EXISTS dynamic_rate_limits (
        id TEXT PRIMARY KEY,
        config_id TEXT NOT NULL,
        user_id TEXT,
        endpoint TEXT,
        current_limit INTEGER NOT NULL,
        adjustment_factor REAL DEFAULT 1.0,
        last_adjusted DATETIME DEFAULT CURRENT_TIMESTAMP,
        adjustment_reason TEXT,
        FOREIGN KEY (config_id) REFERENCES rate_limit_configs (id)
      )`,
      
      // DDoS protection
      `CREATE TABLE IF NOT EXISTS ddos_protection (
        id TEXT PRIMARY KEY,
        ip_address TEXT NOT NULL,
        user_id TEXT,
        blocked BOOLEAN DEFAULT 0,
        block_reason TEXT,
        block_expiry DATETIME,
        violation_count INTEGER DEFAULT 0,
        last_violation DATETIME,
        risk_score REAL DEFAULT 0.0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      
      // Whitelist entries
      `CREATE TABLE IF NOT EXISTS whitelist_entries (
        id TEXT PRIMARY KEY,
        identifier TEXT NOT NULL, -- IP address, user ID, or API key
        type TEXT NOT NULL, -- ip, user, api_key
        endpoint TEXT,
        unlimited BOOLEAN DEFAULT 0,
        custom_limit INTEGER,
        reason TEXT,
        expires_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      
      // Rate limit violations
      `CREATE TABLE IF NOT EXISTS rate_limit_violations (
        id TEXT PRIMARY KEY,
        config_id TEXT NOT NULL,
        identifier TEXT NOT NULL, -- IP, user ID, etc.
        endpoint TEXT,
        violation_type TEXT NOT NULL, -- limit_exceeded, ddos_detected
        details TEXT, -- JSON details
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (config_id) REFERENCES rate_limit_configs (id)
      )`,
      
      // Rate limit metrics
      `CREATE TABLE IF NOT EXISTS rate_limit_metrics (
        id TEXT PRIMARY KEY,
        config_id TEXT,
        metric_type TEXT NOT NULL, -- requests, blocks, violations
        metric_value REAL NOT NULL,
        unit TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        tags TEXT -- JSON tags
      )`,
      
      // Performance optimization settings
      `CREATE TABLE IF NOT EXISTS rate_limit_settings (
        id TEXT PRIMARY KEY,
        setting_name TEXT NOT NULL UNIQUE,
        setting_value TEXT NOT NULL,
        description TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`
    ];

    for (const table of tables) {
      await new Promise((resolve, reject) => {
        db.run(table, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }

    // Initialize default settings
    await this.initializeDefaultSettings();
  }

  // Initialize Redis for distributed rate limiting
  async initializeRedis() {
    try {
      this.redis = Redis.createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379',
        retry_strategy: (options) => {
          if (options.error && options.error.code === 'ECONNREFUSED') {
            return new Error('Redis server connection refused');
          }
          if (options.total_retry_time > 1000 * 60 * 60) {
            return new Error('Retry time exhausted');
          }
          if (options.attempt > 10) {
            return undefined;
          }
          return Math.min(options.attempt * 100, 3000);
        }
      });

      await this.redis.connect();
      console.log('Redis connected for distributed rate limiting');
    } catch (error) {
      console.warn('Redis connection failed, using local cache:', error.message);
    }
  }

  // Initialize default settings
  async initializeDefaultSettings() {
    const defaultSettings = [
      { name: 'ddos_threshold', value: '100', description: 'DDoS detection threshold (requests per minute)' },
      { name: 'ddos_block_duration', value: '300', description: 'DDoS block duration in seconds' },
      { name: 'dynamic_adjustment_enabled', value: 'true', description: 'Enable dynamic limit adjustment' },
      { name: 'graceful_degradation_enabled', value: 'true', description: 'Enable graceful degradation' },
      { name: 'whitelist_cache_ttl', value: '300', description: 'Whitelist cache TTL in seconds' },
      { name: 'metrics_retention_days', value: '30', description: 'Metrics retention period in days' },
      { name: 'alert_threshold', value: '80', description: 'Alert threshold for rate limit violations (percentage)' }
    ];

    for (const setting of defaultSettings) {
      await new Promise((resolve, reject) => {
        const query = `
          INSERT OR IGNORE INTO rate_limit_settings 
          (id, setting_name, setting_value, description)
          VALUES (?, ?, ?, ?)
        `;
        
        this.getDatabase().run(query, [
          uuidv4(),
          setting.name,
          setting.value,
          setting.description
        ], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  }

  // Load rate limits from database
  async loadRateLimits() {
    const db = this.getDatabase();
    
    try {
      const configs = await new Promise((resolve, reject) => {
        const query = 'SELECT * FROM rate_limit_configs WHERE is_active = 1 ORDER BY priority DESC';
        db.all(query, [], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      this.rateLimits.clear();
      for (const config of configs) {
        this.rateLimits.set(config.id, {
          id: config.id,
          name: config.name,
          scope: config.scope,
          limitType: config.limit_type,
          maxRequests: config.max_requests,
          windowSize: config.window_size,
          endpoint: config.endpoint,
          userRole: config.user_role,
          priority: config.priority
        });
      }

      console.log(`Loaded ${this.rateLimits.size} rate limit configurations`);
    } catch (error) {
      console.error('Error loading rate limits:', error);
    }
  }

  // Load whitelist from database
  async loadWhitelist() {
    const db = this.getDatabase();
    
    try {
      const entries = await new Promise((resolve, reject) => {
        const query = `
          SELECT * FROM whitelist_entries 
          WHERE (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
        `;
        db.all(query, [], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      this.whitelist.clear();
      for (const entry of entries) {
        const key = `${entry.type}:${entry.identifier}`;
        this.whitelist.set(key, {
          id: entry.id,
          identifier: entry.identifier,
          type: entry.type,
          endpoint: entry.endpoint,
          unlimited: entry.unlimited,
          customLimit: entry.custom_limit,
          reason: entry.reason,
          expiresAt: entry.expires_at
        });
      }

      console.log(`Loaded ${this.whitelist.size} whitelist entries`);
    } catch (error) {
      console.error('Error loading whitelist:', error);
    }
  }

  // Check rate limit
  async checkRateLimit(identifier, endpoint, userRole = null) {
    const startTime = Date.now();
    
    try {
      // Check whitelist first
      if (await this.isWhitelisted(identifier, endpoint)) {
        return {
          allowed: true,
          limit: null,
          remaining: null,
          resetTime: null,
          whitelisted: true
        };
      }

      // Check DDoS protection
      if (await this.isDDoSBlocked(identifier)) {
        await this.recordViolation(identifier, endpoint, 'ddos_blocked');
        return {
          allowed: false,
          limit: null,
          remaining: 0,
          resetTime: null,
          blocked: true,
          reason: 'DDoS protection'
        };
      }

      // Get applicable rate limits
      const applicableLimits = await this.getApplicableLimits(identifier, endpoint, userRole);
      
      if (applicableLimits.length === 0) {
        return {
          allowed: true,
          limit: null,
          remaining: null,
          resetTime: null
        };
      }

      // Check each applicable limit
      for (const limit of applicableLimits) {
        const result = await this.checkSpecificLimit(identifier, endpoint, limit);
        
        if (!result.allowed) {
          await this.recordViolation(identifier, endpoint, 'limit_exceeded', {
            limitId: limit.id,
            limitName: limit.name,
            currentCount: result.currentCount,
            maxRequests: limit.maxRequests
          });
          
          // Trigger graceful degradation if enabled
          await this.handleGracefulDegradation(identifier, endpoint, limit);
          
          return result;
        }
      }

      // Update metrics
      this.metrics.totalRequests++;
      
      return {
        allowed: true,
        limit: applicableLimits[0].maxRequests,
        remaining: applicableLimits[0].maxRequests - (await this.getCurrentCount(identifier, applicableLimits[0])),
        resetTime: await this.getResetTime(identifier, applicableLimits[0])
      };
    } catch (error) {
      console.error('Error checking rate limit:', error);
      this.metrics.blockedRequests++;
      throw error;
    } finally {
      const responseTime = Date.now() - startTime;
      this.updateAverageResponseTime(responseTime);
    }
  }

  // Check if identifier is whitelisted
  async isWhitelisted(identifier, endpoint) {
    // Check cache first
    const cacheKey = `whitelist:${identifier}:${endpoint || '*'}`;
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    // Check database
    for (const [key, entry] of this.whitelist) {
      if (entry.identifier === identifier) {
        if (entry.endpoint && entry.endpoint !== endpoint && entry.endpoint !== '*') {
          continue;
        }
        
        if (entry.unlimited) {
          this.cache.set(cacheKey, true);
          return true;
        }
        
        if (entry.customLimit) {
          // Apply custom limit logic here
          this.cache.set(cacheKey, true);
          return true;
        }
      }
    }

    this.cache.set(cacheKey, false);
    return false;
  }

  // Check if identifier is DDoS blocked
  async isDDoSBlocked(identifier) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = `
        SELECT * FROM ddos_protection 
        WHERE (ip_address = ? OR user_id = ?) 
        AND blocked = 1 
        AND (block_expiry IS NULL OR block_expiry > CURRENT_TIMESTAMP)
      `;
      
      db.get(query, [identifier, identifier], (err, row) => {
        if (err) reject(err);
        else resolve(!!row);
      });
    });
  }

  // Get applicable rate limits
  async getApplicableLimits(identifier, endpoint, userRole) {
    const applicable = [];
    
    for (const limit of this.rateLimits.values()) {
      if (this.isLimitApplicable(limit, identifier, endpoint, userRole)) {
        applicable.push(limit);
      }
    }
    
    // Sort by priority (highest first)
    return applicable.sort((a, b) => b.priority - a.priority);
  }

  // Check if a rate limit is applicable
  isLimitApplicable(limit, identifier, endpoint, userRole) {
    switch (limit.scope) {
      case 'global':
        return true;
      case 'per_user':
        return true; // Will be applied with user identifier
      case 'per_endpoint':
        return !limit.endpoint || limit.endpoint === endpoint || limit.endpoint === '*';
      case 'per_user_endpoint':
        return (!limit.endpoint || limit.endpoint === endpoint || limit.endpoint === '*') &&
               (!limit.userRole || limit.userRole === userRole);
      default:
        return false;
    }
  }

  // Check specific rate limit
  async checkSpecificLimit(identifier, endpoint, limit) {
    const key = this.getLimitKey(identifier, endpoint, limit);
    const currentCount = await this.getCurrentCount(identifier, limit);
    const dynamicLimit = await this.getDynamicLimit(limit.id, identifier, endpoint);
    const effectiveLimit = dynamicLimit || limit.maxRequests;
    
    const windowStart = await this.getWindowStart(key, limit.limitType);
    const windowEnd = windowStart + limit.windowSize * 1000; // Convert to milliseconds
    const now = Date.now();
    
    // Reset window if expired
    if (now > windowEnd) {
      await this.resetWindow(key, limit.limitType);
      return {
        allowed: true,
        limit: effectiveLimit,
        remaining: effectiveLimit - 1,
        resetTime: now + limit.windowSize * 1000
      };
    }
    
    const allowed = currentCount < effectiveLimit;
    
    if (allowed) {
      await this.incrementCount(key, limit.limitType);
    }
    
    return {
      allowed,
      limit: effectiveLimit,
      remaining: Math.max(0, effectiveLimit - (currentCount + (allowed ? 1 : 0))),
      resetTime: windowEnd,
      currentCount
    };
  }

  // Get limit key for storage
  getLimitKey(identifier, endpoint, limit) {
    switch (limit.scope) {
      case 'global':
        return `global:${limit.id}`;
      case 'per_user':
        return `user:${identifier}:${limit.id}`;
      case 'per_endpoint':
        return `endpoint:${endpoint || '*'}:${limit.id}`;
      case 'per_user_endpoint':
        return `user_endpoint:${identifier}:${endpoint || '*'}:${limit.id}`;
      default:
        return `default:${limit.id}`;
    }
  }

  // Get current count for a limit
  async getCurrentCount(identifier, limit) {
    const key = this.getLimitKey(identifier, null, limit);
    
    if (this.redis) {
      try {
        const count = await this.redis.get(key);
        return parseInt(count) || 0;
      } catch (error) {
        console.warn('Redis error, falling back to local cache:', error.message);
      }
    }
    
    const count = this.cache.get(key) || 0;
    return count;
  }

  // Get window start time
  async getWindowStart(key, limitType) {
    const windowKey = `${key}:window`;
    
    if (this.redis) {
      try {
        const windowStart = await this.redis.get(windowKey);
        return parseInt(windowStart) || Date.now();
      } catch (error) {
        console.warn('Redis error, falling back to local cache:', error.message);
      }
    }
    
    const windowStart = this.cache.get(windowKey);
    if (windowStart === undefined) {
      const now = Date.now();
      this.cache.set(windowKey, now);
      return now;
    }
    
    return windowStart;
  }

  // Reset window
  async resetWindow(key, limitType) {
    const windowKey = `${key}:window`;
    const now = Date.now();
    
    if (this.redis) {
      try {
        await this.redis.del(key);
        await this.redis.set(windowKey, now);
        await this.redis.expire(windowKey, this.getWindowSize(limitType));
      } catch (error) {
        console.warn('Redis error, falling back to local cache:', error.message);
      }
    }
    
    this.cache.del(key);
    this.cache.set(windowKey, now);
  }

  // Increment count
  async incrementCount(key, limitType) {
    if (this.redis) {
      try {
        const ttl = this.getWindowSize(limitType);
        await this.redis.incr(key);
        await this.redis.expire(key, ttl);
        return;
      } catch (error) {
        console.warn('Redis error, falling back to local cache:', error.message);
      }
    }
    
    const current = this.cache.get(key) || 0;
    this.cache.set(key, current + 1);
  }

  // Get window size in seconds
  getWindowSize(limitType) {
    switch (limitType) {
      case 'per_second':
        return 1;
      case 'per_minute':
        return 60;
      case 'per_hour':
        return 3600;
      case 'per_day':
        return 86400;
      default:
        return 60;
    }
  }

  // Get reset time
  async getResetTime(identifier, limit) {
    const key = this.getLimitKey(identifier, null, limit);
    const windowStart = await this.getWindowStart(key, limit.limitType);
    return windowStart + limit.windowSize * 1000;
  }

  // Get dynamic limit
  async getDynamicLimit(configId, identifier, endpoint) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = `
        SELECT current_limit FROM dynamic_rate_limits 
        WHERE config_id = ? AND (user_id = ? OR user_id IS NULL)
        ORDER BY last_adjusted DESC LIMIT 1
      `;
      
      db.get(query, [configId, identifier], (err, row) => {
        if (err) reject(err);
        else resolve(row ? row.current_limit : null);
      });
    });
  }

  // Record violation
  async recordViolation(identifier, endpoint, violationType, details = null) {
    const db = this.getDatabase();
    
    try {
      const violationId = uuidv4();
      
      await new Promise((resolve, reject) => {
        const query = `
          INSERT INTO rate_limit_violations 
          (id, config_id, identifier, endpoint, violation_type, details)
          VALUES (?, ?, ?, ?, ?, ?)
        `;
        
        db.run(query, [
          violationId,
          details?.limitId || null,
          identifier,
          endpoint,
          violationType,
          JSON.stringify(details || {})
        ], function(err) {
          if (err) reject(err);
          else resolve();
        });
      });

      this.metrics.blockedRequests++;
      
      // Emit violation event
      this.emit('violation:recorded', {
        violationId,
        identifier,
        endpoint,
        violationType,
        details
      });
      
      // Check if DDoS protection should be triggered
      if (violationType === 'limit_exceeded') {
        await this.checkDDoSTrigger(identifier, endpoint);
      }
    } catch (error) {
      console.error('Error recording violation:', error);
    }
  }

  // Check DDoS trigger
  async checkDDoSTrigger(identifier, endpoint) {
    const db = this.getDatabase();
    const threshold = await this.getSetting('ddos_threshold', 100);
    const blockDuration = await this.getSetting('ddos_block_duration', 300);
    
    try {
      // Count violations in the last minute
      const violations = await new Promise((resolve, reject) => {
        const query = `
          SELECT COUNT(*) as count FROM rate_limit_violations 
          WHERE identifier = ? AND timestamp > datetime('now', '-1 minute')
        `;
        
        db.get(query, [identifier], (err, row) => {
          if (err) reject(err);
          else resolve(row.count);
        });
      });

      if (violations >= threshold) {
        await this.triggerDDoSProtection(identifier, endpoint, violations, blockDuration);
      }
    } catch (error) {
      console.error('Error checking DDoS trigger:', error);
    }
  }

  // Trigger DDoS protection
  async triggerDDoSProtection(identifier, endpoint, violationCount, blockDuration) {
    const db = this.getDatabase();
    
    try {
      const protectionId = uuidv4();
      const blockExpiry = new Date(Date.now() + blockDuration * 1000).toISOString();
      
      await new Promise((resolve, reject) => {
        const query = `
          INSERT OR REPLACE INTO ddos_protection 
          (id, ip_address, blocked, block_reason, block_expiry, violation_count, last_violation)
          VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `;
        
        db.run(query, [
          protectionId,
          identifier,
          true,
          `DDoS protection triggered: ${violationCount} violations`,
          blockExpiry,
          violationCount
        ], function(err) {
          if (err) reject(err);
          else resolve();
        });
      });

      this.metrics.ddosBlocks++;
      
      // Emit DDoS protection event
      this.emit('ddos:triggered', {
        protectionId,
        identifier,
        endpoint,
        violationCount,
        blockDuration,
        blockExpiry
      });
      
      console.warn(`DDoS protection triggered for ${identifier}: ${violationCount} violations, blocked for ${blockDuration}s`);
    } catch (error) {
      console.error('Error triggering DDoS protection:', error);
    }
  }

  // Handle graceful degradation
  async handleGracefulDegradation(identifier, endpoint, limit) {
    const enabled = await this.getSetting('graceful_degradation_enabled', 'true');
    
    if (enabled !== 'true') {
      return;
    }
    
    // Implement graceful degradation logic
    // This could include:
    // - Reducing response quality
    // - Enabling caching
    // - Serving simplified responses
    // - Queueing requests for later processing
    
    this.emit('graceful:degradation', {
      identifier,
      endpoint,
      limitId: limit.id,
      reason: 'Rate limit exceeded'
    });
  }

  // Update average response time
  updateAverageResponseTime(responseTime) {
    if (this.metrics.totalRequests === 0) {
      this.metrics.averageResponseTime = responseTime;
    } else {
      this.metrics.averageResponseTime = 
        (this.metrics.averageResponseTime * (this.metrics.totalRequests - 1) + responseTime) / this.metrics.totalRequests;
    }
    
    this.metrics.lastUpdated = new Date();
  }

  // Get setting value
  async getSetting(settingName, defaultValue) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = 'SELECT setting_value FROM rate_limit_settings WHERE setting_name = ?';
      db.get(query, [settingName], (err, row) => {
        if (err) reject(err);
        else if (row) {
          resolve(row.setting_value);
        } else {
          resolve(defaultValue.toString());
        }
      });
    });
  }

  // Create rate limit configuration
  async createRateLimitConfig(config) {
    const db = this.getDatabase();
    
    try {
      const configId = uuidv4();
      
      await new Promise((resolve, reject) => {
        const query = `
          INSERT INTO rate_limit_configs 
          (id, name, scope, limit_type, max_requests, window_size, endpoint, user_role, priority)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        db.run(query, [
          configId,
          config.name,
          config.scope,
          config.limit_type,
          config.max_requests,
          config.window_size,
          config.endpoint || null,
          config.user_role || null,
          config.priority || 0
        ], function(err) {
          if (err) reject(err);
          else resolve();
        });
      });

      // Reload rate limits
      await this.loadRateLimits();
      
      return configId;
    } catch (error) {
      console.error('Error creating rate limit config:', error);
      throw error;
    }
  }

  // Add whitelist entry
  async addWhitelistEntry(entry) {
    const db = this.getDatabase();
    
    try {
      const entryId = uuidv4();
      
      await new Promise((resolve, reject) => {
        const query = `
          INSERT INTO whitelist_entries 
          (id, identifier, type, endpoint, unlimited, custom_limit, reason, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        db.run(query, [
          entryId,
          entry.identifier,
          entry.type,
          entry.endpoint || null,
          entry.unlimited || false,
          entry.custom_limit || null,
          entry.reason || null,
          entry.expires_at || null
        ], function(err) {
          if (err) reject(err);
          else resolve();
        });
      });

      // Reload whitelist
      await this.loadWhitelist();
      
      return entryId;
    } catch (error) {
      console.error('Error adding whitelist entry:', error);
      throw error;
    }
  }

  // Adjust dynamic limit
  async adjustDynamicLimit(configId, identifier, adjustmentFactor, reason) {
    const db = this.getDatabase();
    
    try {
      const baseLimit = await new Promise((resolve, reject) => {
        const query = 'SELECT max_requests FROM rate_limit_configs WHERE id = ?';
        db.get(query, [configId], (err, row) => {
          if (err) reject(err);
          else resolve(row ? row.max_requests : null);
        });
      });

      if (!baseLimit) {
        throw new Error('Rate limit configuration not found');
      }

      const currentLimit = await this.getDynamicLimit(configId, identifier);
      const newLimit = Math.round(baseLimit * adjustmentFactor);
      
      await new Promise((resolve, reject) => {
        const query = `
          INSERT OR REPLACE INTO dynamic_rate_limits 
          (id, config_id, user_id, current_limit, adjustment_factor, adjustment_reason)
          VALUES (?, ?, ?, ?, ?, ?)
        `;
        
        db.run(query, [
          uuidv4(),
          configId,
          identifier,
          newLimit,
          adjustmentFactor,
          reason
        ], function(err) {
          if (err) reject(err);
          else resolve();
        });
      });

      this.emit('limit:adjusted', {
        configId,
        identifier,
        oldLimit: currentLimit,
        newLimit,
        adjustmentFactor,
        reason
      });
    } catch (error) {
      console.error('Error adjusting dynamic limit:', error);
      throw error;
    }
  }

  // Get rate limit statistics
  async getStatistics(period = 60) {
    const db = this.getDatabase();
    
    try {
      const cutoffDate = new Date();
      cutoffDate.setMinutes(cutoffDate.getMinutes() - period);
      
      const violations = await new Promise((resolve, reject) => {
        const query = `
          SELECT 
            violation_type,
            COUNT(*) as count,
            COUNT(DISTINCT identifier) as unique_identifiers
          FROM rate_limit_violations 
          WHERE timestamp >= ?
          GROUP BY violation_type
        `;
        
        db.all(query, [cutoffDate.toISOString()], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      const ddosBlocks = await new Promise((resolve, reject) => {
        const query = `
          SELECT COUNT(*) as count, AVG(violation_count) as avg_violations
          FROM ddos_protection 
          WHERE blocked = 1 AND last_violation >= ?
        `;
        
        db.get(query, [cutoffDate.toISOString()], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      const topViolators = await new Promise((resolve, reject) => {
        const query = `
          SELECT identifier, COUNT(*) as violation_count
          FROM rate_limit_violations 
          WHERE timestamp >= ?
          GROUP BY identifier
          ORDER BY violation_count DESC
          LIMIT 10
        `;
        
        db.all(query, [cutoffDate.toISOString()], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      return {
        period_minutes: period,
        violations: violations,
        ddos_blocks: ddosBlocks,
        top_violators: topViolators,
        system_metrics: this.metrics
      };
    } catch (error) {
      console.error('Error getting statistics:', error);
      throw error;
    }
  }

  // Start metrics collector
  async startMetricsCollector() {
    setInterval(async () => {
      try {
        await this.collectMetrics();
      } catch (error) {
        console.error('Error collecting metrics:', error);
      }
    }, 60000); // Collect metrics every minute
  }

  // Collect system metrics
  async collectMetrics() {
    try {
      // Update active limits count
      this.metrics.activeLimits = this.rateLimits.size;
      this.metrics.whitelistEntries = this.whitelist.size;
      this.metrics.lastUpdated = new Date();
      
      // Store metrics in database
      await this.storeMetrics();
      
      this.emit('metrics:updated', this.metrics);
    } catch (error) {
      console.error('Error collecting metrics:', error);
    }
  }

  // Store metrics in database
  async storeMetrics() {
    const db = this.getDatabase();
    
    try {
      await new Promise((resolve, reject) => {
        const query = `
          INSERT INTO rate_limit_metrics 
          (id, metric_type, metric_value, unit, tags)
          VALUES (?, ?, ?, ?, ?)
        `;
        
        db.run(query, [
          uuidv4(),
          'total_requests',
          this.metrics.totalRequests,
          'count',
          JSON.stringify({ type: 'system' })
        ], function(err) {
          if (err) reject(err);
          else resolve();
        });
      });
    } catch (error) {
      console.error('Error storing metrics:', error);
    }
  }

  // Clear expired data
  async clearExpiredData() {
    const db = this.getDatabase();
    const retentionDays = await this.getSetting('metrics_retention_days', 30);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    
    try {
      // Clear old violations
      await new Promise((resolve, reject) => {
        const query = 'DELETE FROM rate_limit_violations WHERE timestamp < ?';
        db.run(query, [cutoffDate.toISOString()], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Clear old metrics
      await new Promise((resolve, reject) => {
        const query = 'DELETE FROM rate_limit_metrics WHERE timestamp < ?';
        db.run(query, [cutoffDate.toISOString()], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Clear expired DDoS blocks
      await new Promise((resolve, reject) => {
        const query = `
          UPDATE ddos_protection 
          SET blocked = 0 
          WHERE blocked = 1 AND block_expiry <= CURRENT_TIMESTAMP
        `;
        db.run(query, [], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      console.log('Cleared expired rate limiting data');
    } catch (error) {
      console.error('Error clearing expired data:', error);
    }
  }

  // Close service
  close() {
    // Close database connection
    if (this.db) {
      this.db.close();
      this.db = null;
    }

    // Close Redis connection
    if (this.redis) {
      this.redis.quit();
      this.redis = null;
    }

    // Close cache
    this.cache.close();

    console.log('Advanced Rate Limiting Service closed');
  }
}

module.exports = new AdvancedRateLimitingService();
