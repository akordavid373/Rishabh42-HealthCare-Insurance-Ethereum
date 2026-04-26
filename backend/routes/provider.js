/**
 * Provider Dashboard API Routes (Issue #26)
 *
 * Endpoints:
 *   GET  /api/providers/dashboard/:providerId  – aggregated dashboard stats
 *   GET  /api/providers/:providerId/patients   – patient roster (paginated)
 *   GET  /api/providers/:providerId/appointments – appointment calendar
 *   GET  /api/providers/:providerId/revenue    – revenue analytics
 *   POST /api/providers/:providerId/prescriptions – create prescription
 *   POST /api/providers/:providerId/documents  – upload document reference
 */
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { body, param, query, validationResult } = require('express-validator');
const { setCache } = require('../middleware/cache');

const router = express.Router();
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../database/healthcare.db');

function openDb() { return new sqlite3.Database(DB_PATH); }

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: 'Validation failed', details: errors.array() });
    return true;
  }
  return false;
}

function dbAll(db, sql, params) {
  return new Promise((resolve, reject) =>
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)))
  );
}

function dbGet(db, sql, params) {
  return new Promise((resolve, reject) =>
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)))
  );
}

// ── Dashboard overview ────────────────────────────────────────────────────────

router.get(
  '/dashboard/:providerId',
  [param('providerId').isInt({ min: 1 }).toInt()],
  async (req, res, next) => {
    if (validate(req, res)) return;
    const { providerId } = req.params;
    const db = openDb();
    try {
      // Aggregate stats across patients, appointments, claims, and payments
      const stats = await dbGet(
        db,
        `SELECT
           COUNT(DISTINCT a.patient_id)                                          AS total_patients,
           COUNT(DISTINCT a.id)                                                  AS total_appointments,
           COUNT(DISTINCT a.id) FILTER (WHERE a.appointment_date > datetime('now')
                                        AND a.status IN ('scheduled','confirmed')) AS upcoming_appointments,
           COUNT(DISTINCT ic.id)                                                 AS total_claims,
           COUNT(DISTINCT ic.id) FILTER (WHERE ic.status IN ('approved','paid')) AS approved_claims,
           COALESCE(SUM(pp.payment_amount), 0)                                   AS total_revenue,
           COALESCE(SUM(pp.payment_amount)
             FILTER (WHERE pp.created_at >= date('now','start of month')), 0)    AS revenue_this_month
         FROM appointments a
         LEFT JOIN insurance_claims ic ON ic.patient_id = a.patient_id
         LEFT JOIN premium_payments pp ON pp.patient_id = a.patient_id
         WHERE a.provider_id = ?`,
        [providerId]
      );

      const recentAppointments = await dbAll(
        db,
        `SELECT a.id, a.appointment_date, a.status, a.appointment_type,
                u.first_name || ' ' || u.last_name AS patient_name
         FROM appointments a
         JOIN patients p ON a.patient_id = p.id
         JOIN users u ON p.user_id = u.id
         WHERE a.provider_id = ?
         ORDER BY a.appointment_date DESC
         LIMIT 5`,
        [providerId]
      );

      const result = { stats: stats || {}, recentAppointments };
      setCache(req.originalUrl, result);
      res.json(result);
    } catch (err) {
      next(err);
    } finally {
      db.close();
    }
  }
);

// ── Patient roster ────────────────────────────────────────────────────────────

