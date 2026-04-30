const express = require('express');
const { body, query, validationResult } = require('express-validator');
const realTimeProcessingService = require('../services/realTimeProcessingService');
const { authenticateToken } = require('../middleware/auth');
const { setCache } = require('../middleware/cache');

const router = express.Router();

// Middleware to check validation errors
const checkValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array()
    });
  }
  next();
};

// Stream Configuration Routes

// Create stream configuration
router.post('/streams/config', [
  authenticateToken,
  body('name').isString().isLength({ min: 1, max: 100 }),
  body('data_type').isString().isLength({ min: 1, max: 50 }),
  body('source_system').isString().isLength({ min: 1, max: 100 }),
  body('processing_rules').optional().isArray(),
  body('anomaly_rules').optional().isArray(),
  body('alert_rules').optional().isArray(),
  body('validation_rules').optional().isArray(),
  body('is_active').optional().isBoolean()
], checkValidation, async (req, res) => {
  try {
    const streamId = await realTimeProcessingService.createStreamConfig(req.body);
    
    res.status(201).json({
      success: true,
      data: { stream_id: streamId },
      message: 'Stream configuration created successfully'
    });
  } catch (error) {
    console.error('Error creating stream config:', error);
    res.status(500).json({
      error: 'Failed to create stream configuration',
      message: error.message
    });
  }
});

// Process stream data
router.post('/streams/data', [
  authenticateToken,
  body('stream_id').isString().isLength({ min: 1 }),
  body('data_type').isString().isLength({ min: 1, max: 50 }),
  body('payload').isString().isLength({ min: 1 }),
  body('source').isString().isLength({ min: 1, max: 100 }),
  body('metadata').optional().isObject(),
  body('timestamp').optional().isISO8601()
], checkValidation, async (req, res) => {
  try {
    const dataId = await realTimeProcessingService.processStreamData(req.body);
    
    res.status(201).json({
      success: true,
      data: { data_id: dataId },
      message: 'Stream data processed successfully'
    });
  } catch (error) {
    console.error('Error processing stream data:', error);
    res.status(500).json({
      error: 'Failed to process stream data',
      message: error.message
    });
  }
});

// Get real-time analytics
router.get('/analytics', [
  authenticateToken,
  query('stream_id').optional().isString(),
  query('period').optional().isInt({ min: 1, max: 1440 }).toInt() // Max 24 hours
], checkValidation, async (req, res) => {
  try {
    const { stream_id, period = 60 } = req.query;
    
    const analytics = await realTimeProcessingService.getRealTimeAnalytics(stream_id, period);
    
    res.json({
      success: true,
      data: analytics
    });
  } catch (error) {
    console.error('Error getting real-time analytics:', error);
    res.status(500).json({
      error: 'Failed to retrieve real-time analytics',
      message: error.message
    });
  }
});

// Get active alerts
router.get('/alerts', [
  authenticateToken,
  query('stream_id').optional().isString(),
  query('priority').optional().isIn(['low', 'medium', 'high', 'critical']),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt()
], checkValidation, async (req, res) => {
  try {
    const { stream_id, priority, limit = 50 } = req.query;
    
    const alerts = await realTimeProcessingService.getActiveAlerts(stream_id, priority);
    const limitedAlerts = alerts.slice(0, limit);
    
    res.json({
      success: true,
      data: limitedAlerts,
      total_count: alerts.length
    });
  } catch (error) {
    console.error('Error getting active alerts:', error);
    res.status(500).json({
      error: 'Failed to retrieve active alerts',
      message: error.message
    });
  }
});

// Acknowledge alert
router.post('/alerts/:alertId/acknowledge', [
  authenticateToken
], async (req, res) => {
  try {
    const { alertId } = req.params;
    
    await realTimeProcessingService.acknowledgeAlert(alertId, req.user.id);
    
    res.json({
      success: true,
      message: 'Alert acknowledged successfully'
    });
  } catch (error) {
    console.error('Error acknowledging alert:', error);
    res.status(500).json({
      error: 'Failed to acknowledge alert',
      message: error.message
    });
  }
});

