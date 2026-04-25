const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { performance } = require('perf_hooks');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../database/healthcare.db');

class AIPerformanceMonitoringService {
  constructor() {
    this.db = null;
    this.metrics = new Map();
    this.alerts = new Map();
    this.performanceThresholds = {
      recommendation_generation: {
        excellent: 500,    // ms
        good: 1000,         // ms
        acceptable: 2000,   // ms
        poor: 3000,         // ms
        critical: 5000     // ms
      },
      model_training: {
        excellent: 30000,  // ms (30 seconds)
        good: 60000,        // ms (1 minute)
        acceptable: 120000, // ms (2 minutes)
        poor: 300000,       // ms (5 minutes)
        critical: 600000   // ms (10 minutes)
      },
      prediction_accuracy: {
        excellent: 0.95,   // 95%
        good: 0.85,         // 85%
        acceptable: 0.75,   // 75%
        poor: 0.65,         // 65%
        critical: 0.5      // 50%
      },
      user_satisfaction: {
        excellent: 4.5,     // out of 5
        good: 4.0,          // out of 5
        acceptable: 3.5,    // out of 5
        poor: 3.0,          // out of 5
        critical: 2.5       // out of 5
      },
      system_throughput: {
        excellent: 1000,   // requests/minute
        good: 500,         // requests/minute
        acceptable: 200,   // requests/minute
        poor: 100,         // requests/minute
        critical: 50       // requests/minute
      },
      error_rate: {
        excellent: 0.01,   // 1%
        good: 0.05,         // 5%
        acceptable: 0.1,    // 10%
        poor: 0.2,          // 20%
        critical: 0.3       // 30%
      }
    };
  }

  getDatabase() {
    if (!this.db) {
      this.db = new sqlite3.Database(DB_PATH);
    }
    return this.db;
  }

