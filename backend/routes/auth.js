const express = require('express');
const { body } = require('express-validator');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { generateTokens, hashPassword, comparePassword, validateRegistration, validateLogin } = require('../middleware/auth');
const { setCache, deleteCache } = require('../middleware/cache');

const router = express.Router();
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../database/healthcare.db');

function getDatabase() {
  return new sqlite3.Database(DB_PATH);
}

router.post('/register', validateRegistration, async (req, res, next) => {
  const { email, password, firstName, lastName, role, dateOfBirth, phone, address } = req.body;
  
  const db = getDatabase();
  
  try {
    const hashedPassword = hashPassword(password);
    
    const stmt = db.prepare(`
      INSERT INTO users (email, password, role, first_name, last_name, date_of_birth, phone, address)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run([email, hashedPassword, role, firstName, lastName, dateOfBirth, phone, address], function(err) {
      if (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          return res.status(409).json({ error: 'Email already exists' });
        }
        return next(err);
      }
      
      const tokens = generateTokens({ 
        id: this.lastID, 
        email, 
        role, 
        firstName, 
        lastName 
      });
      
      deleteCache('/api/patients');
      
      res.status(201).json({
        message: 'User registered successfully',
        user: {
          id: this.lastID,
          email,
          role,
          firstName,
          lastName,
          dateOfBirth,
          phone,
          address
        },
        tokens
      });
    });
    
    stmt.finalize();
  } catch (error) {
    next(error);
  } finally {
    db.close();
  }
});

router.post('/login', validateLogin, (req, res, next) => {
  const { email, password } = req.body;
  const db = getDatabase();
  
  db.get(
    'SELECT * FROM users WHERE email = ?',
    [email],
    (err, user) => {
      if (err) {
        return next(err);
      }
      
      if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      
      if (!comparePassword(password, user.password)) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      
      const tokens = generateTokens({
        id: user.id,
        email: user.email,
        role: user.role,
        firstName: user.first_name,
        lastName: user.last_name
      });
      
      res.json({
        message: 'Login successful',
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          firstName: user.first_name,
          lastName: user.last_name,
          dateOfBirth: user.date_of_birth,
          phone: user.phone,
          address: user.address
        },
        tokens
      });
    }
  );
  
  db.close();
});

router.post('/refresh', (req, res, next) => {
  const { refreshToken } = req.body;
  
  if (!refreshToken) {
    return res.status(401).json({ error: 'Refresh token required' });
  }
  
  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
    const tokens = generateTokens(decoded);
    
    res.json({ tokens });
  } catch (error) {
    next(error);
  }
});

router.post('/logout', (req, res) => {
  deleteCache('/api/patients');
  res.json({ message: 'Logged out successfully' });
});

module.exports = router;
