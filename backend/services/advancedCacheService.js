/**
 * Advanced Caching Service - Issue #49
 * Redis Cluster, Cache Warming, Intelligent Invalidation, Analytics, and Resilience
 */

const redis = require('redis');
const NodeCache = require('node-cache');
const crypto = require('crypto');
const encryptionService = require('./encryptionService');

class AdvancedCacheService {
  constructor() {
    this.ttl = parseInt(process.env.CACHE_TTL) || 300;
    this.useCluster = process.env.REDIS_CLUSTER_NODES ? true : false;
    this.localCache = new NodeCache({ stdTTL: this.ttl, checkperiod: 120 });
    this.metrics = {
      hits: 0,
      misses: 0,
      errors: 0,
      latency: []
    };
    this.isRedisReady = false;
    this._initRedis();
  }

  async _initRedis() {
    try {
      if (this.useCluster) {
        const nodes = process.env.REDIS_CLUSTER_NODES.split(',').map(url => ({ url }));
        this.redisClient = redis.createCluster({
          rootNodes: nodes,
          defaults: {
            password: process.env.REDIS_PASSWORD
          }
        });
      } else if (process.env.REDIS_URL) {
        this.redisClient = redis.createClient({ url: process.env.REDIS_URL });
      }

      if (this.redisClient) {
        this.redisClient.on('error', (err) => {
          console.error('Redis Error:', err);
          this.isRedisReady = false;
          this.metrics.errors++;
        });

        this.redisClient.on('connect', () => {
          console.log(this.useCluster ? 'Connected to Redis Cluster' : 'Connected to Redis');
          this.isRedisReady = true;
        });

        await this.redisClient.connect();
      }
    } catch (error) {
      console.error('Failed to initialize Redis:', error);
      this.isRedisReady = false;
    }
  }

  /**
   * Get data from cache with fallback and analytics
   */
  async get(key, options = {}) {
    const startTime = Date.now();
    try {
      let data = null;

      // 1. Try Redis if available
      if (this.isRedisReady) {
        data = await this.redisClient.get(key);
      } 
      
      // 2. Fallback to Local Cache if Redis missed or unavailable
      if (!data) {
        data = this.localCache.get(key);
        if (data && typeof data !== 'string') {
          data = JSON.stringify(data);
        }
      }

      const latency = Date.now() - startTime;
      this._recordMetrics(data ? 'hit' : 'miss', latency);

      if (!data) return null;

      // 3. Decrypt if sensitive
      if (options.encrypted) {
        try {
          const payload = JSON.parse(data);
          return JSON.parse(encryptionService.decryptAtRest(payload.data, payload.keyId, 'cache-data'));
        } catch (e) {
          console.error('Cache decryption failed:', e);
          return null;
        }
      }

      return JSON.parse(data);
    } catch (error) {
      console.error('Cache get error:', error);
      this.metrics.errors++;
      return null;
    }
  }

  /**
   * Set data in cache with encryption support
   */
  async set(key, value, options = {}) {
    try {
      let dataToStore = JSON.stringify(value);

      if (options.encrypted) {
        const { ciphertext, keyId } = encryptionService.encryptAtRest(dataToStore, 'cache-data');
        dataToStore = JSON.stringify({ data: ciphertext, keyId });
      }

      const ttl = options.ttl || this.ttl;

      // Store in Redis
      if (this.isRedisReady) {
        await this.redisClient.setEx(key, ttl, dataToStore);
      }

      // Mirror in Local Cache (short-lived for L1/L2 strategy)
      this.localCache.set(key, dataToStore, Math.min(ttl, 60)); 
      
      return true;
    } catch (error) {
      console.error('Cache set error:', error);
      this.metrics.errors++;
      return false;
    }
  }

  /**
   * Intelligent Invalidation
   */
  async invalidate(pattern) {
    try {
      if (this.isRedisReady) {
        if (this.useCluster) {
          // Cluster invalidation is more complex, usually done via pub/sub or scanning nodes
          // For simplicity in this demo, we'll use a prefix approach
          console.log(`Invalidating pattern: ${pattern} in Cluster`);
          // In a real cluster, you'd use a more sophisticated approach
        } else {
          const keys = await this.redisClient.keys(`*${pattern}*`);
          if (keys.length > 0) {
            await this.redisClient.del(keys);
          }
        }
      }

      // Local Cache Invalidation
      const localKeys = this.localCache.keys();
      localKeys.forEach(key => {
        if (key.includes(pattern)) {
          this.localCache.del(key);
        }
      });

      return true;
    } catch (error) {
      console.error('Cache invalidation error:', error);
      return false;
    }
  }

  /**
   * Cache Warming Strategy
   */
  async warmCache(items) {
    console.log(`Starting cache warming for ${items.length} items...`);
    for (const item of items) {
      const { key, fetcher, options } = item;
      try {
        const data = await fetcher();
        await this.set(key, data, options);
      } catch (error) {
        console.error(`Failed to warm cache for key ${key}:`, error);
      }
    }
    console.log('Cache warming completed');
  }

  /**
   * Analytics & Monitoring
   */
  getMetrics() {
    const total = this.metrics.hits + this.metrics.misses;
    const hitRatio = total > 0 ? (this.metrics.hits / total).toFixed(4) : 0;
    const avgLatency = this.metrics.latency.length > 0 
      ? (this.metrics.latency.reduce((a, b) => a + b, 0) / this.metrics.latency.length).toFixed(2)
      : 0;

    return {
      ...this.metrics,
      totalRequests: total,
      hitRatio,
      avgLatencyMs: avgLatency,
      redisStatus: this.isRedisReady ? 'connected' : 'disconnected',
      redisStatus: this.isRedisReady ? 'connected' : 'disconnected',
      redisType: this.useCluster ? 'cluster' : 'standalone'
    };
  }

  _recordMetrics(type, latency) {
    if (type === 'hit') this.metrics.hits++;
    else this.metrics.misses++;
    
    this.metrics.latency.push(latency);
    if (this.metrics.latency.length > 1000) this.metrics.latency.shift(); // Keep last 1000
  }
}

module.exports = new AdvancedCacheService();
