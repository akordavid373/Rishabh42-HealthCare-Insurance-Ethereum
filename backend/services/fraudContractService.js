const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../database/healthcare.db');

// Fraud pattern rules (simulates smart contract logic)
const FRAUD_PATTERNS = [
  { id: 'duplicate_claim', description: 'Same procedure billed multiple times within 30 days', weight: 35 },
  { id: 'excessive_billing', description: 'Claim amount exceeds 3x patient average', weight: 25 },
  { id: 'phantom_service', description: 'Service date on weekend/holiday with no emergency code', weight: 20 },
  { id: 'upcoding', description: 'Procedure code inconsistent with diagnosis code', weight: 30 },
  { id: 'unbundling', description: 'Multiple procedure codes that should be billed as one', weight: 20 },
  { id: 'high_frequency', description: 'More than 5 claims in 7 days from same provider', weight: 25 }
];

class FraudContractService {
  getDatabase() {
    return new sqlite3.Database(DB_PATH);
  }

  // ── Pattern Detection ────────────────────────────────────────────────────────

  async analyzeContract(claimId) {
    const db = this.getDatabase();
    const analysisId = uuidv4();
    try {
      const claim = await new Promise((resolve, reject) => {
        db.get(
          `SELECT ic.*, p.id as patient_id FROM insurance_claims ic
           JOIN patients p ON ic.patient_id = p.id WHERE ic.id = ?`,
          [claimId], (err, row) => { if (err) reject(err); else resolve(row); }
        );
      });
      if (!claim) throw new Error('Claim not found');

      const detectedPatterns = await this.runPatternDetection(db, claim);
      const riskScore = detectedPatterns.reduce((s, p) => s + p.weight, 0);
      const riskLevel = riskScore >= 60 ? 'critical' : riskScore >= 35 ? 'high' : riskScore >= 15 ? 'medium' : 'low';

      // Privacy-preserving: hash patient identifiers in stored analysis
      const patientHash = crypto.createHash('sha256').update(String(claim.patient_id)).digest('hex').slice(0, 16);

      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO fraud_contract_analyses
            (analysis_id, claim_id, patient_hash, detected_patterns, risk_score, risk_level,
             prevention_action, ml_confidence, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
          [analysisId, claimId, patientHash, JSON.stringify(detectedPatterns),
           riskScore, riskLevel, this.determinePrevention(riskLevel),
           this.calculateMLConfidence(detectedPatterns)],
          (err) => { if (err) reject(err); else resolve(); }
        );
      });

      if (riskLevel === 'critical' || riskLevel === 'high') {
        await this.triggerPrevention(db, claimId, analysisId, riskLevel);
      }

