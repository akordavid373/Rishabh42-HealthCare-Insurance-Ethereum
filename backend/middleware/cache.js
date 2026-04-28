const advancedCacheService = require('../services/advancedCacheService');

function cacheMiddleware(req, res, next) {
  const key = req.originalUrl;
  
  if (req.method !== 'GET') {
    return next();
  }

  // Check if encryption is needed for this route (example logic)
  const isSensitive = key.includes('/patients/') || key.includes('/medical-records/');

  advancedCacheService.get(key, { encrypted: isSensitive })
    .then(data => {
      if (data) {
        return res.json(data);
      }
      next();
    })
    .catch(err => {
      console.error('Cache middleware error:', err);
      next();
    });
}

function setCache(key, data, options = {}) {
  // Automatically encrypt sensitive data
  const isSensitive = key.includes('/patients/') || key.includes('/medical-records/');
  advancedCacheService.set(key, data, { ...options, encrypted: options.encrypted || isSensitive });
}

function deleteCache(pattern) {
  advancedCacheService.invalidate(pattern);
}

function clearCache() {
  // In a real app, you'd add a clearAll method to the service
  console.log('Cache clearing requested');
}

module.exports = {
  cacheMiddleware,
  setCache,
  deleteCache,
  clearCache
};
