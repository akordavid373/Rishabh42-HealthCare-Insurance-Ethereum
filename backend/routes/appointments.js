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
  const { limit = 50, offset = 0, status, upcoming } = req.query;
  
  const db = getDatabase();
  
  try {
    let query = `
      SELECT a.*, 
        u.first_name || ' ' || u.last_name as provider_name,
        u.specialty
      FROM appointments a
      JOIN users u ON a.provider_id = u.id
      WHERE a.patient_id = ?
    `;
    
    const params = [patientId];
    
    if (status) {
      query += ' AND a.status = ?';
      params.push(status);
    }
    
    if (upcoming === 'true') {
      query += ' AND a.appointment_date > datetime("now") AND a.status IN ("scheduled", "confirmed")';
      query += ' ORDER BY a.appointment_date ASC';
    } else {
      query += ' ORDER BY a.appointment_date DESC';
    }
    
    query += ' LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));
    
    const appointments = await new Promise((resolve, reject) => {
      db.all(query, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });

    const countQuery = status 
      ? 'SELECT COUNT(*) as total FROM appointments WHERE patient_id = ? AND status = ?'
      : upcoming === 'true'
      ? 'SELECT COUNT(*) as total FROM appointments WHERE patient_id = ? AND appointment_date > datetime("now") AND status IN ("scheduled", "confirmed")'
      : 'SELECT COUNT(*) as total FROM appointments WHERE patient_id = ?';
    
    const countParams = status ? [patientId, status] : [patientId];
    
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
      appointments,
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

router.get('/upcoming/:patientId', async (req, res, next) => {
  const { patientId } = req.params;
  const db = getDatabase();
  
  try {
    const upcomingAppointments = await new Promise((resolve, reject) => {
      const query = `
        SELECT a.*, 
          u.first_name || ' ' || u.last_name as provider_name,
          u.specialty
        FROM appointments a
        JOIN users u ON a.provider_id = u.id
        WHERE a.patient_id = ? 
          AND a.appointment_date > datetime("now") 
          AND a.status IN ("scheduled", "confirmed")
        ORDER BY a.appointment_date ASC
        LIMIT 10
      `;
      
      db.all(query, [patientId], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });

    setCache(req.originalUrl, upcomingAppointments);
    res.json(upcomingAppointments);
  } catch (error) {
    next(error);
  } finally {
    db.close();
  }
});

router.get('/:appointmentId', async (req, res, next) => {
  const { appointmentId } = req.params;
  const db = getDatabase();
  
  try {
    const appointment = await new Promise((resolve, reject) => {
      const query = `
        SELECT a.*, 
          u.first_name || ' ' || u.last_name as provider_name,
          u.specialty,
          p.first_name || ' ' || p.last_name as patient_name,
          pt.medical_record_number
        FROM appointments a
        JOIN users u ON a.provider_id = u.id
        JOIN patients pt ON a.patient_id = pt.id
        JOIN users p ON pt.user_id = p.id
        WHERE a.id = ?
      `;
      
      db.get(query, [appointmentId], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });

    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    setCache(req.originalUrl, appointment);
    res.json(appointment);
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
    appointmentDate,
    durationMinutes,
    appointmentType,
    notes,
    virtual,
    meetingLink
  } = req.body;
  
  const db = getDatabase();
  
  try {
    const stmt = db.prepare(`
      INSERT INTO appointments (
        patient_id, provider_id, appointment_date, duration_minutes,
        appointment_type, notes, virtual, meeting_link
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run([
      patientId, providerId, appointmentDate, durationMinutes,
      appointmentType, notes, virtual, meetingLink
    ], function(err) {
      if (err) {
        return next(err);
      }
      
      deleteCache('/api/appointments');
      deleteCache(`/api/appointments/patient/${patientId}`);
      deleteCache(`/api/appointments/upcoming/${patientId}`);
      
      if (req.io) {
        req.io.to(`patient-${patientId}`).emit('new-appointment', {
          appointmentId: this.lastID,
          message: 'New appointment has been scheduled'
        });
      }
      
      res.status(201).json({
        message: 'Appointment created successfully',
        appointmentId: this.lastID
      });
    });
    
    stmt.finalize();
  } catch (error) {
    next(error);
  } finally {
    db.close();
  }
});

router.put('/:appointmentId', async (req, res, next) => {
  const { appointmentId } = req.params;
  const updateFields = req.body;
  
  const db = getDatabase();
  
  try {
    const appointment = await new Promise((resolve, reject) => {
      db.get('SELECT patient_id FROM appointments WHERE id = ?', [appointmentId], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });

    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    const setClause = Object.keys(updateFields)
      .map(key => `${key} = ?`)
      .join(', ');
    
    const values = Object.values(updateFields);
    values.push(appointmentId);
    
    const stmt = db.prepare(`
      UPDATE appointments 
      SET ${setClause}, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `);
    
    stmt.run(values, function(err) {
      if (err) {
        return next(err);
      }
      
      deleteCache('/api/appointments');
      deleteCache(`/api/appointments/patient/${appointment.patient_id}`);
      deleteCache(`/api/appointments/upcoming/${appointment.patient_id}`);
      
      if (req.io) {
        req.io.to(`patient-${appointment.patient_id}`).emit('appointment-updated', {
          appointmentId,
          message: 'Your appointment has been updated'
        });
      }
      
      res.json({ message: 'Appointment updated successfully' });
    });
    
    stmt.finalize();
  } catch (error) {
    next(error);
  } finally {
    db.close();
  }
});

router.delete('/:appointmentId', async (req, res, next) => {
  const { appointmentId } = req.params;
  const db = getDatabase();
  
  try {
    const appointment = await new Promise((resolve, reject) => {
      db.get('SELECT patient_id FROM appointments WHERE id = ?', [appointmentId], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });

    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    db.run('DELETE FROM appointments WHERE id = ?', [appointmentId], function(err) {
      if (err) {
        return next(err);
      }
      
      deleteCache('/api/appointments');
      deleteCache(`/api/appointments/patient/${appointment.patient_id}`);
      deleteCache(`/api/appointments/upcoming/${appointment.patient_id}`);
      
      res.json({ message: 'Appointment deleted successfully' });
    });
  } catch (error) {
    next(error);
  } finally {
    db.close();
  }
});

module.exports = router;
