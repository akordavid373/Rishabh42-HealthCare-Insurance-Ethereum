const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const mlops = require('../services/mlopsService');

const router = express.Router();

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
};

const MODEL_TYPES = ['risk_scoring', 'diagnosis_assist', 'fraud_detection', 'premium_prediction', 'custom'];

// ── Pipelines ────────────────────────────────────────────────────────────────

router.post('/pipelines',
  body('name').isString().notEmpty(),
  body('model_type').isIn(MODEL_TYPES),
  body('config').optional().isObject(),
  validate,
  async (req, res, next) => {
    try {
      const pipeline = await mlops.createPipeline({ ...req.body, created_by: req.user?.id });
      res.status(201).json(pipeline);
    } catch (err) { next(err); }
  }
);

router.get('/pipelines', async (req, res, next) => {
  try {
    res.json(await mlops.listPipelines());
  } catch (err) { next(err); }
});

router.post('/pipelines/:pipelineId/train',
  param('pipelineId').isUUID(),
  validate,
  async (req, res, next) => {
    try {
      const result = await mlops.triggerTraining(req.params.pipelineId, req.user?.id);
      res.status(202).json(result);
    } catch (err) {
      if (err.message.includes('not found')) return res.status(404).json({ error: err.message });
      next(err);
    }
  }
);

router.get('/pipelines/:pipelineId/runs',
  param('pipelineId').isUUID(),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  validate,
  async (req, res, next) => {
    try {
      res.json(await mlops.listRuns(req.params.pipelineId, req.query.limit));
    } catch (err) { next(err); }
  }
);

router.get('/runs/:runId',
  param('runId').isUUID(),
  validate,
  async (req, res, next) => {
    try {
      res.json(await mlops.getRun(req.params.runId));
    } catch (err) {
      if (err.message.includes('not found')) return res.status(404).json({ error: err.message });
      next(err);
    }
  }
);

// ── Deployments ──────────────────────────────────────────────────────────────

router.post('/deployments',
  body('model_id').isUUID(),
  body('environment').isIn(['staging', 'production', 'canary']),
  validate,
  async (req, res, next) => {
    try {
      const result = await mlops.deployModel(req.body.model_id, req.body.environment, req.user?.id);
      res.status(201).json(result);
    } catch (err) {
      if (err.message.includes('not found')) return res.status(404).json({ error: err.message });
      next(err);
    }
  }
);

router.get('/deployments',
  query('environment').optional().isIn(['staging', 'production', 'canary']),
  validate,
  async (req, res, next) => {
    try {
      res.json(await mlops.listDeployments(req.query.environment));
    } catch (err) { next(err); }
  }
);

router.post('/deployments/:deploymentId/rollback',
  param('deploymentId').isUUID(),
  validate,
  async (req, res, next) => {
    try {
      res.json(await mlops.rollback(req.params.deploymentId));
    } catch (err) {
      if (err.message.includes('not found')) return res.status(404).json({ error: err.message });
      next(err);
    }
  }
);

// ── Monitoring ───────────────────────────────────────────────────────────────

router.post('/feedback',
  body('model_id').isUUID(),
  body('prediction_id').isUUID(),
  body('actual').exists(),
  body('predicted').exists(),
  body('latency_ms').optional().isInt({ min: 0 }),
  validate,
  async (req, res, next) => {
    try {
      const { model_id, prediction_id, actual, predicted, latency_ms } = req.body;
      await mlops.recordFeedback(model_id, prediction_id, actual, predicted, latency_ms || 0);
      res.json({ status: 'recorded' });
    } catch (err) { next(err); }
  }
);

router.get('/models/:modelId/health',
  param('modelId').isUUID(),
  query('hours').optional().isInt({ min: 1, max: 720 }),
  validate,
  async (req, res, next) => {
    try {
      res.json(await mlops.getModelHealth(req.params.modelId, req.query.hours || 24));
    } catch (err) { next(err); }
  }
);

// ── Retraining ───────────────────────────────────────────────────────────────

router.post('/pipelines/:pipelineId/retrain',
  param('pipelineId').isUUID(),
  body('trigger_type').isIn(['manual', 'drift', 'scheduled', 'performance_degradation']),
  body('reason').optional().isString(),
  validate,
  async (req, res, next) => {
    try {
      const result = await mlops.scheduleRetraining(
        req.params.pipelineId,
        req.body.trigger_type,
        req.user?.id,
        req.body.reason || null
      );
      res.status(202).json(result);
    } catch (err) {
      if (err.message.includes('not found')) return res.status(404).json({ error: err.message });
      next(err);
    }
  }
);

router.get('/pipelines/:pipelineId/retraining-history',
  param('pipelineId').isUUID(),
  validate,
  async (req, res, next) => {
    try {
      res.json(await mlops.listRetrainingHistory(req.params.pipelineId));
    } catch (err) { next(err); }
  }
);

// ── A/B Testing ──────────────────────────────────────────────────────────────

router.post('/experiments',
  body('name').isString().notEmpty(),
  body('variants').isArray({ min: 2 }),
  body('variants.*.name').isString(),
  body('variants.*.model_id').isUUID(),
  body('variants.*.weight').isFloat({ min: 0, max: 100 }),
  validate,
  async (req, res, next) => {
    try {
      res.status(201).json(await mlops.createExperiment(req.body));
    } catch (err) { next(err); }
  }
);

router.get('/experiments/:experimentId/results',
  param('experimentId').isUUID(),
  validate,
  async (req, res, next) => {
    try {
      res.json(await mlops.getExperimentResults(req.params.experimentId));
    } catch (err) {
      if (err.message.includes('not found')) return res.status(404).json({ error: err.message });
      next(err);
    }
  }
);

router.patch('/experiments/:experimentId/status',
  param('experimentId').isUUID(),
  body('status').isIn(['active', 'paused', 'completed']),
  validate,
  async (req, res, next) => {
    try {
      res.json(await mlops.updateExperimentStatus(req.params.experimentId, req.body.status));
    } catch (err) { next(err); }
  }
);

// ── Explainability ───────────────────────────────────────────────────────────

router.get('/models/:modelId/explain',
  param('modelId').isUUID(),
  validate,
  async (req, res, next) => {
    try {
      res.json(await mlops.getExplainability(req.params.modelId));
    } catch (err) {
      if (err.message.includes('not found') || err.message.includes('No explainability'))
        return res.status(404).json({ error: err.message });
      next(err);
    }
  }
);

router.post('/models/:modelId/explain',
  param('modelId').isUUID(),
  body('input').isObject(),
  validate,
  async (req, res, next) => {
    try {
      res.json(await mlops.explainPrediction(req.params.modelId, req.body.input));
    } catch (err) {
      if (err.message.includes('not found')) return res.status(404).json({ error: err.message });
      next(err);
    }
  }
);

// ── Version Control ──────────────────────────────────────────────────────────

// NOTE: /models/compare must be registered before /models/:modelName/versions
// otherwise Express matches "compare" as the modelName param
router.get('/models/compare',
  query('model_a').isUUID(),
  query('model_b').isUUID(),
  validate,
  async (req, res, next) => {
    try {
      res.json(await mlops.compareVersions(req.query.model_a, req.query.model_b));
    } catch (err) {
      if (err.message.includes('not found')) return res.status(404).json({ error: err.message });
      next(err);
    }
  }
);

router.get('/models/:modelName/versions',
  param('modelName').isString().notEmpty(),
  validate,
  async (req, res, next) => {
    try {
      res.json(await mlops.getModelVersions(req.params.modelName));
    } catch (err) { next(err); }
  }
);

module.exports = router;
