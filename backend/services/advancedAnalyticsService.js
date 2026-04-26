const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../database/healthcare.db');

class AdvancedAnalyticsService {
  getDatabase() {
    return new sqlite3.Database(DB_PATH);
  }

  // ---------------------------------------------------------------------------
  // Dashboard CRUD
  // ---------------------------------------------------------------------------

  async createDashboard(data) {
    const db = this.getDatabase();
    const dashboardId = uuidv4();
    try {
      await this._run(db,
        `INSERT INTO analytics_dashboards (dashboard_id, name, description, layout, created_by, is_public)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [dashboardId, data.name, data.description || null,
         JSON.stringify(data.layout || []), data.created_by, data.is_public ? 1 : 0]
      );
      return this.getDashboard(dashboardId);
    } finally { db.close(); }
  }

  async getDashboard(dashboardId) {
    const db = this.getDatabase();
    try {
      const row = await this._get(db, 'SELECT * FROM analytics_dashboards WHERE dashboard_id = ?', [dashboardId]);
      if (!row) throw new Error('Dashboard not found');
      const widgets = await this._all(db,
        'SELECT * FROM analytics_widgets WHERE dashboard_id = ? ORDER BY position_y, position_x', [dashboardId]);
      return { ...this._formatDashboard(row), widgets: widgets.map(w => this._formatWidget(w)) };
    } finally { db.close(); }
  }

  async listDashboards(filters = {}) {
    const db = this.getDatabase();
    try {
      let query = 'SELECT * FROM analytics_dashboards WHERE 1=1';
      const params = [];
      if (filters.created_by) { query += ' AND created_by = ?'; params.push(filters.created_by); }
      if (filters.is_public !== undefined) { query += ' AND is_public = ?'; params.push(filters.is_public ? 1 : 0); }
      query += ' ORDER BY updated_at DESC';
      const rows = await this._all(db, query, params);
      return rows.map(r => this._formatDashboard(r));
    } finally { db.close(); }
  }

  async updateDashboard(dashboardId, data) {
    const db = this.getDatabase();
    try {
      const sets = [];
      const params = [];
      if (data.name !== undefined) { sets.push('name = ?'); params.push(data.name); }
      if (data.description !== undefined) { sets.push('description = ?'); params.push(data.description); }
      if (data.layout !== undefined) { sets.push('layout = ?'); params.push(JSON.stringify(data.layout)); }
      if (data.is_public !== undefined) { sets.push('is_public = ?'); params.push(data.is_public ? 1 : 0); }
      if (sets.length === 0) throw new Error('No fields to update');
      sets.push('updated_at = CURRENT_TIMESTAMP');
      params.push(dashboardId);
      const changes = await this._run(db, `UPDATE analytics_dashboards SET ${sets.join(', ')} WHERE dashboard_id = ?`, params);
      if (changes === 0) throw new Error('Dashboard not found');
      return this.getDashboard(dashboardId);
    } finally { db.close(); }
  }

  async deleteDashboard(dashboardId) {
    const db = this.getDatabase();
    try {
      await this._run(db, 'DELETE FROM analytics_widgets WHERE dashboard_id = ?', [dashboardId]);
      const changes = await this._run(db, 'DELETE FROM analytics_dashboards WHERE dashboard_id = ?', [dashboardId]);
      if (changes === 0) throw new Error('Dashboard not found');
    } finally { db.close(); }
  }

  // ---------------------------------------------------------------------------
  // Widget CRUD
  // ---------------------------------------------------------------------------

  async addWidget(data) {
    const db = this.getDatabase();
    const widgetId = uuidv4();
    try {
      await this._run(db,
        `INSERT INTO analytics_widgets
          (widget_id, dashboard_id, name, widget_type, data_source, query_config, visualization_config,
           position_x, position_y, width, height, refresh_interval_sec)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [widgetId, data.dashboard_id, data.name, data.widget_type, data.data_source,
         JSON.stringify(data.query_config || {}),
         JSON.stringify(data.visualization_config || {}),
         data.position_x || 0, data.position_y || 0,
         data.width || 1, data.height || 1,
         data.refresh_interval_sec || 300]
      );
      return this.getWidget(widgetId);
    } finally { db.close(); }
  }

