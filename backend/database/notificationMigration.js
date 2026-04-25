const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'healthcare.db');

/**
 * Default notification templates seeded on first run.
 * Variables use {{snake_case}} syntax rendered by TemplateEngine.
 */
const DEFAULT_TEMPLATES = [
  {
    name: 'appointment_reminder',
    description: 'Sent 24h before an appointment',
    notification_type: 'appointment',
    subject_template: 'Appointment Reminder: {{appointment_type}} on {{appointment_date}}',
    body_template:
      'Hi {{patient_name}}, this is a reminder of your {{appointment_type}} appointment with {{provider_name}} on {{appointment_date}} at {{appointment_time}}. {{#virtual}}Join via: {{meeting_link}}{{/virtual}}',
    push_title_template: 'Upcoming Appointment',
    push_body_template: '{{appointment_type}} with {{provider_name}} on {{appointment_date}}',
    sms_template:
      'Reminder: {{appointment_type}} appt on {{appointment_date}} at {{appointment_time}}. Reply STOP to opt out.',
    is_active: 1,
  },
  {
    name: 'claim_status_update',
    description: 'Sent when an insurance claim status changes',
    notification_type: 'claim',
    subject_template: 'Claim {{claim_number}} Status Update: {{status}}',
    body_template:
      'Hi {{patient_name}}, your insurance claim {{claim_number}} has been updated to: {{status}}. {{#denial_reason}}Reason: {{denial_reason}}{{/denial_reason}} Log in to view full details.',
    push_title_template: 'Claim Update',
    push_body_template: 'Claim {{claim_number}} is now {{status}}',
    sms_template: 'Your claim {{claim_number}} status: {{status}}. Login to view details. Reply STOP to opt out.',
    is_active: 1,
  },
  {
    name: 'premium_adjustment',
    description: 'Sent when a premium adjustment is created or resolved',
    notification_type: 'premium_adjustment',
    subject_template: 'Premium Adjustment Notification',
    body_template:
      'Hi {{patient_name}}, {{adjustment_message}} If you have questions, please contact your insurance provider.',
    push_title_template: 'Premium Update',
    push_body_template: '{{adjustment_message}}',
    sms_template: '{{adjustment_message}} Reply STOP to opt out.',
    is_active: 1,
  },
  {
    name: 'system_alert',
    description: 'General system notification',
    notification_type: 'system',
    subject_template: '{{title}}',
    body_template: '{{message}}',
    push_title_template: '{{title}}',
    push_body_template: '{{message}}',
    sms_template: '{{message}} Reply STOP to opt out.',
    is_active: 1,
  },
  {
    name: 'medical_record_added',
    description: 'Sent when a new medical record is added to a patient profile',
    notification_type: 'medical_record',
    subject_template: 'New Medical Record Added',
    body_template:
      'Hi {{patient_name}}, a new medical record of type "{{record_type}}" has been added to your profile by {{provider_name}} on {{date}}. Log in to view it.',
    push_title_template: 'New Medical Record',
    push_body_template: '{{record_type}} added by {{provider_name}}',
    sms_template: 'New medical record added to your profile. Login to view. Reply STOP to opt out.',
    is_active: 1,
  },
  {
    name: 'payment_received',
    description: 'Sent when a premium payment is confirmed',
    notification_type: 'payment',
    subject_template: 'Payment Confirmation — {{payment_amount}}',
    body_template:
      'Hi {{patient_name}}, your payment of {{payment_amount}} has been received on {{payment_date}}. Your coverage period: {{coverage_start}} to {{coverage_end}}. Transaction ID: {{transaction_id}}.',
    push_title_template: 'Payment Confirmed',
    push_body_template: 'Payment of {{payment_amount}} received',
    sms_template: 'Payment confirmed: {{payment_amount}} on {{payment_date}}. Txn: {{transaction_id}}. Reply STOP to opt out.',
    is_active: 1,
  },
];

/**
 * Runs idempotent notification schema migration.
 * Safe to call on every startup — uses IF NOT EXISTS and
 * catches "duplicate column" errors from ALTER TABLE.
 *
 * @param {sqlite3.Database} db - open database connection
 * @returns {Promise<void>}
 */
