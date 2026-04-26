const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const TEST_DB_PATH = path.join(__dirname, '../test_analytics.db');
process.env.DB_PATH = TEST_DB_PATH;

const analyticsService = require('../services/advancedAnalyticsService');

function createTables() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(TEST_DB_PATH);
    db.serialize(() => {
      db.run(`CREATE TABLE IF NOT EXISTS analytics_dashboards (
        dashboard_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        layout TEXT NOT NULL DEFAULT '[]',
        created_by TEXT NOT NULL,
        is_public INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS analytics_widgets (
        widget_id TEXT PRIMARY KEY,
        dashboard_id TEXT NOT NULL,
        name TEXT NOT NULL,
        widget_type TEXT NOT NULL,
        data_source TEXT NOT NULL,
        query_config TEXT NOT NULL DEFAULT '{}',
        visualization_config TEXT NOT NULL DEFAULT '{}',
        position_x INTEGER DEFAULT 0,
        position_y INTEGER DEFAULT 0,
        width INTEGER DEFAULT 1,
        height INTEGER DEFAULT 1,
        refresh_interval_sec INTEGER DEFAULT 300,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS analytics_snapshots (
        snapshot_id TEXT PRIMARY KEY,
        dashboard_id TEXT,
        widget_id TEXT,
        snapshot_type TEXT NOT NULL,
        metric_name TEXT NOT NULL,
        metric_value REAL,
        dimensions TEXT DEFAULT '{}',
        period_start DATETIME,
        period_end DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      // Seed supporting tables for analytics queries
      db.run(`CREATE TABLE IF NOT EXISTS insurance_claims (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER,
        claim_number TEXT,
        status TEXT,
        service_date DATE,
        provider_name TEXT,
        total_amount DECIMAL(10,2),
        insurance_amount DECIMAL(10,2),
        patient_responsibility DECIMAL(10,2),
        submission_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS premium_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER,
        payment_amount DECIMAL(10,2),
        payment_date DATE,
        payment_method TEXT,
        payment_status TEXT,
        insurance_provider TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS patients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        medical_record_number TEXT,
        insurance_provider TEXT,
        insurance_policy_number TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS health_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER,
        metric_type TEXT,
        metric_value TEXT,
        metric_unit TEXT,
        normalized_score REAL,
        recorded_date DATE
      )`);

      // Seed data
      db.run(`INSERT INTO patients (user_id, medical_record_number) VALUES (1, 'MR001')`);
      db.run(`INSERT INTO insurance_claims (patient_id, claim_number, status, service_date, provider_name, total_amount, insurance_amount, patient_responsibility)
              VALUES (1, 'CLM001', 'approved', date('now', '-10 days'), 'Dr. Smith', 500.00, 400.00, 100.00)`);
      db.run(`INSERT INTO insurance_claims (patient_id, claim_number, status, service_date, provider_name, total_amount, insurance_amount, patient_responsibility)
              VALUES (1, 'CLM002', 'denied', date('now', '-5 days'), 'Dr. Jones', 300.00, 0, 300.00)`);
      db.run(`INSERT INTO premium_payments (patient_id, payment_amount, payment_date, payment_method, payment_status)
              VALUES (1, 250.00, date('now', '-15 days'), 'credit_card', 'completed')`);
      db.run(`INSERT INTO premium_payments (patient_id, payment_amount, payment_date, payment_method, payment_status)
              VALUES (1, 250.00, date('now', '-45 days'), 'bank_transfer', 'failed')`);
      db.run(`INSERT INTO health_metrics (patient_id, metric_type, metric_value, metric_unit, normalized_score, recorded_date)
              VALUES (1, 'bmi', '28.5', 'kg/m2', 0.55, date('now', '-30 days'))`, (err) => {
        db.close();
        if (err) reject(err); else resolve();
      });
    });
  });
}

describe('AdvancedAnalyticsService', () => {
  let dashboardId;
  let widgetId;

  beforeAll(async () => {
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
    await createTables();
  });

  afterAll(() => {
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  });

  // ── Dashboard CRUD ────────────────────────────────────────────────────────

  describe('createDashboard()', () => {
    it('should create a dashboard', async () => {
      const dashboard = await analyticsService.createDashboard({
        name: 'Claims Overview',
        description: 'Dashboard tracking claim metrics',
        created_by: 'user-1',
      });
      dashboardId = dashboard.dashboard_id;
      expect(dashboard.name).toBe('Claims Overview');
      expect(dashboard.created_by).toBe('user-1');
      expect(dashboard.widgets).toEqual([]);
    });
  });

  describe('getDashboard()', () => {
    it('should retrieve dashboard with widgets array', async () => {
      const d = await analyticsService.getDashboard(dashboardId);
      expect(d.dashboard_id).toBe(dashboardId);
      expect(Array.isArray(d.widgets)).toBe(true);
    });

    it('should throw for non-existent dashboard', async () => {
      await expect(analyticsService.getDashboard('00000000-0000-0000-0000-000000000000'))
        .rejects.toThrow('Dashboard not found');
    });
  });

  describe('listDashboards()', () => {
    it('should list all dashboards', async () => {
      const list = await analyticsService.listDashboards();
      expect(list.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('updateDashboard()', () => {
    it('should update dashboard name', async () => {
      const updated = await analyticsService.updateDashboard(dashboardId, { name: 'Updated Dashboard' });
      expect(updated.name).toBe('Updated Dashboard');
    });
  });

  // ── Widget CRUD ───────────────────────────────────────────────────────────

  describe('addWidget()', () => {
    it('should add a KPI widget to the dashboard', async () => {
      const widget = await analyticsService.addWidget({
        dashboard_id: dashboardId,
        name: 'Total Claims',
        widget_type: 'kpi',
        data_source: 'insurance_claims',
        query_config: { aggregate: 'COUNT' },
        visualization_config: { color: '#4CAF50' },
      });
      widgetId = widget.widget_id;
      expect(widget.name).toBe('Total Claims');
      expect(widget.widget_type).toBe('kpi');
      expect(widget.dashboard_id).toBe(dashboardId);
    });
  });

  describe('getWidget()', () => {
    it('should retrieve a widget', async () => {
      const w = await analyticsService.getWidget(widgetId);
      expect(w.widget_id).toBe(widgetId);
    });

    it('should throw for non-existent widget', async () => {
      await expect(analyticsService.getWidget('00000000-0000-0000-0000-000000000000'))
        .rejects.toThrow('Widget not found');
    });
  });

  describe('updateWidget()', () => {
    it('should update widget name', async () => {
      const updated = await analyticsService.updateWidget(widgetId, { name: 'Claims Count' });
      expect(updated.name).toBe('Claims Count');
    });
  });

  describe('getDashboard() with widgets', () => {
    it('should include added widgets', async () => {
      const d = await analyticsService.getDashboard(dashboardId);
      expect(d.widgets.length).toBe(1);
      expect(d.widgets[0].widget_id).toBe(widgetId);
    });
  });

  // ── Real-time & Aggregate Analytics ───────────────────────────────────────

  describe('getRealtimeMetrics()', () => {
    it('should return real-time metrics overview', async () => {
      const metrics = await analyticsService.getRealtimeMetrics();
      expect(metrics.timestamp).toBeDefined();
      expect(metrics.claims.total_count).toBeGreaterThanOrEqual(2);
      expect(metrics.claims.total_amount).toBeGreaterThanOrEqual(800);
      expect(metrics.payments.total_count).toBeGreaterThanOrEqual(2);
      expect(metrics.patients.total_registered).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getClaimsAnalytics()', () => {
    it('should return claims analytics with status breakdown', async () => {
      const analytics = await analyticsService.getClaimsAnalytics({ period: '90d' });
      expect(analytics.by_status.length).toBeGreaterThanOrEqual(1);
      expect(analytics.by_month.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getPaymentAnalytics()', () => {
    it('should return payment analytics', async () => {
      const analytics = await analyticsService.getPaymentAnalytics({ period: '90d' });
      expect(analytics.by_method.length).toBeGreaterThanOrEqual(1);
      expect(analytics.by_status.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Predictive Modeling ───────────────────────────────────────────────────

  describe('getPredictiveInsights()', () => {
    it('should return risk score and factors for a patient', async () => {
      const insights = await analyticsService.getPredictiveInsights(1);
      expect(insights.patient_id).toBe(1);
      expect(insights.risk_score).toBeGreaterThanOrEqual(0);
      expect(insights.risk_score).toBeLessThanOrEqual(100);
      expect(['low', 'medium', 'high']).toContain(insights.risk_level);
      expect(['increasing', 'stable', 'decreasing']).toContain(insights.premium_trend);
      expect(insights.factors.claim_history.total).toBe(2);
      expect(insights.factors.payment_history.missed).toBe(1);
    });

    it('should return baseline score for patient with no data', async () => {
      const insights = await analyticsService.getPredictiveInsights(999);
      expect(insights.risk_score).toBe(20); // baseline
      expect(insights.risk_level).toBe('low');
    });
  });

  // ── Snapshots ─────────────────────────────────────────────────────────────

  describe('recordSnapshot()', () => {
    it('should record a snapshot', async () => {
      const snap = await analyticsService.recordSnapshot({
        snapshot_type: 'realtime',
        metric_name: 'total_claims',
        metric_value: 42,
        dashboard_id: dashboardId,
      });
      expect(snap.snapshot_id).toBeDefined();
      expect(snap.metric_name).toBe('total_claims');
      expect(snap.metric_value).toBe(42);
    });
  });

  describe('getSnapshots()', () => {
    it('should list snapshots for a dashboard', async () => {
      const snaps = await analyticsService.getSnapshots({ dashboard_id: dashboardId });
      expect(snaps.length).toBeGreaterThanOrEqual(1);
    });

    it('should filter by metric_name', async () => {
      const snaps = await analyticsService.getSnapshots({ metric_name: 'total_claims' });
      snaps.forEach(s => expect(s.metric_name).toBe('total_claims'));
    });
  });

  // ── Cleanup ───────────────────────────────────────────────────────────────

  describe('deleteWidget()', () => {
    it('should delete a widget', async () => {
      await analyticsService.deleteWidget(widgetId);
      await expect(analyticsService.getWidget(widgetId)).rejects.toThrow('Widget not found');
    });
  });

  describe('deleteDashboard()', () => {
    it('should delete a dashboard', async () => {
      await analyticsService.deleteDashboard(dashboardId);
      await expect(analyticsService.getDashboard(dashboardId)).rejects.toThrow('Dashboard not found');
    });
  });
});
