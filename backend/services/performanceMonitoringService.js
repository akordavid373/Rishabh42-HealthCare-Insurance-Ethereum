const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { performance } = require('perf_hooks');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../database/healthcare.db');

class PerformanceMonitoringService {
  constructor() {
    this.db = null;
    this.metrics = new Map();
    this.alerts = new Map();
    this.benchmarks = new Map();
    this.performanceThresholds = {
      response_time: {
        excellent: 100,    // ms
        good: 200,         // ms
        acceptable: 500,   // ms
        poor: 1000,        // ms
        critical: 2000     // ms
      },
      throughput: {
        excellent: 1000,   // requests/second
        good: 500,         // requests/second
        acceptable: 200,   // requests/second
        poor: 100,         // requests/second
        critical: 50       // requests/second
      },
      error_rate: {
        excellent: 0.1,    // %
        good: 0.5,         // %
        acceptable: 1.0,   // %
        poor: 2.0,         // %
        critical: 5.0      // %
      },
      cpu_usage: {
        excellent: 30,     // %
        good: 50,          // %
        acceptable: 70,    // %
        poor: 85,          // %
        critical: 95       // %
      },
      memory_usage: {
        excellent: 50,     // %
        good: 70,          // %
        acceptable: 80,    // %
        poor: 90,          // %
        critical: 95       // %
      },
      disk_usage: {
        excellent: 60,     // %
        good: 75,          // %
        acceptable: 85,    // %
        poor: 92,          // %
        critical: 95       // %
      }
    };
    
    // Initialize benchmarks
    this.initializeBenchmarks();
  }

  getDatabase() {
    if (!this.db) {
      this.db = new sqlite3.Database(DB_PATH);
    }
    return this.db;
  }

  // Initialize performance monitoring tables
  async initializeTables() {
    const db = this.getDatabase();
    
    const tables = [
      `CREATE TABLE IF NOT EXISTS performance_metrics (
        id TEXT PRIMARY KEY,
        metric_type TEXT NOT NULL,
        metric_name TEXT NOT NULL,
        metric_value REAL NOT NULL,
        unit TEXT NOT NULL,
        tags TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        source TEXT NOT NULL,
        context TEXT
      )`,
      
      `CREATE TABLE IF NOT EXISTS performance_alerts (
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
      
      `CREATE TABLE IF NOT EXISTS performance_benchmarks (
        id TEXT PRIMARY KEY,
        benchmark_name TEXT NOT NULL,
        metric_type TEXT NOT NULL,
        baseline_value REAL NOT NULL,
        target_value REAL NOT NULL,
        unit TEXT NOT NULL,
        description TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      
      `CREATE TABLE IF NOT EXISTS performance_reports (
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
      )`,
      
      `CREATE TABLE IF NOT EXISTS api_performance (
        id TEXT PRIMARY KEY,
        endpoint TEXT NOT NULL,
        method TEXT NOT NULL,
        response_time REAL NOT NULL,
        status_code INTEGER NOT NULL,
        request_size INTEGER,
        response_size INTEGER,
        user_id INTEGER,
        ip_address TEXT,
        user_agent TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
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

  // Initialize benchmarks
  initializeBenchmarks() {
    // API performance benchmarks
    this.benchmarks.set('api_response_time', {
      baseline: 200,
      target: 100,
      unit: 'ms',
      description: 'Average API response time'
    });

    this.benchmarks.set('api_throughput', {
      baseline: 500,
      target: 1000,
      unit: 'requests/second',
      description: 'API request throughput'
    });

    this.benchmarks.set('api_error_rate', {
      baseline: 1.0,
      target: 0.5,
      unit: '%',
      description: 'API error rate'
    });

    // System resource benchmarks
    this.benchmarks.set('cpu_usage', {
      baseline: 70,
      target: 50,
      unit: '%',
      description: 'CPU usage percentage'
    });

    this.benchmarks.set('memory_usage', {
      baseline: 80,
      target: 70,
      unit: '%',
      description: 'Memory usage percentage'
    });

    this.benchmarks.set('disk_usage', {
      baseline: 85,
      target: 75,
      unit: '%',
      description: 'Disk usage percentage'
    });
  }

  // Record performance metric
  async recordMetric(metricType, metricName, value, unit, tags = {}, source = 'system', context = {}) {
    const db = this.getDatabase();
    
    try {
      const metricId = uuidv4();
      
      await new Promise((resolve, reject) => {
        const query = `
          INSERT INTO performance_metrics 
          (id, metric_type, metric_name, metric_value, unit, tags, source, context)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        db.run(query, [
          metricId,
          metricType,
          metricName,
          value,
          unit,
          JSON.stringify(tags),
          source,
          JSON.stringify(context)
        ], function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        });
      });

