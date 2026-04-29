const auditService = require('../services/auditService');

/**
 * Middleware to automatically audit log requests
 * @param {Object} options - Configuration options
 */
const auditMiddleware = (options = {}) => {
  return async (req, res, next) => {
    // Skip auditing for specified paths (e.g., static files, health checks)
    const excludePaths = options.excludePaths || ['/health', '/favicon.ico'];
    if (excludePaths.some(path => req.path.startsWith(path))) {
      return next();
    }

    // Capture initial state for sensitive resources (optional, would need specific logic per route)
    // For now, we focus on auditing the action itself.

    const originalSend = res.send;
    const startTime = Date.now();

    // Override res.send to capture response and log after the request is finished
    res.send = function(body) {
      res.send = originalSend;
      const response = res.send(body);

      // We log in a 'setImmediate' or similar to avoid blocking the response
      setImmediate(async () => {
        try {
          const duration = Date.now() - startTime;
          const user = req.user || {};
          
          const auditEvent = {
            action: `${req.method} ${req.path}`,
            resource: req.baseUrl || 'api',
            resource_id: req.params.id || null,
            user_id: user.id || null,
            user_email: user.email || null,
            user_role: user.role || null,
            ip_address: req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress,
            user_agent: req.headers['user-agent'],
            status: res.statusCode >= 400 ? 'failure' : 'success',
            error_message: res.statusCode >= 400 ? (typeof body === 'string' ? body.substring(0, 500) : 'Request failed') : null,
            metadata: {
              method: req.method,
              query: req.query,
              params: req.params,
              duration_ms: duration,
              // Avoid logging sensitive body data like passwords
              has_body: !!req.body && Object.keys(req.body).length > 0
            }
          };

          // If it's a mutation, we might want to include more info
          if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
            // Business logic for specific routes can be added here
            // or routes can manually call auditService.log
            await auditService.log(auditEvent);
          } else if (options.logReads && req.method === 'GET') {
            await auditService.log(auditEvent);
          }
        } catch (error) {
          console.error('Error in audit middleware:', error);
        }
      });

      return response;
    };

    next();
  };
};

module.exports = auditMiddleware;
