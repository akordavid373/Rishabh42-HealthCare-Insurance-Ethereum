const { EventEmitter } = require('events');
const os = require('os');

class PerformanceTuner extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      maxConnections: config.maxConnections || 100,
      connectionTimeout: config.connectionTimeout || 30000,
      queryTimeout: config.queryTimeout || 30000,
      cacheSize: config.cacheSize || 2000,
      walMode: config.walMode !== false,
      synchronousMode: config.synchronousMode || 'NORMAL',
      tempStore: config.tempStore || 'MEMORY',
      mmapSize: config.mmapSize || 268435456, // 256MB
      pageSize: config.pageSize || 4096,
      cacheSizePages: config.cacheSizePages || 2000,
      journalMode: config.journalMode || 'WAL',
      autoVacuum: config.autoVaccum || 'INCREMENTAL'
    };
    
    this.performanceMetrics = {
      connections: {
        active: 0,
        total: 0,
        rejected: 0
      },
      queries: {
        total: 0,
        slow: 0,
        failed: 0,
        avgExecutionTime: 0
      },
      memory: {
        used: 0,
        peak: 0,
        cacheHits: 0,
        cacheMisses: 0
      },
      disk: {
        reads: 0,
        writes: 0,
        syncTime: 0
      }
    };
    
    this.tuningRecommendations = [];
    this.isMonitoring = false;
    this.monitoringInterval = null;
  }

  async initializeDatabase(db) {
    console.log('Initializing database performance tuning...');
    
    // Apply performance optimizations
    await this.applyPerformanceSettings(db);
    
    // Create performance monitoring tables
    await this.createMonitoringTables(db);
    
    // Start performance monitoring
    this.startMonitoring();
    
    this.emit('performanceTunerInitialized');
    console.log('Database performance tuning initialized');
  }

  async applyPerformanceSettings(db) {
    const settings = [
      `PRAGMA journal_mode = ${this.config.journalMode}`,
      `PRAGMA synchronous = ${this.config.synchronousMode}`,
      `PRAGMA cache_size = -${this.config.cacheSizePages}`,
      `PRAGMA temp_store = ${this.config.tempStore}`,
      `PRAGMA mmap_size = ${this.config.mmapSize}`,
      `PRAGMA page_size = ${this.config.pageSize}`,
      `PRAGMA auto_vacuum = ${this.config.autoVacuum}`,
      `PRAGMA wal_autocheckpoint = 1000`,
      `PRAGMA busy_timeout = ${this.config.connectionTimeout}`,
      `PRAGMA foreign_keys = ON`,
      `PRAGMA optimize`
    ];

    for (const setting of settings) {
      await new Promise((resolve, reject) => {
        db.run(setting, (err) => {
          if (err) {
            console.error(`Error applying setting ${setting}:`, err);
            reject(err);
          } else {
            console.log(`Applied: ${setting}`);
            resolve();
          }
        });
      });
    }
  }

  async createMonitoringTables(db) {
    const tables = [
      `CREATE TABLE IF NOT EXISTS performance_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        metric_type TEXT NOT NULL,
        metric_name TEXT NOT NULL,
        metric_value REAL NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      
      `CREATE TABLE IF NOT EXISTS slow_queries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        query_hash TEXT NOT NULL,
        query_text TEXT NOT NULL,
        execution_time INTEGER NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        params TEXT
      )`,
      
      `CREATE TABLE IF NOT EXISTS connection_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        connection_type TEXT NOT NULL,
        action TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        details TEXT
      )`,
      
      `CREATE TABLE IF NOT EXISTS cache_performance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cache_type TEXT NOT NULL,
        hits INTEGER NOT NULL,
        misses INTEGER NOT NULL,
        hit_rate REAL NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )`
    ];

    for (const tableSql of tables) {
      await new Promise((resolve, reject) => {
        db.run(tableSql, (err) => {
          if (err) {
            console.error('Error creating monitoring table:', err);
            reject(err);
          } else {
            resolve();
          }
        });
      });
    }

    // Create indexes for monitoring tables
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_performance_metrics_timestamp ON performance_metrics(timestamp)',
      'CREATE INDEX IF NOT EXISTS idx_performance_metrics_type ON performance_metrics(metric_type, metric_name)',
      'CREATE INDEX IF NOT EXISTS idx_slow_queries_timestamp ON slow_queries(timestamp)',
      'CREATE INDEX IF NOT EXISTS idx_slow_queries_hash ON slow_queries(query_hash)',
      'CREATE INDEX IF NOT EXISTS idx_connection_stats_timestamp ON connection_stats(timestamp)',
      'CREATE INDEX IF NOT EXISTS idx_cache_performance_timestamp ON cache_performance(timestamp)'
    ];

    for (const indexSql of indexes) {
      await new Promise((resolve, reject) => {
        db.run(indexSql, (err) => {
          if (err) {
            console.error('Error creating monitoring index:', err);
            reject(err);
          } else {
            resolve();
          }
        });
      });
    }
  }

  startMonitoring() {
    if (this.isMonitoring) {
      return;
    }

    this.isMonitoring = true;
    console.log('Starting performance monitoring...');
    
    this.monitoringInterval = setInterval(() => {
      this.collectMetrics();
    }, 60000); // Collect metrics every minute

    this.emit('monitoringStarted');
  }

  stopMonitoring() {
    if (!this.isMonitoring) {
      return;
    }

    this.isMonitoring = false;
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    
    console.log('Performance monitoring stopped');
    this.emit('monitoringStopped');
  }

  collectMetrics() {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    // Update memory metrics
    this.performanceMetrics.memory.used = memUsage.heapUsed;
    this.performanceMetrics.memory.peak = Math.max(this.performanceMetrics.memory.peak, memUsage.heapUsed);
    
    // Get system load
    const loadAvg = os.loadavg();
    const freeMem = os.freemem();
    const totalMem = os.totalmem();
    
    // Emit metrics event
    this.emit('metricsCollected', {
      timestamp: new Date(),
      memory: {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        external: memUsage.external,
        rss: memUsage.rss
      },
      cpu: cpuUsage,
      system: {
        loadAverage: loadAvg,
        freeMemory: freeMem,
        totalMemory: totalMem,
        memoryUsage: ((totalMem - freeMem) / totalMem) * 100
      },
      performance: this.performanceMetrics
    });

    // Check for performance issues
    this.checkPerformanceIssues();
  }

  checkPerformanceIssues() {
    const memUsage = process.memoryUsage();
    const memoryUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
    
    // Check memory usage
    if (memoryUsagePercent > 80) {
      this.emit('performanceIssue', {
        type: 'high_memory_usage',
        severity: 'warning',
        message: `Memory usage is ${memoryUsagePercent.toFixed(2)}%`,
        recommendation: 'Consider increasing cache size or reducing connection pool'
      });
    }
    
    // Check system load
    const loadAvg = os.loadavg();
    if (loadAvg[0] > os.cpus().length * 2) {
      this.emit('performanceIssue', {
        type: 'high_cpu_load',
        severity: 'warning',
        message: `System load average: ${loadAvg[0].toFixed(2)}`,
        recommendation: 'Consider optimizing queries or adding more CPU resources'
      });
    }
    
    // Check slow queries
    if (this.performanceMetrics.queries.slow > this.performanceMetrics.queries.total * 0.1) {
      this.emit('performanceIssue', {
        type: 'high_slow_query_rate',
        severity: 'error',
        message: `${this.performanceMetrics.queries.slow} slow queries detected`,
        recommendation: 'Review and optimize slow queries'
      });
    }
  }

  recordQueryExecution(executionTime, queryHash, queryText, params = []) {
    this.performanceMetrics.queries.total++;
    
    if (executionTime > 1000) { // Slow query threshold: 1 second
      this.performanceMetrics.queries.slow++;
      this.recordSlowQuery(queryHash, queryText, executionTime, params);
    }
    
    // Update average execution time
    const totalExecutionTime = this.performanceMetrics.queries.avgExecutionTime * (this.performanceMetrics.queries.total - 1) + executionTime;
    this.performanceMetrics.queries.avgExecutionTime = totalExecutionTime / this.performanceMetrics.queries.total;
  }

  async recordSlowQuery(queryHash, queryText, executionTime, params) {
    // This would be implemented to store slow queries in the monitoring database
    console.warn(`Slow query detected: ${executionTime}ms - ${queryText.substring(0, 100)}...`);
    
    this.emit('slowQueryDetected', {
      queryHash,
      queryText,
      executionTime,
      params,
      timestamp: new Date()
    });
  }

  recordConnection(action, details = {}) {
    this.performanceMetrics.connections.total++;
    
    if (action === 'created') {
      this.performanceMetrics.connections.active++;
    } else if (action === 'closed') {
      this.performanceMetrics.connections.active--;
    } else if (action === 'rejected') {
      this.performanceMetrics.connections.rejected++;
    }
    
    this.emit('connectionRecorded', {
      action,
      details,
      timestamp: new Date(),
      activeConnections: this.performanceMetrics.connections.active
    });
  }

  recordCacheOperation(type, hit) {
    if (hit) {
      this.performanceMetrics.memory.cacheHits++;
    } else {
      this.performanceMetrics.memory.cacheMisses++;
    }
    
    this.emit('cacheOperation', {
      type,
      hit,
      timestamp: new Date()
    });
  }

  generateTuningRecommendations() {
    const recommendations = [];
    
    // Memory recommendations
    const memUsage = process.memoryUsage();
    const memoryUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
    
    if (memoryUsagePercent > 80) {
      recommendations.push({
        type: 'memory',
        priority: 'high',
        issue: 'High memory usage',
        current: `${memoryUsagePercent.toFixed(2)}%`,
        recommendation: 'Increase cache_size or reduce connection pool size',
        action: 'cache_size = -4000'
      });
    }
    
    // Connection recommendations
    if (this.performanceMetrics.connections.rejected > this.performanceMetrics.connections.total * 0.05) {
      recommendations.push({
        type: 'connections',
        priority: 'high',
        issue: 'High connection rejection rate',
        current: `${((this.performanceMetrics.connections.rejected / this.performanceMetrics.connections.total) * 100).toFixed(2)}%`,
        recommendation: 'Increase max_connections or optimize connection usage',
        action: 'max_connections = 200'
      });
    }
    
    // Slow query recommendations
    if (this.performanceMetrics.queries.slow > 0) {
      recommendations.push({
        type: 'queries',
        priority: 'medium',
        issue: 'Slow queries detected',
        current: `${this.performanceMetrics.queries.slow} slow queries`,
        recommendation: 'Review and optimize slow queries, add missing indexes',
        action: 'Run query analysis and add recommended indexes'
      });
    }
    
    // Cache performance recommendations
    const totalCacheOps = this.performanceMetrics.memory.cacheHits + this.performanceMetrics.memory.cacheMisses;
    if (totalCacheOps > 0) {
      const cacheHitRate = (this.performanceMetrics.memory.cacheHits / totalCacheOps) * 100;
      
      if (cacheHitRate < 70) {
        recommendations.push({
          type: 'cache',
          priority: 'medium',
          issue: 'Low cache hit rate',
          current: `${cacheHitRate.toFixed(2)}%`,
          recommendation: 'Increase cache size or optimize query patterns',
          action: 'cache_size = -4000'
        });
      }
    }
    
    this.tuningRecommendations = recommendations;
    return recommendations;
  }

  getPerformanceReport() {
    return {
      timestamp: new Date(),
      config: this.config,
      metrics: this.performanceMetrics,
      recommendations: this.tuningRecommendations,
      isMonitoring: this.isMonitoring
    };
  }

  async optimizeDatabase(db) {
    console.log('Running database optimization...');
    
    // Run VACUUM to reclaim space
    await new Promise((resolve, reject) => {
      db.run('VACUUM', (err) => {
        if (err) {
          console.error('Error running VACUUM:', err);
          reject(err);
        } else {
          console.log('VACUUM completed successfully');
          resolve();
        }
      });
    });
    
    // Run ANALYZE to update statistics
    await new Promise((resolve, reject) => {
      db.run('ANALYZE', (err) => {
        if (err) {
          console.error('Error running ANALYZE:', err);
          reject(err);
        } else {
          console.log('ANALYZE completed successfully');
          resolve();
        }
      });
    });
    
    // Optimize query planner
    await new Promise((resolve, reject) => {
      db.run('PRAGMA optimize', (err) => {
        if (err) {
          console.error('Error running PRAGMA optimize:', err);
          reject(err);
        } else {
          console.log('Query planner optimization completed');
          resolve();
        }
      });
    });
    
    this.emit('databaseOptimized');
    console.log('Database optimization completed');
  }

  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    this.emit('configUpdated', this.config);
  }

  resetMetrics() {
    this.performanceMetrics = {
      connections: {
        active: 0,
        total: 0,
        rejected: 0
      },
      queries: {
        total: 0,
        slow: 0,
        failed: 0,
        avgExecutionTime: 0
      },
      memory: {
        used: 0,
        peak: 0,
        cacheHits: 0,
        cacheMisses: 0
      },
      disk: {
        reads: 0,
        writes: 0,
        syncTime: 0
      }
    };
    
    this.emit('metricsReset');
  }
}

module.exports = PerformanceTuner;