  async getWidget(widgetId) {
    const db = this.getDatabase();
    try {
      const row = await this._get(db, 'SELECT * FROM analytics_widgets WHERE widget_id = ?', [widgetId]);
      if (!row) throw new Error('Widget not found');
      return this._formatWidget(row);
    } finally { db.close(); }
  }

  async updateWidget(widgetId, data) {
    const db = this.getDatabase();
    try {
      const sets = [];
      const params = [];
      for (const key of ['name', 'widget_type', 'data_source', 'position_x', 'position_y', 'width', 'height', 'refresh_interval_sec']) {
        if (data[key] !== undefined) { sets.push(`${key} = ?`); params.push(data[key]); }
      }
      for (const key of ['query_config', 'visualization_config']) {
        if (data[key] !== undefined) { sets.push(`${key} = ?`); params.push(JSON.stringify(data[key])); }
      }
      if (sets.length === 0) throw new Error('No fields to update');
      sets.push('updated_at = CURRENT_TIMESTAMP');
      params.push(widgetId);
      const changes = await this._run(db, `UPDATE analytics_widgets SET ${sets.join(', ')} WHERE widget_id = ?`, params);
      if (changes === 0) throw new Error('Widget not found');
      return this.getWidget(widgetId);
    } finally { db.close(); }
  }

  async deleteWidget(widgetId) {
    const db = this.getDatabase();
    try {
      const changes = await this._run(db, 'DELETE FROM analytics_widgets WHERE widget_id = ?', [widgetId]);
      if (changes === 0) throw new Error('Widget not found');
    } finally { db.close(); }
  }

  // ---------------------------------------------------------------------------
  // Real-time & Aggregate Analytics
  // ---------------------------------------------------------------------------

  async getRealtimeMetrics() {
    const db = this.getDatabase();
    try {
      const [claims, payments, patients, recentClaims] = await Promise.all([
        this._get(db, `SELECT COUNT(*) as total, SUM(total_amount) as total_amount,
                        AVG(total_amount) as avg_amount FROM insurance_claims`),
        this._get(db, `SELECT COUNT(*) as total, SUM(payment_amount) as total_amount FROM premium_payments`),
        this._get(db, 'SELECT COUNT(*) as total FROM patients'),
        this._get(db, `SELECT COUNT(*) as count FROM insurance_claims WHERE submission_date >= datetime('now', '-24 hours')`),
      ]);

      return {
        timestamp: new Date().toISOString(),
        claims: {
          total_count: claims?.total || 0,
          total_amount: claims?.total_amount || 0,
          average_amount: Math.round((claims?.avg_amount || 0) * 100) / 100,
          last_24h: recentClaims?.count || 0,
        },
        payments: {
          total_count: payments?.total || 0,
          total_collected: payments?.total_amount || 0,
        },
        patients: { total_registered: patients?.total || 0 },
      };
    } finally { db.close(); }
  }

  async getClaimsAnalytics(options = {}) {
    const db = this.getDatabase();
    try {
      const { period = '30d' } = options;
      const dateFilter = this._periodToDateFilter(period);

      const [byStatus, byMonth, topProviders] = await Promise.all([
        this._all(db,
          `SELECT status, COUNT(*) as count, SUM(total_amount) as total
           FROM insurance_claims ${dateFilter.where}
           GROUP BY status ORDER BY count DESC`, dateFilter.params),
        this._all(db,
          `SELECT strftime('%Y-%m', service_date) as month, COUNT(*) as count,
                  SUM(total_amount) as total, AVG(total_amount) as avg_amount
           FROM insurance_claims ${dateFilter.where}
           GROUP BY month ORDER BY month DESC LIMIT 12`, dateFilter.params),
        this._all(db,
          `SELECT provider_name, COUNT(*) as count, SUM(total_amount) as total
           FROM insurance_claims ${dateFilter.where}
           GROUP BY provider_name ORDER BY total DESC LIMIT 10`, dateFilter.params),
      ]);

      return { period, by_status: byStatus, by_month: byMonth, top_providers: topProviders };
    } finally { db.close(); }
  }

