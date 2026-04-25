const express = require('express');
const { body, query, param, validationResult } = require('express-validator');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const NotificationEngine     = require('../services/notifications/NotificationEngine');
const TemplateEngine         = require('../services/notifications/TemplateEngine');
const PersonalizationService = require('../services/notifications/PersonalizationService');
const { setCache, deleteCache } = require('../middleware/cache');
const { validateNotificationBody, requireRole, ownsNotification } = require('../middleware/notificationSecurity');

const router  = express.Router();
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../database/healthcare.db');

function openDb() { return new sqlite3.Database(DB_PATH); }

function handleValidation(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: 'Validation failed', details: errors.array() });
    return true;
  }
  return false;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * GET /api/notifications
 * List notifications for the authenticated user (paginated + filterable)
 * ═════════════════════════════════════════════════════════════════════════*/
router.get('/', [
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('offset').optional().isInt({ min: 0 }).toInt(),
  query('type').optional().isIn(['appointment','claim','payment','system','medical_record','premium_adjustment']),
  query('priority').optional().isIn(['low','medium','high','urgent']),
  query('read').optional().isIn(['true','false']),
  query('channel').optional().isIn(['in_app','email','sms','push']),
], async (req, res, next) => {
  if (handleValidation(req, res)) return;

  const userId = req.user.id;
  const { limit = 20, offset = 0, type, priority, read, channel } = req.query;

  const db = openDb();
  try {
    let where = 'WHERE n.user_id = ?';
    const params = [userId];

    if (type)     { where += ' AND n.type = ?';             params.push(type); }
    if (priority) { where += ' AND n.priority = ?';         params.push(priority); }
    if (channel)  { where += ' AND n.channel = ?';          params.push(channel); }
    if (read === 'true')  { where += ' AND n.read = 1'; }
    if (read === 'false') { where += ' AND n.read = 0'; }

    const [notifications, countRow] = await Promise.all([
      new Promise((resolve, reject) => {
        db.all(
          `SELECT n.*,
             GROUP_CONCAT(nd.channel || ':' || nd.status) as delivery_summary
           FROM notifications n
           LEFT JOIN notification_deliveries nd ON nd.notification_id = n.id
           ${where}
           GROUP BY n.id
           ORDER BY n.created_at DESC
           LIMIT ? OFFSET ?`,
          [...params, limit, offset],
          (err, rows) => { if (err) reject(err); else resolve(rows); }
        );
      }),
      new Promise((resolve, reject) => {
        db.get(
          `SELECT COUNT(*) as total FROM notifications n ${where}`,
          params,
          (err, row) => { if (err) reject(err); else resolve(row); }
        );
      }),
    ]);

    const result = {
      notifications: notifications.map((n) => ({
        ...n,
        metadata: n.metadata ? JSON.parse(n.metadata) : null,
        deliveries: n.delivery_summary
          ? n.delivery_summary.split(',').map((s) => {
              const [ch, st] = s.split(':');
              return { channel: ch, status: st };
            })
          : [],
      })),
      pagination: {
        total: countRow.total,
        limit,
        offset,
        hasMore: offset + limit < countRow.total,
      },
    };

    setCache(req.originalUrl, result);
    res.json(result);
  } catch (err) {
    next(err);
  } finally {
    db.close();
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
 * GET /api/notifications/unread-count
 * ═════════════════════════════════════════════════════════════════════════*/
router.get('/unread-count', async (req, res, next) => {
  const db = openDb();
  try {
    const row = await new Promise((resolve, reject) => {
      db.get(
        'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND read = 0',
        [req.user.id],
        (err, r) => { if (err) reject(err); else resolve(r); }
      );
    });
    res.set('Cache-Control', 'private, max-age=30');
    res.json({ count: row.count });
  } catch (err) {
    next(err);
  } finally {
    db.close();
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
 * GET /api/notifications/templates
 * List available notification templates (admin/provider)
 * ═════════════════════════════════════════════════════════════════════════*/
router.get('/templates', requireRole('admin', 'provider'), async (req, res, next) => {
  try {
    const templates = await TemplateEngine.listTemplates();
    res.json({ templates });
  } catch (err) {
    next(err);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
 * POST /api/notifications/templates/preview
 * Preview a rendered template with sample variables
 * ═════════════════════════════════════════════════════════════════════════*/
router.post('/templates/preview', requireRole('admin', 'provider'), [
  body('templateId').isInt({ min: 1 }),
  body('variables').optional().isObject(),
], async (req, res, next) => {
  if (handleValidation(req, res)) return;
  try {
    const preview = await TemplateEngine.preview(req.body.templateId, req.body.variables || {});
    res.json(preview);
  } catch (err) {
    next(err);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
 * GET /api/notifications/unsubscribe?token=...
 * Token-based unsubscribe link (no auth required — arrives from email)
 * ═════════════════════════════════════════════════════════════════════════*/
router.get('/unsubscribe', async (req, res, next) => {
  const { token, channel = 'email' } = req.query;
  if (!token) return res.status(400).json({ error: 'Token required' });

  const decoded = PersonalizationService.validateUnsubscribeToken(token);
  if (!decoded) return res.status(400).json({ error: 'Invalid or expired token' });

  try {
    const field = channel === 'sms' ? 'unsubscribed_sms' : 'unsubscribed_email';
    await PersonalizationService.updatePreferences(decoded.userId, { [field]: 1 });
    res.json({ message: `Successfully unsubscribed from ${channel} notifications` });
  } catch (err) {
    next(err);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
 * GET /api/notifications/:id
 * Single notification with full delivery details
 * ═════════════════════════════════════════════════════════════════════════*/
router.get('/:id', param('id').isInt({ min: 1 }), ownsNotification, async (req, res, next) => {
  if (handleValidation(req, res)) return;
  const db = openDb();
  try {
    const [notification, deliveries] = await Promise.all([
      new Promise((resolve, reject) => {
        db.get('SELECT * FROM notifications WHERE id = ?', [req.params.id], (err, row) => {
          if (err) reject(err); else resolve(row);
        });
      }),
      new Promise((resolve, reject) => {
        db.all(
          'SELECT * FROM notification_deliveries WHERE notification_id = ? ORDER BY created_at',
          [req.params.id],
          (err, rows) => { if (err) reject(err); else resolve(rows); }
        );
      }),
    ]);

    if (!notification) return res.status(404).json({ error: 'Notification not found' });

    res.json({
      ...notification,
      metadata:   notification.metadata ? JSON.parse(notification.metadata) : null,
      deliveries,
    });
  } catch (err) {
    next(err);
  } finally {
    db.close();
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
 * POST /api/notifications
 * Create & send a notification (admin/provider only)
 * ═════════════════════════════════════════════════════════════════════════*/
router.post('/', requireRole('admin', 'provider'), validateNotificationBody, async (req, res, next) => {
  if (handleValidation(req, res)) return;
  try {
    const engine = NotificationEngine.getInstance();
    const result = await engine.send({
      userId:      req.body.userId,
      type:        req.body.type,
      priority:    req.body.priority    || 'medium',
      channels:    req.body.channels    || [],
      templateId:  req.body.templateId  || null,
      metadata:    req.body.metadata    || {},
      title:       req.body.title       || '',
      message:     req.body.message     || '',
      scheduledAt: req.body.scheduledAt || null,
      expiresAt:   req.body.expiresAt   || null,
    });

    if (result.skipped) {
      return res.status(429).json({ message: 'Notification suppressed', reason: result.reason });
    }

    deleteCache(`/api/notifications`);
    res.status(202).json({ message: 'Notification queued', notificationId: result.notificationId });
  } catch (err) {
    next(err);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
 * POST /api/notifications/send-batch
 * Batch send to multiple users (admin only)
 * ═════════════════════════════════════════════════════════════════════════*/
router.post('/send-batch', requireRole('admin'), [
  body('notifications').isArray({ min: 1, max: 100 }).withMessage('1–100 notifications required'),
  body('notifications.*.userId').isInt({ min: 1 }),
  body('notifications.*.type').notEmpty(),
], async (req, res, next) => {
  if (handleValidation(req, res)) return;
  try {
    const engine  = NotificationEngine.getInstance();
    const results = await engine.sendBatch(req.body.notifications);
    res.status(202).json({ message: 'Batch queued', ...results });
  } catch (err) {
    next(err);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
 * PATCH /api/notifications/:id/read
 * Mark single notification as read
 * ═════════════════════════════════════════════════════════════════════════*/
router.patch('/:id/read', param('id').isInt({ min: 1 }), ownsNotification, async (req, res, next) => {
  if (handleValidation(req, res)) return;
  const db = openDb();
  try {
    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE notifications SET read = 1, read_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`,
        [req.params.id, req.user.id],
        (err) => { if (err) reject(err); else resolve(); }
      );
    });

    // Track open analytics
    const engine = NotificationEngine.getInstance();
    engine.markOpened(parseInt(req.params.id, 10)).catch(() => {});

    deleteCache(`/api/notifications`);
    res.json({ message: 'Marked as read' });
  } catch (err) {
    next(err);
  } finally {
    db.close();
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
 * PATCH /api/notifications/read-all
 * Mark all notifications read for the authenticated user
 * ═════════════════════════════════════════════════════════════════════════*/
router.patch('/read-all', async (req, res, next) => {
  const db = openDb();
  try {
    const { changes } = await new Promise((resolve, reject) => {
      db.run(
        `UPDATE notifications SET read = 1, read_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND read = 0`,
        [req.user.id],
        function (err) { if (err) reject(err); else resolve({ changes: this.changes }); }
      );
    });
    deleteCache(`/api/notifications`);
    res.json({ message: 'All notifications marked as read', count: changes });
  } catch (err) {
    next(err);
  } finally {
    db.close();
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
 * DELETE /api/notifications/:id
 * Soft-delete (sets delivery_status = 'deleted')
 * ═════════════════════════════════════════════════════════════════════════*/
router.delete('/:id', param('id').isInt({ min: 1 }), ownsNotification, async (req, res, next) => {
  if (handleValidation(req, res)) return;
  const db = openDb();
  try {
    // Cancel queue job if still pending
    const engine = NotificationEngine.getInstance();
    await engine.cancel(parseInt(req.params.id, 10));

    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE notifications SET delivery_status = 'deleted' WHERE id = ? AND user_id = ?`,
        [req.params.id, req.user.id],
        function (err) { if (err) reject(err); else resolve({ changes: this.changes }); }
      );
    });

    deleteCache(`/api/notifications`);
    res.json({ message: 'Notification deleted' });
  } catch (err) {
    next(err);
  } finally {
    db.close();
  }
});

module.exports = router;