// Resolve alert
router.post('/alerts/:alertId/resolve', [
  authenticateToken
], async (req, res) => {
  try {
    const { alertId } = req.params;
    
    await realTimeProcessingService.resolveAlert(alertId, req.user.id);
    
    res.json({
      success: true,
      message: 'Alert resolved successfully'
    });
  } catch (error) {
    console.error('Error resolving alert:', error);
    res.status(500).json({
      error: 'Failed to resolve alert',
      message: error.message
    });
  }
});

// Get system metrics
router.get('/metrics', [
  authenticateToken
], async (req, res) => {
  try {
    const metrics = realTimeProcessingService.metrics;
    
    res.json({
      success: true,
      data: metrics
    });
  } catch (error) {
    console.error('Error getting system metrics:', error);
    res.status(500).json({
      error: 'Failed to retrieve system metrics',
      message: error.message
    });
  }
});

// Optimize performance
router.post('/optimize', [
  authenticateToken,
  body('enable_auto_scaling').optional().isBoolean(),
  body('batch_size').optional().isInt({ min: 1, max: 1000 }),
  body('processing_interval').optional().isInt({ min: 100, max: 10000 }),
  body('max_queue_size').optional().isInt({ min: 100, max: 50000 }),
  body('anomaly_threshold').optional().isFloat({ min: 0, max: 1 })
], checkValidation, async (req, res) => {
  try {
    // Update optimization settings if provided
    const updates = {};
    
    if (req.body.enable_auto_scaling !== undefined) {
      await realTimeProcessingService.updateOptimizationSetting('enable_auto_scaling', req.body.enable_auto_scaling.toString());
      updates.enable_auto_scaling = req.body.enable_auto_scaling;
    }
    
    if (req.body.batch_size !== undefined) {
      await realTimeProcessingService.updateOptimizationSetting('batch_size', req.body.batch_size.toString());
      updates.batch_size = req.body.batch_size;
    }
    
    if (req.body.processing_interval !== undefined) {
      await realTimeProcessingService.updateOptimizationSetting('processing_interval', req.body.processing_interval.toString());
      updates.processing_interval = req.body.processing_interval;
    }
    
    if (req.body.max_queue_size !== undefined) {
      await realTimeProcessingService.updateOptimizationSetting('max_queue_size', req.body.max_queue_size.toString());
      updates.max_queue_size = req.body.max_queue_size;
    }
    
    if (req.body.anomaly_threshold !== undefined) {
      await realTimeProcessingService.updateOptimizationSetting('anomaly_threshold', req.body.anomaly_threshold.toString());
      updates.anomaly_threshold = req.body.anomaly_threshold;
    }
    
    // Run performance optimization
    await realTimeProcessingService.optimizePerformance();
    
    res.json({
      success: true,
      data: {
        updated_settings: updates,
        current_metrics: realTimeProcessingService.metrics
      },
      message: 'Performance optimization completed successfully'
    });
  } catch (error) {
    console.error('Error optimizing performance:', error);
    res.status(500).json({
      error: 'Failed to optimize performance',
      message: error.message
    });
  }
});

// Get optimization settings
router.get('/settings', [
  authenticateToken
], async (req, res) => {
  try {
    const settings = await realTimeProcessingService.getOptimizationSettings();
    
    res.json({
      success: true,
      data: settings
    });
  } catch (error) {
    console.error('Error getting optimization settings:', error);
    res.status(500).json({
      error: 'Failed to retrieve optimization settings',
      message: error.message
    });
  }
});

