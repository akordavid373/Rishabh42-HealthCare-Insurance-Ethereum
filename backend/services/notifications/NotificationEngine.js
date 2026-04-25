const EventEmitter = require('events');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../database/healthcare.db');

// Channel adapters — loaded lazily so the engine works even if a channel module fails
let InAppChannel, EmailChannel, SMSChannel, PushChannel;

function loadChannels(io) {
  InAppChannel = InAppChannel || new (require('./channels/InAppChannel'))(io);
  EmailChannel = EmailChannel || new (require('./channels/EmailChannel'))();
  SMSChannel   = SMSChannel   || new (require('./channels/SMSChannel'))();
  PushChannel  = PushChannel  || new (require('./channels/PushChannel'))();
  return { InAppChannel, EmailChannel, SMSChannel, PushChannel };
}

const CHANNEL_MAP = {
  in_app: 'InAppChannel',
  email:  'EmailChannel',
  sms:    'SMSChannel',
  push:   'PushChannel',
};

/**
 * NotificationEngine — central orchestrator for all notification dispatch.
 *
 * Usage:
 *   const engine = NotificationEngine.getInstance(io);
 *   await engine.send({ userId, type, priority, channels, templateId, metadata, title, message });
 *
 * Events emitted:
 *   'notification:sent'      { notificationId, userId, channels }
 *   'notification:failed'    { notificationId, error }
 *   'notification:delivered' { notificationId, channel, messageId }
 *   'notification:opened'    { notificationId, channel }
 */
class NotificationEngine extends EventEmitter {
  constructor(io) {
    super();
    this.io = io;
    this._channels = null;
  }

  /* ─── Singleton ─────────────────────────────────────────────────────── */
  static getInstance(io) {
    if (!NotificationEngine._instance) {
      NotificationEngine._instance = new NotificationEngine(io);
    } else if (io && !NotificationEngine._instance.io) {
      NotificationEngine._instance.io = io;
    }
    return NotificationEngine._instance;
  }

  getChannels() {
    if (!this._channels) {
      this._channels = loadChannels(this.io);
    }
    return this._channels;
  }

  getDatabase() {
    return new sqlite3.Database(DB_PATH);
  }

  /* ─── send() ─────────────────────────────────────────────────────────── */
  /**
   * Send a single notification.
   *
   * @param {object} payload
   * @param {number}   payload.userId          - target user id
   * @param {string}   payload.type            - notification type (e.g. 'appointment')
   * @param {string}   [payload.priority]      - 'low'|'medium'|'high'|'urgent' (default: 'medium')
   * @param {string[]} [payload.channels]      - override channels (default: from user preferences)
   * @param {number}   [payload.templateId]    - template id for rendering
   * @param {object}   [payload.metadata]      - template variables
   * @param {string}   [payload.title]         - title (used if no template)
   * @param {string}   [payload.message]       - message body (used if no template)
   * @param {string}   [payload.scheduledAt]   - ISO datetime for deferred delivery
   * @param {string}   [payload.expiresAt]     - ISO datetime after which notification is void
   * @returns {Promise<{notificationId: number, queued: boolean}>}
   */
  async send(payload) {
    this._validatePayload(payload);

    const PersonalizationService = require('./PersonalizationService');
    const TemplateEngine         = require('./TemplateEngine');

    const {
      userId,
      type,
      priority = 'medium',
      channels: requestedChannels,
      templateId,
      metadata = {},
      title: rawTitle,
      message: rawMessage,
      scheduledAt,
      expiresAt,
    } = payload;

    // 1. Resolve channels via personalization
    const channels = requestedChannels && requestedChannels.length
      ? requestedChannels
      : await PersonalizationService.getEnabledChannels(userId, type);

    // 2. Check quiet hours — defer to next_attempt_at if needed
    const isQuiet  = await PersonalizationService.isQuietHours(userId);
    const sendTime = (scheduledAt || (isQuiet ? await PersonalizationService.getQuietHoursEnd(userId) : null));

    // 3. Check frequency cap
    const capped = await PersonalizationService.checkFrequencyCap(userId, type);
    if (capped) {
      console.warn(`[NotificationEngine] Frequency cap reached for user ${userId}, type=${type}`);
      return { notificationId: null, queued: false, skipped: true, reason: 'frequency_cap' };
    }

    // 4. Render content
    let title = rawTitle || '';
    let message = rawMessage || '';

    if (templateId) {
      const rendered = await TemplateEngine.render(templateId, metadata, channels);
      title   = rendered.subject || title;
      message = rendered.body    || message;
    }

    // 5. Persist notification row
    const notificationId = await this._persistNotification({
      userId, type, priority, title, message,
      templateId, metadata, channels,
      scheduledAt: sendTime, expiresAt,
    });

    // 6. Enqueue for processing
    await this._enqueue(notificationId, priority, sendTime, { channels, metadata, templateId });

    this.emit('notification:sent', { notificationId, userId, channels });
    return { notificationId, queued: true };
  }

