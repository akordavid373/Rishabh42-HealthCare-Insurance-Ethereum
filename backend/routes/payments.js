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
    let query = 'SELECT * FROM premium_payments WHERE patient_id = ?';
    const params = [patientId];
    
    if (status) {
      query += ' AND payment_status = ?';
      params.push(status);
    }
    
    query += ' ORDER BY payment_date DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));
    
    const payments = await new Promise((resolve, reject) => {
      db.all(query, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    const countQuery = status 
      ? 'SELECT COUNT(*) as total FROM premium_payments WHERE patient_id = ? AND payment_status = ?'
      : 'SELECT COUNT(*) as total FROM premium_payments WHERE patient_id = ?';
    
    const countParams = status ? [patientId, status] : [patientId];
    
    const totalCount = await new Promise((resolve, reject) => {
      db.get(countQuery, countParams, (err, row) => {
        if (err) reject(err);
        else resolve(row.total);
      });
    });

    const result = {
      payments,
      pagination: { total: totalCount, limit: parseInt(limit), offset: parseInt(offset) }
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
          COUNT(*) as total_payments,
          COUNT(CASE WHEN payment_status = 'completed' THEN 1 END) as completed_payments,
          SUM(payment_amount) as total_amount,
          SUM(CASE WHEN payment_status = 'completed' THEN payment_amount ELSE 0 END) as total_paid
        FROM premium_payments WHERE patient_id = ?
      `;
      
      db.get(query, [patientId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
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

router.post('/', async (req, res, next) => {
  const {
    patientId, paymentAmount, paymentDate, paymentMethod,
    insuranceProvider, policyNumber, coveragePeriodStart, coveragePeriodEnd
  } = req.body;
  
  const db = getDatabase();
  
  try {
    const stmt = db.prepare(`
      INSERT INTO premium_payments (
        patient_id, payment_amount, payment_date, payment_method,
        insurance_provider, policy_number, coverage_period_start, coverage_period_end
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run([
      patientId, paymentAmount, paymentDate, paymentMethod,
      insuranceProvider, policyNumber, coveragePeriodStart, coveragePeriodEnd
    ], function(err) {
      if (err) return next(err);
      
      deleteCache('/api/payments');
      deleteCache(`/api/payments/patient/${patientId}`);
      
      if (req.io) {
        req.io.to(`patient-${patientId}`).emit('new-payment', {
          paymentId: this.lastID,
          message: 'New premium payment recorded'
        });
      }
      
      res.status(201).json({
        message: 'Payment recorded successfully',
        paymentId: this.lastID
      });
    });
    
    stmt.finalize();
  } catch (error) {
    next(error);
  } finally {
    db.close();
  }
});

module.exports = router;