  async getPaymentAnalytics(options = {}) {
    const db = this.getDatabase();
    try {
      const { period = '30d' } = options;
      const dateFilter = this._periodToDateFilter(period, 'payment_date');

      const [byMethod, byMonth, byStatus] = await Promise.all([
        this._all(db,
          `SELECT payment_method, COUNT(*) as count, SUM(payment_amount) as total
           FROM premium_payments ${dateFilter.where}
           GROUP BY payment_method ORDER BY total DESC`, dateFilter.params),
        this._all(db,
          `SELECT strftime('%Y-%m', payment_date) as month, COUNT(*) as count,
                  SUM(payment_amount) as total
           FROM premium_payments ${dateFilter.where}
           GROUP BY month ORDER BY month DESC LIMIT 12`, dateFilter.params),
        this._all(db,
          `SELECT payment_status, COUNT(*) as count, SUM(payment_amount) as total
           FROM premium_payments ${dateFilter.where}
           GROUP BY payment_status`, dateFilter.params),
      ]);

      return { period, by_method: byMethod, by_month: byMonth, by_status: byStatus };
    } finally { db.close(); }
  }

  // ---------------------------------------------------------------------------
  // Predictive Modeling
  // ---------------------------------------------------------------------------

  async getPredictiveInsights(patientId) {
    const db = this.getDatabase();
    try {
      const [claims, metrics, payments] = await Promise.all([
        this._all(db,
          `SELECT status, total_amount, service_date FROM insurance_claims
           WHERE patient_id = ? ORDER BY service_date DESC LIMIT 50`, [patientId]),
        this._all(db,
          `SELECT metric_type, metric_value, normalized_score, recorded_date FROM health_metrics
           WHERE patient_id = ? ORDER BY recorded_date DESC`, [patientId]),
        this._all(db,
          `SELECT payment_amount, payment_date, payment_status FROM premium_payments
           WHERE patient_id = ? ORDER BY payment_date DESC LIMIT 24`, [patientId]),
      ]);

      // Compute risk indicators from historical data
      const totalClaims = claims.length;
      const deniedClaims = claims.filter(c => c.status === 'denied').length;
      const avgClaimAmount = totalClaims > 0
        ? claims.reduce((s, c) => s + (c.total_amount || 0), 0) / totalClaims : 0;
      const denialRate = totalClaims > 0 ? deniedClaims / totalClaims : 0;

      const latestMetrics = {};
      for (const m of metrics) {
        if (!latestMetrics[m.metric_type]) latestMetrics[m.metric_type] = m;
      }
      const avgNormScore = metrics.length > 0
        ? metrics.reduce((s, m) => s + (m.normalized_score || 0), 0) / metrics.length : 0.5;

      const missedPayments = payments.filter(p => p.payment_status === 'failed').length;

      // Simple risk score (0-100)
      let riskScore = 20; // baseline
      if (denialRate > 0.3) riskScore += 20;
      if (avgClaimAmount > 5000) riskScore += 15;
      if (totalClaims > 10) riskScore += 10;
      if (avgNormScore < 0.4) riskScore += 15;
      if (missedPayments > 2) riskScore += 10;
      riskScore = Math.min(riskScore, 100);

      // Premium trend prediction
      const premiumTrend = riskScore > 60 ? 'increasing' : riskScore > 40 ? 'stable' : 'decreasing';
      const estimatedAdjustment = riskScore > 60
        ? `+${Math.round((riskScore - 50) * 0.3)}%`
        : riskScore < 40
          ? `-${Math.round((50 - riskScore) * 0.2)}%`
          : '0%';

      return {
        patient_id: patientId,
        risk_score: riskScore,
        risk_level: riskScore >= 60 ? 'high' : riskScore >= 40 ? 'medium' : 'low',
        premium_trend: premiumTrend,
        estimated_adjustment: estimatedAdjustment,
        factors: {
          claim_history: { total: totalClaims, denial_rate: Math.round(denialRate * 100) / 100, avg_amount: Math.round(avgClaimAmount * 100) / 100 },
          health_metrics: { avg_normalized_score: Math.round(avgNormScore * 100) / 100, latest: latestMetrics },
          payment_history: { total: payments.length, missed: missedPayments },
        },
        generated_at: new Date().toISOString(),
      };
    } finally { db.close(); }
  }

