const rateLimit = require('express-rate-limit');
const { body, param, validationResult } = require('express-validator');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../database/healthcare.db');

/* ── PHI detection patterns (warn-only by default) ─────────────────────── */
const PHI_PATTERNS = [
  /\b\d{3}-\d{2}-\d{4}\b/,                                         // SSN
  /\b[A-Z]{1,3}\d{6,9}\b/,                                         // MRN-style
  /\b(?:dob|date of birth|born)\s*[:\-]?\s*\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/i, // DOB
];

/* ─── XSS sanitisation ──────────────────────────────────────────────────── */
function sanitiseString(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/javascript:/gi, '')
    .trim();
}

function sanitiseObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const clean = {};
  for (const [k, v] of Object.entries(obj)) {
    clean[k] = typeof v === 'string' ? sanitiseString(v) : v;
  }
  return clean;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Rate limiters — tighter than the global limiter for notification endpoints
 * ════════════════════════════════════════════════════════════════════════*/

/** 20 reads / minute per authenticated user */
const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: (req) => `notif-read-${req.user?.id || req.ip}`,
  message: { error: 'Too many notification read requests. Try again in a minute.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/** 5 sends / minute per authenticated user */
const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator: (req) => `notif-write-${req.user?.id || req.ip}`,
  message: { error: 'Too many notification send requests. Try again in a minute.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/** 10 sends / minute for batch (admin only, slightly more generous) */
const batchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => `notif-batch-${req.user?.id || req.ip}`,
  message: { error: 'Too many batch requests. Try again in a minute.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/* ══════════════════════════════════════════════════════════════════════════
 * requireRole — guard endpoints to specific roles
 * ════════════════════════════════════════════════════════════════════════*/
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        required: roles,
        current: req.user.role,
      });
    }
    next();
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * ownsNotification — ensure patients only access their own notifications
 * ════════════════════════════════════════════════════════════════════════*/
function ownsNotification(req, res, next) {
  const { id } = req.params;
  if (!id) return next();

  // Admins and providers can access any notification
  if (req.user.role === 'admin' || req.user.role === 'provider') return next();

  const db = new sqlite3.Database(DB_PATH);
  db.get(
    'SELECT user_id FROM notifications WHERE id = ?',
    [id],
    (err, row) => {
      db.close();
      if (err) return next(err);
      if (!row) return res.status(404).json({ error: 'Notification not found' });
      if (row.user_id !== req.user.id) {
        return res.status(403).json({ error: 'Access denied' });
      }
      next();
    }
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * validateNotificationBody — full input validation for POST /notifications
 * ════════════════════════════════════════════════════════════════════════*/
const validateNotificationBody = [
  body('userId')
    .isInt({ min: 1 })
    .withMessage('userId must be a positive integer'),

  body('type')
    .isIn(['appointment', 'claim', 'payment', 'system', 'medical_record', 'premium_adjustment'])
    .withMessage('Invalid notification type'),

  body('priority')
    .optional()
    .isIn(['low', 'medium', 'high', 'urgent'])
    .withMessage('priority must be low|medium|high|urgent'),

  body('channels')
    .optional()
    .isArray()
    .withMessage('channels must be an array'),

  body('channels.*')
    .optional()
    .isIn(['in_app', 'email', 'sms', 'push'])
    .withMessage('Each channel must be in_app|email|sms|push'),

  body('templateId')
    .optional()
    .isInt({ min: 1 }),

  body('title')
    .optional()
    .isString()
    .isLength({ max: 255 })
    .customSanitizer(sanitiseString),

  body('message')
    .optional()
    .isString()
    .isLength({ max: 5000 })
    .customSanitizer(sanitiseString),

  body('metadata')
    .optional()
    .isObject()
    .customSanitizer(sanitiseObject),

  body('scheduledAt')
    .optional()
    .isISO8601()
    .withMessage('scheduledAt must be an ISO 8601 datetime'),

  body('expiresAt')
    .optional()
    .isISO8601()
    .withMessage('expiresAt must be an ISO 8601 datetime'),

  // Custom: either templateId OR (title + message) must be present
  body().custom((body) => {
    if (!body.templateId && (!body.title || !body.message)) {
      throw new Error('Either templateId or both title and message are required');
    }
    return true;
  }),

  // PHI detection — warn but do not block (configurable)
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    const text = `${req.body.title || ''} ${req.body.message || ''}`;
    const phiDetected = PHI_PATTERNS.some((p) => p.test(text));

    if (phiDetected) {
      console.warn(
        `[NotificationSecurity] ⚠ Potential PHI in notification body — user=${req.user?.id} type=${req.body.type}`
      );
      // Set a header so downstream can audit; does NOT block the request
      res.set('X-PHI-Warning', '1');
    }

    next();
  },
];

/* ══════════════════════════════════════════════════════════════════════════
 * Composite middleware applied to all notification routes in server.js
 * ════════════════════════════════════════════════════════════════════════*/

/** Applied to GET routes */
const notificationReadGuard = [readLimiter];

/** Applied to POST/PATCH/DELETE routes */
const notificationWriteGuard = [writeLimiter];

/** Applied specifically to /send-batch */
const notificationBatchGuard = [batchLimiter];

module.exports = {
  requireRole,
  ownsNotification,
  validateNotificationBody,
  notificationReadGuard,
  notificationWriteGuard,
  notificationBatchGuard,
  readLimiter,
  writeLimiter,
  batchLimiter,
  sanitiseString,
  sanitiseObject,
};
