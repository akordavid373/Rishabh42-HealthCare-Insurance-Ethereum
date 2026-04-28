const express = require('express');
const router = express.Router();
const DatabaseOptimizationEngine = require('../database/DatabaseOptimizationEngine');

// Initialize the database optimization engine
const optimizationEngine = new DatabaseOptimizationEngine({
  primaryDbPath: require('path').join(__dirname, '..', 'database', 'healthcare.db'),
  shardingEnabled: process.env.SHARDING_ENABLED === 'true',
  replicationEnabled: process.env.REPLICATION_ENABLED !== 'false',
  readReplicasEnabled: process.env.READ_REPLICAS_ENABLED !== 'false',
  queryOptimizationEnabled: process.env.QUERY_OPTIMIZATION_ENABLED !== 'false',
  performanceTuningEnabled: process.env.PERFORMANCE_TUNING_ENABLED !== 'false',
  backupEnabled: process.env.BACKUP_ENABLED !== 'false',
  disasterRecoveryEnabled: process.env.DISASTER_RECOVERY_ENABLED !== 'false'
});

// Initialize the engine on module load
optimizationEngine.initialize().catch(console.error);

// Get system status
router.get('/status', async (req, res) => {
  try {
    const status = optimizationEngine.getSystemStatus();
    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    console.error('Error getting database optimization status:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Start optimization engine
router.post('/start', async (req, res) => {
  try {
    await optimizationEngine.start();
    res.json({
      success: true,
      message: 'Database optimization engine started successfully'
    });
  } catch (error) {
    console.error('Error starting database optimization engine:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Stop optimization engine
router.post('/stop', async (req, res) => {
  try {
    await optimizationEngine.stop();
    res.json({
      success: true,
      message: 'Database optimization engine stopped successfully'
    });
  } catch (error) {
    console.error('Error stopping database optimization engine:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Execute optimized query
router.post('/query', async (req, res) => {
  try {
    const { query, params = [], options = {} } = req.body;
    
    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Query is required'
      });
    }
    
    const result = await optimizationEngine.executeQuery(query, params, options);
    
    res.json({
      success: true,
      data: result,
      executionTime: Date.now() - req.startTime
    });
  } catch (error) {
    console.error('Error executing optimized query:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get optimization recommendations
router.get('/recommendations', async (req, res) => {
  try {
    const recommendations = await optimizationEngine.getOptimizationRecommendations();
    res.json({
      success: true,
      data: recommendations
    });
  } catch (error) {
    console.error('Error getting optimization recommendations:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Run database optimization
router.post('/optimize', async (req, res) => {
  try {
    const results = await optimizationEngine.optimizeDatabase();
    res.json({
      success: true,
      data: results
    });
  } catch (error) {
    console.error('Error running database optimization:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Health check
router.get('/health', async (req, res) => {
  try {
    const healthCheck = await optimizationEngine.healthCheck();
    const statusCode = healthCheck.overall === 'healthy' ? 200 : 
                      healthCheck.overall === 'warning' ? 200 : 503;
    
    res.status(statusCode).json({
      success: healthCheck.overall !== 'error',
      data: healthCheck
    });
  } catch (error) {
    console.error('Error during health check:', error);
    res.status(503).json({
      success: false,
      error: error.message
    });
  }
});

// Reset metrics
router.post('/metrics/reset', async (req, res) => {
  try {
    optimizationEngine.resetMetrics();
    res.json({
      success: true,
      message: 'Metrics reset successfully'
    });
  } catch (error) {
    console.error('Error resetting metrics:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Sharding endpoints
router.get('/sharding/stats', async (req, res) => {
  try {
    if (!optimizationEngine.managers.shardingManager) {
      return res.status(404).json({
        success: false,
        error: 'Sharding is not enabled'
      });
    }
    
    const stats = optimizationEngine.managers.shardingManager.getShardStats();
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error getting sharding stats:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post('/sharding/rebalance', async (req, res) => {
  try {
    if (!optimizationEngine.managers.shardingManager) {
      return res.status(404).json({
        success: false,
        error: 'Sharding is not enabled'
      });
    }
    
    const recommendations = await optimizationEngine.managers.shardingManager.rebalanceShards();
    res.json({
      success: true,
      data: recommendations
    });
  } catch (error) {
    console.error('Error rebalancing shards:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Replication endpoints
router.get('/replication/status', async (req, res) => {
  try {
    if (!optimizationEngine.managers.replicationManager) {
      return res.status(404).json({
        success: false,
        error: 'Replication is not enabled'
      });
    }
    
    const status = optimizationEngine.managers.replicationManager.getReplicationStatus();
    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    console.error('Error getting replication status:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post('/replication/failover', async (req, res) => {
  try {
    if (!optimizationEngine.managers.replicationManager) {
      return res.status(404).json({
        success: false,
        error: 'Replication is not enabled'
      });
    }
    
    const replicaId = await optimizationEngine.managers.replicationManager.failoverToHealthyReplica();
    res.json({
      success: true,
      data: { promotedReplica: replicaId }
    });
  } catch (error) {
    console.error('Error during failover:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Read replica endpoints
router.get('/read-replicas/stats', async (req, res) => {
  try {
    if (!optimizationEngine.managers.readReplicaManager) {
      return res.status(404).json({
        success: false,
        error: 'Read replicas are not enabled'
      });
    }
    
    const stats = optimizationEngine.managers.readReplicaManager.getReplicaStats();
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error getting read replica stats:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post('/read-replicas/add', async (req, res) => {
  try {
    if (!optimizationEngine.managers.readReplicaManager) {
      return res.status(404).json({
        success: false,
        error: 'Read replicas are not enabled'
      });
    }
    
    const replicaId = await optimizationEngine.managers.readReplicaManager.addReplica();
    res.json({
      success: true,
      data: { replicaId }
    });
  } catch (error) {
    console.error('Error adding read replica:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.delete('/read-replicas/:replicaId', async (req, res) => {
  try {
    if (!optimizationEngine.managers.readReplicaManager) {
      return res.status(404).json({
        success: false,
        error: 'Read replicas are not enabled'
      });
    }
    
    const { replicaId } = req.params;
    await optimizationEngine.managers.readReplicaManager.removeReplica(parseInt(replicaId));
    
    res.json({
      success: true,
      message: 'Read replica removed successfully'
    });
  } catch (error) {
    console.error('Error removing read replica:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Backup endpoints
router.get('/backup/history', async (req, res) => {
  try {
    if (!optimizationEngine.managers.backupManager) {
      return res.status(404).json({
        success: false,
        error: 'Backup is not enabled'
      });
    }
    
    const history = optimizationEngine.managers.backupManager.getBackupHistory();
    res.json({
      success: true,
      data: history
    });
  } catch (error) {
    console.error('Error getting backup history:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post('/backup/create', async (req, res) => {
  try {
    if (!optimizationEngine.managers.backupManager) {
      return res.status(404).json({
        success: false,
        error: 'Backup is not enabled'
      });
    }
    
    const { type = 'full' } = req.body;
    const backupInfo = await optimizationEngine.managers.backupManager.createBackup(type);
    
    res.json({
      success: true,
      data: backupInfo
    });
  } catch (error) {
    console.error('Error creating backup:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post('/backup/:backupId/restore', async (req, res) => {
  try {
    if (!optimizationEngine.managers.backupManager) {
      return res.status(404).json({
        success: false,
        error: 'Backup is not enabled'
      });
    }
    
    const { backupId } = req.params;
    const { targetPath } = req.body;
    
    const restorePath = await optimizationEngine.managers.backupManager.restoreBackup(backupId, targetPath);
    
    res.json({
      success: true,
      data: { restorePath }
    });
  } catch (error) {
    console.error('Error restoring backup:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post('/backup/:backupId/verify', async (req, res) => {
  try {
    if (!optimizationEngine.managers.backupManager) {
      return res.status(404).json({
        success: false,
        error: 'Backup is not enabled'
      });
    }
    
    const { backupId } = req.params;
    const verificationResult = await optimizationEngine.managers.backupManager.verifyBackup(backupId);
    
    res.json({
      success: true,
      data: verificationResult
    });
  } catch (error) {
    console.error('Error verifying backup:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Disaster recovery endpoints
router.get('/disaster-recovery/status', async (req, res) => {
  try {
    if (!optimizationEngine.managers.disasterRecoveryManager) {
      return res.status(404).json({
        success: false,
        error: 'Disaster recovery is not enabled'
      });
    }
    
    const status = optimizationEngine.managers.disasterRecoveryManager.getDisasterRecoveryStatus();
    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    console.error('Error getting disaster recovery status:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.get('/disaster-recovery/history', async (req, res) => {
  try {
    if (!optimizationEngine.managers.disasterRecoveryManager) {
      return res.status(404).json({
        success: false,
        error: 'Disaster recovery is not enabled'
      });
    }
    
    const history = optimizationEngine.managers.disasterRecoveryManager.getRecoveryHistory();
    res.json({
      success: true,
      data: history
    });
  } catch (error) {
    console.error('Error getting recovery history:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post('/disaster-recovery/execute', async (req, res) => {
  try {
    if (!optimizationEngine.managers.disasterRecoveryManager) {
      return res.status(404).json({
        success: false,
        error: 'Disaster recovery is not enabled'
      });
    }
    
    const { recoveryPointId } = req.body;
    await optimizationEngine.managers.disasterRecoveryManager.executeRecovery(recoveryPointId);
    
    res.json({
      success: true,
      message: 'Disaster recovery executed successfully'
    });
  } catch (error) {
    console.error('Error executing disaster recovery:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Query optimization endpoints
router.get('/query/stats', async (req, res) => {
  try {
    if (!optimizationEngine.managers.queryOptimizer) {
      return res.status(404).json({
        success: false,
        error: 'Query optimization is not enabled'
      });
    }
    
    const stats = optimizationEngine.managers.queryOptimizer.getQueryStatistics();
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error getting query stats:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post('/query/analyze', async (req, res) => {
  try {
    if (!optimizationEngine.managers.queryOptimizer) {
      return res.status(404).json({
        success: false,
        error: 'Query optimization is not enabled'
      });
    }
    
    const { query, params = [] } = req.body;
    
    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Query is required'
      });
    }
    
    const analysis = await optimizationEngine.managers.queryOptimizer.optimizeQuery(query, params);
    res.json({
      success: true,
      data: analysis
    });
  } catch (error) {
    console.error('Error analyzing query:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post('/query/cache/clear', async (req, res) => {
  try {
    if (!optimizationEngine.managers.queryOptimizer) {
      return res.status(404).json({
        success: false,
        error: 'Query optimization is not enabled'
      });
    }
    
    optimizationEngine.managers.queryOptimizer.clearCache();
    res.json({
      success: true,
      message: 'Query cache cleared successfully'
    });
  } catch (error) {
    console.error('Error clearing query cache:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Performance tuning endpoints
router.get('/performance/report', async (req, res) => {
  try {
    if (!optimizationEngine.managers.performanceTuner) {
      return res.status(404).json({
        success: false,
        error: 'Performance tuning is not enabled'
      });
    }
    
    const report = optimizationEngine.managers.performanceTuner.getPerformanceReport();
    res.json({
      success: true,
      data: report
    });
  } catch (error) {
    console.error('Error getting performance report:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post('/performance/optimize', async (req, res) => {
  try {
    if (!optimizationEngine.managers.performanceTuner) {
      return res.status(404).json({
        success: false,
        error: 'Performance tuning is not enabled'
      });
    }
    
    const primaryDb = optimizationEngine.getPrimaryDatabase();
    await optimizationEngine.managers.performanceTuner.optimizeDatabase(primaryDb);
    primaryDb.close();
    
    res.json({
      success: true,
      message: 'Database performance optimization completed'
    });
  } catch (error) {
    console.error('Error optimizing performance:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Middleware to record start time for query execution
router.use('/query', (req, res, next) => {
  req.startTime = Date.now();
  next();
});

module.exports = router;
