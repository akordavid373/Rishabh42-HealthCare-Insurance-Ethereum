const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../database/healthcare.db');

const CHART_TYPES = ['line', 'bar', 'pie', 'donut', 'area', 'scatter', 'heatmap', 'histogram', 'treemap', 'gauge', '3d_scatter', '3d_surface', '3d_bar'];
const DATA_SOURCES = ['claims', 'patients', 'payments', 'appointments', 'medical_records', 'fraud_scores', 'premium_adjustments'];

class DataVisualizationService {
  getDatabase() {
    return new sqlite3.Database(DB_PATH);
  }

  // ── Dashboard Management ─────────────────────────────────────────────────────

  async createDashboard(data) {
    const db = this.getDatabase();
    const dashboardId = uuidv4();
    try {
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO viz_dashboards (dashboard_id, name, description, owner_id, layout, is_public, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [dashboardId, data.name, data.description || null, data.owner_id,
           JSON.stringify(data.layout || []), data.is_public ? 1 : 0],
          (err) => { if (err) reject(err); else resolve(); }
        );
      });
      return { dashboard_id: dashboardId, ...data };
    } finally { db.close(); }
  }

  async getDashboard(dashboardId) {
    const db = this.getDatabase();
    try {
      const dashboard = await new Promise((resolve, reject) => {
        db.get('SELECT * FROM viz_dashboards WHERE dashboard_id = ?', [dashboardId],
          (err, row) => { if (err) reject(err); else resolve(row); });
      });
      if (!dashboard) throw new Error('Dashboard not found');

      const widgets = await new Promise((resolve, reject) => {
        db.all('SELECT * FROM viz_widgets WHERE dashboard_id = ? ORDER BY position ASC',
          [dashboardId], (err, rows) => { if (err) reject(err); else resolve(rows); });
      });

      return {
        ...dashboard,
        layout: JSON.parse(dashboard.layout || '[]'),
        widgets: widgets.map(w => ({ ...w, config: JSON.parse(w.config || '{}') }))
      };
    } finally { db.close(); }
  }

  async listDashboards(ownerId) {
    const db = this.getDatabase();
    try {
      return await new Promise((resolve, reject) => {
        db.all(
          'SELECT dashboard_id, name, description, is_public, created_at FROM viz_dashboards WHERE owner_id = ? OR is_public = 1 ORDER BY updated_at DESC',
          [ownerId], (err, rows) => { if (err) reject(err); else resolve(rows); }
        );
      });
    } finally { db.close(); }
  }

  async updateDashboardLayout(dashboardId, layout) {
    const db = this.getDatabase();
    try {
      await new Promise((resolve, reject) => {
        db.run('UPDATE viz_dashboards SET layout = ?, updated_at = CURRENT_TIMESTAMP WHERE dashboard_id = ?',
          [JSON.stringify(layout), dashboardId], (err) => { if (err) reject(err); else resolve(); });
      });
      return { dashboard_id: dashboardId, layout };
    } finally { db.close(); }
  }

  // ── Widget Management ────────────────────────────────────────────────────────

  async addWidget(dashboardId, widgetData) {
    const db = this.getDatabase();
    const widgetId = uuidv4();
    try {
      if (!CHART_TYPES.includes(widgetData.chart_type)) {
        throw new Error(`Invalid chart_type. Supported: ${CHART_TYPES.join(', ')}`);
      }
      if (!DATA_SOURCES.includes(widgetData.data_source)) {
        throw new Error(`Invalid data_source. Supported: ${DATA_SOURCES.join(', ')}`);
      }
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO viz_widgets (widget_id, dashboard_id, title, chart_type, data_source, config, position, refresh_interval, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
          [widgetId, dashboardId, widgetData.title, widgetData.chart_type,
           widgetData.data_source, JSON.stringify(widgetData.config || {}),
           widgetData.position || 0, widgetData.refresh_interval || 0],
          (err) => { if (err) reject(err); else resolve(); }
        );
      });
      return { widget_id: widgetId, dashboard_id: dashboardId, ...widgetData };
    } finally { db.close(); }
  }

  async deleteWidget(widgetId) {
    const db = this.getDatabase();
    try {
      await new Promise((resolve, reject) => {
        db.run('DELETE FROM viz_widgets WHERE widget_id = ?', [widgetId],
          function(err) { if (err) reject(err); else resolve(this.changes); });
      });
      return { widget_id: widgetId, deleted: true };
    } finally { db.close(); }
  }

  // ── Data Queries ─────────────────────────────────────────────────────────────

  async getChartData(dataSource, config = {}) {
    const db = this.getDatabase();
    try {
      switch (dataSource) {
        case 'claims':
          return await this.getClaimsChartData(db, config);
        case 'payments':
          return await this.getPaymentsChartData(db, config);
        case 'patients':
          return await this.getPatientsChartData(db, config);
        case 'appointments':
          return await this.getAppointmentsChartData(db, config);
        case 'fraud_scores':
          return await this.getFraudScoresData(db, config);
        default:
          throw new Error(`No chart data handler for source: ${dataSource}`);
      }
    } finally { db.close(); }
  }

  async getClaimsChartData(db, config) {
    const rows = await new Promise((resolve, reject) => {
      db.all(
        `SELECT status, COUNT(*) as count, SUM(total_amount) as total_amount,
         strftime('%Y-%m', service_date) as month
         FROM insurance_claims GROUP BY status, month ORDER BY month DESC LIMIT 24`,
        [], (err, rows) => { if (err) reject(err); else resolve(rows); }
      );
    });
    return { source: 'claims', series: this.groupBySeries(rows, 'status', 'month', 'count'), raw: rows };
  }

  async getPaymentsChartData(db, config) {
    const rows = await new Promise((resolve, reject) => {
      db.all(
        `SELECT payment_status, SUM(payment_amount) as total, strftime('%Y-%m', payment_date) as month
         FROM premium_payments GROUP BY payment_status, month ORDER BY month DESC LIMIT 24`,
        [], (err, rows) => { if (err) reject(err); else resolve(rows); }
      );
    });
    return { source: 'payments', series: this.groupBySeries(rows, 'payment_status', 'month', 'total'), raw: rows };
  }

  async getPatientsChartData(db, config) {
    const rows = await new Promise((resolve, reject) => {
      db.all(
        `SELECT blood_type, COUNT(*) as count FROM patients WHERE blood_type IS NOT NULL GROUP BY blood_type`,
        [], (err, rows) => { if (err) reject(err); else resolve(rows); }
      );
    });
    return { source: 'patients', labels: rows.map(r => r.blood_type), values: rows.map(r => r.count), raw: rows };
  }

  async getAppointmentsChartData(db, config) {
    const rows = await new Promise((resolve, reject) => {
      db.all(
        `SELECT appointment_type, status, COUNT(*) as count FROM appointments GROUP BY appointment_type, status`,
        [], (err, rows) => { if (err) reject(err); else resolve(rows); }
      );
    });
    return { source: 'appointments', series: this.groupBySeries(rows, 'appointment_type', 'status', 'count'), raw: rows };
  }

  async getFraudScoresData(db, config) {
    const rows = await new Promise((resolve, reject) => {
      db.all(
        `SELECT risk_level, COUNT(*) as count, AVG(risk_score) as avg_score
         FROM fraud_analysis GROUP BY risk_level`,
        [], (err, rows) => { if (err) reject(err); else resolve(rows); }
      );
    });
    return { source: 'fraud_scores', labels: rows.map(r => r.risk_level), values: rows.map(r => r.count), raw: rows };
  }

  groupBySeries(rows, groupKey, xKey, yKey) {
    const series = {};
    for (const row of rows) {
      const group = row[groupKey] || 'unknown';
      if (!series[group]) series[group] = [];
      series[group].push({ x: row[xKey], y: row[yKey] });
    }
    return series;
  }

  // ── Real-time Snapshot ───────────────────────────────────────────────────────

  async getRealtimeSnapshot() {
    const db = this.getDatabase();
    try {
      const [claimCount, patientCount, pendingPayments, activeAlerts] = await Promise.all([
        new Promise(r => db.get('SELECT COUNT(*) as c FROM insurance_claims WHERE submission_date >= date("now", "-1 day")', [], (e, row) => r(row?.c || 0))),
        new Promise(r => db.get('SELECT COUNT(*) as c FROM patients', [], (e, row) => r(row?.c || 0))),
        new Promise(r => db.get('SELECT COUNT(*) as c FROM premium_payments WHERE payment_status = "pending"', [], (e, row) => r(row?.c || 0))),
        new Promise(r => db.get('SELECT COUNT(*) as c FROM iot_alerts WHERE status = "active"', [], (e, row) => r(row?.c || 0)))
      ]);
      return {
        timestamp: new Date().toISOString(),
        metrics: { claims_today: claimCount, total_patients: patientCount, pending_payments: pendingPayments, active_iot_alerts: activeAlerts }
      };
    } finally { db.close(); }
  }
}

module.exports = new DataVisualizationService();
