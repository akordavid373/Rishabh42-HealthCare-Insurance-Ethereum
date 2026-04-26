const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const analyticsService = require('../services/advancedAnalyticsService');

const router = express.Router();

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
};

// ── Dashboard CRUD ───────────────────────────────────────────────────────────

// Create dashboard
router.post('/dashboards',
  body('name').isString().notEmpty(),
  body('description').optional().isString(),
  body('layout').optional().isArray(),
  body('is_public').optional().isBoolean(),
  validate,
  async (req, res, next) => {
    try {
      const result = await analyticsService.createDashboard({
        ...req.body,
        created_by: req.user?.id || req.body.created_by || 'system',
      });
      res.status(201).json(result);
    } catch (err) { next(err); }
  }
);

// List dashboards
router.get('/dashboards',
  query('is_public').optional().isBoolean(),
  validate,
  async (req, res, next) => {
    try {
      const filters = { ...req.query };
      const dashboards = await analyticsService.listDashboards(filters);
      res.json(dashboards);
    } catch (err) { next(err); }
  }
);

// Get dashboard with widgets
router.get('/dashboards/:dashboardId',
  param('dashboardId').isUUID(),
  validate,
  async (req, res, next) => {
    try {
      const dashboard = await analyticsService.getDashboard(req.params.dashboardId);
      res.json(dashboard);
    } catch (err) {
      if (err.message === 'Dashboard not found') return res.status(404).json({ error: err.message });
      next(err);
    }
  }
);

// Update dashboard
router.put('/dashboards/:dashboardId',
  param('dashboardId').isUUID(),
  body('name').optional().isString().notEmpty(),
  body('description').optional().isString(),
  body('layout').optional().isArray(),
  body('is_public').optional().isBoolean(),
  validate,
  async (req, res, next) => {
    try {
      const result = await analyticsService.updateDashboard(req.params.dashboardId, req.body);
      res.json(result);
    } catch (err) {
      if (err.message === 'Dashboard not found') return res.status(404).json({ error: err.message });
      next(err);
    }
  }
);

// Delete dashboard
router.delete('/dashboards/:dashboardId',
  param('dashboardId').isUUID(),
  validate,
  async (req, res, next) => {
    try {
      await analyticsService.deleteDashboard(req.params.dashboardId);
      res.json({ message: 'Dashboard deleted' });
    } catch (err) {
      if (err.message === 'Dashboard not found') return res.status(404).json({ error: err.message });
      next(err);
    }
  }
);

// ── Widget CRUD ──────────────────────────────────────────────────────────────

// Add widget to dashboard
router.post('/widgets',
  body('dashboard_id').isUUID(),
  body('name').isString().notEmpty(),
  body('widget_type').isIn(['kpi', 'chart', 'table', 'metric', 'prediction']),
  body('data_source').isString().notEmpty(),
  body('query_config').optional().isObject(),
  body('visualization_config').optional().isObject(),
  body('position_x').optional().isInt({ min: 0 }),
  body('position_y').optional().isInt({ min: 0 }),
  body('width').optional().isInt({ min: 1 }),
  body('height').optional().isInt({ min: 1 }),
  body('refresh_interval_sec').optional().isInt({ min: 10 }),
  validate,
  async (req, res, next) => {
    try {
      const result = await analyticsService.addWidget(req.body);
      res.status(201).json(result);
    } catch (err) { next(err); }
  }
);

// Get widget
router.get('/widgets/:widgetId',
  param('widgetId').isUUID(),
  validate,
  async (req, res, next) => {
    try {
      const widget = await analyticsService.getWidget(req.params.widgetId);
      res.json(widget);
    } catch (err) {
      if (err.message === 'Widget not found') return res.status(404).json({ error: err.message });
      next(err);
    }
  }
);

// Update widget
router.put('/widgets/:widgetId',
  param('widgetId').isUUID(),
  body('name').optional().isString().notEmpty(),
  body('widget_type').optional().isIn(['kpi', 'chart', 'table', 'metric', 'prediction']),
  body('data_source').optional().isString(),
  body('query_config').optional().isObject(),
  body('visualization_config').optional().isObject(),
  body('position_x').optional().isInt({ min: 0 }),
  body('position_y').optional().isInt({ min: 0 }),
  body('width').optional().isInt({ min: 1 }),
  body('height').optional().isInt({ min: 1 }),
  validate,
  async (req, res, next) => {
    try {
      const result = await analyticsService.updateWidget(req.params.widgetId, req.body);
      res.json(result);
    } catch (err) {
      if (err.message === 'Widget not found') return res.status(404).json({ error: err.message });
      next(err);
    }
  }
);

// Delete widget
router.delete('/widgets/:widgetId',
  param('widgetId').isUUID(),
  validate,
  async (req, res, next) => {
    try {
      await analyticsService.deleteWidget(req.params.widgetId);
      res.json({ message: 'Widget deleted' });
    } catch (err) {
      if (err.message === 'Widget not found') return res.status(404).json({ error: err.message });
      next(err);
    }
  }
);

// ── Analytics Endpoints ──────────────────────────────────────────────────────

// Real-time metrics overview
router.get('/realtime',
  async (req, res, next) => {
    try {
      const metrics = await analyticsService.getRealtimeMetrics();
      res.json(metrics);
    } catch (err) { next(err); }
  }
);

// Claims analytics
router.get('/claims',
  query('period').optional().isString(),
  validate,
  async (req, res, next) => {
    try {
      const analytics = await analyticsService.getClaimsAnalytics({ period: req.query.period });
      res.json(analytics);
    } catch (err) { next(err); }
  }
);

// Payment analytics
router.get('/payments',
  query('period').optional().isString(),
  validate,
  async (req, res, next) => {
    try {
      const analytics = await analyticsService.getPaymentAnalytics({ period: req.query.period });
      res.json(analytics);
    } catch (err) { next(err); }
  }
);

// Predictive insights for a patient
router.get('/predictions/:patientId',
  param('patientId').notEmpty(),
  validate,
  async (req, res, next) => {
    try {
      const insights = await analyticsService.getPredictiveInsights(req.params.patientId);
      res.json(insights);
    } catch (err) { next(err); }
  }
);

// ── Snapshots ────────────────────────────────────────────────────────────────

// Record a snapshot
router.post('/snapshots',
  body('snapshot_type').isIn(['realtime', 'scheduled', 'prediction']),
  body('metric_name').isString().notEmpty(),
  body('metric_value').isFloat(),
  body('dashboard_id').optional().isUUID(),
  body('widget_id').optional().isUUID(),
  body('dimensions').optional().isObject(),
  body('period_start').optional().isISO8601(),
  body('period_end').optional().isISO8601(),
  validate,
  async (req, res, next) => {
    try {
      const result = await analyticsService.recordSnapshot(req.body);
      res.status(201).json(result);
    } catch (err) { next(err); }
  }
);

// List snapshots
router.get('/snapshots',
  query('dashboard_id').optional().isUUID(),
  query('widget_id').optional().isUUID(),
  query('metric_name').optional().isString(),
  query('snapshot_type').optional().isIn(['realtime', 'scheduled', 'prediction']),
  query('limit').optional().isInt({ min: 1, max: 1000 }),
  validate,
  async (req, res, next) => {
    try {
      const snapshots = await analyticsService.getSnapshots(req.query);
      res.json(snapshots);
    } catch (err) { next(err); }
  }
);

module.exports = router;
