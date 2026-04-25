const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../database/healthcare.db');

const POLL_INTERVAL_MS  = parseInt(process.env.NOTIFICATION_POLL_MS,  10) || 5000;
const CONCURRENCY       = parseInt(process.env.NOTIFICATION_CONCURRENCY, 10) || 5;
const RETRY_DELAYS_MS   = [60_000, 300_000, 900_000]; // 1 min, 5 min, 15 min

/**
 * QueueProcessor — polls notification_queue and dispatches jobs.
 *
 * Lifecycle:
 *   QueueProcessor.start()  — begin polling (called from server.js)
 *   QueueProcessor.stop()   — graceful shutdown (called on SIGTERM)
 */
class QueueProcessor {
  constructor() {
    this._timer    = null;
    this._active   = 0;         // currently processing jobs
    this._running  = false;
    this._stopping = false;
  }

  static getInstance() {
    if (!QueueProcessor._instance) {
      QueueProcessor._instance = new QueueProcessor();
    }
    return QueueProcessor._instance;
  }

  /* ─── Lifecycle ──────────────────────────────────────────────────────── */
  start() {
    if (this._running) return;
    this._running  = true;
    this._stopping = false;
    console.log(`🔔 Notification queue processor started (poll=${POLL_INTERVAL_MS}ms, concurrency=${CONCURRENCY})`);
    this._schedule();
  }

  stop() {
    this._stopping = true;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this._running = false;
    console.log('🔔 Notification queue processor stopped');
  }

  /* ─── Poll loop ──────────────────────────────────────────────────────── */
  _schedule() {
    this._timer = setTimeout(() => this._poll(), POLL_INTERVAL_MS);
  }

  async _poll() {
    if (this._stopping) return;

    const available = CONCURRENCY - this._active;
    if (available <= 0) {
      this._schedule();
      return;
    }

    const jobs = await this._fetchPendingJobs(available);
    if (jobs.length === 0) {
      this._schedule();
      return;
    }

    for (const job of jobs) {
      this._active++;
      this._processJob(job)
        .finally(() => {
          this._active--;
        });
    }

    this._schedule();
  }

  /* ─── Fetch pending jobs ─────────────────────────────────────────────── */
  _fetchPendingJobs(limit) {
    const db = this._openDb();
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM notification_queue
         WHERE status = 'pending'
           AND next_attempt_at <= datetime('now')
         ORDER BY priority ASC, created_at ASC
         LIMIT ?`,
        [limit],
        (err, rows) => {
          db.close();
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  }

  /* ─── Process a single job ───────────────────────────────────────────── */
  async _processJob(job) {
    const db = this._openDb();

    try {
      // Mark as processing
      await this._markProcessing(db, job.id);

      const NotificationEngine = require('./NotificationEngine');
      const engine = NotificationEngine.getInstance();

      let payload = {};
      try { payload = JSON.parse(job.payload || '{}'); } catch (_) {}

      await engine.dispatch(job.notification_id, payload);

      await this._markCompleted(db, job.id);
    } catch (err) {
      console.error(`[QueueProcessor] Job ${job.id} failed:`, err.message);
      await this._markFailed(db, job, err.message);
    } finally {
      db.close();
    }
  }

  /* ─── Status updates ─────────────────────────────────────────────────── */
  _markProcessing(db, jobId) {
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE notification_queue
         SET status = 'processing', started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [jobId],
        (err) => { if (err) reject(err); else resolve(); }
      );
    });
  }

  _markCompleted(db, jobId) {
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE notification_queue
         SET status = 'completed', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [jobId],
        (err) => { if (err) reject(err); else resolve(); }
      );
    });
  }

  _markFailed(db, job, errorMessage) {
    return new Promise((resolve, reject) => {
      const retryCount  = (job.retry_count || 0) + 1;
      const maxRetries  = job.max_retries || 3;
      const shouldRetry = retryCount < maxRetries;
      const delayMs     = RETRY_DELAYS_MS[retryCount - 1] || RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
      const nextAttempt = new Date(Date.now() + delayMs).toISOString();

      db.run(
        `UPDATE notification_queue
         SET status = ?,
             retry_count = ?,
             next_attempt_at = ?,
             error_message = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          shouldRetry ? 'pending' : 'failed',
          retryCount,
          shouldRetry ? nextAttempt : null,
          errorMessage,
          job.id,
        ],
        (err) => { if (err) reject(err); else resolve(); }
      );
    });
  }

  /* ─── Queue status snapshot ──────────────────────────────────────────── */
  getStatus() {
    const db = this._openDb();
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT
           SUM(CASE WHEN status = 'pending'    THEN 1 ELSE 0 END) as pending,
           SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
           SUM(CASE WHEN status = 'completed'  THEN 1 ELSE 0 END) as completed,
           SUM(CASE WHEN status = 'failed'     THEN 1 ELSE 0 END) as failed,
           SUM(CASE WHEN status = 'cancelled'  THEN 1 ELSE 0 END) as cancelled
         FROM notification_queue`,
        [],
        (err, row) => {
          db.close();
          if (err) reject(err);
          else resolve({ ...row, active_workers: this._active, running: this._running });
        }
      );
    });
  }

  _openDb() {
    return new sqlite3.Database(DB_PATH);
  }
}

module.exports = QueueProcessor;
