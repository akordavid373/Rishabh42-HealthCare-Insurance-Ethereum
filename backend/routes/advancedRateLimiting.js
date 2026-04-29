const express = require('express');
const { body, query, validationResult } = require('express-validator');
const advancedRateLimitingService = require('../services/advancedRateLimitingService');
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

// Rate limit configuration routes

// Create rate limit configuration
router.post('/configs', [
  authenticateToken,
  body('name').isString().isLength({ min: 1, max: 100 }),
  body('scope').isIn(['global', 'per_user', 'per_endpoint', 'per_user_endpoint']),
  body('limit_type').isIn(['per_second', 'per_minute', 'per_hour', 'per_day']),
  body('max_requests').isInt({ min: 1 }),
  body('window_size').isInt({ min: 1 }),
  body('endpoint').optional().isString(),
  body('user_role').optional().isString(),
  body('priority').optional().isInt({ min: 0, max: 100 })
], checkValidation, async (req, res) => {
  try {
    const configId = await advancedRateLimitingService.createRateLimitConfig(req.body);
    
    res.status(201).json({
      success: true,
      data: { config_id: configId },
      message: 'Rate limit configuration created successfully'
    });
  } catch (error) {
    console.error('Error creating rate limit config:', error);
    res.status(500).json({
      error: 'Failed to create rate limit configuration',
      message: error.message
    });
  }
});

// Check rate limit
router.get('/check', [
  authenticateToken,
  query('identifier').isString().isLength({ min: 1 }),
  query('endpoint').optional().isString(),
  query('user_role').optional().isString()
], checkValidation, async (req, res) => {
  try {
    const { identifier, endpoint, user_role } = req.query;
    
    const result = await advancedRateLimitingService.checkRateLimit(
      identifier,
      endpoint,
      user_role
    );
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Error checking rate limit:', error);
    res.status(500).json({
      error: 'Failed to check rate limit',
      message: error.message
    });
  }
});

// Whitelist management routes

// Add whitelist entry
router.post('/whitelist', [
  authenticateToken,
  body('identifier').isString().isLength({ min: 1 }),
  body('type').isIn(['ip', 'user', 'api_key']),
  body('endpoint').optional().isString(),
  body('unlimited').optional().isBoolean(),
  body('custom_limit').optional().isInt({ min: 1 }),
  body('reason').optional().isString().isLength({ max: 500 }),
  body('expires_at').optional().isISO8601()
], checkValidation, async (req, res) => {
  try {
    const entryId = await advancedRateLimitingService.addWhitelistEntry(req.body);
    
    res.status(201).json({
      success: true,
      data: { entry_id: entryId },
      message: 'Whitelist entry added successfully'
    });
  } catch (error) {
    console.error('Error adding whitelist entry:', error);
    res.status(500).json({
      error: 'Failed to add whitelist entry',
      message: error.message
    });
  }
});

// Dynamic limit adjustment routes

// Adjust dynamic limit
router.post('/limits/adjust', [
  authenticateToken,
  body('config_id').isString().isLength({ min: 1 }),
  body('identifier').isString().isLength({ min: 1 }),
  body('adjustment_factor').isFloat({ min: 0.1, max: 10.0 }),
  body('reason').isString().isLength({ min: 1, max: 500 })
], checkValidation, async (req, res) => {
  try {
    const { config_id, identifier, adjustment_factor, reason } = req.body;
    
    await advancedRateLimitingService.adjustDynamicLimit(
      config_id,
      identifier,
      adjustment_factor,
      reason
    );
    
    res.json({
      success: true,
      message: 'Dynamic limit adjusted successfully'
    });
  } catch (error) {
    console.error('Error adjusting dynamic limit:', error);
    res.status(500).json({
      error: 'Failed to adjust dynamic limit',
      message: error.message
    });
  }
});

// Statistics and monitoring routes

// Get rate limiting statistics
router.get('/statistics', [
  authenticateToken,
  query('period').optional().isInt({ min: 1, max: 1440 }).toInt() // Max 24 hours
], checkValidation, async (req, res) => {
  try {
    const { period = 60 } = req.query;
    
    const statistics = await advancedRateLimitingService.getStatistics(period);
    
    res.json({
      success: true,
      data: statistics
    });
  } catch (error) {
    console.error('Error getting statistics:', error);
    res.status(500).json({
      error: 'Failed to retrieve statistics',
      message: error.message
    });
  }
});

// Get system metrics
router.get('/metrics', [
  authenticateToken
], async (req, res) => {
  try {
    const metrics = advancedRateLimitingService.metrics;
    
    res.json({
      success: true,
      data: metrics
    });
  } catch (error) {
    console.error('Error getting metrics:', error);
    res.status(500).json({
      error: 'Failed to retrieve metrics',
      message: error.message
    });
  }
});

// DDoS protection routes

// Get DDoS protection status
router.get('/ddos/status', [
  authenticateToken,
  query('identifier').optional().isString()
], checkValidation, async (req, res) => {
  try {
    const { identifier } = req.query;
    
    // This would need to be implemented in the service
    const ddosStatus = await advancedRateLimitingService.getDDoSStatus(identifier);
    
    res.json({
      success: true,
      data: ddosStatus
    });
  } catch (error) {
    console.error('Error getting DDoS status:', error);
    res.status(500).json({
      error: 'Failed to retrieve DDoS status',
      message: error.message
    });
  }
});

