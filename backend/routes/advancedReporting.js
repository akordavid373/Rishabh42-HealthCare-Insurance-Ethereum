const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const reportingService = require('../services/advancedReportingService');

const router = express.Router();

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
};

// ── Report Definitions ───────────────────────────────────────────────────────

// Create a report definition
router.post('/reports',
  body('name').isString().notEmpty(),
  body('report_type').isIn(['claims', 'payments', 'patients', 'health_metrics', 'premium', 'custom']),
  body('description').optional().isString(),
  body('data_sources').optional().isArray(),
  body('columns').optional().isArray(),
  body('filters').optional().isObject(),
  body('grouping').optional().isArray(),
  body('sorting').optional().isArray(),
  body('visualization').optional().isObject(),
  body('is_public').optional().isBoolean(),
  validate,
  async (req, res, next) => {
    try {
      const result = await reportingService.createReport({
        ...req.body,
        created_by: req.user?.id || req.body.created_by || 'system',
      });
      res.status(201).json(result);
    } catch (err) { next(err); }
  }
);

// List report definitions
router.get('/reports',
  query('report_type').optional().isIn(['claims', 'payments', 'patients', 'health_metrics', 'premium', 'custom']),
  query('is_public').optional().isBoolean(),
  query('limit').optional().isInt({ min: 1, max: 200 }),
  query('offset').optional().isInt({ min: 0 }),
  validate,
  async (req, res, next) => {
    try {
      const filters = { ...req.query };
      if (!filters.created_by) filters.created_by = undefined; // allow all
      const reports = await reportingService.listReports(filters);
      res.json(reports);
    } catch (err) { next(err); }
  }
);

// Get a single report definition
router.get('/reports/:reportId',
  param('reportId').isUUID(),
  validate,
  async (req, res, next) => {
    try {
      const report = await reportingService.getReport(req.params.reportId);
      res.json(report);
    } catch (err) {
      if (err.message === 'Report not found') return res.status(404).json({ error: err.message });
      next(err);
    }
  }
);

// Update a report definition
router.put('/reports/:reportId',
  param('reportId').isUUID(),
  body('name').optional().isString().notEmpty(),
  body('report_type').optional().isIn(['claims', 'payments', 'patients', 'health_metrics', 'premium', 'custom']),
  body('columns').optional().isArray(),
  body('filters').optional().isObject(),
  body('grouping').optional().isArray(),
  body('sorting').optional().isArray(),
  body('visualization').optional().isObject(),
  body('is_public').optional().isBoolean(),
  validate,
  async (req, res, next) => {
    try {
      const result = await reportingService.updateReport(req.params.reportId, req.body);
      res.json(result);
    } catch (err) {
      if (err.message === 'Report not found') return res.status(404).json({ error: err.message });
      next(err);
    }
  }
);

// Delete a report definition
router.delete('/reports/:reportId',
  param('reportId').isUUID(),
  validate,
  async (req, res, next) => {
    try {
      await reportingService.deleteReport(req.params.reportId);
      res.json({ message: 'Report deleted' });
    } catch (err) {
      if (err.message === 'Report not found') return res.status(404).json({ error: err.message });
      next(err);
    }
  }
);

// ── Report Execution ─────────────────────────────────────────────────────────

// Execute a report
router.post('/reports/:reportId/execute',
  param('reportId').isUUID(),
  body('output_format').optional().isIn(['json', 'csv']),
  validate,
  async (req, res, next) => {
    try {
      const result = await reportingService.executeReport(
        req.params.reportId,
        req.user?.id || 'system',
        req.body.output_format || 'json'
      );
      res.json(result);
    } catch (err) {
      if (err.message === 'Report not found') return res.status(404).json({ error: err.message });
      next(err);
    }
  }
);

// Get execution result
router.get('/executions/:executionId',
  param('executionId').isUUID(),
  validate,
  async (req, res, next) => {
    try {
      const execution = await reportingService.getExecution(req.params.executionId);
      res.json(execution);
    } catch (err) {
      if (err.message === 'Execution not found') return res.status(404).json({ error: err.message });
      next(err);
    }
  }
);

// List executions for a report
router.get('/reports/:reportId/executions',
  param('reportId').isUUID(),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('offset').optional().isInt({ min: 0 }),
  validate,
  async (req, res, next) => {
    try {
      const executions = await reportingService.listExecutions(req.params.reportId, req.query);
      res.json(executions);
    } catch (err) { next(err); }
  }
);

// ── Scheduling ───────────────────────────────────────────────────────────────

// Create a schedule
router.post('/schedules',
  body('report_id').isUUID(),
  body('cron_expression').isString().notEmpty(),
  body('timezone').optional().isString(),
  body('output_format').optional().isIn(['json', 'csv', 'pdf']),
  body('distribution').optional().isArray(),
  validate,
  async (req, res, next) => {
    try {
      const result = await reportingService.createSchedule({
        ...req.body,
        created_by: req.user?.id || 'system',
      });
      res.status(201).json(result);
    } catch (err) {
      if (err.message === 'Report not found') return res.status(404).json({ error: err.message });
      next(err);
    }
  }
);

// List schedules
router.get('/schedules',
  query('report_id').optional().isUUID(),
  query('is_active').optional().isBoolean(),
  validate,
  async (req, res, next) => {
    try {
      const schedules = await reportingService.listSchedules(req.query);
      res.json(schedules);
    } catch (err) { next(err); }
  }
);

// Get a schedule
router.get('/schedules/:scheduleId',
  param('scheduleId').isUUID(),
  validate,
  async (req, res, next) => {
    try {
      const schedule = await reportingService.getSchedule(req.params.scheduleId);
      res.json(schedule);
    } catch (err) {
      if (err.message === 'Schedule not found') return res.status(404).json({ error: err.message });
      next(err);
    }
  }
);

// Update a schedule
router.put('/schedules/:scheduleId',
  param('scheduleId').isUUID(),
  body('cron_expression').optional().isString(),
  body('timezone').optional().isString(),
  body('output_format').optional().isIn(['json', 'csv', 'pdf']),
  body('distribution').optional().isArray(),
  body('is_active').optional().isBoolean(),
  validate,
  async (req, res, next) => {
    try {
      const result = await reportingService.updateSchedule(req.params.scheduleId, req.body);
      res.json(result);
    } catch (err) {
      if (err.message === 'Schedule not found') return res.status(404).json({ error: err.message });
      next(err);
    }
  }
);

// Delete a schedule
router.delete('/schedules/:scheduleId',
  param('scheduleId').isUUID(),
  validate,
  async (req, res, next) => {
    try {
      await reportingService.deleteSchedule(req.params.scheduleId);
      res.json({ message: 'Schedule deleted' });
    } catch (err) {
      if (err.message === 'Schedule not found') return res.status(404).json({ error: err.message });
      next(err);
    }
  }
);

module.exports = router;
