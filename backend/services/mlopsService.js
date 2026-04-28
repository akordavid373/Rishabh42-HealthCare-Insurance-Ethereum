const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../database/healthcare.db');

class MLOpsService {
  getDb() {
    return new sqlite3.Database(DB_PATH);
  }

  run(db, sql, params = []) {
    return new Promise((resolve, reject) => {
      db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve(this);
      });
    });
  }

  get(db, sql, params = []) {
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  all(db, sql, params = []) {
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  // ── Training Pipeline ────────────────────────────────────────────────────────

  async createPipeline(data) {
    const db = this.getDb();
    const pipelineId = uuidv4();
    try {
      await this.run(db,
        `INSERT INTO mlops_pipelines
          (pipeline_id, name, model_type, config, status, created_by, created_at)
         VALUES (?, ?, ?, ?, 'idle', ?, CURRENT_TIMESTAMP)`,
        [pipelineId, data.name, data.model_type, JSON.stringify(data.config || {}), data.created_by]
      );
      return { pipeline_id: pipelineId, name: data.name, model_type: data.model_type, status: 'idle' };
    } finally { db.close(); }
  }

  async listPipelines() {
    const db = this.getDb();
    try {
      const rows = await this.all(db, 'SELECT * FROM mlops_pipelines ORDER BY created_at DESC');
      return rows.map(r => ({ ...r, config: JSON.parse(r.config || '{}') }));
    } finally { db.close(); }
  }

  async triggerTraining(pipelineId, triggeredBy) {
    const db = this.getDb();
    const runId = uuidv4();
    try {
      const pipeline = await this.get(db, 'SELECT * FROM mlops_pipelines WHERE pipeline_id = ?', [pipelineId]);
      if (!pipeline) throw new Error('Pipeline not found');

      await this.run(db,
        `INSERT INTO mlops_runs (run_id, pipeline_id, status, triggered_by, started_at)
         VALUES (?, ?, 'running', ?, CURRENT_TIMESTAMP)`,
        [runId, pipelineId, triggeredBy]
      );
      await this.run(db,
        'UPDATE mlops_pipelines SET status = ?, last_run_id = ?, updated_at = CURRENT_TIMESTAMP WHERE pipeline_id = ?',
        ['running', runId, pipelineId]
      );

      setImmediate(() => this._runTraining(runId, pipelineId, pipeline));
      return { run_id: runId, pipeline_id: pipelineId, status: 'running' };
    } finally { db.close(); }
  }

  async _runTraining(runId, pipelineId, pipeline) {
    const db = this.getDb();
    try {
      const config = JSON.parse(pipeline.config || '{}');
      await new Promise(r => setTimeout(r, config.training_delay_ms || 1500));

      const metrics = this._simulateMetrics();
      const modelId = uuidv4();

      await this.run(db,
        `INSERT INTO ml_models
          (model_id, name, version, model_type, description, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'staging', CURRENT_TIMESTAMP)`,
        [modelId, pipeline.name, `v${Date.now()}`, pipeline.model_type,
          `Trained by pipeline ${pipelineId}`]
      );

      await this.run(db,
        `INSERT INTO mlops_explainability
          (explain_id, model_id, run_id, method, feature_importance, created_at)
         VALUES (?, ?, ?, 'permutation_importance', ?, CURRENT_TIMESTAMP)`,
        [uuidv4(), modelId, runId, JSON.stringify(this._featureImportance(pipeline.model_type))]
      );

      await this.run(db,
        `UPDATE mlops_runs
         SET status = 'completed', model_id = ?, metrics = ?, finished_at = CURRENT_TIMESTAMP
         WHERE run_id = ?`,
        [modelId, JSON.stringify(metrics), runId]
      );
      await this.run(db,
        'UPDATE mlops_pipelines SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE pipeline_id = ?',
        ['idle', pipelineId]
      );

      const threshold = config.auto_deploy_accuracy || 0;
      if (threshold > 0 && metrics.accuracy >= threshold) {
        await this._autoDeploy(db, modelId, pipelineId, runId, pipeline.name);
      }
    } catch (err) {
      await this.run(db,
        `UPDATE mlops_runs SET status = 'failed', error = ?, finished_at = CURRENT_TIMESTAMP WHERE run_id = ?`,
        [err.message, runId]
      ).catch(() => {});
      await this.run(db,
        'UPDATE mlops_pipelines SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE pipeline_id = ?',
        ['idle', pipelineId]
      ).catch(() => {});
    } finally { db.close(); }
  }

  _simulateMetrics() {
    const p = 0.78 + Math.random() * 0.15;
    const r = 0.76 + Math.random() * 0.15;
    return {
      accuracy: parseFloat((0.80 + Math.random() * 0.15).toFixed(4)),
      precision: parseFloat(p.toFixed(4)),
      recall: parseFloat(r.toFixed(4)),
      f1_score: parseFloat((2 * p * r / (p + r)).toFixed(4)),
      training_samples: Math.floor(1000 + Math.random() * 9000),
    };
  }

  _featureImportance(modelType) {
    const sets = {
      risk_scoring: ['age', 'bmi', 'blood_pressure', 'cholesterol', 'smoking', 'diabetes', 'prior_claims'],
      fraud_detection: ['claim_amount', 'provider_history', 'diagnosis_freq', 'billing_pattern', 'time_since_claim'],
      premium_prediction: ['age_group', 'coverage_type', 'claim_history', 'health_score', 'region'],
      diagnosis_assist: ['symptoms', 'lab_values', 'vitals', 'medication_history', 'family_history'],
    };
    const features = sets[modelType] || ['feature_1', 'feature_2', 'feature_3'];
    const total = features.reduce((s, _, i) => s + (features.length - i), 0);
    return features.map((name, i) => ({
      feature: name,
      importance: parseFloat(((features.length - i) / total).toFixed(4)),
    }));
  }

  async _autoDeploy(db, modelId, pipelineId, runId, modelName) {
    await this.run(db,
      `UPDATE ml_models SET status = 'deprecated', updated_at = CURRENT_TIMESTAMP
       WHERE name = ? AND status = 'production' AND model_id != ?`,
      [modelName, modelId]
    );
    await this.run(db,
      `UPDATE ml_models SET status = 'production', updated_at = CURRENT_TIMESTAMP WHERE model_id = ?`,
      [modelId]
    );
    await this.run(db,
      `INSERT INTO mlops_deployments
        (deployment_id, model_id, pipeline_id, run_id, environment, status, deployed_at)
       VALUES (?, ?, ?, ?, 'production', 'active', CURRENT_TIMESTAMP)`,
      [uuidv4(), modelId, pipelineId, runId]
    );
  }

  async getRun(runId) {
    const db = this.getDb();
    try {
      const run = await this.get(db, 'SELECT * FROM mlops_runs WHERE run_id = ?', [runId]);
      if (!run) throw new Error('Run not found');
      return { ...run, metrics: JSON.parse(run.metrics || 'null') };
    } finally { db.close(); }
  }

  async listRuns(pipelineId, limit = 20) {
    const db = this.getDb();
    try {
      const rows = await this.all(db,
        'SELECT * FROM mlops_runs WHERE pipeline_id = ? ORDER BY started_at DESC LIMIT ?',
        [pipelineId, limit]
      );
      return rows.map(r => ({ ...r, metrics: JSON.parse(r.metrics || 'null') }));
    } finally { db.close(); }
  }

  // ── Deployment ───────────────────────────────────────────────────────────────

  async deployModel(modelId, environment, deployedBy) {
    const db = this.getDb();
    const deploymentId = uuidv4();
    try {
      const model = await this.get(db, 'SELECT * FROM ml_models WHERE model_id = ?', [modelId]);
      if (!model) throw new Error('Model not found');

      if (environment === 'production') {
        await this.run(db,
          `UPDATE ml_models SET status = 'deprecated', updated_at = CURRENT_TIMESTAMP
           WHERE name = ? AND status = 'production' AND model_id != ?`,
          [model.name, modelId]
        );
        await this.run(db,
          `UPDATE ml_models SET status = 'production', updated_at = CURRENT_TIMESTAMP WHERE model_id = ?`,
          [modelId]
        );
      }

      await this.run(db,
        `INSERT INTO mlops_deployments
          (deployment_id, model_id, pipeline_id, run_id, environment, status, deployed_by, deployed_at)
         VALUES (?, ?, NULL, NULL, ?, 'active', ?, CURRENT_TIMESTAMP)`,
        [deploymentId, modelId, environment, deployedBy]
      );

      return { deployment_id: deploymentId, model_id: modelId, environment, status: 'active' };
    } finally { db.close(); }
  }

  async listDeployments(environment) {
    const db = this.getDb();
    try {
      let sql = `SELECT d.*, m.name, m.version, m.model_type
                 FROM mlops_deployments d JOIN ml_models m ON d.model_id = m.model_id WHERE 1=1`;
      const params = [];
      if (environment) { sql += ' AND d.environment = ?'; params.push(environment); }
      sql += ' ORDER BY d.deployed_at DESC';
      return await this.all(db, sql, params);
    } finally { db.close(); }
  }

  async rollback(deploymentId) {
    const db = this.getDb();
    try {
      const dep = await this.get(db, 'SELECT * FROM mlops_deployments WHERE deployment_id = ?', [deploymentId]);
      if (!dep) throw new Error('Deployment not found');

      await this.run(db,
        `UPDATE mlops_deployments SET status = 'rolled_back', updated_at = CURRENT_TIMESTAMP WHERE deployment_id = ?`,
        [deploymentId]
      );

      const model = await this.get(db, 'SELECT * FROM ml_models WHERE model_id = ?', [dep.model_id]);
      if (model) {
        const prev = await this.get(db,
          `SELECT d.* FROM mlops_deployments d JOIN ml_models m ON d.model_id = m.model_id
           WHERE m.name = ? AND d.environment = ? AND d.deployment_id != ? AND d.status = 'active'
           ORDER BY d.deployed_at DESC LIMIT 1`,
          [model.name, dep.environment, deploymentId]
        );
        if (prev) {
          await this.run(db,
            `UPDATE ml_models SET status = 'production', updated_at = CURRENT_TIMESTAMP WHERE model_id = ?`,
            [prev.model_id]
          );
          await this.run(db,
            `UPDATE ml_models SET status = 'deprecated', updated_at = CURRENT_TIMESTAMP WHERE model_id = ?`,
            [dep.model_id]
          );
          return { rolled_back_to: prev.deployment_id, model_id: prev.model_id };
        }
      }
      return { rolled_back: deploymentId, previous: null };
    } finally { db.close(); }
  }

  // ── Performance Monitoring ───────────────────────────────────────────────────

  async recordFeedback(modelId, predictionId, actual, predicted, latencyMs) {
    const db = this.getDb();
    try {
      await this.run(db,
        `INSERT INTO mlops_feedback
          (feedback_id, model_id, prediction_id, actual_value, predicted_value, latency_ms, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [uuidv4(), modelId, predictionId, JSON.stringify(actual), JSON.stringify(predicted), latencyMs]
      );
      const count = await this.get(db, 'SELECT COUNT(*) as cnt FROM mlops_feedback WHERE model_id = ?', [modelId]);
      if (count && count.cnt % 100 === 0) {
        setImmediate(() => this._checkDrift(modelId));
      }
    } finally { db.close(); }
  }

  async getModelHealth(modelId, hours = 24) {
    const db = this.getDb();
    try {
      const since = new Date(Date.now() - hours * 3600000).toISOString();
      const stats = await this.get(db,
        `SELECT COUNT(*) as total_predictions, AVG(latency_ms) as avg_latency_ms,
                MIN(latency_ms) as min_latency_ms, MAX(latency_ms) as max_latency_ms
         FROM mlops_feedback WHERE model_id = ? AND recorded_at >= ?`,
        [modelId, since]
      );
      const driftAlerts = await this.all(db,
        `SELECT * FROM mlops_drift_alerts WHERE model_id = ? AND detected_at >= ? ORDER BY detected_at DESC`,
        [modelId, since]
      );
      return {
        model_id: modelId,
        period_hours: hours,
        prediction_stats: stats,
        drift_alerts: driftAlerts,
        health_status: driftAlerts.some(a => a.severity === 'high') ? 'degraded' : 'healthy',
      };
    } finally { db.close(); }
  }

  async _checkDrift(modelId) {
    const db = this.getDb();
    try {
      const recent = await this.all(db,
        `SELECT actual_value, predicted_value FROM mlops_feedback
         WHERE model_id = ? ORDER BY recorded_at DESC LIMIT 100`,
        [modelId]
      );
      const window200 = await this.all(db,
        `SELECT actual_value, predicted_value FROM mlops_feedback
         WHERE model_id = ? ORDER BY recorded_at DESC LIMIT 200`,
        [modelId]
      );
      const baseline = window200.slice(100);

      const accuracy = (rows) => {
        if (!rows.length) return null;
        return rows.filter(r => r.actual_value === r.predicted_value).length / rows.length;
      };

      const recentAcc = accuracy(recent);
      const baselineAcc = accuracy(baseline);

      if (recentAcc !== null && baselineAcc !== null && baselineAcc - recentAcc > 0.05) {
        const drift = baselineAcc - recentAcc;
        await this.run(db,
          `INSERT INTO mlops_drift_alerts
            (alert_id, model_id, drift_score, severity, baseline_accuracy, recent_accuracy, detected_at)
           VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
          [uuidv4(), modelId, parseFloat(drift.toFixed(4)),
            drift > 0.15 ? 'high' : 'medium',
            parseFloat(baselineAcc.toFixed(4)), parseFloat(recentAcc.toFixed(4))]
        );
      }
    } catch (err) {
      console.error('Drift check error:', err.message);
    } finally { db.close(); }
  }

  // ── Retraining ───────────────────────────────────────────────────────────────

  async scheduleRetraining(pipelineId, triggerType, triggeredBy, reason) {
    const db = this.getDb();
    const scheduleId = uuidv4();
    try {
      await this.run(db,
        `INSERT INTO mlops_retraining_schedule
          (schedule_id, pipeline_id, trigger_type, triggered_by, reason, status, scheduled_at)
         VALUES (?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)`,
        [scheduleId, pipelineId, triggerType, triggeredBy, reason]
      );
    } finally { db.close(); }

    // triggerTraining opens its own connection — close outer db first
    const runResult = await this.triggerTraining(pipelineId, triggeredBy);

    const db2 = this.getDb();
    try {
      await this.run(db2,
        `UPDATE mlops_retraining_schedule SET status = 'triggered', run_id = ? WHERE schedule_id = ?`,
        [runResult.run_id, scheduleId]
      );
    } finally { db2.close(); }

    return { schedule_id: scheduleId, ...runResult };
  }

  async listRetrainingHistory(pipelineId) {
    const db = this.getDb();
    try {
      return await this.all(db,
        `SELECT * FROM mlops_retraining_schedule WHERE pipeline_id = ? ORDER BY scheduled_at DESC LIMIT 50`,
        [pipelineId]
      );
    } finally { db.close(); }
  }

  // ── A/B Testing ──────────────────────────────────────────────────────────────

  async createExperiment(data) {
    const db = this.getDb();
    const experimentId = uuidv4();
    try {
      const totalWeight = data.variants.reduce((s, v) => s + (v.weight || 0), 0);
      if (Math.abs(totalWeight - 100) > 0.01) throw new Error('Variant weights must sum to 100');

      await this.run(db,
        `INSERT INTO mlops_experiments
          (experiment_id, name, description, variants, status, start_date, end_date, created_at)
         VALUES (?, ?, ?, ?, 'active', ?, ?, CURRENT_TIMESTAMP)`,
        [experimentId, data.name, data.description || null,
          JSON.stringify(data.variants), data.start_date || null, data.end_date || null]
      );
      return { experiment_id: experimentId, status: 'active', ...data };
    } finally { db.close(); }
  }

  assignVariant(experimentId, userId, variants) {
    const hash = [...`${experimentId}${userId}`].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0);
    const bucket = hash % 100;
    let cumulative = 0;
    for (const v of variants) {
      cumulative += v.weight;
      if (bucket < cumulative) return v.name;
    }
    return variants[variants.length - 1].name;
  }

  async getExperimentResults(experimentId) {
    const db = this.getDb();
    try {
      const exp = await this.get(db, 'SELECT * FROM mlops_experiments WHERE experiment_id = ?', [experimentId]);
      if (!exp) throw new Error('Experiment not found');

      const variants = JSON.parse(exp.variants || '[]');
      const results = await Promise.all(variants.map(async (v) => {
        const stats = await this.get(db,
          `SELECT COUNT(*) as requests, AVG(latency_ms) as avg_latency
           FROM ml_predictions WHERE model_id = ? AND ab_variant = ?`,
          [v.model_id, v.name]
        );
        return { variant: v.name, model_id: v.model_id, weight: v.weight, ...stats };
      }));

      return { experiment_id: experimentId, name: exp.name, status: exp.status, results };
    } finally { db.close(); }
  }

  async updateExperimentStatus(experimentId, status) {
    const db = this.getDb();
    try {
      await this.run(db,
        `UPDATE mlops_experiments SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE experiment_id = ?`,
        [status, experimentId]
      );
      return { experiment_id: experimentId, status };
    } finally { db.close(); }
  }

  // ── Explainability ───────────────────────────────────────────────────────────

  async getExplainability(modelId) {
    const db = this.getDb();
    try {
      const row = await this.get(db,
        `SELECT * FROM mlops_explainability WHERE model_id = ? ORDER BY created_at DESC LIMIT 1`,
        [modelId]
      );
      if (!row) throw new Error('No explainability data for this model');
      return { ...row, feature_importance: JSON.parse(row.feature_importance || '[]') };
    } finally { db.close(); }
  }

  async explainPrediction(modelId, inputData) {
    const db = this.getDb();
    try {
      const model = await this.get(db, 'SELECT * FROM ml_models WHERE model_id = ?', [modelId]);
      if (!model) throw new Error('Model not found');

      const baseExplain = await this.get(db,
        `SELECT * FROM mlops_explainability WHERE model_id = ? ORDER BY created_at DESC LIMIT 1`,
        [modelId]
      );
      const featureImportance = baseExplain
        ? JSON.parse(baseExplain.feature_importance || '[]')
        : this._featureImportance(model.model_type);

      // SHAP-style local explanation: scale global importance by input feature values
      const localExplanation = featureImportance.map(f => {
        const inputVal = inputData[f.feature] !== undefined ? inputData[f.feature] : null;
        const contribution = inputVal !== null
          ? parseFloat((f.importance * (typeof inputVal === 'number' ? inputVal : 1)).toFixed(4))
          : 0;
        return { feature: f.feature, global_importance: f.importance, input_value: inputVal, contribution };
      });

      localExplanation.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

      return {
        model_id: modelId,
        method: 'shap_approximation',
        top_features: localExplanation.slice(0, 5),
        all_features: localExplanation,
      };
    } finally { db.close(); }
  }

  // ── Version Control ──────────────────────────────────────────────────────────

  async getModelVersions(modelName) {
    const db = this.getDb();
    try {
      return await this.all(db,
        `SELECT model_id, name, version, model_type, status, description, created_at, updated_at
         FROM ml_models WHERE name = ? ORDER BY created_at DESC`,
        [modelName]
      );
    } finally { db.close(); }
  }

  async compareVersions(modelIdA, modelIdB) {
    const db = this.getDb();
    try {
      const [a, b] = await Promise.all([
        this.get(db, 'SELECT * FROM ml_models WHERE model_id = ?', [modelIdA]),
        this.get(db, 'SELECT * FROM ml_models WHERE model_id = ?', [modelIdB]),
      ]);
      if (!a || !b) throw new Error('One or both models not found');

      const [runA, runB] = await Promise.all([
        this.get(db, 'SELECT metrics FROM mlops_runs WHERE model_id = ? ORDER BY finished_at DESC LIMIT 1', [modelIdA]),
        this.get(db, 'SELECT metrics FROM mlops_runs WHERE model_id = ? ORDER BY finished_at DESC LIMIT 1', [modelIdB]),
      ]);

      return {
        model_a: { ...a, metrics: JSON.parse(runA?.metrics || 'null') },
        model_b: { ...b, metrics: JSON.parse(runB?.metrics || 'null') },
      };
    } finally { db.close(); }
  }
}

module.exports = new MLOpsService();