      return {
        analysis_id: analysisId,
        claim_id: claimId,
        risk_score: riskScore,
        risk_level: riskLevel,
        detected_patterns: detectedPatterns,
        prevention_action: this.determinePrevention(riskLevel),
        ml_confidence: this.calculateMLConfidence(detectedPatterns)
      };
    } finally { db.close(); }
  }

  async runPatternDetection(db, claim) {
    const detected = [];

    // Duplicate claim check
    const duplicates = await new Promise((resolve, reject) => {
      db.get(
        `SELECT COUNT(*) as count FROM insurance_claims
         WHERE patient_id = ? AND procedure_codes = ? AND id != ?
         AND service_date >= date(?, '-30 days')`,
        [claim.patient_id, claim.procedure_codes, claim.id, claim.service_date],
        (err, row) => { if (err) reject(err); else resolve(row?.count || 0); }
      );
    });
    if (duplicates > 0) detected.push({ ...FRAUD_PATTERNS[0], triggered: true, evidence: `${duplicates} duplicate(s) found` });

    // Excessive billing check
    const avgClaim = await new Promise((resolve, reject) => {
      db.get(
        `SELECT AVG(total_amount) as avg FROM insurance_claims WHERE patient_id = ? AND id != ?`,
        [claim.patient_id, claim.id],
        (err, row) => { if (err) reject(err); else resolve(row?.avg || 0); }
      );
    });
    if (avgClaim > 0 && claim.total_amount > avgClaim * 3) {
      detected.push({ ...FRAUD_PATTERNS[1], triggered: true, evidence: `Amount ${claim.total_amount} vs avg ${Math.round(avgClaim)}` });
    }

    // High frequency provider check
    const providerFreq = await new Promise((resolve, reject) => {
      db.get(
        `SELECT COUNT(*) as count FROM insurance_claims
         WHERE provider_name = ? AND service_date >= date(?, '-7 days')`,
        [claim.provider_name, claim.service_date],
        (err, row) => { if (err) reject(err); else resolve(row?.count || 0); }
      );
    });
    if (providerFreq > 5) {
      detected.push({ ...FRAUD_PATTERNS[5], triggered: true, evidence: `${providerFreq} claims in 7 days from provider` });
    }

    return detected;
  }

  determinePrevention(riskLevel) {
    const actions = { critical: 'block_and_investigate', high: 'hold_for_review', medium: 'flag_for_audit', low: 'monitor' };
    return actions[riskLevel] || 'monitor';
  }

  calculateMLConfidence(patterns) {
    if (patterns.length === 0) return 0.95;
    return Math.min(0.99, 0.70 + patterns.length * 0.08);
  }

  async triggerPrevention(db, claimId, analysisId, riskLevel) {
    const action = this.determinePrevention(riskLevel);
    const newStatus = action === 'block_and_investigate' ? 'denied' : 'pending';
    await new Promise((resolve, reject) => {
      db.run(`UPDATE insurance_claims SET status = ? WHERE id = ?`,
        [newStatus, claimId], (err) => { if (err) reject(err); else resolve(); });
    });
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO fraud_investigations (investigation_id, claim_id, analysis_id, status, priority, opened_at)
         VALUES (?, ?, ?, 'open', ?, CURRENT_TIMESTAMP)`,
        [uuidv4(), claimId, analysisId, riskLevel === 'critical' ? 'urgent' : 'high'],
        (err) => { if (err) reject(err); else resolve(); }
      );
    });
  }

  // ── Monitoring ───────────────────────────────────────────────────────────────

  async getRealTimeMonitor(filters = {}) {
    const db = this.getDatabase();
    try {
      let query = `SELECT fca.*, ic.claim_number, ic.total_amount, ic.provider_name
                   FROM fraud_contract_analyses fca
                   JOIN insurance_claims ic ON fca.claim_id = ic.id
                   WHERE fca.created_at >= datetime('now', '-24 hours')`;
      const params = [];
      if (filters.risk_level) { query += ' AND fca.risk_level = ?'; params.push(filters.risk_level); }
      query += ' ORDER BY fca.created_at DESC LIMIT 100';

      return await new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) => {
          if (err) reject(err);
          else resolve(rows.map(r => ({
            ...r,
            detected_patterns: JSON.parse(r.detected_patterns || '[]')
          })));
        });
      });
    } finally { db.close(); }
  }

  // ── Investigations ───────────────────────────────────────────────────────────

  async getInvestigations(filters = {}) {
    const db = this.getDatabase();
    try {
      let query = 'SELECT fi.*, ic.claim_number, ic.total_amount FROM fraud_investigations fi JOIN insurance_claims ic ON fi.claim_id = ic.id WHERE 1=1';
      const params = [];
      if (filters.status) { query += ' AND fi.status = ?'; params.push(filters.status); }
      if (filters.priority) { query += ' AND fi.priority = ?'; params.push(filters.priority); }
      query += ' ORDER BY fi.opened_at DESC LIMIT ? OFFSET ?';
      params.push(parseInt(filters.limit || 50), parseInt(filters.offset || 0));
      return await new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) => { if (err) reject(err); else resolve(rows); });
      });
    } finally { db.close(); }
  }

  async updateInvestigation(investigationId, update) {
    const db = this.getDatabase();
    try {
      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE fraud_investigations SET status = ?, resolution = ?, resolved_at = CASE WHEN ? IN ('resolved','closed') THEN CURRENT_TIMESTAMP ELSE resolved_at END WHERE investigation_id = ?`,
          [update.status, update.resolution || null, update.status, investigationId],
          (err) => { if (err) reject(err); else resolve(); }
        );
      });
      return { investigation_id: investigationId, ...update };
    } finally { db.close(); }
  }

  // ── Reporting ────────────────────────────────────────────────────────────────

  async getFraudReport(days = 30) {
    const db = this.getDatabase();
    try {
      const [summary, byLevel, topPatterns] = await Promise.all([
        new Promise((resolve, reject) => {
          db.get(
            `SELECT COUNT(*) as total_analyses, AVG(risk_score) as avg_risk_score,
             COUNT(CASE WHEN risk_level IN ('high','critical') THEN 1 END) as high_risk_count
             FROM fraud_contract_analyses WHERE created_at >= datetime('now', '-${parseInt(days)} days')`,
            [], (err, row) => { if (err) reject(err); else resolve(row); }
          );
        }),
        new Promise((resolve, reject) => {
          db.all(
            `SELECT risk_level, COUNT(*) as count FROM fraud_contract_analyses
             WHERE created_at >= datetime('now', '-${parseInt(days)} days') GROUP BY risk_level`,
            [], (err, rows) => { if (err) reject(err); else resolve(rows); }
          );
        }),
        new Promise((resolve, reject) => {
          db.all(
            `SELECT prevention_action, COUNT(*) as count FROM fraud_contract_analyses
             WHERE created_at >= datetime('now', '-${parseInt(days)} days') GROUP BY prevention_action`,
            [], (err, rows) => { if (err) reject(err); else resolve(rows); }
          );
        })
      ]);
      return { period_days: days, summary, by_risk_level: byLevel, by_prevention_action: topPatterns, generated_at: new Date().toISOString() };
    } finally { db.close(); }
  }
}

module.exports = new FraudContractService();
