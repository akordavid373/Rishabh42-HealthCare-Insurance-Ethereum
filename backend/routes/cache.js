const express = require('express');
const router = express.Router();
const advancedCacheService = require('../services/advancedCacheService');
const { authenticateToken } = require('../middleware/auth');

// Middleware to check if user is admin
const isAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ error: 'Access denied. Admin privileges required.' });
  }
};

/**
 * @route GET /api/cache/metrics
 * @desc Get cache performance metrics
 */
router.get('/metrics', authenticateToken, isAdmin, (req, res) => {
  res.json(advancedCacheService.getMetrics());
});

/**
 * @route POST /api/cache/warm
 * @desc Trigger cache warming for specific resources
 */
router.post('/warm', authenticateToken, isAdmin, async (req, res) => {
  const { resources } = req.body; // Array of { key, resourceType }
  
  if (!resources || !Array.isArray(resources)) {
    return res.status(400).json({ error: 'Resources array is required' });
  }

  // Define warming tasks
  const warmingTasks = resources.map(r => ({
    key: r.key,
    fetcher: async () => {
      // In a real app, this would call the internal service for the resourceType
      return { warmed: true, resourceType: r.resourceType, timestamp: new Date().toISOString() };
    },
    options: { ttl: 3600 } // Long TTL for warmed data
  }));

  advancedCacheService.warmCache(warmingTasks);
  
  res.json({ message: 'Cache warming started', taskCount: warmingTasks.length });
});

/**
 * @route POST /api/cache/invalidate
 * @desc Invalidate cache by pattern
 */
router.post('/invalidate', authenticateToken, isAdmin, async (req, res) => {
  const { pattern } = req.body;
  if (!pattern) return res.status(400).json({ error: 'Pattern is required' });

  const success = await advancedCacheService.invalidate(pattern);
  res.json({ success, pattern });
});

module.exports = router;
