const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { setCache, deleteCache } = require('../middleware/cache');

const router = express.Router();
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../database/healthcare.db');

function getDatabase() {
  return new sqlite3.Database(DB_PATH);
}

router.get('/dashboard/:patientId', async (req, res, next) => {
  const { patientId } = req.params;
  const db = getDatabase();
  
  try {
    const dashboardData = await new Promise((resolve, reject) => {
      const query = `
        SELECT 
          p.*,
          u.first_name,
          u.last_name,
          u.email,
          u.phone,
          COUNT(DISTINCT mr.id) as total_medical_records,
          COUNT(DISTINCT ic.id) as total_claims,
          COUNT(DISTINCT ic.id) FILTER (WHERE ic.status IN ('approved', 'paid')) as approved_claims,
          COUNT(DISTINCT pp.id) as total_payments,
          COUNT(DISTINCT a.id) as upcoming_appointments,
          SUM(CASE WHEN ic.status IN ('approved', 'paid') THEN ic.insurance_amount ELSE 0 END) as total_insurance_paid,
          SUM(pp.payment_amount) as total_premiums_paid
        FROM patients p
        JOIN users u ON p.user_id = u.id
        LEFT JOIN medical_records mr ON p.id = mr.patient_id
        LEFT JOIN insurance_claims ic ON p.id = ic.patient_id
        LEFT JOIN premium_payments pp ON p.id = pp.patient_id
        LEFT JOIN appointments a ON p.id = a.patient_id AND a.appointment_date > datetime('now') AND a.status IN ('scheduled', 'confirmed')
        WHERE p.id = ?
        GROUP BY p.id
      `;
      
      db.get(query, [patientId], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });

    if (!dashboardData) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    setCache(req.originalUrl, dashboardData);
    res.json(dashboardData);
  } catch (error) {
    next(error);
  } finally {
    db.close();
  }
});

router.get('/:patientId', async (req, res, next) => {
  const { patientId } = req.params;
  const db = getDatabase();
  
  try {
    const patient = await new Promise((resolve, reject) => {
      const query = `
        SELECT p.*, u.first_name, u.last_name, u.email, u.phone, u.date_of_birth, u.address
        FROM patients p
        JOIN users u ON p.user_id = u.id
        WHERE p.id = ?
      `;
      
      db.get(query, [patientId], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });

    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    setCache(req.originalUrl, patient);
    res.json(patient);
  } catch (error) {
    next(error);
  } finally {
    db.close();
  }
});

router.post('/', async (req, res, next) => {
  const { 
    userId, 
    medicalRecordNumber, 
    insuranceProvider, 
    insurancePolicyNumber,
    emergencyContactName,
    emergencyContactPhone,
    bloodType,
    allergies,
    medications
  } = req.body;
  
  const db = getDatabase();
  
  try {
    const stmt = db.prepare(`
      INSERT INTO patients (
        user_id, medical_record_number, insurance_provider, insurance_policy_number,
        emergency_contact_name, emergency_contact_phone, blood_type, allergies, medications
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run([
      userId, medicalRecordNumber, insuranceProvider, insurancePolicyNumber,
      emergencyContactName, emergencyContactPhone, bloodType, allergies, medications
    ], function(err) {
      if (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          return res.status(409).json({ error: 'Medical record number already exists' });
        }
        return next(err);
      }
      
      deleteCache('/api/patients');
      
      res.status(201).json({
        message: 'Patient profile created successfully',
        patientId: this.lastID
      });
    });
    
    stmt.finalize();
  } catch (error) {
    next(error);
  } finally {
    db.close();
  }
});

router.put('/:patientId', async (req, res, next) => {
  const { patientId } = req.params;
  const updateFields = req.body;
  
  const db = getDatabase();
  
  try {
    const setClause = Object.keys(updateFields)
      .map(key => `${key} = ?`)
      .join(', ');
    
    const values = Object.values(updateFields);
    values.push(patientId);
    
    const stmt = db.prepare(`
      UPDATE patients 
      SET ${setClause}, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `);
    
    stmt.run(values, function(err) {
      if (err) {
        return next(err);
      }
      
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Patient not found' });
      }
      
      deleteCache('/api/patients');
      deleteCache(`/api/patients/${patientId}`);
      deleteCache(`/api/patients/dashboard/${patientId}`);
      
      res.json({ message: 'Patient profile updated successfully' });
    });
    
    stmt.finalize();
  } catch (error) {
    next(error);
  } finally {
    db.close();
  }
});

module.exports = router;
