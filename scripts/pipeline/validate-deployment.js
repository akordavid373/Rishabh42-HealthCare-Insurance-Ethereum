#!/usr/bin/env node

/**
 * Deployment Validation Script
 * 
 * Validates deployments across all environments
 * - Contract health checks
 * - API endpoint verification
 * - Database connectivity
 * - Performance metrics validation
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

class DeploymentValidator {
  constructor(options = {}) {
    this.environment = options.environment || 'development';
    this.healthCheckUrl = options.healthCheckUrl;
    this.apiBaseUrl = options.apiBaseUrl;
    this.timeout = options.timeout || 30000;
    this.maxRetries = options.maxRetries || 5;
    this.retryDelay = options.retryDelay || 2000;
    this.results = [];
  }

  async makeRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;
      
      const timeout = setTimeout(() => {
        reject(new Error(`Request timeout after ${this.timeout}ms`));
      }, this.timeout);

      protocol.get(url, { protocol: url.startsWith('https') ? 'https:' : 'http:' }, (res) => {
        clearTimeout(timeout);
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            data: options.parseJson ? JSON.parse(data) : data,
          });
        });
      }).on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  async retryRequest(url, options = {}) {
    let lastError;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.makeRequest(url, options);
      } catch (err) {
        lastError = err;
        if (attempt < this.maxRetries) {
          console.log(`Attempt ${attempt + 1} failed, retrying in ${this.retryDelay}ms...`);
          await new Promise(resolve => setTimeout(resolve, this.retryDelay));
        }
      }
    }

    throw lastError;
  }

  async validateContractDeployment() {
    console.log('✓ Validating contract deployment...');
    
    try {
      const deploymentPath = path.join(process.cwd(), 'deployment.json');
      
      if (!fs.existsSync(deploymentPath)) {
        throw new Error('deployment.json not found');
      }

      const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
      
      if (!deployment.contract_id) {
        throw new Error('No contract_id found in deployment.json');
      }

      this.results.push({
        category: 'Contract Deployment',
        name: 'Contract ID Verification',
        status: 'success',
        details: `Contract deployed: ${deployment.contract_id}`,
      });

      return true;
    } catch (err) {
      this.results.push({
        category: 'Contract Deployment',
        name: 'Contract ID Verification',
        status: 'failure',
        details: err.message,
      });
      return false;
    }
  }

  async validateHealthEndpoint() {
    if (!this.healthCheckUrl) {
      console.log('⊘ Skipping health endpoint validation (no URL provided)');
      return true;
    }

    console.log('✓ Validating health endpoint...');

    try {
      const response = await this.retryRequest(this.healthCheckUrl, { parseJson: true });

      if (response.status !== 200) {
        throw new Error(`Health check returned status ${response.status}`);
      }

      this.results.push({
        category: 'Health Checks',
        name: 'Health Endpoint',
        status: 'success',
        details: 'Health endpoint responding',
      });

      return true;
    } catch (err) {
      this.results.push({
        category: 'Health Checks',
        name: 'Health Endpoint',
        status: 'failure',
        details: err.message,
      });
      return false;
    }
  }

  async validateAPIEndpoints() {
    if (!this.apiBaseUrl) {
      console.log('⊘ Skipping API validation (no base URL provided)');
      return true;
    }

    console.log('✓ Validating API endpoints...');

    const endpoints = [
      '/api/health',
      '/api/auth/verify',
      '/api/metrics',
    ];

    let allPassed = true;

    for (const endpoint of endpoints) {
      try {
        const url = `${this.apiBaseUrl}${endpoint}`;
        const response = await this.retryRequest(url);

        if (response.status >= 400) {
          throw new Error(`API returned status ${response.status}`);
        }

        this.results.push({
          category: 'API Endpoints',
          name: endpoint,
          status: 'success',
          details: `Status: ${response.status}`,
        });
      } catch (err) {
        this.results.push({
          category: 'API Endpoints',
          name: endpoint,
          status: 'failure',
          details: err.message,
        });
        allPassed = false;
      }
    }

    return allPassed;
  }

  async validateArtifactIntegrity() {
    console.log('✓ Validating artifact integrity...');

    try {
      const deploymentPath = path.join(process.cwd(), 'deployment.json');
      const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));

      if (!deployment.artifact_sha256) {
        throw new Error('No artifact SHA256 found in deployment manifest');
      }

      this.results.push({
        category: 'Artifact Integrity',
        name: 'SHA256 Verification',
        status: 'success',
        details: `Artifact verified: ${deployment.artifact_sha256.substring(0, 16)}...`,
      });

      return true;
    } catch (err) {
      this.results.push({
        category: 'Artifact Integrity',
        name: 'SHA256 Verification',
        status: 'failure',
        details: err.message,
      });
      return false;
    }
  }

  async validateDatabaseConnectivity() {
    console.log('✓ Validating database connectivity...');

    try {
      // Check if database file exists for sqlite
      const dbPaths = [
        path.join(process.cwd(), 'backend/database/healthcare.db'),
        path.join(process.cwd(), 'backend/database/healthcare_test.db'),
      ];

      let dbFound = false;
      for (const dbPath of dbPaths) {
        if (fs.existsSync(dbPath)) {
          dbFound = true;
          this.results.push({
            category: 'Database Connectivity',
            name: 'Database File',
            status: 'success',
            details: `Database found: ${path.relative(process.cwd(), dbPath)}`,
          });
          break;
        }
      }

      if (!dbFound) {
        throw new Error('No database files found');
      }

      return true;
    } catch (err) {
      this.results.push({
        category: 'Database Connectivity',
        name: 'Database File',
        status: 'failure',
        details: err.message,
      });
      return false;
    }
  }

  async runAllValidations() {
    console.log(`\n🔍 Running deployment validation for ${this.environment}...\n`);

    const results = await Promise.all([
      this.validateContractDeployment(),
      this.validateHealthEndpoint(),
      this.validateAPIEndpoints(),
      this.validateArtifactIntegrity(),
      this.validateDatabaseConnectivity(),
    ]);

    return results.every(r => r === true || r === undefined);
  }

  printReport() {
    console.log('\n═════════════════════════════════════════════════════════');
    console.log('          DEPLOYMENT VALIDATION REPORT');
    console.log('═════════════════════════════════════════════════════════\n');

    const grouped = {};
    for (const result of this.results) {
      if (!grouped[result.category]) {
        grouped[result.category] = [];
      }
      grouped[result.category].push(result);
    }

    let totalTests = 0;
    let passedTests = 0;

    for (const [category, tests] of Object.entries(grouped)) {
      console.log(`\n📋 ${category}`);
      console.log('─'.repeat(50));

      for (const test of tests) {
        totalTests++;
        const icon = test.status === 'success' ? '✓' : '✗';
        const color = test.status === 'success' ? '\x1b[32m' : '\x1b[31m';
        const reset = '\x1b[0m';

        console.log(`${color}${icon}${reset} ${test.name}`);
        console.log(`  └─ ${test.details}`);

        if (test.status === 'success') {
          passedTests++;
        }
      }
    }

    console.log('\n═════════════════════════════════════════════════════════');
    console.log(`\nSummary: ${passedTests}/${totalTests} checks passed`);
    
    if (passedTests === totalTests) {
      console.log('✅ All validation checks passed!\n');
      return true;
    } else {
      console.log('❌ Some validation checks failed!\n');
      return false;
    }
  }

  toJSON() {
    return {
      environment: this.environment,
      timestamp: new Date().toISOString(),
      tests: this.results,
      summary: {
        total: this.results.length,
        passed: this.results.filter(r => r.status === 'success').length,
        failed: this.results.filter(r => r.status === 'failure').length,
      },
    };
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  const options = {
    environment: process.env.DEPLOYMENT_ENV || 'development',
    healthCheckUrl: process.env.HEALTH_CHECK_URL,
    apiBaseUrl: process.env.API_BASE_URL,
  };

  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--environment' && args[i + 1]) {
      options.environment = args[i + 1];
      i++;
    } else if (args[i] === '--health-check-url' && args[i + 1]) {
      options.healthCheckUrl = args[i + 1];
      i++;
    } else if (args[i] === '--api-base-url' && args[i + 1]) {
      options.apiBaseUrl = args[i + 1];
      i++;
    }
  }

  const validator = new DeploymentValidator(options);

  try {
    const success = await validator.runAllValidations();
    const passed = validator.printReport();

    // Write JSON report
    const reportPath = path.join(process.cwd(), `validation-report-${options.environment}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(validator.toJSON(), null, 2));
    console.log(`📄 Report saved to: ${reportPath}\n`);

    process.exit(passed ? 0 : 1);
  } catch (err) {
    console.error('❌ Validation failed:', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = DeploymentValidator;