  /* ─── sendBatch() ────────────────────────────────────────────────────── */
  /**
   * Send to multiple users efficiently in a single DB transaction.
   * @param {object[]} payloads - array of send() payload objects
   * @returns {Promise<{sent: number, skipped: number, ids: number[]}>}
   */
  async sendBatch(payloads) {
    const results = { sent: 0, skipped: 0, ids: [] };

    for (const payload of payloads) {
      try {
        const result = await this.send(payload);
        if (result.skipped) {
          results.skipped++;
        } else {
          results.sent++;
          if (result.notificationId) results.ids.push(result.notificationId);
        }
      } catch (err) {
        console.error('[NotificationEngine] Batch item failed:', err.message);
        results.skipped++;
      }
    }

    return results;
  }

  /* ─── dispatch() ─────────────────────────────────────────────────────── */
  /**
   * Called by QueueProcessor to actually deliver a queued notification.
   * @param {number} notificationId
   * @param {object} queuePayload - { channels, metadata, templateId }
   */
  async dispatch(notificationId, queuePayload) {
    const TemplateEngine = require('./TemplateEngine');
    const db = this.getDatabase();

    try {
      // Load notification row
      const notification = await this._getNotification(db, notificationId);
      if (!notification) throw new Error(`Notification ${notificationId} not found`);

      // Check expiry
      if (notification.expires_at && new Date(notification.expires_at) < new Date()) {
        await this._updateDeliveryStatus(db, notificationId, 'expired');
        return { skipped: true, reason: 'expired' };
      }

      const { channels = ['in_app'], metadata = {}, templateId } = queuePayload || {};
      const channelInstances = this.getChannels();

      const results = [];

      for (const channel of channels) {
        const adapterKey = CHANNEL_MAP[channel];
        const adapter    = channelInstances[adapterKey];

        if (!adapter) {
          console.warn(`[NotificationEngine] No adapter for channel: ${channel}`);
          continue;
        }

        // Render channel-specific content
        let content = { title: notification.title, body: notification.message };
        if (templateId) {
          content = await TemplateEngine.renderForChannel(templateId, metadata, channel);
        }

        // Record delivery attempt
        const deliveryId = await this._createDeliveryRecord(db, notificationId, channel);

        const startMs = Date.now();
        try {
          const result = await adapter.deliver(notification, content);
          const latencyMs = Date.now() - startMs;

          await this._updateDeliveryRecord(db, deliveryId, {
            status: result.success ? 'delivered' : 'failed',
            messageId: result.messageId,
            errorCode: result.errorCode,
            errorMessage: result.error,
            deliveredAt: result.success ? new Date().toISOString() : null,
          });

          // Update analytics
          this._trackAnalytics(channel, notification.type, result.success, latencyMs);

          if (result.success) {
            this.emit('notification:delivered', { notificationId, channel, messageId: result.messageId });
          } else {
            this.emit('notification:failed', { notificationId, channel, error: result.error });
          }

          results.push({ channel, success: result.success });
        } catch (channelErr) {
          await this._updateDeliveryRecord(db, deliveryId, {
            status: 'failed',
            errorMessage: channelErr.message,
          });
          this.emit('notification:failed', { notificationId, channel, error: channelErr.message });
          results.push({ channel, success: false, error: channelErr.message });
        }
      }

      // Mark notification delivered if any channel succeeded
      const anySuccess = results.some((r) => r.success);
      await this._updateDeliveryStatus(db, notificationId, anySuccess ? 'delivered' : 'failed');

      return { results };
    } finally {
      db.close();
    }
  }

