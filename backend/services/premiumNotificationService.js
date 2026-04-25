/**
 * PremiumNotificationService — refactored to delegate all delivery logic
 * to NotificationEngine, TemplateEngine and PersonalizationService.
 *
 * Public interface is unchanged — all call sites in premiumAdjustmentTriggers.js
 * continue to work without modification:
 *   new PremiumNotificationService(io)
 *   service.notifyPremiumChange(data, type)
 *   service.scheduleReminderNotifications(data)
 *   service.getUserNotifications(userId)
 *   service.markNotificationAsRead(id, userId)
 *   service.getUnreadCount(userId)
 */
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const NotificationEngine     = require('./notifications/NotificationEngine');
const TemplateEngine         = require('./notifications/TemplateEngine');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../database/healthcare.db');

class PremiumNotificationService {
  constructor(io) {
    this.io = io;
    // Ensure engine has the io instance
    this._engine = NotificationEngine.getInstance(io);
  }

  getDatabase() {
    return new sqlite3.Database(DB_PATH);
  }

  /* ─── notifyPremiumChange ────────────────────────────────────────────── */
  async notifyPremiumChange(adjustmentData, notificationType = 'adjustment_created') {
    const db = this.getDatabase();

    try {
      const patient = await this._getPatientDetails(db, adjustmentData.patientId);
      if (!patient) throw new Error(`Patient ${adjustmentData.patientId} not found`);

      const notifications = this._buildNotificationPayloads(adjustmentData, patient, notificationType);

      let notificationsSent = 0;
      const notificationTypes = [];

      for (const payload of notifications) {
        try {
          const result = await this._engine.send(payload);
          if (!result.skipped) {
            notificationsSent++;
            notificationTypes.push(payload.type);
          }
        } catch (err) {
          console.error('[PremiumNotificationService] Failed to send notification:', err.message);
        }
      }

      await this._updateAdjustmentNotificationStatus(db, adjustmentData.id);

      return { success: true, notificationsSent, notificationTypes };
    } catch (error) {
      console.error('[PremiumNotificationService] notifyPremiumChange error:', error);
      throw error;
    } finally {
      db.close();
    }
  }

  /* ─── Build payloads from adjustment data ────────────────────────────── */
  _buildNotificationPayloads(adjustmentData, patient, notificationType) {
    const abs = Math.abs(adjustmentData.adjustmentPercentage || 0);
    const priority = abs >= 15 ? 'urgent' : abs >= 10 ? 'high' : abs >= 5 ? 'medium' : 'low';

    const metadata = {
      patient_name:          `${patient.first_name} ${patient.last_name}`,
      adjustment_percentage: adjustmentData.adjustmentPercentage,
      previous_premium:      `$${adjustmentData.previousPremium}`,
      new_premium:           `$${adjustmentData.newPremium}`,
      effective_date:        adjustmentData.effectiveDate,
      adjustment_message:    this._buildAdjustmentMessage(adjustmentData, notificationType),
    };

    const base = {
      userId:     patient.user_id,
      type:       'premium_adjustment',
      priority,
      metadata,
    };

    const payloads = [];

    switch (notificationType) {
      case 'adjustment_created':
        payloads.push({
          ...base,
          channels:   ['in_app'],
          title:      'Premium Adjustment Under Review',
          message:    metadata.adjustment_message,
        });
        if (abs >= 10) {
          payloads.push({ ...base, channels: ['email'], title: 'Premium Adjustment Under Review', message: metadata.adjustment_message });
        }
        break;

      case 'adjustment_approved':
        payloads.push({ ...base, channels: ['in_app', 'email'], title: 'Premium Adjustment Approved', message: metadata.adjustment_message });
        if (adjustmentData.adjustmentPercentage > 15) {
          payloads.push({ ...base, channels: ['sms'], priority: 'urgent', title: 'Important: Premium Change', message: metadata.adjustment_message });
        }
        break;

      case 'adjustment_rejected':
        payloads.push({ ...base, channels: ['in_app', 'email'], title: 'Premium Adjustment Review Complete', message: metadata.adjustment_message });
        break;

      case 'adjustment_effective':
        payloads.push({ ...base, channels: ['in_app'], title: 'Premium Adjustment Effective Today', message: metadata.adjustment_message });
        break;

      case 'governance_required': {
        // Notify admins
        const adminPayload = {
          type:     'premium_adjustment',
          priority: 'high',
          metadata,
          channels: ['in_app'],
          title:    'Premium Adjustment Review Required',
          message:  `A premium adjustment for patient ${adjustmentData.patientId} requires governance review (${adjustmentData.adjustmentPercentage}%).`,
        };
        // We'll need admin user ids — return a special sentinel to be resolved by caller
        // For now, push a placeholder that will be expanded below
        payloads.push({ ...adminPayload, _adminBroadcast: true });
        break;
      }
    }

    return payloads;
  }