// Get processing statistics
router.get('/statistics', [
  authenticateToken,
  query('stream_id').optional().isString(),
  query('period').optional().isInt({ min: 1, max: 1440 }).toInt()
], checkValidation, async (req, res) => {
  try {
    const { stream_id, period = 60 } = req.query;
    
    const analytics = await realTimeProcessingService.getRealTimeAnalytics(stream_id, period);
    
    // Calculate additional statistics
    const statistics = {
      processing_efficiency: analytics.stream_analytics.reduce((acc, stream) => {
        const efficiency = stream.total_data_points > 0 ? 
          (stream.processed_data_points / stream.total_data_points) * 100 : 0;
        return acc + efficiency;
      }, 0) / (analytics.stream_analytics.length || 1),
      
      error_rate: analytics.stream_analytics.reduce((acc, stream) => {
        const errorRate = stream.total_data_points > 0 ? 
          (stream.failed_count / stream.total_data_points) * 100 : 0;
        return acc + errorRate;
      }, 0) / (analytics.stream_analytics.length || 1),
      
      anomaly_detection_rate: analytics.anomaly_statistics.reduce((acc, stat) => acc + stat.count, 0),
      
      alert_generation_rate: analytics.alert_statistics.reduce((acc, stat) => acc + stat.count, 0),
      
      average_processing_time: analytics.stream_analytics.reduce((acc, stream) => 
        acc + (stream.avg_processing_time || 0), 0) / (analytics.stream_analytics.length || 1)
    };
    
    res.json({
      success: true,
      data: {
        ...analytics,
        calculated_statistics: statistics
      }
    });
  } catch (error) {
    console.error('Error getting processing statistics:', error);
    res.status(500).json({
      error: 'Failed to retrieve processing statistics',
      message: error.message
    });
  }
});

// Get anomaly details
router.get('/anomalies', [
  authenticateToken,
  query('stream_id').optional().isString(),
  query('anomaly_type').optional().isString(),
  query('severity').optional().isIn(['low', 'medium', 'high', 'critical']),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt()
], checkValidation, async (req, res) => {
  try {
    const { stream_id, anomaly_type, severity, limit = 50 } = req.query;
    
    // This would need to be implemented in the service
    const anomalies = await realTimeProcessingService.getAnomalies(stream_id, anomaly_type, severity, limit);
    
    res.json({
      success: true,
      data: anomalies
    });
  } catch (error) {
    console.error('Error getting anomalies:', error);
    res.status(500).json({
      error: 'Failed to retrieve anomalies',
      message: error.message
    });
  }
});