  // ---------------------------------------------------------------------------
  // Snapshots
  // ---------------------------------------------------------------------------

  async recordSnapshot(data) {
    const db = this.getDatabase();
    const snapshotId = uuidv4();
    try {
      await this._run(db,
        `INSERT INTO analytics_snapshots
          (snapshot_id, dashboard_id, widget_id, snapshot_type, metric_name, metric_value, dimensions, period_start, period_end)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [snapshotId, data.dashboard_id || null, data.widget_id || null,
         data.snapshot_type, data.metric_name, data.metric_value,
         JSON.stringify(data.dimensions || {}),
         data.period_start || null, data.period_end || null]
      );
      return { snapshot_id: snapshotId, ...data, created_at: new Date().toISOString() };
    } finally { db.close(); }
  }

  async getSnapshots(filters = {}) {
    const db = this.getDatabase();
    try {
      let query = 'SELECT * FROM analytics_snapshots WHERE 1=1';
      const params = [];
      if (filters.dashboard_id) { query += ' AND dashboard_id = ?'; params.push(filters.dashboard_id); }
      if (filters.widget_id) { query += ' AND widget_id = ?'; params.push(filters.widget_id); }
      if (filters.metric_name) { query += ' AND metric_name = ?'; params.push(filters.metric_name); }
      if (filters.snapshot_type) { query += ' AND snapshot_type = ?'; params.push(filters.snapshot_type); }
      query += ' ORDER BY created_at DESC';
      if (filters.limit) { query += ' LIMIT ?'; params.push(parseInt(filters.limit)); }
      const rows = await this._all(db, query, params);
      return rows.map(r => ({
        ...r,
        dimensions: JSON.parse(r.dimensions || '{}'),
      }));
    } finally { db.close(); }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  _periodToDateFilter(period, dateCol = 'submission_date') {
    const match = period.match(/^(\d+)([dhm])$/);
    if (!match) return { where: '', params: [] };
    const [, num, unit] = match;
    const sqlUnit = { d: 'days', h: 'hours', m: 'months' }[unit] || 'days';
    return {
      where: `WHERE ${dateCol} >= datetime('now', '-${num} ${sqlUnit}')`,
      params: [],
    };
  }

  _formatDashboard(row) {
    return {
      dashboard_id: row.dashboard_id,
      name: row.name,
      description: row.description,
      layout: JSON.parse(row.layout || '[]'),
      created_by: row.created_by,
      is_public: !!row.is_public,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  _formatWidget(row) {
    return {
      widget_id: row.widget_id,
      dashboard_id: row.dashboard_id,
      name: row.name,
      widget_type: row.widget_type,
      data_source: row.data_source,
      query_config: JSON.parse(row.query_config || '{}'),
      visualization_config: JSON.parse(row.visualization_config || '{}'),
      position_x: row.position_x,
      position_y: row.position_y,
      width: row.width,
      height: row.height,
      refresh_interval_sec: row.refresh_interval_sec,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  _run(db, sql, params = []) {
    return new Promise((resolve, reject) => {
      db.run(sql, params, function (err) { if (err) reject(err); else resolve(this.changes); });
    });
  }

  _get(db, sql, params = []) {
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => { if (err) reject(err); else resolve(row); });
    });
  }

  _all(db, sql, params = []) {
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => { if (err) reject(err); else resolve(rows || []); });
    });
  }
}

module.exports = new AdvancedAnalyticsService();
