const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { setCache, deleteCache } = require('../middleware/cache');

const router = express.Router();
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../database/healthcare.db');

function getDatabase() {
  return new sqlite3.Database(DB_PATH);
}

router.get('/patient/:patientId', async (req, res, next) => {
  const { patientId } = req.params;
  const { limit = 50, offset = 0, status } = req.query;
  
  const db = getDatabase();
  
  try {
    let query = `
      SELECT ic.*, 
        COUNT(*) OVER() as total_count
      FROM insurance_claims ic
      WHERE ic.patient_id = ?
    `;
    
    const params = [patientId];
    
    if (status) {
      query += ' AND ic.status = ?';
      params.push(status);
    }
    
    query += ' ORDER BY ic.submission_date DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));
    
    const claims = await new Promise((resolve, reject) => {
      db.all(query, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });

    const totalCount = claims.length > 0 ? claims[0].total_count : 0;
    const claimsWithoutCount = claims.map(({ total_count, ...claim }) => claim);

    const result = {
      claims: claimsWithoutCount,
      pagination: {
        total: totalCount,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: parseInt(offset) + parseInt(limit) < totalCount
      }
    };

    setCache(req.originalUrl, result);
    res.json(result);
  } catch (error) {
    next(error);
  } finally {
    db.close();
  }
});

router.get('/summary/:patientId', async (req, res, next) => {
  const { patientId } = req.params;
  const db = getDatabase();
  
  try {
    const summary = await new Promise((resolve, reject) => {
      const query = `
        SELECT 
          COUNT(*) as total_claims,
          COUNT(CASE WHEN status IN ('approved', 'paid') THEN 1 END) as approved_claims,
          COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_claims,
          COUNT(CASE WHEN status = 'denied' THEN 1 END) as denied_claims,
          SUM(total_amount) as total_billed,
          SUM(CASE WHEN status IN ('approved', 'paid') THEN insurance_amount ELSE 0 END) as total_paid,
          SUM(CASE WHEN status IN ('approved', 'paid') THEN patient_responsibility ELSE 0 END) as total_patient_responsibility,
          AVG(CASE WHEN status IN ('approved', 'paid') THEN 
            JULIANDAY(processing_date) - JULIANDAY(submission_date) 
          END) as avg_processing_days
        FROM insurance_claims 
        WHERE patient_id = ?
      `;
      
      db.get(query, [patientId], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });

    setCache(req.originalUrl, summary);
    res.json(summary);
  } catch (error) {
    next(error);
  } finally {
    db.close();
  }
});

router.get('/:claimId', async (req, res, next) => {
  const { claimId } = req.params;
  const db = getDatabase();
  
  try {
    const claim = await new Promise((resolve, reject) => {
      const query = `
        SELECT ic.*, 
          p.first_name || ' ' || p.last_name as patient_name,
          p.medical_record_number
        FROM insurance_claims ic
        JOIN patients pt ON ic.patient_id = pt.id
        JOIN users p ON pt.user_id = p.id
        WHERE ic.id = ?
      `;
      
      db.get(query, [claimId], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });

    if (!claim) {
      return res.status(404).json({ error: 'Claim not found' });
    }

    setCache(req.originalUrl, claim);
    res.json(claim);
  } catch (error) {
    next(error);
  } finally {
    db.close();
  }
});

router.post('/', async (req, res, next) => {
  const {
    patientId,
    claimNumber,
    serviceDate,
    providerName,
    diagnosisCodes,
    procedureCodes,
    totalAmount,
    insuranceAmount,
    patientResponsibility,
    notes
  } = req.body;
  
  const db = getDatabase();
  
  try {
    const stmt = db.prepare(`
      INSERT INTO insurance_claims (
        patient_id, claim_number, service_date, provider_name,
        diagnosis_codes, procedure_codes, total_amount, insurance_amount,
        patient_responsibility, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run([
      patientId, claimNumber, serviceDate, providerName,
      diagnosisCodes, procedureCodes, totalAmount, insuranceAmount,
      patientResponsibility, notes
    ], function(err) {
      if (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          return res.status(409).json({ error: 'Claim number already exists' });
        }
        return next(err);
      }
      
      deleteCache('/api/claims');
      deleteCache(`/api/claims/patient/${patientId}`);
      deleteCache(`/api/claims/summary/${patientId}`);
      
      if (req.io) {
        req.io.to(`patient-${patientId}`).emit('new-claim', {
          claimId: this.lastID,
          message: 'New insurance claim has been submitted'
        });
      }
      
      res.status(201).json({
        message: 'Claim created successfully',
        claimId: this.lastID
      });
    });
    
    stmt.finalize();
  } catch (error) {
    next(error);
  } finally {
    db.close();
  }
});

router.put('/:claimId/status', async (req, res, next) => {
  const { claimId } = req.params;
  const { status, processingDate, paymentDate, denialReason } = req.body;
  
  const db = getDatabase();
  
  try {
    const claim = await new Promise((resolve, reject) => {
      db.get('SELECT patient_id FROM insurance_claims WHERE id = ?', [claimId], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });

    if (!claim) {
      return res.status(404).json({ error: 'Claim not found' });
    }

    const stmt = db.prepare(`
      UPDATE insurance_claims 
      SET status = ?, processing_date = ?, payment_date = ?, denial_reason = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    
    stmt.run([status, processingDate, paymentDate, denialReason, claimId], function(err) {
      if (err) {
        return next(err);
      }
      
      deleteCache('/api/claims');
      deleteCache(`/api/claims/patient/${claim.patient_id}`);
      deleteCache(`/api/claims/summary/${claim.patient_id}`);
      deleteCache(`/api/claims/${claimId}`);
      
      if (req.io) {
        req.io.to(`patient-${claim.patient_id}`).emit('claim-status-update', {
          claimId,
          status,
          message: `Your claim status has been updated to: ${status}`
        });
      }
      
      res.json({ message: 'Claim status updated successfully' });
    });
    
    stmt.finalize();
  } catch (error) {
    next(error);
  } finally {
    db.close();
  }
});

module.exports = router;
