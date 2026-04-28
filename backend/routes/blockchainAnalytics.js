const express = require('express');
const { body, query, param, validationResult } = require('express-validator');
const blockchainAnalyticsService = require('../services/blockchainAnalyticsService');

const router = express.Router();

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  return next();
};

const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

const networkValidator = body('network').isString().trim().notEmpty().withMessage('network is required');
const txHashValidator = body('tx_hash').isString().trim().notEmpty().withMessage('tx_hash is required');
const statusValues = ['pending', 'confirmed', 'failed', 'reverted', 'dropped'];
const riskLevels = ['low', 'medium', 'high', 'critical'];
const dataSources = ['transactions_over_time', 'risk_distribution', 'network_activity', 'contract_scores', 'compliance_status', 'dashboard_summary'];

blockchainAnalyticsService.initializeTables().catch((err) => {
  console.error('Failed to initialize blockchain analytics tables:', err.message);
});

const transactionValidators = [
  networkValidator,
  txHashValidator,
  body('from_address').optional().isString().trim(),
  body('to_address').optional().isString().trim(),
  body('contract_address').optional().isString().trim(),
  body('asset_code').optional().isString().trim(),
  body('amount').optional().isNumeric().withMessage('amount must be numeric'),
  body('fee').optional().isNumeric().withMessage('fee must be numeric'),
  body('status').optional().isIn(statusValues).withMessage(`status must be one of ${statusValues.join(', ')}`),
  body('tx_type').optional().isString().trim(),
  body('block_number').optional().isInt(),
  body('ledger_sequence').optional().isInt(),
  body('confirmation_time_ms').optional().isInt({ min: 0 }),
  body('metadata').optional().isObject()
];

const periodQueryValidators = [
  query('from').optional().isISO8601().withMessage('from must be ISO8601'),
  query('to').optional().isISO8601().withMessage('to must be ISO8601'),
  query('period_start').optional().isISO8601().withMessage('period_start must be ISO8601'),
  query('period_end').optional().isISO8601().withMessage('period_end must be ISO8601'),
  query('limit').optional().isInt({ min: 1, max: 500 }).toInt()
];

router.post('/transactions/monitor', transactionValidators, validate, asyncHandler(async (req, res) => {
  const result = await blockchainAnalyticsService.monitorTransaction(req.body);
  res.status(201).json({ success: true, data: result });
}));

router.post('/transactions', transactionValidators, validate, asyncHandler(async (req, res) => {
  const transaction = await blockchainAnalyticsService.recordTransaction(req.body);
  res.status(201).json({ success: true, data: transaction });
}));

router.get('/transactions', [
  query('network').optional().isString().trim(),
  query('address').optional().isString().trim(),
  query('contract_address').optional().isString().trim(),
  query('status').optional().isIn(statusValues),
  query('risk_level').optional().isIn(riskLevels),
  query('tx_type').optional().isString().trim(),
  ...periodQueryValidators
], validate, asyncHandler(async (req, res) => {
  const transactions = await blockchainAnalyticsService.getTransactions(req.query);
  res.json({ success: true, data: transactions });
}));

router.get('/transactions/:network/:txHash', [
  param('network').isString().trim().notEmpty(),
  param('txHash').isString().trim().notEmpty()
], validate, asyncHandler(async (req, res) => {
  const transaction = await blockchainAnalyticsService.getTransaction(req.params.txHash, req.params.network);
  if (!transaction) return res.status(404).json({ success: false, message: 'Transaction not found' });
  return res.json({ success: true, data: transaction });
}));

router.post('/contracts/analyze', [
  body('network').isString().trim().notEmpty().withMessage('network is required'),
  body('contract_address').isString().trim().notEmpty().withMessage('contract_address is required'),
  body('contract_name').optional().isString().trim(),
  body('source_code').optional().isString(),
  body('abi').optional(),
  body('metadata').optional().isObject()
], validate, asyncHandler(async (req, res) => {
  const analysis = await blockchainAnalyticsService.analyzeSmartContract(req.body);
  res.status(201).json({ success: true, data: analysis });
}));

router.get('/contracts/analyses', [
  query('network').optional().isString().trim(),
  query('contract_address').optional().isString().trim(),
  query('risk_level').optional().isIn(riskLevels),
  query('limit').optional().isInt({ min: 1, max: 500 }).toInt()
], validate, asyncHandler(async (req, res) => {
  const analyses = await blockchainAnalyticsService.getContractAnalyses(req.query);
  res.json({ success: true, data: analyses });
}));