function runNotificationMigration(db) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');

      // ── 1. notification_templates ─────────────────────────────────────
      db.run(`
        CREATE TABLE IF NOT EXISTS notification_templates (
          id                  INTEGER PRIMARY KEY AUTOINCREMENT,
          name                TEXT UNIQUE NOT NULL,
          description         TEXT,
          notification_type   TEXT NOT NULL,
          subject_template    TEXT NOT NULL,
          body_template       TEXT NOT NULL,
          push_title_template TEXT,
          push_body_template  TEXT,
          sms_template        TEXT,
          is_active           INTEGER DEFAULT 1,
          created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // ── 2. notification_preferences ───────────────────────────────────
      db.run(`
        CREATE TABLE IF NOT EXISTS notification_preferences (
          id                      INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id                 INTEGER NOT NULL UNIQUE,
          channel_in_app          INTEGER DEFAULT 1,
          channel_email           INTEGER DEFAULT 1,
          channel_sms             INTEGER DEFAULT 0,
          channel_push            INTEGER DEFAULT 0,
          quiet_hours_enabled     INTEGER DEFAULT 0,
          quiet_hours_start       TEXT DEFAULT '22:00',
          quiet_hours_end         TEXT DEFAULT '08:00',
          frequency_cap_hourly    INTEGER DEFAULT 5,
          frequency_cap_daily     INTEGER DEFAULT 20,
          unsubscribe_token       TEXT UNIQUE,
          unsubscribed_email      INTEGER DEFAULT 0,
          unsubscribed_sms        INTEGER DEFAULT 0,
          push_subscription       TEXT,
          type_appointment        INTEGER DEFAULT 1,
          type_claim              INTEGER DEFAULT 1,
          type_payment            INTEGER DEFAULT 1,
          type_system             INTEGER DEFAULT 1,
          type_medical_record     INTEGER DEFAULT 1,
          type_premium_adjustment INTEGER DEFAULT 1,
          created_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id)
        )
      `);

      // ── 3. notification_deliveries ────────────────────────────────────
      db.run(`
        CREATE TABLE IF NOT EXISTS notification_deliveries (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          notification_id INTEGER NOT NULL,
          channel         TEXT NOT NULL CHECK (channel IN ('in_app','email','sms','push')),
          status          TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','sent','delivered','opened','failed','skipped')),
          message_id      TEXT,
          error_code      TEXT,
          error_message   TEXT,
          retry_count     INTEGER DEFAULT 0,
          sent_at         DATETIME,
          delivered_at    DATETIME,
          opened_at       DATETIME,
          created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (notification_id) REFERENCES notifications(id)
        )
      `);

      // ── 4. notification_queue ─────────────────────────────────────────
      db.run(`
        CREATE TABLE IF NOT EXISTS notification_queue (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          notification_id INTEGER NOT NULL,
          status          TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','processing','completed','failed','cancelled')),
          priority        INTEGER DEFAULT 5,
          retry_count     INTEGER DEFAULT 0,
          max_retries     INTEGER DEFAULT 3,
          next_attempt_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          scheduled_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
          started_at      DATETIME,
          completed_at    DATETIME,
          error_message   TEXT,
          payload         TEXT,
          created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (notification_id) REFERENCES notifications(id)
        )
      `);

      // ── 5. notification_analytics ─────────────────────────────────────
      db.run(`
        CREATE TABLE IF NOT EXISTS notification_analytics (
          id                INTEGER PRIMARY KEY AUTOINCREMENT,
          date              TEXT NOT NULL,
          channel           TEXT NOT NULL,
          notification_type TEXT NOT NULL,
          sent_count        INTEGER DEFAULT 0,
          delivered_count   INTEGER DEFAULT 0,
          opened_count      INTEGER DEFAULT 0,
          failed_count      INTEGER DEFAULT 0,
          avg_latency_ms    REAL DEFAULT 0,
          updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(date, channel, notification_type)
        )
      `);

      // ── 6. ALTER notifications table (idempotent) ─────────────────────
      const alterColumns = [
        "ALTER TABLE notifications ADD COLUMN channel TEXT DEFAULT 'in_app'",
        'ALTER TABLE notifications ADD COLUMN template_id INTEGER',
        'ALTER TABLE notifications ADD COLUMN metadata TEXT',
        'ALTER TABLE notifications ADD COLUMN expires_at DATETIME',
        "ALTER TABLE notifications ADD COLUMN delivery_status TEXT DEFAULT 'pending'",
        'ALTER TABLE notifications ADD COLUMN read_at DATETIME',
      ];

      alterColumns.forEach((sql) => {
        db.run(sql, (err) => {
          // SQLite throws "duplicate column name" if column exists — safe to ignore
          if (err && !err.message.includes('duplicate column')) {
            console.warn('ALTER TABLE notifications warning:', err.message);
          }
        });
      });

      // ── 7. Indexes ────────────────────────────────────────────────────
      const indexes = [
        'CREATE INDEX IF NOT EXISTS idx_queue_status_scheduled ON notification_queue(status, next_attempt_at)',
        'CREATE INDEX IF NOT EXISTS idx_queue_priority ON notification_queue(priority DESC, created_at ASC)',
        'CREATE INDEX IF NOT EXISTS idx_deliveries_notification_id ON notification_deliveries(notification_id)',
        'CREATE INDEX IF NOT EXISTS idx_deliveries_channel_status ON notification_deliveries(channel, status)',
        'CREATE INDEX IF NOT EXISTS idx_preferences_user_id ON notification_preferences(user_id)',
        'CREATE INDEX IF NOT EXISTS idx_analytics_date_channel ON notification_analytics(date, channel)',
        'CREATE INDEX IF NOT EXISTS idx_notifications_channel ON notifications(channel)',
        'CREATE INDEX IF NOT EXISTS idx_notifications_delivery_status ON notifications(delivery_status)',
        'CREATE INDEX IF NOT EXISTS idx_notifications_expires_at ON notifications(expires_at)',
      ];

      indexes.forEach((sql) => db.run(sql));

      // ── 8. Seed default templates ─────────────────────────────────────
      const templateStmt = db.prepare(`
        INSERT OR IGNORE INTO notification_templates (
          name, description, notification_type,
          subject_template, body_template,
          push_title_template, push_body_template, sms_template,
          is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      DEFAULT_TEMPLATES.forEach((t) => {
        templateStmt.run([
          t.name, t.description, t.notification_type,
          t.subject_template, t.body_template,
          t.push_title_template, t.push_body_template, t.sms_template,
          t.is_active,
        ]);
      });

      templateStmt.finalize();

      db.run('COMMIT', (err) => {
        if (err) {
          console.error('Notification migration commit error:', err);
          db.run('ROLLBACK');
          reject(err);
        } else {
          console.log('✅ Notification schema migration completed');
          resolve();
        }
      });
    });
  });
}

/**
 * Standalone runner — used if you run this file directly:
 *   node backend/database/notificationMigration.js
 */
if (require.main === module) {
  const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) { console.error(err); process.exit(1); }
  });
  runNotificationMigration(db)
    .then(() => { db.close(); process.exit(0); })
    .catch((err) => { console.error(err); db.close(); process.exit(1); });
}

module.exports = { runNotificationMigration };
