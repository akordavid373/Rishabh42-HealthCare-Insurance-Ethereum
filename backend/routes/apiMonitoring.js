const express = require('express');
const { body, query, validationResult } = require('express-validator');
const performanceMonitoringService = require('../services/performanceMonitoringService');
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

// Get real-time performance metrics
router.get('/metrics/realtime', [
  authenticateToken,
  query('metric_type').optional().isIn(['response_time', 'throughput', 'error_rate', 'cpu_usage', 'memory_usage', 'disk_usage']),
  query('limit').optional().isInt({ min: 1, max: 1000 }).toInt()
], checkValidation, async (req, res) => {
  try {
    const { metric_type, limit = 100 } = req.query;
    
    const metrics = await performanceMonitoringService.getMetrics(
      metric_type,
      null,
      1, // Last hour for real-time
      limit
    );

    res.json({
      success: true,
      data: metrics,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting real-time metrics:', error);
    res.status(500).json({
      error: 'Failed to retrieve real-time metrics',
      message: error.message
    });
  }
});

// Get API performance analytics
router.get('/analytics/api-performance', [
  authenticateToken,
  query('endpoint').optional().isString(),
  query('period').optional().isInt({ min: 1, max: 168 }).toInt(), // Max 7 days
  query('limit').optional().isInt({ min: 1, max: 10000 }).toInt()
], checkValidation, async (req, res) => {
  try {
    const { endpoint, period = 24, limit = 1000 } = req.query;
    
    const apiPerformance = await performanceMonitoringService.getAPIPerformance(
      endpoint,
      period,
      limit
    );

    // Calculate additional analytics
    const analytics = {
      total_requests: apiPerformance.length,
      avg_response_time: apiPerformance.reduce((sum, req) => sum + req.response_time, 0) / apiPerformance.length,
      error_rate: (apiPerformance.filter(req => req.status_code >= 400).length / apiPerformance.length) * 100,
      status_distribution: {},
      endpoint_distribution: {},
      hourly_distribution: {}
    };

    // Analyze status code distribution
    apiPerformance.forEach(req => {
      const statusRange = req.status_code < 300 ? '2xx' : 
                        req.status_code < 400 ? '3xx' : 
                        req.status_code < 500 ? '4xx' : '5xx';
      analytics.status_distribution[statusRange] = (analytics.status_distribution[statusRange] || 0) + 1;
    });

    // Analyze endpoint distribution
    apiPerformance.forEach(req => {
      analytics.endpoint_distribution[req.endpoint] = (analytics.endpoint_distribution[req.endpoint] || 0) + 1;
    });

    // Analyze hourly distribution
    apiPerformance.forEach(req => {
      const hour = new Date(req.timestamp).getHours();
      analytics.hourly_distribution[hour] = (analytics.hourly_distribution[hour] || 0) + 1;
    });

    res.json({
      success: true,
      data: {
        raw_data: apiPerformance,
        analytics: analytics,
        period_hours: period
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting API performance analytics:', error);
    res.status(500).json({
      error: 'Failed to retrieve API performance analytics',
      message: error.message
    });
  }
});

// Get performance dashboard data
router.get('/dashboard', [
  authenticateToken,
  query('period').optional().isInt({ min: 1, max: 168 }).toInt()
], checkValidation, async (req, res) => {
  try {
    const { period = 24 } = req.query;
    
    const stats = await performanceMonitoringService.getPerformanceStats(period);
    const alerts = await performanceMonitoringService.getAlerts('active');
    
    // Calculate health score
    const healthScore = calculateHealthScore(stats);
    
    // Get top performing endpoints
    const topEndpoints = await getTopPerformingEndpoints(period);
    
    // Get error trends
    const errorTrends = await getErrorTrends(period);

    res.json({
      success: true,
      data: {
        overview: stats,
        health_score: healthScore,
        active_alerts: alerts,
        top_endpoints: topEndpoints,
        error_trends: errorTrends,
        period_hours: period
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting dashboard data:', error);
    res.status(500).json({
      error: 'Failed to retrieve dashboard data',
      message: error.message
    });
  }
});

// Get historical performance reports
router.get('/reports', [
  authenticateToken,
  query('period').optional().isInt({ min: 1, max: 168 }).toInt(),
  query('report_type').optional().isIn(['periodic', 'custom', 'alert'])
], checkValidation, async (req, res) => {
  try {
    const { period = 24, report_type = 'periodic' } = req.query;
    
    const report = await performanceMonitoringService.generatePerformanceReport(
      period,
      req.user.id
    );

    res.json({
      success: true,
      data: report,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error generating performance report:', error);
    res.status(500).json({
      error: 'Failed to generate performance report',
      message: error.message
    });
  }
});

// Get performance alerts
router.get('/alerts', [
  authenticateToken,
  query('status').optional().isIn(['active', 'resolved', 'acknowledged']),
  query('severity').optional().isIn(['critical', 'poor', 'acceptable']),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt()
], checkValidation, async (req, res) => {
  try {
    const { status = 'active', severity, limit = 50 } = req.query;
    
    const alerts = await performanceMonitoringService.getAlerts(status, severity, limit);

    res.json({
      success: true,
      data: alerts,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting alerts:', error);
    res.status(500).json({
      error: 'Failed to retrieve alerts',
      message: error.message
    });
  }
});

// Acknowledge alert
router.post('/alerts/:alertId/acknowledge', [
  authenticateToken,
  body('notes').optional().isString().isLength({ max: 500 })
], checkValidation, async (req, res) => {
  try {
    const { alertId } = req.params;
    const { notes } = req.body;
    
    await performanceMonitoringService.acknowledgeAlert(alertId, req.user.id, notes);

    res.json({
      success: true,
      message: 'Alert acknowledged successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error acknowledging alert:', error);
    res.status(500).json({
      error: 'Failed to acknowledge alert',
      message: error.message
    });
  }
});

// Get usage analytics
router.get('/analytics/usage', [
  authenticateToken,
  query('period').optional().isInt({ min: 1, max: 168 }).toInt(),
  query('group_by').optional().isIn(['hour', 'day', 'endpoint', 'user'])
], checkValidation, async (req, res) => {
  try {
    const { period = 24, group_by = 'hour' } = req.query;
    
    const usageData = await getUsageAnalytics(period, group_by);

    res.json({
      success: true,
      data: usageData,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting usage analytics:', error);
    res.status(500).json({
      error: 'Failed to retrieve usage analytics',
      message: error.message
    });
  }
});

// Get error tracking data
router.get('/analytics/errors', [
  authenticateToken,
  query('period').optional().isInt({ min: 1, max: 168 }).toInt(),
  query('status_code').optional().isInt({ min: 400, max: 599 }).toInt()
], checkValidation, async (req, res) => {
  try {
    const { period = 24, status_code } = req.query;
    
    const errorData = await getErrorAnalytics(period, status_code);

    res.json({
      success: true,
      data: errorData,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting error analytics:', error);
    res.status(500).json({
      error: 'Failed to retrieve error analytics',
      message: error.message
    });
  }
});

// Create custom alert threshold
router.post('/alerts/thresholds', [
  authenticateToken,
  body('metric_name').isString().isLength({ min: 1, max: 100 }),
  body('threshold_value').isFloat({ min: 0 }),
  body('severity').isIn(['critical', 'poor', 'acceptable']),
  body('condition').isIn(['greater_than', 'less_than', 'equals']),
  body('description').optional().isString().isLength({ max: 500 })
], checkValidation, async (req, res) => {
  try {
    const { metric_name, threshold_value, severity, condition, description } = req.body;
    
    const thresholdId = await performanceMonitoringService.createCustomThreshold(
      metric_name,
      threshold_value,
      severity,
      condition,
      description,
      req.user.id
    );

    res.json({
      success: true,
      data: { threshold_id: thresholdId },
      message: 'Custom alert threshold created successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error creating custom threshold:', error);
    res.status(500).json({
      error: 'Failed to create custom alert threshold',
      message: error.message
    });
  }
});

// Helper functions
function calculateHealthScore(stats) {
  let score = 100;
  
  // Deduct points for poor API performance
  if (stats.api_performance.avg_response_time > 1000) score -= 30;
  else if (stats.api_performance.avg_response_time > 500) score -= 15;
  else if (stats.api_performance.avg_response_time > 200) score -= 5;
  
  // Deduct points for high error rate
  if (stats.api_performance.error_rate > 5) score -= 40;
  else if (stats.api_performance.error_rate > 2) score -= 20;
  else if (stats.api_performance.error_rate > 1) score -= 10;
  
  // Deduct points for critical alerts
  if (stats.alerts.critical_alerts > 0) score -= stats.alerts.critical_alerts * 20;
  
  // Deduct points for poor system resources
  Object.entries(stats.system_resources).forEach(([resource, data]) => {
    if (data.status === 'critical') score -= 15;
    else if (data.status === 'poor') score -= 5;
  });
  
  return Math.max(0, score);
}

async function getTopPerformingEndpoints(period) {
  const apiPerformance = await performanceMonitoringService.getAPIPerformance(null, period, 10000);
  
  const endpointStats = {};
  apiPerformance.forEach(req => {
    if (!endpointStats[req.endpoint]) {
      endpointStats[req.endpoint] = {
        count: 0,
        total_response_time: 0,
        errors: 0
      };
    }
    endpointStats[req.endpoint].count++;
    endpointStats[req.endpoint].total_response_time += req.response_time;
    if (req.status_code >= 400) {
      endpointStats[req.endpoint].errors++;
    }
  });
  
  return Object.entries(endpointStats)
    .map(([endpoint, stats]) => ({
      endpoint,
      request_count: stats.count,
      avg_response_time: stats.total_response_time / stats.count,
      error_rate: (stats.errors / stats.count) * 100,
      performance_score: calculateEndpointScore(stats)
    }))
    .sort((a, b) => b.performance_score - a.performance_score)
    .slice(0, 10);
}

function calculateEndpointScore(stats) {
  const avgResponseTime = stats.total_response_time / stats.count;
  const errorRate = (stats.errors / stats.count) * 100;
  
  let score = 100;
  if (avgResponseTime > 1000) score -= 30;
  else if (avgResponseTime > 500) score -= 15;
  else if (avgResponseTime > 200) score -= 5;
  
  if (errorRate > 5) score -= 40;
  else if (errorRate > 2) score -= 20;
  else if (errorRate > 1) score -= 10;
  
  return Math.max(0, score);
}

async function getErrorTrends(period) {
  const apiPerformance = await performanceMonitoringService.getAPIPerformance(null, period, 10000);
  
  const hourlyErrors = {};
  apiPerformance.forEach(req => {
    if (req.status_code >= 400) {
      const hour = new Date(req.timestamp).getHours();
      hourlyErrors[hour] = (hourlyErrors[hour] || 0) + 1;
    }
  });
  
  return Object.entries(hourlyErrors)
    .map(([hour, count]) => ({
      hour: parseInt(hour),
      error_count: count
    }))
    .sort((a, b) => a.hour - b.hour);
}

async function getUsageAnalytics(period, groupBy) {
  const apiPerformance = await performanceMonitoringService.getAPIPerformance(null, period, 10000);
  
  const groupedData = {};
  
  apiPerformance.forEach(req => {
    let key;
    switch (groupBy) {
      case 'hour':
        key = new Date(req.timestamp).getHours();
        break;
      case 'day':
        key = new Date(req.timestamp).toISOString().split('T')[0];
        break;
      case 'endpoint':
        key = req.endpoint;
        break;
      case 'user':
        key = req.user_id || 'anonymous';
        break;
      default:
        key = new Date(req.timestamp).getHours();
    }
    
    if (!groupedData[key]) {
      groupedData[key] = {
        requests: 0,
        errors: 0,
        total_response_time: 0,
        unique_users: new Set()
      };
    }
    
    groupedData[key].requests++;
    groupedData[key].total_response_time += req.response_time;
    if (req.status_code >= 400) {
      groupedData[key].errors++;
    }
    if (req.user_id) {
      groupedData[key].unique_users.add(req.user_id);
    }
  });
  
  return Object.entries(groupedData).map(([key, data]) => ({
    group_key: key,
    request_count: data.requests,
    error_count: data.errors,
    error_rate: (data.errors / data.requests) * 100,
    avg_response_time: data.total_response_time / data.requests,
    unique_users: data.unique_users.size
  }));
}

async function getErrorAnalytics(period, statusCode) {
  const apiPerformance = await performanceMonitoringService.getAPIPerformance(null, period, 10000);
  
  const errors = apiPerformance.filter(req => req.status_code >= 400);
  if (statusCode) {
    errors.filter(req => req.status_code === statusCode);
  }
  
  const errorStats = {
    total_errors: errors.length,
    error_rate: (errors.length / apiPerformance.length) * 100,
    status_distribution: {},
    endpoint_errors: {},
    error_trends: {}
  };
  
  errors.forEach(error => {
    // Status distribution
    const status = error.status_code;
    errorStats.status_distribution[status] = (errorStats.status_distribution[status] || 0) + 1;
    
    // Endpoint errors
    const endpoint = error.endpoint;
    errorStats.endpoint_errors[endpoint] = (errorStats.endpoint_errors[endpoint] || 0) + 1;
    
    // Error trends by hour
    const hour = new Date(error.timestamp).getHours();
    errorStats.error_trends[hour] = (errorStats.error_trends[hour] || 0) + 1;
  });
  
  return errorStats;
}

module.exports = router;