  /* ─── cancel() ───────────────────────────────────────────────────────── */
  async cancel(notificationId) {
    const db = this.getDatabase();
    try {
      return new Promise((resolve, reject) => {
        db.run(
          `UPDATE notification_queue SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
           WHERE notification_id = ? AND status = 'pending'`,
          [notificationId],
          function (err) {
            if (err) reject(err);
            else resolve({ cancelled: this.changes > 0 });
          }
        );
      });
    } finally {
      db.close();
    }
  }

  /* ─── markOpened() ───────────────────────────────────────────────────── */
  async markOpened(notificationId, channel = 'in_app') {
    const db = this.getDatabase();
    try {
      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE notification_deliveries
           SET status = 'opened', opened_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
           WHERE notification_id = ? AND channel = ? AND status != 'opened'`,
          [notificationId, channel],
          (err) => { if (err) reject(err); else resolve(); }
        );
      });
      this.emit('notification:opened', { notificationId, channel });
      this._trackAnalytics(channel, null, null, null, 'opened');
    } finally {
      db.close();
    }
  }

  /* ─── Private helpers ────────────────────────────────────────────────── */
  _validatePayload(payload) {
    if (!payload || !payload.userId) throw new Error('NotificationEngine.send: userId is required');
    if (!payload.type)    throw new Error('NotificationEngine.send: type is required');
    if (!payload.templateId && (!payload.title || !payload.message)) {
      throw new Error('NotificationEngine.send: either templateId or (title + message) is required');
    }
  }

  _persistNotification({ userId, type, priority, title, message, templateId, metadata, scheduledAt, expiresAt }) {
    const db = this.getDatabase();
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO notifications
          (user_id, title, message, type, priority, channel, template_id, metadata,
           delivery_status, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, 'in_app', ?, ?, 'pending', ?, CURRENT_TIMESTAMP)`,
        [userId, title, message, type, priority, templateId || null,
         metadata ? JSON.stringify(metadata) : null, expiresAt || null],
        function (err) {
          db.close();
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });
  }

  _enqueue(notificationId, priority, scheduledAt, payload) {
    const db = this.getDatabase();
    const priorityValue = { urgent: 1, high: 2, medium: 5, low: 8 }[priority] || 5;
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO notification_queue
          (notification_id, priority, payload, scheduled_at, next_attempt_at)
         VALUES (?, ?, ?, ?, ?)`,
        [
          notificationId,
          priorityValue,
          JSON.stringify(payload),
          scheduledAt || new Date().toISOString(),
          scheduledAt || new Date().toISOString(),
        ],
        function (err) {
          db.close();
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });
  }

  _getNotification(db, notificationId) {
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM notifications WHERE id = ?', [notificationId], (err, row) => {
        if (err) reject(err); else resolve(row);
      });
    });
  }

  _createDeliveryRecord(db, notificationId, channel) {
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO notification_deliveries (notification_id, channel, status)
         VALUES (?, ?, 'pending')`,
        [notificationId, channel],
        function (err) { if (err) reject(err); else resolve(this.lastID); }
      );
    });
  }

  _updateDeliveryRecord(db, deliveryId, { status, messageId, errorCode, errorMessage, deliveredAt }) {
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE notification_deliveries
         SET status = ?, message_id = ?, error_code = ?, error_message = ?,
             delivered_at = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [status, messageId || null, errorCode || null, errorMessage || null, deliveredAt || null, deliveryId],
        (err) => { if (err) reject(err); else resolve(); }
      );
    });
  }

  _updateDeliveryStatus(db, notificationId, status) {
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE notifications SET delivery_status = ? WHERE id = ?`,
        [status, notificationId],
        (err) => { if (err) reject(err); else resolve(); }
      );
    });
  }

  _trackAnalytics(channel, type, success, latencyMs, event = null) {
    // Delegate to AnalyticsService (non-blocking)
    try {
      const AnalyticsService = require('./AnalyticsService');
      AnalyticsService.track({ channel, type, success, latencyMs, event });
    } catch (_) {
      // Analytics is non-critical
    }
  }
}

module.exports = NotificationEngine;
