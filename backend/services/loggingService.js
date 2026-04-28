const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../database/healthcare.db');
const LOG_DIR = path.join(__dirname, '../logs');

// Ensure log directory exists
const fs = require('fs');
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR);
}

class LoggingService {
  constructor() {
    this.db = new sqlite3.Database(DB_PATH);
    
    const logFormat = winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    );

    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: logFormat,
      defaultMeta: { service: 'healthcare-backend' },
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          )
        }),
        new DailyRotateFile({
          filename: path.join(LOG_DIR, 'application-%DATE%.log'),
          datePattern: 'YYYY-MM-DD',
          zippedArchive: true,
          maxSize: '20m',
          maxFiles: '14d'
        }),
        new DailyRotateFile({
          level: 'error',
          filename: path.join(LOG_DIR, 'error-%DATE%.log'),
          datePattern: 'YYYY-MM-DD',
          zippedArchive: true,
          maxSize: '20m',
          maxFiles: '30d'
        })
      ]
    });

    // Add database transport
    this.logger.add(new winston.transports.Stream({
      stream: {
        write: (message) => {
          const log = JSON.parse(message);
          this.saveToDatabase(log);
        }
      }
    }));
  }

  async saveToDatabase(log) {
    const query = `
      INSERT INTO system_logs (id, level, message, context, timestamp, source, user_id, ip_address, user_agent, compliance_relevant)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const params = [
      uuidv4(),
      log.level,
      log.message,
      JSON.stringify(log.context || {}),
      log.timestamp,
      log.service || 'unknown',
      log.user_id || null,
      log.ip_address || null,
      log.user_agent || null,
      log.compliance_relevant ? 1 : 0
    ];

    this.db.run(query, params, (err) => {
      if (err) {
        console.error('Failed to save log to database:', err);
      }
    });
  }

  info(message, context = {}) {
    this.logger.info(message, { context });
  }

  error(message, error = null, context = {}) {
    const errorDetails = error ? {
      message: error.message,
      stack: error.stack,
      name: error.name
    } : null;
    
    this.logger.error(message, { 
      error: errorDetails,
      context 
    });
  }

  warn(message, context = {}) {
    this.logger.warn(message, { context });
  }

  debug(message, context = {}) {
    this.logger.debug(message, { context });
  }

  // Log compliance relevant events
  compliance(message, context = {}) {
    this.logger.info(message, { 
      context,
      compliance_relevant: true 
    });
  }

  // Advanced log analysis methods
  async queryLogs(filters = {}, limit = 100) {
    return new Promise((resolve, reject) => {
      let query = 'SELECT * FROM system_logs WHERE 1=1';
      const params = [];

      if (filters.level) {
        query += ' AND level = ?';
        params.push(filters.level);
      }

      if (filters.source) {
        query += ' AND source = ?';
        params.push(filters.source);
      }

      if (filters.compliance_relevant !== undefined) {
        query += ' AND compliance_relevant = ?';
        params.push(filters.compliance_relevant ? 1 : 0);
      }

      if (filters.startTime) {
        query += ' AND timestamp >= ?';
        params.push(filters.startTime);
      }

      if (filters.endTime) {
        query += ' AND timestamp <= ?';
        params.push(filters.endTime);
      }

      query += ' ORDER BY timestamp DESC LIMIT ?';
      params.push(limit);

      this.db.all(query, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows.map(row => ({
          ...row,
          context: JSON.parse(row.context || '{}'),
          compliance_relevant: !!row.compliance_relevant
        })));
      });
    });
  }

  async getErrorStats(periodHours = 24) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT message, COUNT(*) as count
        FROM system_logs
        WHERE level = 'error' AND timestamp >= datetime('now', ?)
        GROUP BY message
        ORDER BY count DESC
      `;
      
      this.db.all(query, [`-${periodHours} hours`], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }
}

module.exports = new LoggingService();