// Trigger DDoS protection manually
router.post('/ddos/trigger', [
  authenticateToken,
  body('identifier').isString().isLength({ min: 1 }),
  body('reason').isString().isLength({ min: 1, max: 500 }),
  body('duration').optional().isInt({ min: 60, max: 3600 }).toInt() // Max 1 hour
], checkValidation, async (req, res) => {
  try {
    const { identifier, reason, duration = 300 } = req.body;
    
    await advancedRateLimitingService.triggerDDoSProtection(
      identifier,
      null,
      1, // Manual trigger
      duration,
      reason
    );
    
    res.json({
      success: true,
      message: 'DDoS protection triggered successfully'
    });
  } catch (error) {
    console.error('Error triggering DDoS protection:', error);
    res.status(500).json({
      error: 'Failed to trigger DDoS protection',
      message: error.message
    });
  }
});

// Settings management routes

// Get rate limiting settings
router.get('/settings', [
  authenticateToken
], async (req, res) => {
  try {
    const settings = await advancedRateLimitingService.getSettings();
    
    res.json({
      success: true,
      data: settings
    });
  } catch (error) {
    console.error('Error getting settings:', error);
    res.status(500).json({
      error: 'Failed to retrieve settings',
      message: error.message
    });
  }
});

// Update rate limiting settings
router.post('/settings', [
  authenticateToken,
  body('settings').isObject()
], checkValidation, async (req, res) => {
  try {
    const { settings } = req.body;
    
    for (const [key, value] of Object.entries(settings)) {
      await advancedRateLimitingService.updateSetting(key, value.toString());
    }
    
    res.json({
      success: true,
      message: 'Settings updated successfully'
    });
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({
      error: 'Failed to update settings',
      message: error.message
    });
  }
});

// Violation management routes

// Get recent violations
router.get('/violations', [
  authenticateToken,
  query('identifier').optional().isString(),
  query('violation_type').optional().isIn(['limit_exceeded', 'ddos_blocked']),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt()
], checkValidation, async (req, res) => {
  try {
    const { identifier, violation_type, limit = 50 } = req.query;
    
    // This would need to be implemented in the service
    const violations = await advancedRateLimitingService.getViolations(
      identifier,
      violation_type,
      limit
    );
    
    res.json({
      success: true,
      data: violations
    });
  } catch (error) {
    console.error('Error getting violations:', error);
    res.status(500).json({
      error: 'Failed to retrieve violations',
      message: error.message
    });
  }
});

// Clear expired data
router.post('/cleanup', [
  authenticateToken
], async (req, res) => {
  try {
    await advancedRateLimitingService.clearExpiredData();
    
    res.json({
      success: true,
      message: 'Expired data cleared successfully'
    });
  } catch (error) {
    console.error('Error clearing expired data:', error);
    res.status(500).json({
      error: 'Failed to clear expired data',
      message: error.message
    });
  }
});

// Health check route
router.get('/health', [
  authenticateToken
], async (req, res) => {
  try {
    const metrics = advancedRateLimitingService.metrics;
    const settings = await advancedRateLimitingService.getSettings();
    
    // Calculate health score
    let healthScore = 100;
    
    // Deduct points for high block rate
    const blockRate = metrics.totalRequests > 0 ? 
      (metrics.blockedRequests / metrics.totalRequests) * 100 : 0;
    
    if (blockRate > 10) healthScore -= 30;
    else if (blockRate > 5) healthScore -= 15;
    else if (blockRate > 1) healthScore -= 5;
    
    // Deduct points for DDoS blocks
    if (metrics.ddosBlocks > 100) healthScore -= 20;
    else if (metrics.ddosBlocks > 50) healthScore -= 10;
    else if (metrics.ddosBlocks > 10) healthScore -= 5;
    
    // Determine health status
    let status = 'healthy';
    if (healthScore < 50) status = 'critical';
    else if (healthScore < 70) status = 'warning';
    else if (healthScore < 90) status = 'degraded';
    
    res.json({
      success: true,
      data: {
        health_score: Math.max(0, healthScore),
        status: status,
        metrics: {
          total_requests: metrics.totalRequests,
          blocked_requests: metrics.blockedRequests,
          block_rate: blockRate,
          ddos_blocks: metrics.ddosBlocks,
          active_limits: metrics.activeLimits,
          whitelist_entries: metrics.whitelistEntries,
          average_response_time: metrics.averageResponseTime
        },
        last_updated: metrics.lastUpdated
      }
    });
  } catch (error) {
    console.error('Error getting health status:', error);
    res.status(500).json({
      error: 'Failed to retrieve health status',
      message: error.message
    });
  }
});

// Middleware for applying rate limiting
const rateLimitMiddleware = (options = {}) => {
  return async (req, res, next) => {
    try {
      const identifier = req.ip || req.connection.remoteAddress;
      const endpoint = req.route ? req.route.path : req.path;
      const userRole = req.user ? req.user.role : null;
      
      const result = await advancedRateLimitingService.checkRateLimit(
        identifier,
        endpoint,
        userRole
      );
      
      // Set rate limit headers
      if (result.limit) {
        res.set({
          'X-RateLimit-Limit': result.limit,
          'X-RateLimit-Remaining': result.remaining,
          'X-RateLimit-Reset': result.resetTime ? Math.ceil(result.resetTime / 1000) : null
        });
      }
      
      if (!result.allowed) {
        return res.status(429).json({
          error: 'Rate limit exceeded',
          message: result.reason || 'Too many requests',
          retry_after: result.resetTime ? Math.ceil((result.resetTime - Date.now()) / 1000) : 60
        });
      }
      
      next();
    } catch (error) {
      console.error('Rate limiting middleware error:', error);
      // Fail open - allow request if rate limiting fails
      next();
    }
  };
};

module.exports = { router, rateLimitMiddleware };