      // Check for performance alerts
      await this.checkPerformanceAlerts(metricType, metricName, value, tags);

      return metricId;
    } catch (error) {
      console.error('Error recording performance metric:', error);
      throw error;
    }
  }

  // Record API performance
  async recordAPIPerformance(endpoint, method, responseTime, statusCode, requestSize, responseSize, userId, ipAddress, userAgent) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = `
        INSERT INTO api_performance 
        (id, endpoint, method, response_time, status_code, request_size, response_size, user_id, ip_address, user_agent)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      db.run(query, [
        uuidv4(),
        endpoint,
        method,
        responseTime,
        statusCode,
        requestSize,
        responseSize,
        userId,
        ipAddress,
        userAgent
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
        INSERT INTO performance_alerts 
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
      acceptable: 'ℹ️'
    };

    return `${severityEmoji[severity] || '⚠️'} Performance Alert: ${metricName}\n\n` +
           `Metric: ${metricName}\n` +
           `Type: ${metricType}\n` +
           `Current Value: ${actualValue}\n` +
           `Threshold: ${thresholdValue}\n` +
           `Severity: ${severity.toUpperCase()}\n` +
           `Time: ${new Date().toISOString()}`;
  }

  // Get performance metrics
  async getMetrics(metricType = null, metricName = null, period = 24, limit = 1000) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      let query = 'SELECT * FROM performance_metrics WHERE 1=1';
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

  // Get API performance metrics
  async getAPIPerformance(endpoint = null, period = 24, limit = 1000) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      let query = 'SELECT * FROM api_performance WHERE 1=1';
      const params = [];

      if (endpoint) {
        query += ' AND endpoint = ?';
        params.push(endpoint);
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

  // Get performance alerts
  async getAlerts(status = 'active', severity = null, limit = 50) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      let query = 'SELECT * FROM performance_alerts WHERE status = ?';
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

  // Get performance statistics
  async getPerformanceStats(period = 24) {
    const db = this.getDatabase();
    
    const cutoffDate = new Date();
    cutoffDate.setHours(cutoffDate.getHours() - period);

    try {
      // Get API performance stats
      const apiStats = await this.getAPIPerformanceStats(cutoffDate);
      
      // Get system resource stats
      const systemStats = await this.getSystemResourceStats(cutoffDate);
      
      // Get alert stats
      const alertStats = await this.getAlertStats(cutoffDate);

      return {
        period_hours: period,
        api_performance: apiStats,
        system_resources: systemStats,
        alerts: alertStats,
        generated_at: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error getting performance stats:', error);
      throw error;
    }
  }

  // Get API performance statistics
  async getAPIPerformanceStats(cutoffDate) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = `
        SELECT 
          COUNT(*) as total_requests,
          AVG(response_time) as avg_response_time,
          MIN(response_time) as min_response_time,
          MAX(response_time) as max_response_time,
          COUNT(CASE WHEN status_code >= 400 THEN 1 END) as error_count,
          COUNT(DISTINCT endpoint) as unique_endpoints,
          COUNT(DISTINCT user_id) as unique_users
        FROM api_performance
        WHERE timestamp >= ?
      `;
      
      db.get(query, [cutoffDate.toISOString()], (err, row) => {
        if (err) {
          reject(err);
        } else {
          const stats = {
            total_requests: row.total_requests || 0,
            avg_response_time: row.avg_response_time || 0,
            min_response_time: row.min_response_time || 0,
            max_response_time: row.max_response_time || 0,
            error_count: row.error_count || 0,
            error_rate: row.total_requests > 0 ? (row.error_count / row.total_requests) * 100 : 0,
            unique_endpoints: row.unique_endpoints || 0,
            unique_users: row.unique_users || 0,
            throughput: row.total_requests / 24 // requests per hour
          };

          // Determine performance level
          stats.performance_level = this.determinePerformanceLevel(stats.avg_response_time, stats.error_rate);

          resolve(stats);
        }
      });
    });
  }

  // Get system resource statistics
  async getSystemResourceStats(cutoffDate) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = `
        SELECT 
          metric_name,
          AVG(metric_value) as avg_value,
          MIN(metric_value) as min_value,
          MAX(metric_value) as max_value,
          COUNT(*) as data_points
        FROM performance_metrics
        WHERE timestamp >= ? AND metric_type IN ('cpu_usage', 'memory_usage', 'disk_usage')
        GROUP BY metric_name
      `;
      
      db.all(query, [cutoffDate.toISOString()], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const stats = {};
          
          rows.forEach(row => {
            stats[row.metric_name] = {
              average: row.avg_value || 0,
              minimum: row.min_value || 0,
              maximum: row.max_value || 0,
              data_points: row.data_points || 0,
              status: this.getResourceStatus(row.metric_name, row.avg_value || 0)
            };
          });

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
        FROM performance_alerts
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

  // Determine performance level
  determinePerformanceLevel(avgResponseTime, errorRate) {
    const thresholds = this.performanceThresholds.response_time;
    
    if (avgResponseTime <= thresholds.excellent && errorRate <= this.performanceThresholds.error_rate.excellent) {
      return 'excellent';
    } else if (avgResponseTime <= thresholds.good && errorRate <= this.performanceThresholds.error_rate.good) {
      return 'good';
    } else if (avgResponseTime <= thresholds.acceptable && errorRate <= this.performanceThresholds.error_rate.acceptable) {
      return 'acceptable';
    } else if (avgResponseTime <= thresholds.poor && errorRate <= this.performanceThresholds.error_rate.poor) {
      return 'poor';
    } else {
      return 'critical';
    }
  }

  // Get resource status
  getResourceStatus(metricName, value) {
    const thresholds = this.performanceThresholds[metricName];
    
    if (!thresholds) return 'unknown';

    if (value <= thresholds.excellent) return 'excellent';
    if (value <= thresholds.good) return 'good';
    if (value <= thresholds.acceptable) return 'acceptable';
    if (value <= thresholds.poor) return 'poor';
    return 'critical';
  }

  // Generate performance report
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
      console.error('Error generating performance report:', error);
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
        FROM performance_metrics
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
        FROM performance_alerts
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

    // API performance recommendations
    if (stats.api_performance.avg_response_time > this.performanceThresholds.response_time.good) {
      recommendations.push({
        priority: 'high',
        category: 'api_performance',
        description: 'API response times are above optimal levels',
        actions: [
          'Optimize database queries',
          'Implement response caching',
          'Review and optimize slow endpoints',
          'Consider load balancing'
        ]
      });
    }

    if (stats.api_performance.error_rate > this.performanceThresholds.error_rate.good) {
      recommendations.push({
        priority: 'high',
        category: 'api_reliability',
        description: 'API error rate is above acceptable levels',
        actions: [
          'Review error logs for common issues',
          'Implement better error handling',
          'Add input validation',
          'Improve monitoring and alerting'
        ]
      });
    }

    // System resource recommendations
    Object.entries(stats.system_resources).forEach(([resource, data]) => {
      if (data.average > this.performanceThresholds[resource].good) {
        recommendations.push({
          priority: 'medium',
          category: resource,
          description: `${resource.replace('_', ' ')} usage is above optimal levels`,
          actions: [
            `Monitor ${resource} trends`,
            `Optimize ${resource} usage`,
            `Consider scaling resources`,
            `Review resource-intensive processes`
          ]
        });
      }
    });

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
        INSERT INTO performance_reports 
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

  // Middleware for API performance monitoring
  apiPerformanceMiddleware() {
    return (req, res, next) => {
      const startTime = performance.now();
      const requestSize = req.headers['content-length'] ? parseInt(req.headers['content-length']) : 0;

      // Override res.end to capture response time and size
      const originalEnd = res.end;
      res.end = function(chunk, encoding) {
        const endTime = performance.now();
        const responseTime = endTime - startTime;
        const responseSize = chunk ? chunk.length : 0;

        // Record API performance asynchronously
        setImmediate(() => {
          this.recordAPIPerformance(
            req.route ? req.route.path : req.path,
            req.method,
            responseTime,
            res.statusCode,
            requestSize,
            responseSize,
            req.user ? req.user.id : null,
            req.ip,
            req.headers['user-agent']
          ).catch(err => console.error('Error recording API performance:', err));
        });

        originalEnd.call(this, chunk, encoding);
      }.bind(this);

      next();
    };
  }

  // System resource monitoring
  async collectSystemMetrics() {
    try {
      // CPU usage
      const cpuUsage = process.cpuUsage();
      const cpuPercent = (cpuUsage.user + cpuUsage.system) / 1000000; // Convert to seconds
      
      await this.recordMetric('cpu_usage', 'process_cpu', cpuPercent, '%', {
        process_id: process.pid,
        node_version: process.version
      });

      // Memory usage
      const memUsage = process.memoryUsage();
      const heapUsedPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
      
      await this.recordMetric('memory_usage', 'heap_used_percent', heapUsedPercent, '%', {
        process_id: process.pid,
        heap_used: memUsage.heapUsed,
        heap_total: memUsage.heapTotal,
        rss: memUsage.rss
      });

      // Event loop lag
      const eventLoopLag = await this.measureEventLoopLag();
      await this.recordMetric('event_loop', 'lag', eventLoopLag, 'ms', {
        process_id: process.pid
      });

    } catch (error) {
      console.error('Error collecting system metrics:', error);
    }
  }

  // Measure event loop lag
  measureEventLoopLag() {
    return new Promise((resolve) => {
      const start = performance.now();
      setImmediate(() => {
        const lag = performance.now() - start;
        resolve(lag);
      });
    });
  }

  // Acknowledge alert
  async acknowledgeAlert(alertId, userId, notes = null) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = `
        UPDATE performance_alerts 
        SET status = 'acknowledged', acknowledged_by = ?, resolved_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'active'
      `;
      
      db.run(query, [userId, alertId], function(err) {
        if (err) {
          reject(err);
        } else if (this.changes === 0) {
          reject(new Error('Alert not found or already acknowledged'));
        } else {
          resolve();
        }
      });
    });
  }

  // Create custom alert threshold
  async createCustomThreshold(metricName, thresholdValue, severity, condition, description, userId) {
    const db = this.getDatabase();
    
    try {
      // First ensure the custom thresholds table exists
      await this.createCustomThresholdsTable();
      
      const thresholdId = uuidv4();
      
      return new Promise((resolve, reject) => {
        const query = `
          INSERT INTO custom_alert_thresholds 
          (id, metric_name, threshold_value, severity, condition, description, created_by, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `;
        
        db.run(query, [
          thresholdId,
          metricName,
          thresholdValue,
          severity,
          condition,
          description || null,
          userId
        ], function(err) {
          if (err) {
            reject(err);
          } else {
            resolve(thresholdId);
          }
        });
      });
    } catch (error) {
      console.error('Error creating custom threshold:', error);
      throw error;
    }
  }

  // Create custom thresholds table
  async createCustomThresholdsTable() {
    const db = this.getDatabase();
    
    const table = `
      CREATE TABLE IF NOT EXISTS custom_alert_thresholds (
        id TEXT PRIMARY KEY,
        metric_name TEXT NOT NULL,
        threshold_value REAL NOT NULL,
        severity TEXT NOT NULL,
        condition TEXT NOT NULL,
        description TEXT,
        created_by INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_active BOOLEAN DEFAULT 1,
        FOREIGN KEY (created_by) REFERENCES users (id)
      )
    `;
    
    return new Promise((resolve, reject) => {
      db.run(table, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  // Get custom thresholds
  async getCustomThresholds() {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = `
        SELECT * FROM custom_alert_thresholds 
        WHERE is_active = 1 
        ORDER BY created_at DESC
      `;
      
      db.all(query, [], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  // Check custom thresholds
  async checkCustomThresholds(metricType, metricName, value) {
    const thresholds = await this.getCustomThresholds();
    
    for (const threshold of thresholds) {
      if (threshold.metric_name === metricName) {
        let shouldAlert = false;
        
        switch (threshold.condition) {
          case 'greater_than':
            shouldAlert = value > threshold.threshold_value;
            break;
          case 'less_than':
            shouldAlert = value < threshold.threshold_value;
            break;
          case 'equals':
            shouldAlert = Math.abs(value - threshold.threshold_value) < 0.001;
            break;
        }
        
        if (shouldAlert) {
          await this.createPerformanceAlert(
            metricType,
            metricName,
            threshold.severity,
            threshold.threshold_value,
            value,
            { custom_threshold: threshold.id }
          );
        }
      }
    }
  }

  // Enhanced metric recording with custom threshold checking
  async recordMetricEnhanced(metricType, metricName, value, unit, tags = {}, source = 'system', context = {}) {
    const metricId = await this.recordMetric(metricType, metricName, value, unit, tags, source, context);
    
    // Check custom thresholds
    await this.checkCustomThresholds(metricType, metricName, value);
    
    return metricId;
  }

  // Get performance trends
  async getPerformanceTrends(metricName, period = 24, interval = 'hour') {
    const db = this.getDatabase();
    
    const cutoffDate = new Date();
    cutoffDate.setHours(cutoffDate.getHours() - period);
    
    let groupBy;
    switch (interval) {
      case 'hour':
        groupBy = "strftime('%H', timestamp)";
        break;
      case 'day':
        groupBy = "strftime('%Y-%m-%d', timestamp)";
        break;
      case 'minute':
        groupBy = "strftime('%H:%M', timestamp)";
        break;
      default:
        groupBy = "strftime('%H', timestamp)";
    }
    
    return new Promise((resolve, reject) => {
      const query = `
        SELECT 
          ${groupBy} as time_group,
          AVG(metric_value) as avg_value,
          MIN(metric_value) as min_value,
          MAX(metric_value) as max_value,
          COUNT(*) as data_points
        FROM performance_metrics
        WHERE metric_name = ? AND timestamp >= ?
        GROUP BY ${groupBy}
        ORDER BY time_group
      `;
      
      db.all(query, [metricName, cutoffDate.toISOString()], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  // Get system health summary
  async getSystemHealthSummary() {
    try {
      const stats = await this.getPerformanceStats(1); // Last hour
      const alerts = await this.getAlerts('active', null, 10);
      
      const healthScore = calculateHealthScore(stats);
      const status = healthScore >= 90 ? 'healthy' : 
                    healthScore >= 70 ? 'warning' : 
                    healthScore >= 50 ? 'critical' : 'unhealthy';
      
      return {
        status,
        health_score: healthScore,
        active_alerts: alerts.length,
        critical_alerts: alerts.filter(a => a.severity === 'critical').length,
        api_performance: stats.api_performance.performance_level,
        last_updated: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error getting system health summary:', error);
      throw error;
    }
  }

  // Close database connection
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

// Helper function for health score calculation
function calculateHealthScore(stats) {
  let score = 100;
  
  // Deduct points for poor API performance
  if (stats.api_performance.avg_response_time > 1000) score -= 30;
  else if (stats.api_performance.avg_response_time > 500) score -= 15;
  else if (stats.api_performance.avg_response_time > 200) score -= 5;
  
  // Deduct points for high error rate
  if (stats.api_performance.error_rate > 5) score -= 40;
  else if (stats.api_performance.error_rate > 2) score -= 20;
  else if (stats.api_performance.error_rate > 1) score -= 10;
  
  // Deduct points for critical alerts
  if (stats.alerts.critical_alerts > 0) score -= stats.alerts.critical_alerts * 20;
  
  // Deduct points for poor system resources
  Object.entries(stats.system_resources).forEach(([resource, data]) => {
    if (data.status === 'critical') score -= 15;
    else if (data.status === 'poor') score -= 5;
  });
  
  return Math.max(0, score);
}

module.exports = new PerformanceMonitoringService();
