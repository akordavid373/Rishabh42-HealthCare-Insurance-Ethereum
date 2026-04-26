const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const vizService = require('../services/dataVisualizationService');

const router = express.Router();
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
};

// Create dashboard
router.post('/dashboards',
  body('name').isString().notEmpty(),
  body('owner_id').notEmpty(),
  body('is_public').optional().isBoolean(),
  body('layout').optional().isArray(),
  validate,
  async (req, res, next) => {
    try {
      const dashboard = await vizService.createDashboard(req.body);
      res.status(201).json(dashboard);
    } catch (err) { next(err); }
  }
);

// List dashboards
router.get('/dashboards',
  query('owner_id').notEmpty(),
  validate,
  async (req, res, next) => {
    try {
      const dashboards = await vizService.listDashboards(req.query.owner_id);
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
      const dashboard = await vizService.getDashboard(req.params.dashboardId);
      res.json(dashboard);
    } catch (err) {
      if (err.message.includes('not found')) return res.status(404).json({ error: err.message });
      next(err);
    }
  }
);

// Update dashboard layout
router.patch('/dashboards/:dashboardId/layout',
  param('dashboardId').isUUID(),
  body('layout').isArray(),
  validate,
  async (req, res, next) => {
    try {
      const result = await vizService.updateDashboardLayout(req.params.dashboardId, req.body.layout);
      req.io?.to(`dashboard-${req.params.dashboardId}`).emit('layout-updated', result);
      res.json(result);
    } catch (err) { next(err); }
  }
);

// Add widget to dashboard
router.post('/dashboards/:dashboardId/widgets',
  param('dashboardId').isUUID(),
  body('title').isString().notEmpty(),
  body('chart_type').isIn(['line', 'bar', 'pie', 'donut', 'area', 'scatter', 'heatmap', 'histogram', 'treemap', 'gauge', '3d_scatter', '3d_surface', '3d_bar']),
  body('data_source').isIn(['claims', 'patients', 'payments', 'appointments', 'medical_records', 'fraud_scores', 'premium_adjustments']),
  body('config').optional().isObject(),
  body('refresh_interval').optional().isInt({ min: 0 }),
  validate,
  async (req, res, next) => {
    try {
      const widget = await vizService.addWidget(req.params.dashboardId, req.body);
      res.status(201).json(widget);
    } catch (err) {
      if (err.message.includes('Invalid')) return res.status(400).json({ error: err.message });
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
      const result = await vizService.deleteWidget(req.params.widgetId);
      res.json(result);
    } catch (err) { next(err); }
  }
);

// Get chart data for a data source
router.get('/data/:dataSource',
  param('dataSource').isIn(['claims', 'patients', 'payments', 'appointments', 'medical_records', 'fraud_scores', 'premium_adjustments']),
  validate,
  async (req, res, next) => {
    try {
      const data = await vizService.getChartData(req.params.dataSource, req.query);
      res.json(data);
    } catch (err) {
      if (err.message.includes('No chart data')) return res.status(400).json({ error: err.message });
      next(err);
    }
  }
);

// Real-time snapshot for live dashboards
router.get('/snapshot',
  async (req, res, next) => {
    try {
      const snapshot = await vizService.getRealtimeSnapshot();
      req.io?.emit('dashboard-snapshot', snapshot);
      res.json(snapshot);
    } catch (err) { next(err); }
  }
);

module.exports = router;
