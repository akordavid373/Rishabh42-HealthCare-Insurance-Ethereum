const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../database/healthcare.db');

class ReinsuranceService {
  getDatabase() {
    return new sqlite3.Database(DB_PATH);
  }

  // ── Pool Management ──────────────────────────────────────────────────────────

  async createPool(data) {
    const db = this.getDatabase();
    const poolId = uuidv4();
    try {
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO reinsurance_pools
            (pool_id, name, description, pool_type, total_capacity, used_capacity,
             min_contribution, risk_model, governance_rules, status, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 'active', ?, CURRENT_TIMESTAMP)`,
          [poolId, data.name, data.description || null, data.pool_type || 'proportional',
           data.total_capacity, data.min_contribution || 0,
           JSON.stringify(data.risk_model || {}),
           JSON.stringify(data.governance_rules || { quorum: 51, voting_period_days: 7 }),
           data.created_by],
          (err) => { if (err) reject(err); else resolve(); }
        );
      });
      return { pool_id: poolId, status: 'active', used_capacity: 0, ...data };
    } finally { db.close(); }
  }

  async joinPool(poolId, insurerId, contribution) {
    const db = this.getDatabase();
    const memberId = uuidv4();
    try {
      const pool = await new Promise((resolve, reject) => {
        db.get('SELECT * FROM reinsurance_pools WHERE pool_id = ? AND status = ?', [poolId, 'active'],
          (err, row) => { if (err) reject(err); else resolve(row); });
      });
      if (!pool) throw new Error('Pool not found or inactive');
      if (contribution < pool.min_contribution) throw new Error(`Minimum contribution is ${pool.min_contribution}`);
      if (pool.used_capacity + contribution > pool.total_capacity) throw new Error('Contribution exceeds pool capacity');

      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO reinsurance_members (member_id, pool_id, insurer_id, contribution, share_percentage, joined_at)
           VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
          [memberId, poolId, insurerId, contribution,
           Math.round((contribution / pool.total_capacity) * 10000) / 100],
          (err) => { if (err) reject(err); else resolve(); }
        );
      });
      await new Promise((resolve, reject) => {
        db.run('UPDATE reinsurance_pools SET used_capacity = used_capacity + ? WHERE pool_id = ?',
          [contribution, poolId], (err) => { if (err) reject(err); else resolve(); });
      });
      return { member_id: memberId, pool_id: poolId, insurer_id: insurerId, contribution };
    } finally { db.close(); }
  }

  // ── Risk Sharing & Claims ────────────────────────────────────────────────────

  async submitClaim(poolId, claimData) {
    const db = this.getDatabase();
    const reClaimId = uuidv4();
    try {
      const members = await new Promise((resolve, reject) => {
        db.all('SELECT * FROM reinsurance_members WHERE pool_id = ?', [poolId],
          (err, rows) => { if (err) reject(err); else resolve(rows); });
      });
      if (members.length === 0) throw new Error('No members in pool');

      const riskModel = await this.calculateRiskSharing(members, claimData.amount);

      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO reinsurance_claims
            (claim_id, pool_id, submitter_id, original_claim_id, claimed_amount,
             risk_distribution, status, submitted_at)
           VALUES (?, ?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)`,
          [reClaimId, poolId, claimData.submitter_id, claimData.original_claim_id || null,
           claimData.amount, JSON.stringify(riskModel)],
          (err) => { if (err) reject(err); else resolve(); }
        );
      });

      return { claim_id: reClaimId, pool_id: poolId, risk_distribution: riskModel, status: 'pending' };
    } finally { db.close(); }
  }

  calculateRiskSharing(members, totalAmount) {
    return members.map(m => ({
      insurer_id: m.insurer_id,
      share_percentage: m.share_percentage,
      liability_amount: Math.round((m.share_percentage / 100) * totalAmount * 100) / 100
    }));
  }

  async settleClaimAutomatically(claimId) {
    const db = this.getDatabase();
    try {
      const claim = await new Promise((resolve, reject) => {
        db.get('SELECT * FROM reinsurance_claims WHERE claim_id = ?', [claimId],
          (err, row) => { if (err) reject(err); else resolve(row); });
      });
      if (!claim) throw new Error('Claim not found');
      if (claim.status !== 'pending') throw new Error(`Claim already ${claim.status}`);

      const distribution = JSON.parse(claim.risk_distribution || '[]');
      const settlements = [];

      for (const share of distribution) {
        const settlementId = uuidv4();
        await new Promise((resolve, reject) => {
          db.run(
            `INSERT INTO reinsurance_settlements
              (settlement_id, claim_id, pool_id, insurer_id, amount, status, settled_at)
             VALUES (?, ?, ?, ?, ?, 'completed', CURRENT_TIMESTAMP)`,
            [settlementId, claimId, claim.pool_id, share.insurer_id, share.liability_amount],
            (err) => { if (err) reject(err); else resolve(); }
          );
        });
        settlements.push({ settlement_id: settlementId, ...share });
      }

      await new Promise((resolve, reject) => {
        db.run(`UPDATE reinsurance_claims SET status = 'settled', settled_at = CURRENT_TIMESTAMP WHERE claim_id = ?`,
          [claimId], (err) => { if (err) reject(err); else resolve(); });
      });

      return { claim_id: claimId, status: 'settled', settlements };
    } finally { db.close(); }
  }

  // ── Governance ───────────────────────────────────────────────────────────────

  async createProposal(poolId, proposerId, proposalData) {
    const db = this.getDatabase();
    const proposalId = uuidv4();
    try {
      const pool = await new Promise((resolve, reject) => {
        db.get('SELECT governance_rules FROM reinsurance_pools WHERE pool_id = ?', [poolId],
          (err, row) => { if (err) reject(err); else resolve(row); });
      });
      const rules = JSON.parse(pool?.governance_rules || '{}');
      const votingDeadline = new Date(Date.now() + (rules.voting_period_days || 7) * 86400000).toISOString();

      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO reinsurance_proposals
            (proposal_id, pool_id, proposer_id, title, description, proposal_type, votes_for, votes_against, status, voting_deadline, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, 0, 'active', ?, CURRENT_TIMESTAMP)`,
          [proposalId, poolId, proposerId, proposalData.title, proposalData.description,
           proposalData.proposal_type || 'parameter_change', votingDeadline],
          (err) => { if (err) reject(err); else resolve(); }
        );
      });
      return { proposal_id: proposalId, pool_id: poolId, voting_deadline: votingDeadline, status: 'active' };
    } finally { db.close(); }
  }

  async vote(proposalId, voterId, vote) {
    const db = this.getDatabase();
    try {
      if (!['for', 'against'].includes(vote)) throw new Error('Vote must be "for" or "against"');
      const col = vote === 'for' ? 'votes_for' : 'votes_against';
      await new Promise((resolve, reject) => {
        db.run(`UPDATE reinsurance_proposals SET ${col} = ${col} + 1 WHERE proposal_id = ? AND status = 'active'`,
          [proposalId], function(err) { if (err) reject(err); else resolve(this.changes); });
      });
      return { proposal_id: proposalId, voter_id: voterId, vote };
    } finally { db.close(); }
  }

  async getPoolStats(poolId) {
    const db = this.getDatabase();
    try {
      const [pool, claimStats, memberCount] = await Promise.all([
        new Promise((resolve, reject) => {
          db.get('SELECT * FROM reinsurance_pools WHERE pool_id = ?', [poolId],
            (err, row) => { if (err) reject(err); else resolve(row); });
        }),
        new Promise((resolve, reject) => {
          db.get(`SELECT COUNT(*) as total, SUM(claimed_amount) as total_claimed,
                  COUNT(CASE WHEN status='settled' THEN 1 END) as settled
                  FROM reinsurance_claims WHERE pool_id = ?`,
            [poolId], (err, row) => { if (err) reject(err); else resolve(row); });
        }),
        new Promise((resolve, reject) => {
          db.get('SELECT COUNT(*) as count FROM reinsurance_members WHERE pool_id = ?',
            [poolId], (err, row) => { if (err) reject(err); else resolve(row?.count || 0); });
        })
      ]);
      if (!pool) throw new Error('Pool not found');
      return {
        ...pool,
        risk_model: JSON.parse(pool.risk_model || '{}'),
        governance_rules: JSON.parse(pool.governance_rules || '{}'),
        member_count: memberCount,
        claim_stats: claimStats,
        utilization_pct: pool.total_capacity > 0
          ? Math.round((pool.used_capacity / pool.total_capacity) * 10000) / 100 : 0
      };
    } finally { db.close(); }
  }
}

module.exports = new ReinsuranceService();