router.get(
  '/:providerId/patients',
  [
    param('providerId').isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('offset').optional().isInt({ min: 0 }).toInt(),
    query('search').optional().isString().trim().escape(),
  ],
  async (req, res, next) => {
    if (validate(req, res)) return;
    const { providerId } = req.params;
    const { limit = 20, offset = 0, search } = req.query;
    const db = openDb();
    try {
      let where = 'WHERE a.provider_id = ?';
      const params = [providerId];
      if (search) {
        where += ` AND (u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ?)`;
        const like = `%${search}%`;
        params.push(like, like, like);
      }

      const patients = await dbAll(
        db,
        `SELECT DISTINCT p.id, u.first_name, u.last_name, u.email, u.phone,
                p.blood_type, p.insurance_provider,
                MAX(a.appointment_date) AS last_visit
         FROM appointments a
         JOIN patients p ON a.patient_id = p.id
         JOIN users u ON p.user_id = u.id
         ${where}
         GROUP BY p.id
         ORDER BY last_visit DESC
         LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );

      res.json({ patients, limit, offset });
    } catch (err) {
      next(err);
    } finally {
      db.close();
    }
  }
);

// ── Appointment calendar ──────────────────────────────────────────────────────

router.get(
  '/:providerId/appointments',
  [
    param('providerId').isInt({ min: 1 }).toInt(),
    query('from').optional().isISO8601(),
    query('to').optional().isISO8601(),
    query('status').optional().isIn(['scheduled', 'confirmed', 'completed', 'cancelled']),
  ],
  async (req, res, next) => {
    if (validate(req, res)) return;
    const { providerId } = req.params;
    const { from, to, status } = req.query;
    const db = openDb();
    try {
      let where = 'WHERE a.provider_id = ?';
      const params = [providerId];
      if (from)   { where += ' AND a.appointment_date >= ?'; params.push(from); }
      if (to)     { where += ' AND a.appointment_date <= ?'; params.push(to); }
      if (status) { where += ' AND a.status = ?';            params.push(status); }

      const appointments = await dbAll(
        db,
        `SELECT a.id, a.appointment_date, a.status, a.appointment_type, a.notes,
                u.first_name || ' ' || u.last_name AS patient_name,
                p.id AS patient_id
         FROM appointments a
         JOIN patients p ON a.patient_id = p.id
         JOIN users u ON p.user_id = u.id
         ${where}
         ORDER BY a.appointment_date ASC`,
        params
      );

      res.json({ appointments });
    } catch (err) {
      next(err);
    } finally {
      db.close();
    }
  }
);

// ── Revenue analytics ─────────────────────────────────────────────────────────

router.get(
  '/:providerId/revenue',
  [
    param('providerId').isInt({ min: 1 }).toInt(),
    query('months').optional().isInt({ min: 1, max: 24 }).toInt(),
  ],
  async (req, res, next) => {
    if (validate(req, res)) return;
    const { providerId } = req.params;
    const { months = 6 } = req.query;
    const db = openDb();
    try {
      const monthly = await dbAll(
        db,
        `SELECT strftime('%Y-%m', pp.created_at) AS month,
                COUNT(*)                          AS payment_count,
                SUM(pp.payment_amount)            AS total_revenue
         FROM premium_payments pp
         JOIN patients p ON pp.patient_id = p.id
         JOIN appointments a ON a.patient_id = p.id AND a.provider_id = ?
         WHERE pp.created_at >= date('now', ? || ' months')
         GROUP BY month
         ORDER BY month ASC`,
        [providerId, `-${months}`]
      );

      const claimStats = await dbGet(
        db,
        `SELECT COUNT(*)                                                    AS total_claims,
                COUNT(*) FILTER (WHERE ic.status IN ('approved','paid'))    AS approved_claims,
                COALESCE(SUM(ic.insurance_amount)
                  FILTER (WHERE ic.status IN ('approved','paid')), 0)       AS total_approved_amount
         FROM insurance_claims ic
         JOIN patients p ON ic.patient_id = p.id
         JOIN appointments a ON a.patient_id = p.id AND a.provider_id = ?`,
        [providerId]
      );

      res.json({ monthly, claimStats: claimStats || {} });
    } catch (err) {
      next(err);
    } finally {
      db.close();
    }
  }
);

// ── Prescriptions ─────────────────────────────────────────────────────────────

router.post(
  '/:providerId/prescriptions',
  [
    param('providerId').isInt({ min: 1 }).toInt(),
    body('patientId').isInt({ min: 1 }).toInt(),
    body('medication').isString().trim().notEmpty(),
    body('dosage').isString().trim().notEmpty(),
    body('duration').isString().trim().notEmpty(),
    body('notes').optional().isString().trim(),
  ],
  async (req, res, next) => {
    if (validate(req, res)) return;
    const { providerId } = req.params;
    const { patientId, medication, dosage, duration, notes } = req.body;
    const db = openDb();
    try {
      const result = await new Promise((resolve, reject) =>
        db.run(
          `INSERT INTO prescriptions (provider_id, patient_id, medication, dosage, duration, notes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
          [providerId, patientId, medication, dosage, duration, notes || null],
          function (err) { err ? reject(err) : resolve(this.lastID); }
        )
      );
      res.status(201).json({ message: 'Prescription created', prescriptionId: result });
    } catch (err) {
      // Table may not exist in all environments; return graceful error
      if (err.message && err.message.includes('no such table')) {
        return res.status(501).json({ error: 'Prescriptions table not yet migrated' });
      }
      next(err);
    } finally {
      db.close();
    }
  }
);

// ── Document management ───────────────────────────────────────────────────────

router.post(
  '/:providerId/documents',
  [
    param('providerId').isInt({ min: 1 }).toInt(),
    body('patientId').isInt({ min: 1 }).toInt(),
    body('documentType').isString().trim().notEmpty(),
    body('ipfsHash').isString().trim().notEmpty(),
    body('description').optional().isString().trim(),
  ],
  async (req, res, next) => {
    if (validate(req, res)) return;
    const { providerId } = req.params;
    const { patientId, documentType, ipfsHash, description } = req.body;
    const db = openDb();
    try {
      const result = await new Promise((resolve, reject) =>
        db.run(
          `INSERT INTO medical_documents (provider_id, patient_id, document_type, ipfs_hash, description, created_at)
           VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
          [providerId, patientId, documentType, ipfsHash, description || null],
          function (err) { err ? reject(err) : resolve(this.lastID); }
        )
      );
      res.status(201).json({ message: 'Document reference stored', documentId: result });
    } catch (err) {
      if (err.message && err.message.includes('no such table')) {
        return res.status(501).json({ error: 'Documents table not yet migrated' });
      }
      next(err);
    } finally {
      db.close();
    }
  }
);

module.exports = router;