  _buildAdjustmentMessage(adjustmentData, notificationType) {
    const prev = `$${adjustmentData.previousPremium}`;
    const next = `$${adjustmentData.newPremium}`;
    const pct  = adjustmentData.adjustmentPercentage;
    const date = adjustmentData.effectiveDate;

    switch (notificationType) {
      case 'adjustment_created':
        return `Your premium adjustment request of ${pct > 0 ? '+' : ''}${pct}% is under review. Current premium: ${prev}.`;
      case 'adjustment_approved':
        return `Your premium has been adjusted from ${prev} to ${next}. Effective: ${date}.`;
      case 'adjustment_rejected':
        return `Your premium adjustment request was reviewed. Your premium remains at ${prev}. ${adjustmentData.governanceNotes ? 'Reason: ' + adjustmentData.governanceNotes : ''}`;
      case 'adjustment_effective':
        return `Your premium adjustment is now effective. New premium: ${next}.`;
      case 'governance_required':
        return `Premium adjustment of ${pct}% for patient ${adjustmentData.patientId} requires review.`;
      default:
        return `Premium update: ${prev} → ${next}.`;
    }
  }

  /* ─── scheduleReminderNotifications ─────────────────────────────────── */
  async scheduleReminderNotifications(adjustmentData) {
    const db = this.getDatabase();
    try {
      const patient       = await this._getPatientDetails(db, adjustmentData.patientId);
      if (!patient) throw new Error(`Patient ${adjustmentData.patientId} not found`);

      const effectiveDate = new Date(adjustmentData.effectiveDate);
      const reminderDates = this._calculateReminderDates(effectiveDate);

      for (const reminderDate of reminderDates) {
        await this._engine.send({
          userId:      patient.user_id,
          type:        'premium_adjustment',
          priority:    'medium',
          channels:    ['email'],
          title:       'Premium Adjustment Reminder',
          message:     `Reminder: Your premium will change to $${adjustmentData.newPremium} on ${adjustmentData.effectiveDate}.`,
          metadata:    {
            patient_name:  `${patient.first_name} ${patient.last_name}`,
            new_premium:   `$${adjustmentData.newPremium}`,
            effective_date: adjustmentData.effectiveDate,
          },
          scheduledAt: reminderDate.toISOString(),
        });
      }

      return { remindersScheduled: reminderDates.length };
    } finally {
      db.close();
    }
  }

  _calculateReminderDates(effectiveDate) {
    const dates = [];
    const now   = new Date();

    const sevenDaysBefore = new Date(effectiveDate);
    sevenDaysBefore.setDate(sevenDaysBefore.getDate() - 7);

    const oneDayBefore = new Date(effectiveDate);
    oneDayBefore.setDate(oneDayBefore.getDate() - 1);

    if (sevenDaysBefore > now) dates.push(sevenDaysBefore);
    if (oneDayBefore   > now) dates.push(oneDayBefore);

    return dates;
  }

  /* ─── getUserNotifications (unchanged interface) ─────────────────────── */
  async getUserNotifications(userId, limit = 50, offset = 0) {
    const db = this.getDatabase();
    try {
      return new Promise((resolve, reject) => {
        db.all(
          `SELECT * FROM notifications
           WHERE user_id = ?
           ORDER BY created_at DESC
           LIMIT ? OFFSET ?`,
          [userId, limit, offset],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
          }
        );
      });
    } finally {
      db.close();
    }
  }

  /* ─── markNotificationAsRead ─────────────────────────────────────────── */
  async markNotificationAsRead(notificationId, userId) {
    const db = this.getDatabase();
    try {
      return new Promise((resolve, reject) => {
        db.run(
          `UPDATE notifications SET read = 1, read_at = CURRENT_TIMESTAMP
           WHERE id = ? AND user_id = ?`,
          [notificationId, userId],
          function (err) {
            if (err) reject(err);
            else resolve(this.changes);
          }
        );
      });
    } finally {
      db.close();
    }
  }

  /* ─── getUnreadCount ─────────────────────────────────────────────────── */
  async getUnreadCount(userId) {
    const db = this.getDatabase();
    try {
      return new Promise((resolve, reject) => {
        db.get(
          'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND read = 0',
          [userId],
          (err, row) => {
            if (err) reject(err);
            else resolve(row.count);
          }
        );
      });
    } finally {
      db.close();
    }
  }

  /* ─── Private helpers ────────────────────────────────────────────────── */
  _getPatientDetails(db, patientId) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT p.*, u.email, u.phone, u.first_name, u.last_name
         FROM patients p JOIN users u ON p.user_id = u.id
         WHERE p.id = ?`,
        [patientId],
        (err, row) => { if (err) reject(err); else resolve(row); }
      );
    });
  }

  _updateAdjustmentNotificationStatus(db, adjustmentId) {
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE premium_adjustments SET notification_sent = TRUE WHERE id = ?',
        [adjustmentId],
        function (err) { if (err) reject(err); else resolve(this.changes); }
      );
    });
  }
}

module.exports = PremiumNotificationService;
