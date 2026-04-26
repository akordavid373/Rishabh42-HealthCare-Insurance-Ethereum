const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const fraudContractService = require('../services/fraudContractService');

const router = express.Router();
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
};

// Analyze a claim via fraud contract patterns
router.post('/analyze/:claimId',
  param('claimId').isInt({ min: 1 }),
  validate,
  async (req, res, next) => {
    try {
      const result = await fraudContractService.analyzeContract(req.params.claimId);
      if (result.risk_level === 'critical' || result.risk_level === 'high') {
        req.io?.emit('fraud-alert', { claim_id: req.params.claimId, risk_level: result.risk_level });
      }
      res.json(result);
    } catch (err) {
      if (err.message.includes('not found')) return res.status(404).json({ error: err.message });
      next(err);
    }
  }
);

// Real-time fraud monitor (last 24h)
router.get('/monitor',
  query('risk_level').optional().isIn(['low', 'medium', 'high', 'critical']),
  validate,
  async (req, res, next) => {
    try {
      const results = await fraudContractService.getRealTimeMonitor(req.query);
      res.json(results);
    } catch (err) { next(err); }
  }
);

// Get investigations
router.get('/investigations',
  query('status').optional().isIn(['open', 'in_progress', 'resolved', 'closed']),
  query('priority').optional().isIn(['low', 'medium', 'high', 'urgent']),
  query('limit').optional().isInt({ min: 1, max: 200 }),
  query('offset').optional().isInt({ min: 0 }),
  validate,
  async (req, res, next) => {
    try {
      const investigations = await fraudContractService.getInvestigations(req.query);
      res.json(investigations);
    } catch (err) { next(err); }
  }
);

// Update investigation
router.patch('/investigations/:investigationId',
  param('investigationId').isUUID(),
  body('status').isIn(['open', 'in_progress', 'resolved', 'closed']),
  body('resolution').optional().isString().isLength({ max: 2000 }),
  validate,
  async (req, res, next) => {
    try {
      const result = await fraudContractService.updateInvestigation(req.params.investigationId, req.body);
      res.json(result);
    } catch (err) { next(err); }
  }
);

// Fraud report
router.get('/report',
  query('days').optional().isInt({ min: 1, max: 365 }),
  validate,
  async (req, res, next) => {
    try {
      const report = await fraudContractService.getFraudReport(req.query.days);
      res.json(report);
    } catch (err) { next(err); }
  }
);

module.exports = router;
