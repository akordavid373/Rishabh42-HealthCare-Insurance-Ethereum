const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../database/healthcare.db');

function openDb() {
  return new sqlite3.Database(DB_PATH);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * AnalyticsService — event-driven analytics for the notification system.
 *
 * Called by NotificationEngine._trackAnalytics() on every delivery event.
 * Aggregates into notification_analytics table (one row per date/channel/type).
 *
 * All methods are fire-and-forget (non-blocking errors are swallowed)
 * so a failing analytics write never disrupts notification delivery.
 */
const AnalyticsService = {

  /* ─── Track a delivery event ────────────────────────────────────────────── */
  /**
   * @param {object} opts
   * @param {string}  opts.channel     - 'in_app'|'email'|'sms'|'push'
   * @param {string}  opts.type        - notification type
   * @param {boolean} opts.success     - delivery success flag
   * @param {number}  [opts.latencyMs] - delivery latency in ms
   * @param {string}  [opts.event]     - override event: 'opened', 'failed', etc.
   */
  track({ channel, type, success, latencyMs, event } = {}) {
    if (!channel) return;

    const safeType    = type    || 'unknown';
    const safeChannel = channel || 'in_app';
    const date        = todayStr();

    const db = openDb();

    // Upsert analytics row
    db.run(
      `INSERT INTO notification_analytics (date, channel, notification_type, sent_count)
       VALUES (?, ?, ?, 0)
       ON CONFLICT(date, channel, notification_type) DO NOTHING`,
      [date, safeChannel, safeType],
      () => {
        let updateSql;
        let params;

        if (event === 'opened') {
          updateSql = `UPDATE notification_analytics
                       SET opened_count = opened_count + 1, updated_at = CURRENT_TIMESTAMP
                       WHERE date = ? AND channel = ? AND notification_type = ?`;
          params = [date, safeChannel, safeType];
        } else if (success === true) {
          // Delivered — update sent + delivered + avg latency
          updateSql = `UPDATE notification_analytics
                       SET sent_count       = sent_count + 1,
                           delivered_count  = delivered_count + 1,
                           avg_latency_ms   = CASE
                             WHEN delivered_count = 0 THEN ?
                             ELSE (avg_latency_ms * delivered_count + ?) / (delivered_count + 1)
                           END,
                           updated_at = CURRENT_TIMESTAMP
                       WHERE date = ? AND channel = ? AND notification_type = ?`;
          params = [latencyMs || 0, latencyMs || 0, date, safeChannel, safeType];
        } else if (success === false) {
          updateSql = `UPDATE notification_analytics
                       SET sent_count   = sent_count + 1,
                           failed_count = failed_count + 1,
                           updated_at   = CURRENT_TIMESTAMP
                       WHERE date = ? AND channel = ? AND notification_type = ?`;
          params = [date, safeChannel, safeType];
        } else {
          db.close();
          return;
        }

        db.run(updateSql, params, (err) => {
          if (err) console.warn('[AnalyticsService] track error:', err.message);
          db.close();
        });
      }
    );
  },

  /* ─── Dashboard summary ─────────────────────────────────────────────────── */
  /**
   * Returns aggregated metrics across all channels and types.
   *
   * @param {string} [from] - YYYY-MM-DD  (defaults to 30 days ago)
   * @param {string} [to]   - YYYY-MM-DD  (defaults to today)
   * @returns {Promise<object>}
   */
  async getDashboard(from, to) {
    const db = openDb();
    const dateFrom = from || new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
    const dateTo   = to   || todayStr();

    try {
      const [totals, byChannel, byType, recentFailures] = await Promise.all([
        this._query(db, `
          SELECT
            SUM(sent_count)       as total_sent,
            SUM(delivered_count)  as total_delivered,
            SUM(opened_count)     as total_opened,
            SUM(failed_count)     as total_failed,
            CASE WHEN SUM(sent_count) > 0
              THEN ROUND(100.0 * SUM(delivered_count) / SUM(sent_count), 1)
              ELSE 0 END as delivery_rate_pct,
            CASE WHEN SUM(delivered_count) > 0
              THEN ROUND(100.0 * SUM(opened_count) / SUM(delivered_count), 1)
              ELSE 0 END as open_rate_pct,
            ROUND(AVG(avg_latency_ms), 0) as avg_latency_ms
          FROM notification_analytics
          WHERE date BETWEEN ? AND ?
        `, [dateFrom, dateTo], 'get'),

        this._query(db, `
          SELECT channel,
            SUM(sent_count) as sent, SUM(delivered_count) as delivered,
            SUM(opened_count) as opened, SUM(failed_count) as failed,
            ROUND(AVG(avg_latency_ms), 0) as avg_latency_ms,
            CASE WHEN SUM(sent_count) > 0
              THEN ROUND(100.0 * SUM(delivered_count) / SUM(sent_count), 1)
              ELSE 0 END as delivery_rate_pct
          FROM notification_analytics
          WHERE date BETWEEN ? AND ?
          GROUP BY channel ORDER BY sent DESC
        `, [dateFrom, dateTo], 'all'),

        this._query(db, `
          SELECT notification_type as type,
            SUM(sent_count) as sent, SUM(delivered_count) as delivered,
            SUM(opened_count) as opened, SUM(failed_count) as failed,
            CASE WHEN SUM(delivered_count) > 0
              THEN ROUND(100.0 * SUM(opened_count) / SUM(delivered_count), 1)
              ELSE 0 END as open_rate_pct
          FROM notification_analytics
          WHERE date BETWEEN ? AND ?
          GROUP BY notification_type ORDER BY sent DESC
        `, [dateFrom, dateTo], 'all'),

        this._query(db, `
          SELECT nd.channel, nd.error_code, nd.error_message, COUNT(*) as count
          FROM notification_deliveries nd
          WHERE nd.status = 'failed'
            AND nd.created_at >= datetime('now', '-30 days')
          GROUP BY nd.channel, nd.error_code
          ORDER BY count DESC LIMIT 10
        `, [], 'all'),
      ]);

      return {
        period:    { from: dateFrom, to: dateTo },
        totals,
        byChannel,
        byType,
        recentFailures,
      };
    } finally {
      db.close();
    }
  },

  /* ─── Daily trend data ─────────────────────────────────────────────────── */
  async getTrends(from, to) {
    const db = openDb();
    const dateFrom = from || new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
    const dateTo   = to   || todayStr();

    try {
      return this._query(db, `
        SELECT date,
          SUM(sent_count)      as sent,
          SUM(delivered_count) as delivered,
          SUM(opened_count)    as opened,
          SUM(failed_count)    as failed
        FROM notification_analytics
        WHERE date BETWEEN ? AND ?
        GROUP BY date ORDER BY date ASC
      `, [dateFrom, dateTo], 'all');
    } finally {
      db.close();
    }
  },

  /* ─── Per-channel breakdown ─────────────────────────────────────────────── */
  async getChannelBreakdown(from, to) {
    const db = openDb();
    const dateFrom = from || new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
    const dateTo   = to   || todayStr();

    try {
      return this._query(db, `
        SELECT date, channel,
          SUM(sent_count)      as sent,
          SUM(delivered_count) as delivered,
          SUM(opened_count)    as opened,
          SUM(failed_count)    as failed,
          ROUND(AVG(avg_latency_ms), 0) as avg_latency_ms
        FROM notification_analytics
        WHERE date BETWEEN ? AND ?
        GROUP BY date, channel ORDER BY date, channel
      `, [dateFrom, dateTo], 'all');
    } finally {
      db.close();
    }
  },

  /* ─── Failure analysis ──────────────────────────────────────────────────── */
  async getFailures(from, to) {
    const db = openDb();
    const dateFrom = from || new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
    const dateTo   = to   || todayStr();

    try {
      return this._query(db, `
        SELECT nd.channel, nd.error_code, nd.error_message,
          COUNT(*) as total_failures,
          MAX(nd.created_at) as last_seen
        FROM notification_deliveries nd
        WHERE nd.status = 'failed'
          AND DATE(nd.created_at) BETWEEN ? AND ?
        GROUP BY nd.channel, nd.error_code, nd.error_message
        ORDER BY total_failures DESC
      `, [dateFrom, dateTo], 'all');
    } finally {
      db.close();
    }
  },

  /* ─── Helper: promisify db.get / db.all ─────────────────────────────────── */
  _query(db, sql, params, method) {
    return new Promise((resolve, reject) => {
      db[method](sql, params, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
  },
};

module.exports = AnalyticsService;