  // Initialize AI performance monitoring tables
  async initializeTables() {
    const db = this.getDatabase();
    
    const tables = [
      `CREATE TABLE IF NOT EXISTS ai_performance_metrics (
        id TEXT PRIMARY KEY,
        metric_type TEXT NOT NULL,
        metric_name TEXT NOT NULL,
        metric_value REAL NOT NULL,
        unit TEXT NOT NULL,
        tags TEXT NOT NULL,
        context TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        source TEXT NOT NULL
      )`,
      
      `CREATE TABLE IF NOT EXISTS ai_performance_alerts (
        id TEXT PRIMARY KEY,
        alert_type TEXT NOT NULL,
        severity TEXT NOT NULL,
        metric_name TEXT NOT NULL,
        threshold_value REAL NOT NULL,
        actual_value REAL NOT NULL,
        message TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        resolved_at DATETIME,
        acknowledged_by INTEGER,
        FOREIGN KEY (acknowledged_by) REFERENCES users (id)
      )`,
      
      `CREATE TABLE IF NOT EXISTS recommendation_performance (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        recommendation_type TEXT NOT NULL,
        generation_time REAL NOT NULL,
        accuracy_score REAL,
        user_rating INTEGER,
        user_feedback TEXT,
        accepted BOOLEAN,
        context TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )`,
      
      `CREATE TABLE IF NOT EXISTS model_performance (
        id TEXT PRIMARY KEY,
        model_id TEXT NOT NULL,
        model_type TEXT NOT NULL,
        model_name TEXT NOT NULL,
        training_time REAL NOT NULL,
        accuracy REAL,
        precision REAL,
        recall REAL,
        f1_score REAL,
        training_data_size INTEGER,
        inference_time REAL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (model_id) REFERENCES ml_models (id)
      )`,
      
      `CREATE TABLE IF NOT EXISTS ai_system_health (
        id TEXT PRIMARY KEY,
        cpu_usage REAL NOT NULL,
        memory_usage REAL NOT NULL,
        disk_usage REAL NOT NULL,
        active_models INTEGER NOT NULL,
        active_requests INTEGER NOT NULL,
        queue_size INTEGER NOT NULL,
        error_count INTEGER NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      
      `CREATE TABLE IF NOT EXISTS ai_performance_reports (
        id TEXT PRIMARY KEY,
        report_type TEXT NOT NULL,
        period_start DATETIME NOT NULL,
        period_end DATETIME NOT NULL,
        summary TEXT NOT NULL,
        detailed_metrics TEXT NOT NULL,
        alerts_summary TEXT NOT NULL,
        recommendations TEXT NOT NULL,
        generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        generated_by INTEGER,
        FOREIGN KEY (generated_by) REFERENCES users (id)
      )`
    ];

    for (const table of tables) {
      await new Promise((resolve, reject) => {
        db.run(table, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  }

  // Record AI performance metric
  async recordMetric(metricType, metricName, value, unit, tags = {}, context = {}, source = 'system') {
    const db = this.getDatabase();
    
    try {
      const metricId = uuidv4();
      
      await new Promise((resolve, reject) => {
        const query = `
          INSERT INTO ai_performance_metrics 
          (id, metric_type, metric_name, metric_value, unit, tags, context, source)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        db.run(query, [
          metricId,
          metricType,
          metricName,
          value,
          unit,
          JSON.stringify(tags),
          JSON.stringify(context),
          source
        ], function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        });
      });

      // Check for performance alerts
      await this.checkPerformanceAlerts(metricType, metricName, value, tags);

      return metricId;
    } catch (error) {
      console.error('Error recording AI performance metric:', error);
      throw error;
    }
  }

  // Record recommendation performance
  async recordRecommendationPerformance(userId, recommendationType, generationTime, accuracyScore, userRating, userFeedback, accepted, context) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = `
        INSERT INTO recommendation_performance 
        (id, user_id, recommendation_type, generation_time, accuracy_score, user_rating, user_feedback, accepted, context)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      db.run(query, [
        uuidv4(),
        userId,
        recommendationType,
        generationTime,
        accuracyScore,
        userRating,
        userFeedback,
        accepted,
        JSON.stringify(context)
      ], function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
    });
  }

  // Record model performance
  async recordModelPerformance(modelId, modelType, modelName, trainingTime, accuracy, precision, recall, f1Score, trainingDataSize, inferenceTime) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = `
        INSERT INTO model_performance 
        (id, model_id, model_type, model_name, training_time, accuracy, precision, recall, f1_score, training_data_size, inference_time)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      db.run(query, [
        uuidv4(),
        modelId,
        modelType,
        modelName,
        trainingTime,
        accuracy,
        precision,
        recall,
        f1Score,
        trainingDataSize,
        inferenceTime
      ], function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
    });
  }

  // Record system health
  async recordSystemHealth(cpuUsage, memoryUsage, diskUsage, activeModels, activeRequests, queueSize, errorCount) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = `
        INSERT INTO ai_system_health 
        (id, cpu_usage, memory_usage, disk_usage, active_models, active_requests, queue_size, error_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      db.run(query, [
        uuidv4(),
        cpuUsage,
        memoryUsage,
        diskUsage,
        activeModels,
        activeRequests,
        queueSize,
        errorCount
      ], function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
    });
  }

  // Check for performance alerts
  async checkPerformanceAlerts(metricType, metricName, value, tags) {
    const thresholds = this.performanceThresholds[metricType];
    
    if (!thresholds) return;

    let severity = null;
    let thresholdValue = null;

    if (metricType === 'recommendation_generation' || metricType === 'model_training') {
      if (value >= thresholds.critical) {
        severity = 'critical';
        thresholdValue = thresholds.critical;
      } else if (value >= thresholds.poor) {
        severity = 'poor';
        thresholdValue = thresholds.poor;
      } else if (value >= thresholds.acceptable) {
        severity = 'acceptable';
        thresholdValue = thresholds.acceptable;
      }
    } else {
      if (value <= thresholds.critical) {
        severity = 'critical';
        thresholdValue = thresholds.critical;
      } else if (value <= thresholds.poor) {
        severity = 'poor';
        thresholdValue = thresholds.poor;
      } else if (value <= thresholds.acceptable) {
        severity = 'acceptable';
        thresholdValue = thresholds.acceptable;
      }
    }

    if (severity && (severity === 'critical' || severity === 'poor')) {
      await this.createPerformanceAlert(metricType, metricName, severity, thresholdValue, value, tags);
    }
  }

  // Create performance alert
  async createPerformanceAlert(metricType, metricName, severity, thresholdValue, actualValue, tags) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const alertId = uuidv4();
      const message = this.generateAlertMessage(metricType, metricName, severity, thresholdValue, actualValue);
      
      const query = `
        INSERT INTO ai_performance_alerts 
        (id, alert_type, severity, metric_name, threshold_value, actual_value, message)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;
      
      db.run(query, [
        alertId,
        'threshold_exceeded',
        severity,
        metricName,
        thresholdValue,
        actualValue,
        message
      ], function(err) {
        if (err) reject(err);
        else resolve(alertId);
      });
    });
  }

  // Generate alert message
  generateAlertMessage(metricType, metricName, severity, thresholdValue, actualValue) {
    const severityEmoji = {
      critical: '🚨',
      poor: '⚠️',
      acceptable: 'ℹ️',
      good: '✅',
      excellent: '🌟'
    };

    const unit = this.getMetricUnit(metricType);
    
    return `${severityEmoji[severity] || '⚠️'} AI Performance Alert: ${metricName}\n\n` +
           `Metric: ${metricName}\n` +
           `Type: ${metricType}\n` +
           `Current Value: ${actualValue}${unit}\n` +
           `Threshold: ${thresholdValue}${unit}\n` +
           `Severity: ${severity.toUpperCase()}\n` +
           `Time: ${new Date().toISOString()}`;
  }

  // Get metric unit
  getMetricUnit(metricType) {
    const units = {
      recommendation_generation: 'ms',
      model_training: 'ms',
      prediction_accuracy: '%',
      user_satisfaction: '/5',
      system_throughput: 'req/min',
      error_rate: '%'
    };
    
    return units[metricType] || '';
  }

  // Get AI performance metrics
  async getMetrics(metricType = null, metricName = null, period = 24, limit = 1000) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      let query = 'SELECT * FROM ai_performance_metrics WHERE 1=1';
      const params = [];

      if (metricType) {
        query += ' AND metric_type = ?';
        params.push(metricType);
      }

      if (metricName) {
        query += ' AND metric_name = ?';
        params.push(metricName);
      }

      if (period) {
        const cutoffDate = new Date();
        cutoffDate.setHours(cutoffDate.getHours() - period);
        query += ' AND timestamp >= ?';
        params.push(cutoffDate.toISOString());
      }

      query += ' ORDER BY timestamp DESC LIMIT ?';
      params.push(limit);

      db.all(query, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const metrics = rows.map(row => ({
            ...row,
            tags: JSON.parse(row.tags || '{}'),
            context: JSON.parse(row.context || '{}')
          }));
          resolve(metrics);
        }
      });
    });
  }

  // Get recommendation performance metrics
  async getRecommendationPerformance(userId = null, period = 24, limit = 1000) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      let query = 'SELECT * FROM recommendation_performance WHERE 1=1';
      const params = [];

      if (userId) {
        query += ' AND user_id = ?';
        params.push(userId);
      }

      if (period) {
        const cutoffDate = new Date();
        cutoffDate.setHours(cutoffDate.getHours() - period);
        query += ' AND timestamp >= ?';
        params.push(cutoffDate.toISOString());
      }

      query += ' ORDER BY timestamp DESC LIMIT ?';
      params.push(limit);

      db.all(query, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const performance = rows.map(row => ({
            ...row,
            context: JSON.parse(row.context || '{}')
          }));
          resolve(performance);
        }
      });
    });
  }

  // Get model performance metrics
  async getModelPerformance(modelId = null, period = 24, limit = 100) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      let query = 'SELECT * FROM model_performance WHERE 1=1';
      const params = [];

      if (modelId) {
        query += ' AND model_id = ?';
        params.push(modelId);
      }

      if (period) {
        const cutoffDate = new Date();
        cutoffDate.setHours(cutoffDate.getHours() - period);
        query += ' AND timestamp >= ?';
        params.push(cutoffDate.toISOString());
      }

      query += ' ORDER BY timestamp DESC LIMIT ?';
      params.push(limit);

      db.all(query, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  // Get system health metrics
  async getSystemHealth(period = 24, limit = 1000) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      let query = 'SELECT * FROM ai_system_health WHERE 1=1';
      const params = [];

      if (period) {
        const cutoffDate = new Date();
        cutoffDate.setHours(cutoffDate.getHours() - period);
        query += ' AND timestamp >= ?';
        params.push(cutoffDate.toISOString());
      }

      query += ' ORDER BY timestamp DESC LIMIT ?';
      params.push(limit);

      db.all(query, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  // Get performance alerts
  async getAlerts(status = 'active', severity = null, limit = 50) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      let query = 'SELECT * FROM ai_performance_alerts WHERE status = ?';
      const params = [status];

      if (severity) {
        query += ' AND severity = ?';
        params.push(severity);
      }

      query += ' ORDER BY created_at DESC LIMIT ?';
      params.push(limit);

      db.all(query, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  // Get AI performance statistics
  async getPerformanceStats(period = 24) {
    const db = this.getDatabase();
    
    const cutoffDate = new Date();
    cutoffDate.setHours(cutoffDate.getHours() - period);

    try {
      // Get recommendation performance stats
      const recommendationStats = await this.getRecommendationPerformanceStats(cutoffDate);
      
      // Get model performance stats
      const modelStats = await this.getModelPerformanceStats(cutoffDate);
      
      // Get system health stats
      const systemStats = await this.getSystemHealthStats(cutoffDate);
      
      // Get alert stats
      const alertStats = await this.getAlertStats(cutoffDate);

      return {
        period_hours: period,
        recommendation_performance: recommendationStats,
        model_performance: modelStats,
        system_health: systemStats,
        alerts: alertStats,
        generated_at: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error getting AI performance stats:', error);
      throw error;
    }
  }

  // Get recommendation performance statistics
  async getRecommendationPerformanceStats(cutoffDate) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = `
        SELECT 
          COUNT(*) as total_recommendations,
          AVG(generation_time) as avg_generation_time,
          MIN(generation_time) as min_generation_time,
          MAX(generation_time) as max_generation_time,
          AVG(accuracy_score) as avg_accuracy_score,
          AVG(user_rating) as avg_user_rating,
          COUNT(CASE WHEN accepted = TRUE THEN 1 END) as accepted_count,
          COUNT(DISTINCT user_id) as unique_users,
          COUNT(DISTINCT recommendation_type) as recommendation_types
        FROM recommendation_performance
        WHERE timestamp >= ?
      `;
      
      db.get(query, [cutoffDate.toISOString()], (err, row) => {
        if (err) {
          reject(err);
        } else {
          const stats = {
            total_recommendations: row.total_recommendations || 0,
            avg_generation_time: row.avg_generation_time || 0,
            min_generation_time: row.min_generation_time || 0,
            max_generation_time: row.max_generation_time || 0,
            avg_accuracy_score: row.avg_accuracy_score || 0,
            avg_user_rating: row.avg_user_rating || 0,
            acceptance_rate: row.total_recommendations > 0 ? (row.accepted_count / row.total_recommendations) : 0,
            unique_users: row.unique_users || 0,
            recommendation_types: row.recommendation_types || 0
          };

          // Determine performance level
          stats.performance_level = this.determineRecommendationPerformanceLevel(stats.avg_generation_time, stats.avg_accuracy_score);

          resolve(stats);
        }
      });
    });
  }

  // Get model performance statistics
  async getModelPerformanceStats(cutoffDate) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = `
        SELECT 
          COUNT(*) as total_models,
          AVG(training_time) as avg_training_time,
          AVG(accuracy) as avg_accuracy,
          AVG(precision) as avg_precision,
          AVG(recall) as avg_recall,
          AVG(f1_score) as avg_f1_score,
          AVG(inference_time) as avg_inference_time,
          COUNT(DISTINCT model_type) as model_types
        FROM model_performance
        WHERE timestamp >= ?
      `;
      
      db.get(query, [cutoffDate.toISOString()], (err, row) => {
        if (err) {
          reject(err);
        } else {
          const stats = {
            total_models: row.total_models || 0,
            avg_training_time: row.avg_training_time || 0,
            avg_accuracy: row.avg_accuracy || 0,
            avg_precision: row.avg_precision || 0,
            avg_recall: row.avg_recall || 0,
            avg_f1_score: row.avg_f1_score || 0,
            avg_inference_time: row.avg_inference_time || 0,
            model_types: row.model_types || 0
          };

          // Determine performance level
          stats.performance_level = this.determineModelPerformanceLevel(stats.avg_accuracy, stats.avg_f1_score);

          resolve(stats);
        }
      });
    });
  }

  // Get system health statistics
  async getSystemHealthStats(cutoffDate) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = `
        SELECT 
          AVG(cpu_usage) as avg_cpu_usage,
          MAX(cpu_usage) as max_cpu_usage,
          AVG(memory_usage) as avg_memory_usage,
          MAX(memory_usage) as max_memory_usage,
          AVG(disk_usage) as avg_disk_usage,
          AVG(active_models) as avg_active_models,
          AVG(active_requests) as avg_active_requests,
          AVG(queue_size) as avg_queue_size,
          SUM(error_count) as total_errors
        FROM ai_system_health
        WHERE timestamp >= ?
      `;
      
      db.get(query, [cutoffDate.toISOString()], (err, row) => {
        if (err) {
          reject(err);
        } else {
          const stats = {
            avg_cpu_usage: row.avg_cpu_usage || 0,
            max_cpu_usage: row.max_cpu_usage || 0,
            avg_memory_usage: row.avg_memory_usage || 0,
            max_memory_usage: row.max_memory_usage || 0,
            avg_disk_usage: row.avg_disk_usage || 0,
            avg_active_models: row.avg_active_models || 0,
            avg_active_requests: row.avg_active_requests || 0,
            avg_queue_size: row.avg_queue_size || 0,
            total_errors: row.total_errors || 0
          };

          // Determine health status
          stats.health_status = this.determineSystemHealthStatus(stats);

          resolve(stats);
        }
      });
    });
  }

  // Get alert statistics
  async getAlertStats(cutoffDate) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = `
        SELECT 
          COUNT(*) as total_alerts,
          COUNT(CASE WHEN severity = 'critical' THEN 1 END) as critical_alerts,
          COUNT(CASE WHEN severity = 'poor' THEN 1 END) as poor_alerts,
          COUNT(CASE WHEN severity = 'acceptable' THEN 1 END) as acceptable_alerts,
          COUNT(CASE WHEN status = 'active' THEN 1 END) as active_alerts,
          COUNT(DISTINCT metric_name) as affected_metrics
        FROM ai_performance_alerts
        WHERE created_at >= ?
      `;
      
      db.get(query, [cutoffDate.toISOString()], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve({
            total_alerts: row.total_alerts || 0,
            critical_alerts: row.critical_alerts || 0,
            poor_alerts: row.poor_alerts || 0,
            acceptable_alerts: row.acceptable_alerts || 0,
            active_alerts: row.active_alerts || 0,
            affected_metrics: row.affected_metrics || 0
          });
        }
      });
    });
  }

  // Determine recommendation performance level
  determineRecommendationPerformanceLevel(avgGenerationTime, avgAccuracy) {
    const genTimeThresholds = this.performanceThresholds.recommendation_generation;
    const accThresholds = this.performanceThresholds.prediction_accuracy;
    
    if (avgGenerationTime <= genTimeThresholds.excellent && avgAccuracy >= accThresholds.excellent) {
      return 'excellent';
    } else if (avgGenerationTime <= genTimeThresholds.good && avgAccuracy >= accThresholds.good) {
      return 'good';
    } else if (avgGenerationTime <= genTimeThresholds.acceptable && avgAccuracy >= accThresholds.acceptable) {
      return 'acceptable';
    } else if (avgGenerationTime <= genTimeThresholds.poor && avgAccuracy >= accThresholds.poor) {
      return 'poor';
    } else {
      return 'critical';
    }
  }

  // Determine model performance level
  determineModelPerformanceLevel(avgAccuracy, avgF1Score) {
    const accThresholds = this.performanceThresholds.prediction_accuracy;
    
    if (avgAccuracy >= accThresholds.excellent && avgF1Score >= 0.9) {
      return 'excellent';
    } else if (avgAccuracy >= accThresholds.good && avgF1Score >= 0.8) {
      return 'good';
    } else if (avgAccuracy >= accThresholds.acceptable && avgF1Score >= 0.7) {
      return 'acceptable';
    } else if (avgAccuracy >= accThresholds.poor && avgF1Score >= 0.6) {
      return 'poor';
    } else {
      return 'critical';
    }
  }

  // Determine system health status
  determineSystemHealthStatus(stats) {
    const cpuThresholds = { excellent: 30, good: 50, acceptable: 70, poor: 85, critical: 95 };
    const memThresholds = { excellent: 50, good: 70, acceptable: 80, poor: 90, critical: 95 };
    
    let cpuStatus = 'excellent';
    let memStatus = 'excellent';
    
    Object.entries(cpuThresholds).forEach(([status, threshold]) => {
      if (stats.avg_cpu_usage >= threshold) {
        cpuStatus = status;
      }
    });
    
    Object.entries(memThresholds).forEach(([status, threshold]) => {
      if (stats.avg_memory_usage >= threshold) {
        memStatus = status;
      }
    });
    
    // Overall health is determined by the worst component
    const statusLevels = { excellent: 4, good: 3, acceptable: 2, poor: 1, critical: 0 };
    const cpuLevel = statusLevels[cpuStatus];
    const memLevel = statusLevels[memStatus];
    
    const overallLevel = Math.min(cpuLevel, memLevel);
    return Object.keys(statusLevels).find(key => statusLevels[key] === overallLevel);
  }

  // Generate AI performance report
  async generatePerformanceReport(period = 24, userId = null) {
    try {
      const periodStart = new Date();
      periodStart.setHours(periodStart.getHours() - period);
      const periodEnd = new Date();

      // Get performance statistics
      const stats = await this.getPerformanceStats(period);
      
      // Get detailed metrics
      const detailedMetrics = await this.getDetailedMetrics(periodStart, periodEnd);
      
      // Get alerts summary
      const alertsSummary = await this.getAlertsSummary(periodStart, periodEnd);
      
      // Generate recommendations
      const recommendations = this.generatePerformanceRecommendations(stats, alertsSummary);
      
      const reportId = uuidv4();

      // Save report
      await this.savePerformanceReport(reportId, periodStart, periodEnd, stats, detailedMetrics, alertsSummary, recommendations, userId);

      return {
        report_id: reportId,
        period_start: periodStart.toISOString(),
        period_end: periodEnd.toISOString(),
        summary: stats,
        detailed_metrics: detailedMetrics,
        alerts_summary: alertsSummary,
        recommendations: recommendations,
        generated_at: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error generating AI performance report:', error);
      throw error;
    }
  }

  // Get detailed metrics
  async getDetailedMetrics(periodStart, periodEnd) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = `
        SELECT 
          metric_type,
          metric_name,
          AVG(metric_value) as avg_value,
          MIN(metric_value) as min_value,
          MAX(metric_value) as max_value,
          COUNT(*) as data_points,
          timestamp
        FROM ai_performance_metrics
        WHERE timestamp >= ? AND timestamp <= ?
        GROUP BY metric_type, metric_name
        ORDER BY metric_type, metric_name
      `;
      
      db.all(query, [periodStart.toISOString(), periodEnd.toISOString()], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const metrics = {};
          
          rows.forEach(row => {
            if (!metrics[row.metric_type]) {
              metrics[row.metric_type] = [];
            }
            
            metrics[row.metric_type].push({
              name: row.metric_name,
              average: row.avg_value || 0,
              minimum: row.min_value || 0,
              maximum: row.max_value || 0,
              data_points: row.data_points || 0
            });
          });

          resolve(metrics);
        }
      });
    });
  }

  // Get alerts summary
  async getAlertsSummary(periodStart, periodEnd) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = `
        SELECT 
          severity,
          COUNT(*) as count,
          metric_name,
          AVG(actual_value) as avg_value,
          MAX(actual_value) as max_value
        FROM ai_performance_alerts
        WHERE created_at >= ? AND created_at <= ?
        GROUP BY severity, metric_name
        ORDER BY severity, count DESC
      `;
      
      db.all(query, [periodStart.toISOString(), periodEnd.toISOString()], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  // Generate performance recommendations
  generatePerformanceRecommendations(stats, alertsSummary) {
    const recommendations = [];

    // Recommendation generation performance
    if (stats.recommendation_performance.avg_generation_time > this.performanceThresholds.recommendation_generation.good) {
      recommendations.push({
        priority: 'high',
        category: 'recommendation_generation',
        description: 'Recommendation generation time is above optimal levels',
        actions: [
          'Optimize recommendation algorithms',
          'Implement caching mechanisms',
          'Consider model optimization techniques',
          'Scale infrastructure if needed'
        ]
      });
    }

    // Model performance recommendations
    if (stats.model_performance.avg_accuracy < this.performanceThresholds.prediction_accuracy.good) {
      recommendations.push({
        priority: 'high',
        category: 'model_performance',
        description: 'Model accuracy is below acceptable levels',
        actions: [
          'Retrain models with more data',
          'Feature engineering improvements',
          'Consider ensemble methods',
          'Update model architectures'
        ]
      });
    }

    // System health recommendations
    if (stats.system_health.avg_cpu_usage > 80 || stats.system_health.avg_memory_usage > 80) {
      recommendations.push({
        priority: 'critical',
        category: 'system_health',
        description: 'System resource usage is high',
        actions: [
          'Scale up infrastructure',
          'Optimize resource usage',
          'Implement load balancing',
          'Monitor system performance closely'
        ]
      });
    }

    // Alert-based recommendations
    const criticalAlerts = alertsSummary.filter(alert => alert.severity === 'critical');
    if (criticalAlerts.length > 0) {
      recommendations.push({
        priority: 'critical',
        category: 'alerts',
        description: `${criticalAlerts.length} critical performance alerts detected`,
        actions: [
          'Immediately address critical alerts',
          'Review alert thresholds',
          'Implement preventive measures',
          'Enhance monitoring coverage'
        ]
      });
    }

    return recommendations;
  }

  // Save performance report
  async savePerformanceReport(reportId, periodStart, periodEnd, summary, detailedMetrics, alertsSummary, recommendations, userId) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = `
        INSERT INTO ai_performance_reports 
        (id, report_type, period_start, period_end, summary, detailed_metrics, alerts_summary, recommendations, generated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      db.run(query, [
        reportId,
        'periodic',
        periodStart.toISOString(),
        periodEnd.toISOString(),
        JSON.stringify(summary),
        JSON.stringify(detailedMetrics),
        JSON.stringify(alertsSummary),
        JSON.stringify(recommendations),
        userId
      ], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  // Middleware for AI performance monitoring
  aiPerformanceMiddleware() {
    return (req, res, next) => {
      const startTime = performance.now();
      const endpoint = req.route ? req.route.path : req.path;
      const method = req.method;

      // Override res.end to capture performance
      const originalEnd = res.end;
      res.end = function(chunk, encoding) {
        const endTime = performance.now();
        const responseTime = endTime - startTime;

        // Record AI endpoint performance asynchronously
        setImmediate(() => {
          if (endpoint.includes('/ai/') || endpoint.includes('/recommendation/') || endpoint.includes('/prediction/')) {
            this.recordMetric(
              'recommendation_generation',
              `${method} ${endpoint}`,
              responseTime,
              'ms',
              { endpoint, method },
              { userId: req.user?.id, timestamp: new Date().toISOString() },
              'api'
            ).catch(err => console.error('Error recording AI performance:', err));
          }
        });

        originalEnd.call(this, chunk, encoding);
      }.bind(this);

      next();
    };
  }

  // Close database connection
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

module.exports = new AIPerformanceMonitoringService();
