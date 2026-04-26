const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const reinsuranceService = require('../services/reinsuranceService');

const router = express.Router();
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
};

// Create reinsurance pool
router.post('/pools',
  body('name').isString().notEmpty(),
  body('total_capacity').isFloat({ min: 1000 }),
  body('created_by').notEmpty(),
  body('pool_type').optional().isIn(['proportional', 'excess_of_loss', 'stop_loss', 'catastrophe']),
  body('min_contribution').optional().isFloat({ min: 0 }),
  validate,
  async (req, res, next) => {
    try {
      const pool = await reinsuranceService.createPool(req.body);
      res.status(201).json(pool);
    } catch (err) { next(err); }
  }
);

// Get pool stats
router.get('/pools/:poolId',
  param('poolId').isUUID(),
  validate,
  async (req, res, next) => {
    try {
      const stats = await reinsuranceService.getPoolStats(req.params.poolId);
      res.json(stats);
    } catch (err) {
      if (err.message.includes('not found')) return res.status(404).json({ error: err.message });
      next(err);
    }
  }
);

// Join pool
router.post('/pools/:poolId/join',
  param('poolId').isUUID(),
  body('insurer_id').notEmpty(),
  body('contribution').isFloat({ min: 0.01 }),
  validate,
  async (req, res, next) => {
    try {
      const result = await reinsuranceService.joinPool(
        req.params.poolId, req.body.insurer_id, req.body.contribution
      );
      res.status(201).json(result);
    } catch (err) {
      if (err.message.includes('Minimum') || err.message.includes('capacity')) return res.status(400).json({ error: err.message });
      next(err);
    }
  }
);

// Submit reinsurance claim
router.post('/pools/:poolId/claims',
  param('poolId').isUUID(),
  body('submitter_id').notEmpty(),
  body('amount').isFloat({ min: 0.01 }),
  body('original_claim_id').optional().isString(),
  validate,
  async (req, res, next) => {
    try {
      const claim = await reinsuranceService.submitClaim(req.params.poolId, req.body);
      res.status(201).json(claim);
    } catch (err) { next(err); }
  }
);

// Trigger automated settlement
router.post('/claims/:claimId/settle',
  param('claimId').isUUID(),
  validate,
  async (req, res, next) => {
    try {
      const result = await reinsuranceService.settleClaimAutomatically(req.params.claimId);
      req.io?.emit('reinsurance-settled', result);
      res.json(result);
    } catch (err) {
      if (err.message.includes('not found')) return res.status(404).json({ error: err.message });
      if (err.message.includes('already')) return res.status(400).json({ error: err.message });
      next(err);
    }
  }
);

// Create governance proposal
router.post('/pools/:poolId/proposals',
  param('poolId').isUUID(),
  body('proposer_id').notEmpty(),
  body('title').isString().notEmpty(),
  body('description').isString().notEmpty(),
  body('proposal_type').optional().isIn(['parameter_change', 'capacity_increase', 'member_removal', 'fee_change']),
  validate,
  async (req, res, next) => {
    try {
      const proposal = await reinsuranceService.createProposal(req.params.poolId, req.body.proposer_id, req.body);
      res.status(201).json(proposal);
    } catch (err) { next(err); }
  }
);

// Vote on proposal
router.post('/proposals/:proposalId/vote',
  param('proposalId').isUUID(),
  body('voter_id').notEmpty(),
  body('vote').isIn(['for', 'against']),
  validate,
  async (req, res, next) => {
    try {
      const result = await reinsuranceService.vote(req.params.proposalId, req.body.voter_id, req.body.vote);
      res.json(result);
    } catch (err) { next(err); }
  }
);

module.exports = router;
