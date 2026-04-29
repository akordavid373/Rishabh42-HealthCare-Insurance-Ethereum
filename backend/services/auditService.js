const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../database/healthcare.db');

class AuditService {
  constructor() {
    this.db = new sqlite3.Database(DB_PATH);
  }

  /**
   * Log an audit event
   * @param {Object} event - Audit event details
   */
  async log(event) {
    const {
      action,
      resource,
      resource_id = null,
      user_id = null,
      user_email = null,
      user_role = null,
      ip_address = null,
      user_agent = null,
      previous_state = null,
      new_state = null,
      status = 'success',
      error_message = null,
      metadata = {}
    } = event;

    const id = uuidv4();
    const timestamp = new Date().toISOString();

    // Calculate changes if both states are provided
    let changes = null;
    if (previous_state && new_state) {
      changes = this._calculateDiff(previous_state, new_state);
    }

    // Generate checksum for integrity
    const checksum = this._generateChecksum({
      id, action, resource, resource_id, user_id, timestamp, status
    });

    const query = `
      INSERT INTO audit_logs (
        id, action, resource, resource_id, user_id, user_email, user_role,
        ip_address, user_agent, previous_state, new_state, changes,
        status, error_message, metadata, checksum, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      id,
      action,
      resource,
      resource_id ? String(resource_id) : null,
      user_id,
      user_email,
      user_role,
      ip_address,
      user_agent,
      previous_state ? JSON.stringify(previous_state) : null,
      new_state ? JSON.stringify(new_state) : null,
      changes ? JSON.stringify(changes) : null,
      status,
      error_message,
      JSON.stringify(metadata),
      checksum,
      timestamp
    ];

    return new Promise((resolve, reject) => {
      this.db.run(query, params, function(err) {
        if (err) {
          console.error('Audit Log Error:', err);
          reject(err);
        } else {
          resolve({ id, checksum });
        }
      });
    });
  }

  /**
   * Calculate diff between two states
   */
  _calculateDiff(oldState, newState) {
    const diff = {};
    const allKeys = new Set([...Object.keys(oldState), ...Object.keys(newState)]);
    
    for (const key of allKeys) {
      if (JSON.stringify(oldState[key]) !== JSON.stringify(newState[key])) {
        diff[key] = {
          old: oldState[key],
          new: newState[key]
        };
      }
    }
    return Object.keys(diff).length > 0 ? diff : null;
  }

  /**
   * Generate a SHA-256 checksum for the log entry
   */
  _generateChecksum(data) {
    const secret = process.env.AUDIT_LOG_SECRET || 'audit-secret-key';
    return crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(data))
      .digest('hex');
  }

  /**
   * Search audit logs
   */
  async search(filters = {}, options = {}) {
    const { limit = 50, offset = 0 } = options;
    let query = 'SELECT * FROM audit_logs WHERE 1=1';
    const params = [];

    if (filters.user_id) {
      query += ' AND user_id = ?';
      params.push(filters.user_id);
    }
    if (filters.resource) {
      query += ' AND resource = ?';
      params.push(filters.resource);
    }
    if (filters.action) {
      query += ' AND action = ?';
      params.push(filters.action);
    }
    if (filters.status) {
      query += ' AND status = ?';
      params.push(filters.status);
    }
    if (filters.startDate) {
      query += ' AND timestamp >= ?';
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      query += ' AND timestamp <= ?';
      params.push(filters.endDate);
    }

    query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return new Promise((resolve, reject) => {
      this.db.all(query, params, (err, rows) => {
        if (err) reject(err);
        else {
          resolve(rows.map(row => ({
            ...row,
            previous_state: row.previous_state ? JSON.parse(row.previous_state) : null,
            new_state: row.new_state ? JSON.parse(row.new_state) : null,
            changes: row.changes ? JSON.parse(row.changes) : null,
            metadata: JSON.parse(row.metadata || '{}')
          })));
        }
      });
    });
  }

  /**
   * Apply log retention policy
   * @param {number} days - Number of days to keep logs
   */
  async applyRetentionPolicy(days = 90) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const dateString = cutoffDate.toISOString();

    const query = 'DELETE FROM audit_logs WHERE timestamp < ?';
    
    return new Promise((resolve, reject) => {
      this.db.run(query, [dateString], function(err) {
        if (err) reject(err);
        else {
          console.log(`Audit Retention: Deleted ${this.changes} logs older than ${days} days.`);
          resolve(this.changes);
        }
      });
    });
  }

  /**
   * Verify integrity of a log entry
   */
  async verifyIntegrity(logId) {
    return new Promise((resolve, reject) => {
      this.db.get('SELECT * FROM audit_logs WHERE id = ?', [logId], (err, row) => {
        if (err) return reject(err);
        if (!row) return reject(new Error('Log not found'));

        const dataToVerify = {
          id: row.id,
          action: row.action,
          resource: row.resource,
          resource_id: row.resource_id,
          user_id: row.user_id,
          timestamp: row.timestamp,
          status: row.status
        };

        const calculatedChecksum = this._generateChecksum(dataToVerify);
        resolve(calculatedChecksum === row.checksum);
      });
    });
  }
}

module.exports = new AuditService();