router.get('/contracts/analyses/:analysisId', [
  param('analysisId').isString().trim().notEmpty()
], validate, asyncHandler(async (req, res) => {
  const analysis = await blockchainAnalyticsService.getContractAnalysis(req.params.analysisId);
  if (!analysis) return res.status(404).json({ success: false, message: 'Contract analysis not found' });
  return res.json({ success: true, data: analysis });
}));

router.post('/compliance/reports', [
  body('report_type').optional().isString().trim(),
  body('framework').optional().isString().trim(),
  body('period_start').optional().isISO8601().withMessage('period_start must be ISO8601'),
  body('period_end').optional().isISO8601().withMessage('period_end must be ISO8601'),
  body('from').optional().isISO8601().withMessage('from must be ISO8601'),
  body('to').optional().isISO8601().withMessage('to must be ISO8601'),
  body('generated_by').optional().isString().trim()
], validate, asyncHandler(async (req, res) => {
  const report = await blockchainAnalyticsService.generateComplianceReport(req.body);
  res.status(201).json({ success: true, data: report });
}));

router.get('/compliance/reports', [
  query('report_type').optional().isString().trim(),
  query('framework').optional().isString().trim(),
  ...periodQueryValidators
], validate, asyncHandler(async (req, res) => {
  const reports = await blockchainAnalyticsService.getComplianceReports(req.query);
  res.json({ success: true, data: reports });
}));

router.get('/compliance/reports/:reportId', [
  param('reportId').isString().trim().notEmpty()
], validate, asyncHandler(async (req, res) => {
  const report = await blockchainAnalyticsService.getComplianceReport(req.params.reportId);
  if (!report) return res.status(404).json({ success: false, message: 'Compliance report not found' });
  return res.json({ success: true, data: report });
}));

router.get('/metrics/performance', periodQueryValidators, validate, asyncHandler(async (req, res) => {
  const metrics = await blockchainAnalyticsService.getPerformanceMetrics(req.query);
  res.json({ success: true, data: metrics });
}));

router.get('/security/monitoring', periodQueryValidators, validate, asyncHandler(async (req, res) => {
  const monitoring = await blockchainAnalyticsService.getSecurityMonitoring(req.query);
  res.json({ success: true, data: monitoring });
}));

router.get('/security/alerts', [
  query('status').optional().isString().trim(),
  query('severity').optional().isIn(riskLevels),
  query('limit').optional().isInt({ min: 1, max: 500 }).toInt()
], validate, asyncHandler(async (req, res) => {
  const monitoring = await blockchainAnalyticsService.getSecurityMonitoring({ limit: req.query.limit || 100 });
  let alerts = monitoring.active_alerts;
  if (req.query.severity) alerts = alerts.filter((alert) => alert.severity === req.query.severity);
  res.json({ success: true, data: alerts });
}));

router.get('/visualization/dashboard/summary', periodQueryValidators, validate, asyncHandler(async (req, res) => {
  const summary = await blockchainAnalyticsService.getDashboardSummary(req.query);
  res.json({ success: true, data: summary });
}));

router.get('/visualization/:dataSource', [
  param('dataSource').isString().trim().notEmpty(),
  ...periodQueryValidators
], validate, asyncHandler(async (req, res) => {
  if (!dataSources.includes(req.params.dataSource)) {
    return res.status(400).json({ success: false, message: 'Invalid data source' });
  }
  const data = await blockchainAnalyticsService.getVisualizationData({ ...req.query, dataSource: req.params.dataSource });
  return res.json({ success: true, data });
}));

router.post('/documentation/generate', [
  body('format').optional().isIn(['json', 'markdown', 'openapi']).withMessage('format must be json, markdown, or openapi'),
  body('doc_type').optional().isString().trim(),
  body('generated_by').optional().isString().trim()
], validate, asyncHandler(async (req, res) => {
  const documentation = await blockchainAnalyticsService.generateDocumentation(req.body);
  res.status(201).json({ success: true, data: documentation });
}));

router.get('/documentation/latest', [
  query('format').optional().isIn(['json', 'markdown', 'openapi'])
], validate, asyncHandler(async (req, res) => {
  const documentation = await blockchainAnalyticsService.getLatestDocumentation(req.query.format);
  if (!documentation) return res.status(404).json({ success: false, message: 'Documentation not found' });
  return res.json({ success: true, data: documentation });
}));

module.exports = router;
