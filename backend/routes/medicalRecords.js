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
  const { limit = 50, offset = 0, recordType } = req.query;
  
  const db = getDatabase();
  
  try {
    let query = `
      SELECT mr.*, u.first_name || ' ' || u.last_name as provider_name
      FROM medical_records mr
      JOIN users u ON mr.provider_id = u.id
      WHERE mr.patient_id = ?
    `;
    
    const params = [patientId];
    
    if (recordType) {
      query += ' AND mr.record_type = ?';
      params.push(recordType);
    }
    
    query += ' ORDER BY mr.date_of_service DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));
    
    const records = await new Promise((resolve, reject) => {
      db.all(query, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });

    const countQuery = recordType 
      ? 'SELECT COUNT(*) as total FROM medical_records WHERE patient_id = ? AND record_type = ?'
      : 'SELECT COUNT(*) as total FROM medical_records WHERE patient_id = ?';
    
    const countParams = recordType ? [patientId, recordType] : [patientId];
    
    const totalCount = await new Promise((resolve, reject) => {
      db.get(countQuery, countParams, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row.total);
        }
      });
    });

    const result = {
      records,
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

router.get('/:recordId', async (req, res, next) => {
  const { recordId } = req.params;
  const db = getDatabase();
  
  try {
    const record = await new Promise((resolve, reject) => {
      const query = `
        SELECT mr.*, u.first_name || ' ' || u.last_name as provider_name
        FROM medical_records mr
        JOIN users u ON mr.provider_id = u.id
        WHERE mr.id = ?
      `;
      
      db.get(query, [recordId], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });

    if (!record) {
      return res.status(404).json({ error: 'Medical record not found' });
    }

    setCache(req.originalUrl, record);
    res.json(record);
  } catch (error) {
    next(error);
  } finally {
    db.close();
  }
});

router.post('/', async (req, res, next) => {
  const {
    patientId,
    providerId,
    recordType,
    title,
    description,
    diagnosisCode,
    treatmentCode,
    dateOfService,
    facilityName,
    notes,
    attachments
  } = req.body;
  
  const db = getDatabase();
  
  try {
    const stmt = db.prepare(`
      INSERT INTO medical_records (
        patient_id, provider_id, record_type, title, description,
        diagnosis_code, treatment_code, date_of_service, facility_name,
        notes, attachments
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run([
      patientId, providerId, recordType, title, description,
      diagnosisCode, treatmentCode, dateOfService, facilityName,
      notes, attachments
    ], function(err) {
      if (err) {
        return next(err);
      }
      
      deleteCache('/api/medical-records');
      deleteCache(`/api/medical-records/patient/${patientId}`);
      
      if (req.io) {
        req.io.to(`patient-${patientId}`).emit('new-medical-record', {
          recordId: this.lastID,
          message: 'New medical record has been added to your profile'
        });
      }
      
      res.status(201).json({
        message: 'Medical record created successfully',
        recordId: this.lastID
      });
    });
    
    stmt.finalize();
  } catch (error) {
    next(error);
  } finally {
    db.close();
  }
});

router.put('/:recordId', async (req, res, next) => {
  const { recordId } = req.params;
  const updateFields = req.body;
  
  const db = getDatabase();
  
  try {
    const setClause = Object.keys(updateFields)
      .map(key => `${key} = ?`)
      .join(', ');
    
    const values = Object.values(updateFields);
    values.push(recordId);
    
    const stmt = db.prepare(`
      UPDATE medical_records 
      SET ${setClause}, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `);
    
    stmt.run(values, function(err) {
      if (err) {
        return next(err);
      }
      
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Medical record not found' });
      }
      
      deleteCache('/api/medical-records');
      deleteCache(`/api/medical-records/${recordId}`);
      
      res.json({ message: 'Medical record updated successfully' });
    });
    
    stmt.finalize();
  } catch (error) {
    next(error);
  } finally {
    db.close();
  }
});

router.delete('/:recordId', async (req, res, next) => {
  const { recordId } = req.params;
  const db = getDatabase();
  
  try {
    const record = await new Promise((resolve, reject) => {
      db.get('SELECT patient_id FROM medical_records WHERE id = ?', [recordId], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });

    if (!record) {
      return res.status(404).json({ error: 'Medical record not found' });
    }

    db.run('DELETE FROM medical_records WHERE id = ?', [recordId], function(err) {
      if (err) {
        return next(err);
      }
      
      deleteCache('/api/medical-records');
      deleteCache(`/api/medical-records/patient/${record.patient_id}`);
      
      res.json({ message: 'Medical record deleted successfully' });
    });
  } catch (error) {
    next(error);
  } finally {
    db.close();
  }
});

module.exports = router;
