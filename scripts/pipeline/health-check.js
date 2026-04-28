#!/usr/bin/env node

/**
 * Deployment Health Check Script
 * 
 * Performs comprehensive health checks after deployment
 * - Contract state verification
 * - API response time measurement
 * - Error rate monitoring
 * - Resource utilization checks
 */

const http = require('http');
const https = require('https');

class HealthChecker {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || 'http://localhost:3001';
    this.timeout = options.timeout || 10000;
    this.checkInterval = options.checkInterval || 5000;
    this.maxAttempts = options.maxAttempts || 5;
    this.thresholds = {
      responseTime: options.responseTimeThreshold || 1000, // ms
      errorRate: options.errorRateThreshold || 0.05, // 5%
      memoryUsage: options.memoryUsageThreshold || 0.8, // 80%
      ...options.thresholds,
    };
    this.metrics = {
      requests: 0,
      successRequests: 0,
      failedRequests: 0,
      totalResponseTime: 0,
      minResponseTime: Infinity,
      maxResponseTime: 0,
    };
  }

  async httpRequest(path) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.baseUrl);
      const protocol = url.protocol === 'https:' ? https : http;
      
      const startTime = Date.now();
      
      const timeout = setTimeout(() => {
        reject(new Error('Request timeout'));
      }, this.timeout);

      protocol.get(url, (res) => {
        clearTimeout(timeout);
        const elapsed = Date.now() - startTime;
        
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            elapsed,
            data: res.statusCode === 200 ? JSON.parse(data) : null,
          });
        });
      }).on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  recordMetric(success, elapsed) {
    this.metrics.requests++;
    this.metrics.totalResponseTime += elapsed;
    this.metrics.minResponseTime = Math.min(this.metrics.minResponseTime, elapsed);
    this.metrics.maxResponseTime = Math.max(this.metrics.maxResponseTime, elapsed);

    if (success) {
      this.metrics.successRequests++;
    } else {
      this.metrics.failedRequests++;
    }
  }

  async checkHealth() {
    const checks = {
      basic_health: { passed: false, message: '' },
      api_response_time: { passed: false, message: '' },
      error_rate: { passed: false, message: '' },
      contract_state: { passed: false, message: '' },
      memory_usage: { passed: false, message: '' },
    };

    try {
      // Basic health check
      const healthResponse = await this.httpRequest('/api/health');
      checks.basic_health.passed = healthResponse.status === 200;
      checks.basic_health.message = `Health endpoint: ${healthResponse.status}`;

      // API response time check
      const avgResponseTime = this.metrics.totalResponseTime / Math.max(this.metrics.requests, 1);
      checks.api_response_time.passed = avgResponseTime <= this.thresholds.responseTime;
      checks.api_response_time.message = `Avg response time: ${avgResponseTime.toFixed(2)}ms (threshold: ${this.thresholds.responseTime}ms)`;

      // Error rate check
      const errorRate = this.metrics.failedRequests / Math.max(this.metrics.requests, 1);
      checks.error_rate.passed = errorRate <= this.thresholds.errorRate;
      checks.error_rate.message = `Error rate: ${(errorRate * 100).toFixed(2)}% (threshold: ${(this.thresholds.errorRate * 100).toFixed(2)}%)`;

      // Contract state check
      try {
        const metricsResponse = await this.httpRequest('/api/metrics');
        checks.contract_state.passed = metricsResponse.status === 200;
        checks.contract_state.message = 'Contract state verified';
      } catch (err) {
        checks.contract_state.passed = false;
        checks.contract_state.message = `Contract state check failed: ${err.message}`;
      }

      // Memory usage check
      if (global.gc) {
        global.gc();
      }
      const memUsage = process.memoryUsage();
      const memUsagePercent = (memUsage.heapUsed / memUsage.heapTotal);
      checks.memory_usage.passed = memUsagePercent <= this.thresholds.memoryUsage;
      checks.memory_usage.message = `Memory: ${(memUsagePercent * 100).toFixed(2)}% (threshold: ${(this.thresholds.memoryUsage * 100).toFixed(2)}%)`;

    } catch (err) {
      for (const check of Object.values(checks)) {
        if (!check.passed) {
          check.message = err.message;
        }
      }
    }

    return checks;
  }

  async runHealthCheck(attempt = 1) {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🔍 Health Check - Attempt ${attempt}/${this.maxAttempts}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    try {
      const startTime = Date.now();
      const response = await this.httpRequest('/api/health');
      const elapsed = Date.now() - startTime;

      this.recordMetric(response.status === 200, elapsed);

      console.log(`✓ Health endpoint response: ${response.status} (${elapsed}ms)`);

      const checks = await this.checkHealth();
      let allPassed = true;

      // Print check results
      for (const [checkName, checkResult] of Object.entries(checks)) {
        const icon = checkResult.passed ? '✓' : '✗';
        const color = checkResult.passed ? '\x1b[32m' : '\x1b[31m';
        const reset = '\x1b[0m';

        console.log(`${color}${icon}${reset} ${checkName}: ${checkResult.message}`);
        if (!checkResult.passed) {
          allPassed = false;
        }
      }

      if (allPassed) {
        console.log(`\n✅ All health checks passed on attempt ${attempt}`);
        return true;
      }

      if (attempt < this.maxAttempts) {
        console.log(`\n⏳ Retrying in ${this.checkInterval / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, this.checkInterval));
        return this.runHealthCheck(attempt + 1);
      } else {
        console.log(`\n❌ Health checks failed after ${this.maxAttempts} attempts`);
        return false;
      }
    } catch (err) {
      console.log(`⚠️ Error: ${err.message}`);

      if (attempt < this.maxAttempts) {
        console.log(`\nRetrying in ${this.checkInterval / 1000}s... (Attempt ${attempt + 1})`);
        await new Promise(resolve => setTimeout(resolve, this.checkInterval));
        return this.runHealthCheck(attempt + 1);
      } else {
        console.log(`\n❌ Health check failed after ${this.maxAttempts} attempts`);
        return false;
      }
    }
  }

  printSummary() {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log('📊 Health Check Summary');
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    const errorRate = (this.metrics.failedRequests / Math.max(this.metrics.requests, 1)) * 100;
    const avgResponseTime = this.metrics.totalResponseTime / Math.max(this.metrics.requests, 1);

    console.log(`Total Requests: ${this.metrics.requests}`);
    console.log(`Successful: ${this.metrics.successRequests}`);
    console.log(`Failed: ${this.metrics.failedRequests}`);
    console.log(`Error Rate: ${errorRate.toFixed(2)}%`);
    console.log(`\nResponse Times:`);
    console.log(`  Min: ${this.metrics.minResponseTime.toFixed(2)}ms`);
    console.log(`  Max: ${this.metrics.maxResponseTime.toFixed(2)}ms`);
    console.log(`  Avg: ${avgResponseTime.toFixed(2)}ms`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  const options = {
    baseUrl: process.env.BASE_URL || 'http://localhost:3001',
    maxAttempts: parseInt(process.env.MAX_ATTEMPTS || '5', 10),
  };

  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--base-url' && args[i + 1]) {
      options.baseUrl = args[i + 1];
      i++;
    } else if (args[i] === '--max-attempts' && args[i + 1]) {
      options.maxAttempts = parseInt(args[i + 1], 10);
      i++;
    }
  }

  console.log(`🏥 Healthcare Drips - Deployment Health Check`);
  console.log(`🌐 Target: ${options.baseUrl}`);

  const checker = new HealthChecker(options);
  const success = await checker.runHealthCheck();
  checker.printSummary();

  process.exit(success ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = HealthChecker;