// Get stream health status
router.get('/streams/:streamId/health', [
  authenticateToken
], async (req, res) => {
  try {
    const { streamId } = req.params;
    
    // Get recent analytics for the specific stream
    const analytics = await realTimeProcessingService.getRealTimeAnalytics(streamId, 10); // Last 10 minutes
        
    const streamData = analytics.stream_analytics.find(s => s.stream_id === streamId);
    
    if (!streamData) {
      return res.status(404).json({
        error: 'Stream not found or no recent data'
      });
    }
    
    // Calculate health score
    let healthScore = 100;
    
    // Deduct points for high error rate
    const errorRate = streamData.total_data_points > 0 ? 
      (streamData.failed_count / streamData.total_data_points) * 100 : 0;
    
    if (errorRate > 10) healthScore -= 30;
    else if (errorRate > 5) healthScore -= 15;
    else if (errorRate > 1) healthScore -= 5;
    
    // Deduct points for slow processing
    if (streamData.avg_processing_time > 5000) healthScore -= 20;
    else if (streamData.avg_processing_time > 2000) healthScore -= 10;
    else if (streamData.avg_processing_time > 1000) healthScore -= 5;
    
    // Determine health status
    let status = 'healthy';
    if (healthScore < 50) status = 'critical';
    else if (healthScore < 70) status = 'warning';
    else if (healthScore < 90) status = 'degraded';
    
    res.json({
      success: true,
      data: {
        stream_id: streamId,
        health_score: Math.max(0, healthScore),
        status: status,
        metrics: {
          total_data_points: streamData.total_data_points,
          processed_data_points: streamData.processed_data_points,
          failed_count: streamData.failed_count,
          avg_processing_time: streamData.avg_processing_time,
          error_rate: errorRate,
          processing_efficiency: streamData.total_data_points > 0 ? 
            (streamData.processed_data_points / streamData.total_data_points) * 100 : 0
        },
        last_updated: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error getting stream health:', error);
    res.status(500).json({
      error: 'Failed to retrieve stream health status',
      message: error.message
    });
  }
});

// Create validation rule
router.post('/streams/:streamId/validation-rules', [
  authenticateToken,
  body('name').isString().isLength({ min: 1, max: 100 }),
  body('type').isIn(['schema', 'format', 'business_logic']),
  body('definition').isObject()
], checkValidation, async (req, res) => {
  try {
    const { streamId } = req.params;
    
    await realTimeProcessingService.createValidationRule(streamId, req.body);
    
    res.status(201).json({
      success: true,
      message: 'Validation rule created successfully'
    });
  } catch (error) {
    console.error('Error creating validation rule:', error);
    res.status(500).json({
      error: 'Failed to create validation rule',
      message: error.message
    });
  }
});

// Test anomaly detection
router.post('/test/anomaly-detection', [
  authenticateToken,
  body('stream_id').isString(),
  body('test_data').isObject(),
  body('anomaly_rules').isArray()
], checkValidation, async (req, res) => {
  try {
    const { stream_id, test_data, anomaly_rules } = req.body;
    
    // Create a mock stream data object for testing
    const mockStreamData = {
      stream_id: stream_id,
      data_type: 'test',
      payload: JSON.stringify(test_data),
      source: 'test',
      timestamp: new Date().toISOString()
    };
    
    // Create a mock stream config with the provided rules
    const mockStreamConfig = {
      id: stream_id,
      name: 'Test Stream',
      data_type: 'test',
      source_system: 'test',
      processing_rules: [],
      anomaly_rules: anomaly_rules,
      alert_rules: []
    };
    
    // Test anomaly detection
    const anomalies = await realTimeProcessingService.detectAnomalies(mockStreamData, mockStreamConfig);
    
    res.json({
      success: true,
      data: {
        detected_anomalies: anomalies,
        test_data: test_data,
        rules_tested: anomaly_rules.length
      },
      message: 'Anomaly detection test completed'
    });
  } catch (error) {
    console.error('Error testing anomaly detection:', error);
    res.status(500).json({
      error: 'Failed to test anomaly detection',
      message: error.message
    });
  }
});

// Get processing queue status
router.get('/queue/status', [
  authenticateToken
], async (req, res) => {
  try {
    const queueSize = realTimeProcessingService.processingQueue.length;
    const isProcessing = realTimeProcessingService.isProcessingQueue;
    
    res.json({
      success: true,
      data: {
        queue_size: queueSize,
        is_processing: isProcessing,
        queue_status: queueSize > 1000 ? 'high' : queueSize > 500 ? 'medium' : 'normal',
        estimated_wait_time: isProcessing ? Math.ceil(queueSize / 10) : 0 // seconds
      }
    });
  } catch (error) {
    console.error('Error getting queue status:', error);
    res.status(500).json({
      error: 'Failed to retrieve queue status',
      message: error.message
    });
  }
});

// Batch process data
router.post('/batch/process', [
  authenticateToken,
  body('stream_id').isString(),
  body('data_items').isArray({ min: 1, max: 100 }),
  body('data_items.*.payload').isString(),
  body('data_items.*.source').isString()
], checkValidation, async (req, res) => {
  try {
    const { stream_id, data_items } = req.body;
    
    const results = [];
    
    for (const item of data_items) {
      try {
        const streamData = {
          stream_id: stream_id,
          data_type: 'batch',
          payload: item.payload,
          source: item.source,
          timestamp: item.timestamp || new Date().toISOString(),
          metadata: item.metadata || {}
        };
        
        const dataId = await realTimeProcessingService.processStreamData(streamData);
        results.push({
          success: true,
          data_id: dataId,
          source: item.source
        });
      } catch (error) {
        results.push({
          success: false,
          error: error.message,
          source: item.source
        });
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    const failureCount = results.length - successCount;
    
    res.json({
      success: true,
      data: {
        results: results,
        summary: {
          total_items: data_items.length,
          success_count: successCount,
          failure_count: failureCount,
          success_rate: (successCount / data_items.length) * 100
        }
      },
      message: `Batch processing completed: ${successCount} successful, ${failureCount} failed`
    });
  } catch (error) {
    console.error('Error in batch processing:', error);
    res.status(500).json({
      error: 'Failed to process batch data',
      message: error.message
    });
  }
});

module.exports = router;
