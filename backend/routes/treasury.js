const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const treasuryService = require('../services/treasuryService');

const router = express.Router();
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
};

// Create treasury
router.post('/',
  body('name').isString().notEmpty(),
  body('required_signatures').isInt({ min: 1 }),
  body('signers').isArray({ min: 1 }),
  body('signers.*.user_id').notEmpty(),
  body('created_by').notEmpty(),
  body('initial_balance').optional().isFloat({ min: 0 }),
  body('currency').optional().isIn(['USD', 'EUR', 'XLM', 'USDC']),
  validate,
  async (req, res, next) => {
    try {
      const treasury = await treasuryService.createTreasury(req.body);
      res.status(201).json(treasury);
    } catch (err) {
      if (err.message.includes('required_signatures')) return res.status(400).json({ error: err.message });
      next(err);
    }
  }
);

// Get treasury
router.get('/:treasuryId',
  param('treasuryId').isUUID(),
  validate,
  async (req, res, next) => {
    try {
      const treasury = await treasuryService.getTreasury(req.params.treasuryId);
      res.json(treasury);
    } catch (err) {
      if (err.message.includes('not found')) return res.status(404).json({ error: err.message });
      next(err);
    }
  }
);

// Propose transaction
router.post('/:treasuryId/transactions',
  param('treasuryId').isUUID(),
  body('proposer_id').notEmpty(),
  body('tx_type').isIn(['transfer', 'withdrawal', 'investment', 'emergency_withdrawal', 'reinsurance_payment']),
  body('amount').isFloat({ min: 0.01 }),
  body('description').optional().isString(),
  body('recipient').optional().isString(),
  validate,
  async (req, res, next) => {
    try {
      const result = await treasuryService.proposeTransaction(
        req.params.treasuryId, req.body.proposer_id, req.body
      );
      req.io?.emit('treasury-tx-proposed', result);
      res.status(201).json(result);
    } catch (err) {
      if (err.message.includes('not found') || err.message.includes('Only')) return res.status(403).json({ error: err.message });
      next(err);
    }
  }
);

// Get transactions
router.get('/:treasuryId/transactions',
  param('treasuryId').isUUID(),
  query('status').optional().isIn(['pending', 'approved', 'executed', 'rejected']),
  query('tx_type').optional().isString(),
  validate,
  async (req, res, next) => {
    try {
      const txs = await treasuryService.getTransactions(req.params.treasuryId, req.query);
      res.json(txs);
    } catch (err) { next(err); }
  }
);

// Sign transaction
router.post('/transactions/:txId/sign',
  param('txId').isUUID(),
  body('signer_id').notEmpty(),
  validate,
  async (req, res, next) => {
    try {
      const result = await treasuryService.signTransaction(req.params.txId, req.body.signer_id);
      req.io?.emit('treasury-tx-signed', result);
      res.json(result);
    } catch (err) {
      if (err.message.includes('not found')) return res.status(404).json({ error: err.message });
      if (err.message.includes('authorized') || err.message.includes('Already')) return res.status(403).json({ error: err.message });
      next(err);
    }
  }
);

// Emergency freeze
router.post('/:treasuryId/freeze',
  param('treasuryId').isUUID(),
  body('requester_id').notEmpty(),
  body('reason').isString().notEmpty(),
  validate,
  async (req, res, next) => {
    try {
      const result = await treasuryService.emergencyFreeze(
        req.params.treasuryId, req.body.requester_id, req.body.reason
      );
      req.io?.emit('treasury-frozen', result);
      res.json(result);
    } catch (err) { next(err); }
  }
);

// Audit log
router.get('/:treasuryId/audit',
  param('treasuryId').isUUID(),
  query('limit').optional().isInt({ min: 1, max: 500 }),
  validate,
  async (req, res, next) => {
    try {
      const log = await treasuryService.getAuditLog(req.params.treasuryId, req.query.limit);
      res.json(log);
    } catch (err) { next(err); }
  }
);

// Treasury report
router.get('/:treasuryId/report',
  param('treasuryId').isUUID(),
  validate,
  async (req, res, next) => {
    try {
      const report = await treasuryService.getReport(req.params.treasuryId);
      res.json(report);
    } catch (err) { next(err); }
  }
);

module.exports = router;
