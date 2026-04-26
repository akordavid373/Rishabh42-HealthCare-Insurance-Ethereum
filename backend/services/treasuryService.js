const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../database/healthcare.db');

const ROLES = ['owner', 'admin', 'approver', 'viewer'];
const TX_TYPES = ['transfer', 'withdrawal', 'investment', 'emergency_withdrawal', 'reinsurance_payment'];

class TreasuryService {
  getDatabase() {
    return new sqlite3.Database(DB_PATH);
  }

  // ── Treasury Setup ───────────────────────────────────────────────────────────

  async createTreasury(data) {
    const db = this.getDatabase();
    const treasuryId = uuidv4();
    try {
      if (data.required_signatures < 1 || data.required_signatures > data.signers.length) {
        throw new Error('required_signatures must be between 1 and total signers');
      }
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO treasuries (treasury_id, name, description, required_signatures, total_signers, balance, currency, status, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, CURRENT_TIMESTAMP)`,
          [treasuryId, data.name, data.description || null, data.required_signatures,
           data.signers.length, data.initial_balance || 0, data.currency || 'USD', data.created_by],
          (err) => { if (err) reject(err); else resolve(); }
        );
      });
      // Add signers
      for (const signer of data.signers) {
        await new Promise((resolve, reject) => {
          db.run(
            `INSERT INTO treasury_signers (treasury_id, user_id, role, added_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
            [treasuryId, signer.user_id, signer.role || 'approver'],
            (err) => { if (err) reject(err); else resolve(); }
          );
        });
      }
      return { treasury_id: treasuryId, status: 'active', ...data };
    } finally { db.close(); }
  }

  async getTreasury(treasuryId) {
    const db = this.getDatabase();
    try {
      const treasury = await new Promise((resolve, reject) => {
        db.get('SELECT * FROM treasuries WHERE treasury_id = ?', [treasuryId],
          (err, row) => { if (err) reject(err); else resolve(row); });
      });
      if (!treasury) throw new Error('Treasury not found');
      const signers = await new Promise((resolve, reject) => {
        db.all('SELECT * FROM treasury_signers WHERE treasury_id = ?', [treasuryId],
          (err, rows) => { if (err) reject(err); else resolve(rows); });
      });
      return { ...treasury, signers };
    } finally { db.close(); }
  }

  // ── Transaction Proposals ────────────────────────────────────────────────────

  async proposeTransaction(treasuryId, proposerId, txData) {
    const db = this.getDatabase();
    const txId = uuidv4();
    try {
      const treasury = await this.getTreasury(treasuryId);
      const isSigner = treasury.signers.some(s => s.user_id == proposerId);
      if (!isSigner) throw new Error('Only treasury signers can propose transactions');
      if (!TX_TYPES.includes(txData.tx_type)) throw new Error(`Invalid tx_type. Allowed: ${TX_TYPES.join(', ')}`);
      if (txData.amount > treasury.balance && txData.tx_type !== 'investment') {
        throw new Error('Insufficient treasury balance');
      }

      const txHash = crypto.createHash('sha256')
        .update(`${treasuryId}${txId}${txData.amount}${Date.now()}`).digest('hex');

      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO treasury_transactions
            (tx_id, treasury_id, proposer_id, tx_type, amount, currency, recipient, description,
             tx_hash, required_signatures, signatures_collected, status, proposed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'pending', CURRENT_TIMESTAMP)`,
          [txId, treasuryId, proposerId, txData.tx_type, txData.amount,
           txData.currency || treasury.currency, txData.recipient || null,
           txData.description || null, txHash, treasury.required_signatures],
          (err) => { if (err) reject(err); else resolve(); }
        );
      });

      await this.auditLog(db, treasuryId, proposerId, 'transaction_proposed', { tx_id: txId, amount: txData.amount });
      return { tx_id: txId, tx_hash: txHash, status: 'pending', required_signatures: treasury.required_signatures };
    } finally { db.close(); }
  }

  async signTransaction(txId, signerId) {
    const db = this.getDatabase();
    try {
      const tx = await new Promise((resolve, reject) => {
        db.get('SELECT * FROM treasury_transactions WHERE tx_id = ?', [txId],
          (err, row) => { if (err) reject(err); else resolve(row); });
      });
      if (!tx) throw new Error('Transaction not found');
      if (tx.status !== 'pending') throw new Error(`Transaction is already ${tx.status}`);

      // Check signer is authorized
      const signer = await new Promise((resolve, reject) => {
        db.get('SELECT * FROM treasury_signers WHERE treasury_id = ? AND user_id = ?',
          [tx.treasury_id, signerId], (err, row) => { if (err) reject(err); else resolve(row); });
      });
      if (!signer) throw new Error('Not an authorized signer for this treasury');

      // Check not already signed
      const existing = await new Promise((resolve, reject) => {
        db.get('SELECT id FROM treasury_signatures WHERE tx_id = ? AND signer_id = ?',
          [txId, signerId], (err, row) => { if (err) reject(err); else resolve(row); });
      });
      if (existing) throw new Error('Already signed this transaction');

      const sigHash = crypto.createHash('sha256').update(`${txId}${signerId}${Date.now()}`).digest('hex');
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO treasury_signatures (tx_id, signer_id, sig_hash, signed_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
          [txId, signerId, sigHash], (err) => { if (err) reject(err); else resolve(); }
        );
      });

      const newCount = tx.signatures_collected + 1;
      const newStatus = newCount >= tx.required_signatures ? 'approved' : 'pending';

      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE treasury_transactions SET signatures_collected = ?, status = ? WHERE tx_id = ?`,
          [newCount, newStatus, txId], (err) => { if (err) reject(err); else resolve(); }
        );
      });

      if (newStatus === 'approved') {
        await this.executeTransaction(db, tx);
      }

      await this.auditLog(db, tx.treasury_id, signerId, 'transaction_signed', { tx_id: txId, new_status: newStatus });
      return { tx_id: txId, signatures_collected: newCount, status: newStatus };
    } finally { db.close(); }
  }

  async executeTransaction(db, tx) {
    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE treasuries SET balance = balance - ? WHERE treasury_id = ?`,
        [tx.amount, tx.treasury_id], (err) => { if (err) reject(err); else resolve(); }
      );
    });
    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE treasury_transactions SET status = 'executed', executed_at = CURRENT_TIMESTAMP WHERE tx_id = ?`,
        [tx.tx_id], (err) => { if (err) reject(err); else resolve(); }
      );
    });
  }

  // ── Emergency Procedures ─────────────────────────────────────────────────────

  async emergencyFreeze(treasuryId, requesterId, reason) {
    const db = this.getDatabase();
    try {
      await new Promise((resolve, reject) => {
        db.run(`UPDATE treasuries SET status = 'frozen' WHERE treasury_id = ?`,
          [treasuryId], (err) => { if (err) reject(err); else resolve(); });
      });
      await this.auditLog(db, treasuryId, requesterId, 'emergency_freeze', { reason });
      return { treasury_id: treasuryId, status: 'frozen', reason };
    } finally { db.close(); }
  }

  // ── Audit & Reporting ────────────────────────────────────────────────────────

  async auditLog(db, treasuryId, userId, action, details) {
    return new Promise((resolve) => {
      db.run(
        `INSERT INTO treasury_audit_log (log_id, treasury_id, user_id, action, details, logged_at)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [uuidv4(), treasuryId, userId, action, JSON.stringify(details)],
        () => resolve()
      );
    });
  }

  async getAuditLog(treasuryId, limit = 100) {
    const db = this.getDatabase();
    try {
      return await new Promise((resolve, reject) => {
        db.all(
          `SELECT * FROM treasury_audit_log WHERE treasury_id = ? ORDER BY logged_at DESC LIMIT ?`,
          [treasuryId, limit], (err, rows) => {
            if (err) reject(err);
            else resolve(rows.map(r => ({ ...r, details: JSON.parse(r.details || '{}') })));
          }
        );
      });
    } finally { db.close(); }
  }

  async getReport(treasuryId) {
    const db = this.getDatabase();
    try {
      const [treasury, txStats] = await Promise.all([
        this.getTreasury(treasuryId),
        new Promise((resolve, reject) => {
          db.get(
            `SELECT COUNT(*) as total_tx, SUM(CASE WHEN status='executed' THEN amount ELSE 0 END) as total_outflow,
             COUNT(CASE WHEN status='pending' THEN 1 END) as pending_tx
             FROM treasury_transactions WHERE treasury_id = ?`,
            [treasuryId], (err, row) => { if (err) reject(err); else resolve(row); }
          );
        })
      ]);
      return { treasury, stats: txStats, generated_at: new Date().toISOString() };
    } finally { db.close(); }
  }

  async getTransactions(treasuryId, filters = {}) {
    const db = this.getDatabase();
    try {
      let query = 'SELECT * FROM treasury_transactions WHERE treasury_id = ?';
      const params = [treasuryId];
      if (filters.status) { query += ' AND status = ?'; params.push(filters.status); }
      if (filters.tx_type) { query += ' AND tx_type = ?'; params.push(filters.tx_type); }
      query += ' ORDER BY proposed_at DESC LIMIT ? OFFSET ?';
      params.push(parseInt(filters.limit || 50), parseInt(filters.offset || 0));
      return await new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) => { if (err) reject(err); else resolve(rows); });
      });
    } finally { db.close(); }
  }
}

module.exports = new TreasuryService();
