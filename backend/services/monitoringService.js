const promClient = require('prom-client');
const loggingService = require('./loggingService');
const performanceMonitoringService = require('./performanceMonitoringService');
const incidentResponseService = require('./incidentResponseService');
const complianceValidationService = require('./complianceValidationService');

class MonitoringService {
  constructor() {
    this.register = new promClient.Registry();
    promClient.collectDefaultMetrics({ register: this.register });

    // Custom metrics
    this.httpRequestDuration = new promClient.Histogram({
      name: 'http_request_duration_seconds',
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10],
      registers: [this.register]
    });

    this.securityAlertsCounter = new promClient.Counter({
      name: 'security_alerts_total',
      help: 'Total number of security alerts',
      labelNames: ['severity', 'type'],
      registers: [this.register]
    });

    this.complianceScoreGauge = new promClient.Gauge({
      name: 'compliance_score',
      help: 'Current compliance score',
      labelNames: ['framework'],
      registers: [this.register]
    });

    this.activeUsersGauge = new promClient.Gauge({
      name: 'active_users_count',
      help: 'Number of currently active users',
      registers: [this.register]
    });

    // Start background checks
    this.startBackgroundMonitoring();
  }

  startBackgroundMonitoring() {
    // Check performance thresholds every minute
    setInterval(async () => {
      try {
        await this.checkPerformanceThresholds();
      } catch (error) {
        loggingService.error('Performance monitoring check failed', error);
      }
    }, 60000);

    // Check compliance status every hour
    setInterval(async () => {
      try {
        await this.updateComplianceMetrics();
      } catch (error) {
        loggingService.error('Compliance monitoring check failed', error);
      }
    }, 3600000);
  }

  async checkPerformanceThresholds() {
    const stats = await performanceMonitoringService.getPerformanceStats(1); // Last hour
    
    if (stats.api_performance.error_rate > 5) {
      await this.triggerAlert('high_error_rate', 'high', `API error rate is ${stats.api_performance.error_rate}%`);
    }

    if (stats.api_performance.avg_response_time > 500) {
      await this.triggerAlert('high_latency', 'medium', `Average API latency is ${stats.api_performance.avg_response_time}ms`);
    }

    // Check system resources
    for (const [resource, data] of Object.entries(stats.system_resources)) {
      if (data.average > 90) {
        await this.triggerAlert(`critical_${resource}`, 'critical', `${resource} usage is critically high: ${data.average}%`);
      }
    }
  }

  async updateComplianceMetrics() {
    const frameworks = ['hipaa', 'gdpr', 'pci_dss'];
    for (const frameworkId of frameworks) {
      try {
        const result = await complianceValidationService.validateCompliance('system', 'global', frameworkId);
        this.complianceScoreGauge.set({ framework: frameworkId }, result.overall_score);
        
        if (result.overall_score < 80) {
          await this.triggerAlert('compliance_breach', 'high', `Compliance score for ${frameworkId} dropped to ${result.overall_score}%`);
        }
      } catch (error) {
        loggingService.error(`Failed to update compliance metrics for ${frameworkId}`, error);
      }
    }
  }

  async triggerAlert(type, severity, message) {
    loggingService.warn(`Alert triggered: [${severity.toUpperCase()}] ${type} - ${message}`);
    
    // Create security incident for high/critical alerts
    if (severity === 'high' || severity === 'critical') {
      try {
        await incidentResponseService.createIncident({
          incidentType: type,
          severity: severity,
          title: `Automated Alert: ${type}`,
          description: message,
          sourceSystem: 'monitoring-service'
        });
        
        this.securityAlertsCounter.inc({ severity, type });
      } catch (error) {
        loggingService.error('Failed to create security incident for alert', error);
      }
    }
  }

  getMetrics() {
    return this.register.metrics();
  }

  // Middleware for tracking HTTP metrics
  metricsMiddleware() {
    return (req, res, next) => {
      const start = process.hrtime();
      
      res.on('finish', () => {
        const diff = process.hrtime(start);
        const durationSeconds = diff[0] + diff[1] / 1e9;
        
        const route = req.route ? req.route.path : req.path;
        this.httpRequestDuration.observe(
          { 
            method: req.method, 
            route, 
            status_code: res.statusCode 
          }, 
          durationSeconds
        );
      });
      
      next();
    };
  }
}

module.exports = new MonitoringService();
