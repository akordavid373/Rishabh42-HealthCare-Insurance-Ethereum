const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../database/healthcare.db');

// Default caps — can be overridden per user in notification_preferences
const DEFAULT_CAP_HOURLY = parseInt(process.env.NOTIFICATION_CAP_HOURLY, 10) || 5;
const DEFAULT_CAP_DAILY  = parseInt(process.env.NOTIFICATION_CAP_DAILY,  10) || 20;

// Channel priority order by notification priority
const CHANNEL_PRIORITY = {
  urgent: ['sms', 'push', 'in_app', 'email'],
  high:   ['in_app', 'push', 'email', 'sms'],
  medium: ['in_app', 'email'],
  low:    ['in_app'],
};

function openDb() {
  return new sqlite3.Database(DB_PATH);
}

/**
 * PersonalizationService — user-driven channel selection, quiet hours,
 * frequency capping, and optimal send-time calculation.
 *
 * All methods are stateless and work directly against the DB.
 */
const PersonalizationService = {

  /* ─── Load or create user preferences ──────────────────────────────────── */
  async getPreferences(userId) {
    const db = openDb();
    try {
      let prefs = await new Promise((resolve, reject) => {
        db.get(
          'SELECT * FROM notification_preferences WHERE user_id = ?',
          [userId],
          (err, row) => { if (err) reject(err); else resolve(row); }
        );
      });

      if (!prefs) {
        // Auto-create default prefs row
        prefs = await this._createDefaultPreferences(db, userId);
      }

      return prefs;
    } finally {
      db.close();
    }
  },

  /* ─── Update user preferences ───────────────────────────────────────────── */
  async updatePreferences(userId, updates) {
    const db = openDb();
    try {
      // Ensure prefs row exists
      await this.getPreferences(userId);

      const allowed = [
        'channel_in_app', 'channel_email', 'channel_sms', 'channel_push',
        'quiet_hours_enabled', 'quiet_hours_start', 'quiet_hours_end',
        'frequency_cap_hourly', 'frequency_cap_daily',
        'unsubscribed_email', 'unsubscribed_sms',
        'push_subscription',
        'type_appointment', 'type_claim', 'type_payment',
        'type_system', 'type_medical_record', 'type_premium_adjustment',
      ];

      const safeUpdates = {};
      for (const key of allowed) {
        if (updates[key] !== undefined) safeUpdates[key] = updates[key];
      }

      if (Object.keys(safeUpdates).length === 0) return;

      const setClause = Object.keys(safeUpdates).map((k) => `${k} = ?`).join(', ');
      const values    = [...Object.values(safeUpdates), userId];

      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE notification_preferences SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`,
          values,
          (err) => { if (err) reject(err); else resolve(); }
        );
      });
    } finally {
      db.close();
    }
  },

  /* ─── Determine enabled channels for a user ─────────────────────────────── */
  async getEnabledChannels(userId, notificationType) {
    const prefs = await this.getPreferences(userId);

    // Check if this notification type is enabled at all
    const typeKey = `type_${notificationType}`;
    if (prefs[typeKey] === 0) return []; // user opted out of this type

    const channelMap = {
      in_app: prefs.channel_in_app,
      email:  prefs.channel_email && !prefs.unsubscribed_email,
      sms:    prefs.channel_sms   && !prefs.unsubscribed_sms,
      push:   prefs.channel_push,
    };

    return Object.entries(channelMap)
      .filter(([, enabled]) => Boolean(enabled))
      .map(([ch]) => ch);
  },

  /* ─── Quiet hours check ─────────────────────────────────────────────────── */
  async isQuietHours(userId) {
    const prefs = await this.getPreferences(userId);
    if (!prefs.quiet_hours_enabled) return false;

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const [startH, startM] = prefs.quiet_hours_start.split(':').map(Number);
    const [endH, endM]     = prefs.quiet_hours_end.split(':').map(Number);
    const startMin = startH * 60 + startM;
    const endMin   = endH   * 60 + endM;

    // Handle overnight quiet windows (e.g. 22:00 – 08:00)
    if (startMin > endMin) {
      return currentMinutes >= startMin || currentMinutes < endMin;
    }
    return currentMinutes >= startMin && currentMinutes < endMin;
  },

  /* ─── Calculate when quiet hours end ───────────────────────────────────── */
  async getQuietHoursEnd(userId) {
    const prefs = await this.getPreferences(userId);
    if (!prefs.quiet_hours_enabled || !prefs.quiet_hours_end) return null;

    const [endH, endM] = prefs.quiet_hours_end.split(':').map(Number);
    const now = new Date();
    const end = new Date(now);
    end.setHours(endH, endM, 0, 0);
    if (end <= now) end.setDate(end.getDate() + 1);
    return end.toISOString();
  },

  /* ─── Frequency cap enforcement ─────────────────────────────────────────── */
  async checkFrequencyCap(userId, notificationType) {
    const prefs = await this.getPreferences(userId);
    const capHourly = prefs.frequency_cap_hourly || DEFAULT_CAP_HOURLY;
    const capDaily  = prefs.frequency_cap_daily  || DEFAULT_CAP_DAILY;

    const db = openDb();
    try {
      const counts = await new Promise((resolve, reject) => {
        db.get(
          `SELECT
             SUM(CASE WHEN created_at >= datetime('now', '-1 hour') THEN 1 ELSE 0 END) as hourly,
             SUM(CASE WHEN created_at >= datetime('now', '-1 day')  THEN 1 ELSE 0 END) as daily
           FROM notifications
           WHERE user_id = ? AND type = ?`,
          [userId, notificationType],
          (err, row) => { if (err) reject(err); else resolve(row); }
        );
      });

      return (counts.hourly >= capHourly) || (counts.daily >= capDaily);
    } finally {
      db.close();
    }
  },

  /* ─── Rank channels by priority ─────────────────────────────────────────── */
  rankChannelsByPriority(notificationPriority, enabledChannels) {
    const order = CHANNEL_PRIORITY[notificationPriority] || CHANNEL_PRIORITY.medium;
    return order.filter((ch) => enabledChannels.includes(ch));
  },

  /* ─── Generate unsubscribe token ────────────────────────────────────────── */
  generateUnsubscribeToken(userId) {
    const secret  = process.env.JWT_SECRET || 'fallback-secret-key';
    const payload = `${userId}:${Date.now()}`;
    const token   = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    return `${Buffer.from(payload).toString('base64')}.${token}`;
  },

  /* ─── Validate unsubscribe token ────────────────────────────────────────── */
  validateUnsubscribeToken(rawToken) {
    try {
      const secret = process.env.JWT_SECRET || 'fallback-secret-key';
      const [b64, sig] = rawToken.split('.');
      const payload    = Buffer.from(b64, 'base64').toString('utf8');
      const expected   = crypto.createHmac('sha256', secret).update(payload).digest('hex');
      if (sig !== expected) return null;

      const [userIdStr, tsStr] = payload.split(':');
      const age = Date.now() - parseInt(tsStr, 10);
      if (age > 30 * 24 * 60 * 60 * 1000) return null; // expired after 30 days

      return { userId: parseInt(userIdStr, 10) };
    } catch (_) {
      return null;
    }
  },

  /* ─── Private helpers ────────────────────────────────────────────────────── */
  _createDefaultPreferences(db, userId) {
    return new Promise((resolve, reject) => {
      const token = crypto.randomBytes(32).toString('hex');
      db.run(
        `INSERT OR IGNORE INTO notification_preferences (user_id, unsubscribe_token)
         VALUES (?, ?)`,
        [userId, token],
        function (err) {
          if (err) reject(err);
          else {
            db.get(
              'SELECT * FROM notification_preferences WHERE user_id = ?',
              [userId],
              (err2, row) => { if (err2) reject(err2); else resolve(row); }
            );
          }
        }
      );
    });
  },
};

module.exports = PersonalizationService;
