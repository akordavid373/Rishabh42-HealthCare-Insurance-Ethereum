const { EventEmitter } = require('events');
const ShardingManager = require('./sharding/ShardingManager');
const ReplicationManager = require('./replication/ReplicationManager');
const ReadReplicaManager = require('./read_replicas/ReadReplicaManager');
const QueryOptimizer = require('./optimization/QueryOptimizer');
const PerformanceTuner = require('./performance/PerformanceTuner');
const BackupManager = require('./backup/BackupManager');
const DisasterRecoveryManager = require('./disaster_recovery/DisasterRecoveryManager');

class DatabaseOptimizationEngine extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      primaryDbPath: config.primaryDbPath || require('path').join(__dirname, 'healthcare.db'),
      shardingEnabled: config.shardingEnabled || false,
      replicationEnabled: config.replicationEnabled || true,
      readReplicasEnabled: config.readReplicasEnabled || true,
      queryOptimizationEnabled: config.queryOptimizationEnabled || true,
      performanceTuningEnabled: config.performanceTuningEnabled || true,
      backupEnabled: config.backupEnabled || true,
      disasterRecoveryEnabled: config.disasterRecoveryEnabled || true,
      
      // Sharding config
      shardCount: config.shardCount || 4,
      shardingStrategy: config.shardingStrategy || 'hash',
      
      // Replication config
      replicaCount: config.replicaCount || 2,
      replicationInterval: config.replicationInterval || 10000,
      
      // Read replicas config
      readReplicaCount: config.readReplicaCount || 3,
      readReplicaSyncInterval: config.readReplicaSyncInterval || 10000,
      
      // Performance config
      maxConnections: config.maxConnections || 100,
      slowQueryThreshold: config.slowQueryThreshold || 1000,
      
      // Backup config
      backupInterval: config.backupInterval || 3600000,
      backupRetentionDays: config.backupRetentionDays || 30,
      
      // Disaster recovery config
      healthCheckInterval: config.healthCheckInterval || 30000,
      autoFailoverEnabled: config.autoFailoverEnabled || false
    };
    
    this.managers = {};
    this.isInitialized = false;
    this.isRunning = false;
    this.metrics = {
      queries: {
        total: 0,
        optimized: 0,
        slow: 0,
        failed: 0,
        avgExecutionTime: 0
      },
      operations: {
        reads: 0,
        writes: 0,
        sharded: 0,
        replicated: 0
      },
      performance: {
        cacheHitRate: 0,
        connectionUtilization: 0,
        memoryUsage: 0
      }
    };
  }

  async initialize() {
    if (this.isInitialized) {
      console.log('Database optimization engine already initialized');
      return;
    }

    console.log('Initializing database optimization engine...');
    
    try {
      // Initialize managers based on configuration
      await this.initializeManagers();
      
      // Set up event listeners
      this.setupEventListeners();
      
      // Initialize performance monitoring
      if (this.config.performanceTuningEnabled) {
        await this.managers.performanceTuner.initializeDatabase(this.getPrimaryDatabase());
      }
      
      this.isInitialized = true;
      this.emit('engineInitialized');
      console.log('Database optimization engine initialized successfully');
      
    } catch (error) {
      console.error('Error initializing database optimization engine:', error);
      this.emit('initializationError', error);
      throw error;
    }
  }

  async initializeManagers() {
    // Initialize Query Optimizer
    if (this.config.queryOptimizationEnabled) {
      this.managers.queryOptimizer = new QueryOptimizer({
        slowQueryThreshold: this.config.slowQueryThreshold
      });
    }

    // Initialize Performance Tuner
    if (this.config.performanceTuningEnabled) {
      this.managers.performanceTuner = new PerformanceTuner({
        maxConnections: this.config.maxConnections,
        slowQueryThreshold: this.config.slowQueryThreshold
      });
    }

    // Initialize Sharding Manager
    if (this.config.shardingEnabled) {
      this.managers.shardingManager = new ShardingManager({
        shardCount: this.config.shardCount,
        shardingStrategy: this.config.shardingStrategy
      });
    }

    // Initialize Replication Manager
    if (this.config.replicationEnabled) {
      this.managers.replicationManager = new ReplicationManager({
        primaryDbPath: this.config.primaryDbPath,
        replicaCount: this.config.replicaCount,
        replicationInterval: this.config.replicationInterval
      });
    }

    // Initialize Read Replica Manager
    if (this.config.readReplicasEnabled) {
      this.managers.readReplicaManager = new ReadReplicaManager({
        primaryDbPath: this.config.primaryDbPath,
        replicaCount: this.config.readReplicaCount,
        syncInterval: this.config.readReplicaSyncInterval
      });
    }

    // Initialize Backup Manager
    if (this.config.backupEnabled) {
      this.managers.backupManager = new BackupManager({
        primaryDbPath: this.config.primaryDbPath,
        backupInterval: this.config.backupInterval,
        retentionDays: this.config.backupRetentionDays
      });
    }

    // Initialize Disaster Recovery Manager
    if (this.config.disasterRecoveryEnabled) {
      this.managers.disasterRecoveryManager = new DisasterRecoveryManager({
        primaryDbPath: this.config.primaryDbPath,
        healthCheckInterval: this.config.healthCheckInterval,
        autoFailoverEnabled: this.config.autoFailoverEnabled
      });
    }
  }

  setupEventListeners() {
    // Query optimizer events
    if (this.managers.queryOptimizer) {
      this.managers.queryOptimizer.on('queryOptimized', (result) => {
        this.metrics.queries.optimized++;
        this.emit('queryOptimized', result);
      });

      this.managers.queryOptimizer.on('slowQuery', (data) => {
        this.metrics.queries.slow++;
        this.emit('slowQuery', data);
      });
    }

    // Performance tuner events
    if (this.managers.performanceTuner) {
      this.managers.performanceTuner.on('metricsCollected', (metrics) => {
        this.metrics.performance.memoryUsage = metrics.memory.heapUsed;
        this.emit('performanceMetrics', metrics);
      });

      this.managers.performanceTuner.on('performanceIssue', (issue) => {
        this.emit('performanceIssue', issue);
      });
    }

    // Replication events
    if (this.managers.replicationManager) {
      this.managers.replicationManager.on('replicationCompleted', (data) => {
        this.metrics.operations.replicated++;
        this.emit('replicationCompleted', data);
      });

      this.managers.replicationManager.on('replicationError', (error) => {
        this.emit('replicationError', error);
      });
    }

    // Read replica events
    if (this.managers.readReplicaManager) {
      this.managers.readReplicaManager.on('syncCompleted', (data) => {
        this.metrics.operations.reads++;
        this.emit('readReplicaSyncCompleted', data);
      });
    }

    // Backup events
    if (this.managers.backupManager) {
      this.managers.backupManager.on('backupCompleted', (backupInfo) => {
        this.emit('backupCompleted', backupInfo);
      });

      this.managers.backupManager.on('backupError', (error) => {
        this.emit('backupError', error);
      });
    }

    // Disaster recovery events
    if (this.managers.disasterRecoveryManager) {
      this.managers.disasterRecoveryManager.on('healthCheckCompleted', (health) => {
        this.emit('healthCheckCompleted', health);
      });

      this.managers.disasterRecoveryManager.on('failoverCompleted', (data) => {
        this.emit('failoverCompleted', data);
      });
    }
  }

  async start() {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (this.isRunning) {
      console.log('Database optimization engine is already running');
      return;
    }

    console.log('Starting database optimization engine...');

    try {
      // Start replication
      if (this.managers.replicationManager) {
        await this.managers.replicationManager.startReplication();
      }

      // Start read replica synchronization
      if (this.managers.readReplicaManager) {
        this.managers.readReplicaManager.startSynchronization();
      }

      // Start scheduled backups
      if (this.managers.backupManager) {
        await this.managers.backupManager.startScheduledBackups();
      }

      // Start disaster recovery
      if (this.managers.disasterRecoveryManager) {
        await this.managers.disasterRecoveryManager.startDisasterRecovery();
      }

      this.isRunning = true;
      this.emit('engineStarted');
      console.log('Database optimization engine started successfully');

    } catch (error) {
      console.error('Error starting database optimization engine:', error);
      this.emit('startError', error);
      throw error;
    }
  }

  async stop() {
    if (!this.isRunning) {
      console.log('Database optimization engine is not running');
      return;
    }

    console.log('Stopping database optimization engine...');

    try {
      // Stop disaster recovery
      if (this.managers.disasterRecoveryManager) {
        await this.managers.disasterRecoveryManager.stopDisasterRecovery();
      }

      // Stop backups
      if (this.managers.backupManager) {
        this.managers.backupManager.stopScheduledBackups();
      }

      // Stop read replica synchronization
      if (this.managers.readReplicaManager) {
        this.managers.readReplicaManager.stopSynchronization();
      }

      // Stop replication
      if (this.managers.replicationManager) {
        await this.managers.replicationManager.stopReplication();
      }

      // Stop performance monitoring
      if (this.managers.performanceTuner) {
        this.managers.performanceTuner.stopMonitoring();
      }

      this.isRunning = false;
      this.emit('engineStopped');
      console.log('Database optimization engine stopped');

    } catch (error) {
      console.error('Error stopping database optimization engine:', error);
      this.emit('stopError', error);
      throw error;
    }
  }

  async executeQuery(query, params = [], options = {}) {
    const startTime = Date.now();
    this.metrics.queries.total++;

    try {
      let result;
      let queryType = this.getQueryType(query);

      // Route query based on type and configuration
      if (queryType === 'SELECT' && this.managers.readReplicaManager && options.useReadReplicas !== false) {
        // Use read replica for SELECT queries
        result = await this.managers.readReplicaManager.executeReadQuery(query, params);
        this.metrics.operations.reads++;
      } else if (this.config.shardingEnabled && this.managers.shardingManager && options.shardKey) {
        // Use sharding for operations with shard key
        if (queryType === 'SELECT') {
          result = await this.managers.shardingManager.executeQuery(options.shardKey, query, params);
        } else {
          result = await this.managers.shardingManager.executeWrite(options.shardKey, query, params);
        }
        this.metrics.operations.sharded++;
      } else {
        // Use primary database
        result = await this.executeOnPrimary(query, params);
        if (queryType !== 'SELECT') {
          this.metrics.operations.writes++;
        }
      }

      // Record query execution time
      const executionTime = Date.now() - startTime;
      this.recordQueryExecution(executionTime, query, params);

      // Apply query optimization if enabled
      if (this.config.queryOptimizationEnabled && this.managers.queryOptimizer) {
        await this.managers.queryOptimizer.optimizeQuery(query, params);
      }

      this.emit('queryExecuted', { query, params, executionTime, result });
      return result;

    } catch (error) {
      this.metrics.queries.failed++;
      this.emit('queryError', { query, params, error });
      throw error;
    }
  }

  getQueryType(query) {
    const queryUpper = query.trim().toUpperCase();
    if (queryUpper.startsWith('SELECT')) return 'SELECT';
    if (queryUpper.startsWith('INSERT')) return 'INSERT';
    if (queryUpper.startsWith('UPDATE')) return 'UPDATE';
    if (queryUpper.startsWith('DELETE')) return 'DELETE';
    return 'OTHER';
  }

  async executeOnPrimary(query, params = []) {
    const sqlite3 = require('sqlite3').verbose();
    return new Promise((resolve, reject) => {
      const db = new sqlite3.Database(this.config.primaryDbPath);
      db.all(query, params, (err, rows) => {
        db.close();
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  recordQueryExecution(executionTime, query, params) {
    // Update average execution time
    const totalExecutionTime = this.metrics.queries.avgExecutionTime * (this.metrics.queries.total - 1) + executionTime;
    this.metrics.queries.avgExecutionTime = totalExecutionTime / this.metrics.queries.total;

    // Record in performance tuner if available
    if (this.managers.performanceTuner) {
      this.managers.performanceTuner.recordQueryExecution(
        executionTime,
        this.generateQueryHash(query, params),
        query,
        params
      );
    }

    // Record in query optimizer if available
    if (this.managers.queryOptimizer) {
      const queryHash = this.generateQueryHash(query, params);
      this.managers.queryOptimizer.updateQueryStats(queryHash, executionTime, false);
    }
  }

  generateQueryHash(query, params) {
    const crypto = require('crypto');
    const queryStr = `${query}:${JSON.stringify(params)}`;
    return crypto.createHash('md5').update(queryStr).digest('hex');
  }

  getPrimaryDatabase() {
    const sqlite3 = require('sqlite3').verbose();
    return new sqlite3.Database(this.config.primaryDbPath);
  }

  async getOptimizationRecommendations() {
    const recommendations = {
      query: [],
      performance: [],
      indexing: [],
      configuration: []
    };

    // Get query optimization recommendations
    if (this.managers.queryOptimizer) {
      const queryStats = this.managers.queryOptimizer.getQueryStatistics();
      recommendations.query = queryStats.indexRecommendations.map(rec => ({
        type: 'index',
        table: rec.table,
        column: rec.column,
        sql: rec.sql,
        priority: rec.priority,
        reason: rec.reason
      }));
    }

    // Get performance tuning recommendations
    if (this.managers.performanceTuner) {
      const perfRecommendations = this.managers.performanceTuner.generateTuningRecommendations();
      recommendations.performance = perfRecommendations;
    }

    // Get sharding recommendations
    if (this.managers.shardingManager) {
      const shardStats = this.managers.shardingManager.getShardStats();
      const rebalanceRecs = await this.managers.shardingManager.rebalanceShards();
      recommendations.configuration.push(...rebalanceRecs);
    }

    return recommendations;
  }

  getSystemStatus() {
    const status = {
      isInitialized: this.isInitialized,
      isRunning: this.isRunning,
      config: this.config,
      metrics: this.metrics,
      managers: {}
    };

    // Get manager statuses
    if (this.managers.queryOptimizer) {
      status.managers.queryOptimizer = {
        cacheSize: this.managers.queryOptimizer.getCacheSize(),
        statistics: this.managers.queryOptimizer.getQueryStatistics()
      };
    }

    if (this.managers.performanceTuner) {
      status.managers.performanceTuner = this.managers.performanceTuner.getPerformanceReport();
    }

    if (this.managers.shardingManager) {
      status.managers.shardingManager = this.managers.shardingManager.getShardStats();
    }

    if (this.managers.replicationManager) {
      status.managers.replicationManager = this.managers.replicationManager.getReplicationStatus();
    }

    if (this.managers.readReplicaManager) {
      status.managers.readReplicaManager = this.managers.readReplicaManager.getReplicaStats();
    }

    if (this.managers.backupManager) {
      status.managers.backupManager = this.managers.backupManager.getBackupStatistics();
    }

    if (this.managers.disasterRecoveryManager) {
      status.managers.disasterRecoveryManager = this.managers.disasterRecoveryManager.getDisasterRecoveryStatus();
    }

    return status;
  }

  async optimizeDatabase() {
    console.log('Running comprehensive database optimization...');

    const optimizationResults = {
      queryOptimization: null,
      performanceTuning: null,
      shardingOptimization: null,
      backupOptimization: null
    };

    try {
      // Optimize queries
      if (this.managers.queryOptimizer) {
        const queryStats = this.managers.queryOptimizer.getQueryStatistics();
        optimizationResults.queryOptimization = {
          cacheCleared: false,
          recommendations: queryStats.indexRecommendations.length
        };
        
        // Clear cache if needed
        if (this.managers.queryOptimizer.getCacheSize() > 500) {
          this.managers.queryOptimizer.clearCache();
          optimizationResults.queryOptimization.cacheCleared = true;
        }
      }

      // Optimize performance
      if (this.managers.performanceTuner) {
        const primaryDb = this.getPrimaryDatabase();
        await this.managers.performanceTuner.optimizeDatabase(primaryDb);
        primaryDb.close();
        
        optimizationResults.performanceTuning = {
          completed: true,
          recommendations: this.managers.performanceTuner.generateTuningRecommendations()
        };
      }

      // Optimize sharding
      if (this.managers.shardingManager) {
        const rebalanceRecs = await this.managers.shardingManager.rebalanceShards();
        optimizationResults.shardingOptimization = {
          recommendations: rebalanceRecs,
          shardStats: this.managers.shardingManager.getShardStats()
        };
      }

      // Optimize backups
      if (this.managers.backupManager) {
        await this.managers.backupManager.createBackup('full');
        optimizationResults.backupOptimization = {
          backupCreated: true,
          statistics: this.managers.backupManager.getBackupStatistics()
        };
      }

      this.emit('databaseOptimized', optimizationResults);
      console.log('Database optimization completed');

      return optimizationResults;

    } catch (error) {
      console.error('Database optimization failed:', error);
      this.emit('optimizationError', error);
      throw error;
    }
  }

  async healthCheck() {
    const healthCheck = {
      timestamp: new Date(),
      overall: 'healthy',
      components: {}
    };

    try {
      // Check query optimizer
      if (this.managers.queryOptimizer) {
        healthCheck.components.queryOptimizer = {
          status: 'healthy',
          cacheSize: this.managers.queryOptimizer.getCacheSize()
        };
      }

      // Check performance tuner
      if (this.managers.performanceTuner) {
        const perfReport = this.managers.performanceTuner.getPerformanceReport();
        healthCheck.components.performanceTuner = {
          status: perfReport.isMonitoring ? 'healthy' : 'warning',
          isMonitoring: perfReport.isMonitoring
        };
      }

      // Check replication
      if (this.managers.replicationManager) {
        const replicationStatus = this.managers.replicationManager.getReplicationStatus();
        healthCheck.components.replication = {
          status: replicationStatus.isReplicating ? 'healthy' : 'warning',
          isReplicating: replicationStatus.isReplicating,
          replicaCount: replicationStatus.replicas.length
        };
      }

      // Check read replicas
      if (this.managers.readReplicaManager) {
        const replicaStats = this.managers.readReplicaManager.getReplicaStats();
        const healthyReplicas = replicaStats.replicas.filter(r => r.isHealthy).length;
        healthCheck.components.readReplicas = {
          status: healthyReplicas > 0 ? 'healthy' : 'unhealthy',
          healthyReplicas: healthyReplicas,
          totalReplicas: replicaStats.replicas.length
        };
      }

      // Check backup system
      if (this.managers.backupManager) {
        const backupStats = this.managers.backupManager.getBackupStatistics();
        const lastBackupAge = backupStats.lastBackupTime ? 
          Date.now() - new Date(backupStats.lastBackupTime).getTime() : Infinity;
        
        healthCheck.components.backup = {
          status: lastBackupAge < 86400000 ? 'healthy' : 'warning', // 24 hours
          lastBackupTime: backupStats.lastBackupTime,
          successfulBackups: backupStats.successfulBackups
        };
      }

      // Check disaster recovery
      if (this.managers.disasterRecoveryManager) {
        const drStatus = this.managers.disasterRecoveryManager.getDisasterRecoveryStatus();
        healthCheck.components.disasterRecovery = {
          status: drStatus.healthStatus.primary.status === 'healthy' ? 'healthy' : 'warning',
          primaryStatus: drStatus.healthStatus.primary.status
        };
      }

      // Determine overall health
      const componentStatuses = Object.values(healthCheck.components).map(c => c.status);
      if (componentStatuses.includes('unhealthy')) {
        healthCheck.overall = 'unhealthy';
      } else if (componentStatuses.includes('warning')) {
        healthCheck.overall = 'warning';
      }

      this.emit('healthCheckCompleted', healthCheck);
      return healthCheck;

    } catch (error) {
      console.error('Health check failed:', error);
      healthCheck.overall = 'error';
      healthCheck.error = error.message;
      this.emit('healthCheckError', error);
      return healthCheck;
    }
  }

  resetMetrics() {
    this.metrics = {
      queries: {
        total: 0,
        optimized: 0,
        slow: 0,
        failed: 0,
        avgExecutionTime: 0
      },
      operations: {
        reads: 0,
        writes: 0,
        sharded: 0,
        replicated: 0
      },
      performance: {
        cacheHitRate: 0,
        connectionUtilization: 0,
        memoryUsage: 0
      }
    };

    // Reset manager metrics
    if (this.managers.performanceTuner) {
      this.managers.performanceTuner.resetMetrics();
    }

    this.emit('metricsReset');
  }
}

module.exports = DatabaseOptimizationEngine;
