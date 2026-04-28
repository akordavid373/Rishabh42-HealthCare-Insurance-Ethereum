#!/usr/bin/env node

/**
 * Environment Configuration Manager
 * Manages configuration across multiple environments
 */

const fs = require('fs');
const path = require('path');

const ENVIRONMENTS = {
  development: {
    name: 'Development',
    branch: 'develop',
    network: 'testnet',
    apiBaseUrl: 'http://localhost:3001',
    healthCheckUrl: 'http://localhost:3001/api/health',
    autoDeployOnPush: true,
    requiresApproval: false,
    performanceThresholds: {
      responseTime: 2000,
      errorRate: 0.1,
    },
    retention: {
      artifacts: 30,
      deployments: 30,
      logs: 7,
    },
  },
  staging: {
    name: 'Staging',
    branch: 'main',
    network: 'testnet',
    apiBaseUrl: 'https://staging-api.example.com',
    healthCheckUrl: 'https://staging-api.example.com/api/health',
    autoDeployOnPush: true,
    requiresApproval: true,
    performanceThresholds: {
      responseTime: 1000,
      errorRate: 0.05,
    },
    retention: {
      artifacts: 60,
      deployments: 60,
      logs: 30,
    },
  },
  production: {
    name: 'Production',
    branch: 'main',
    network: 'mainnet',
    apiBaseUrl: 'https://api.example.com',
    healthCheckUrl: 'https://api.example.com/api/health',
    autoDeployOnPush: false,
    requiresApproval: true,
    requiresVoting: true,
    performanceThresholds: {
      responseTime: 500,
      errorRate: 0.01,
    },
    retention: {
      artifacts: 365,
      deployments: 365,
      logs: 90,
    },
    preDeploymentSteps: [
      'run-full-test-suite',
      'security-audit',
      'performance-baseline',
      'backup-database',
    ],
    postDeploymentSteps: [
      'validate-contract',
      'verify-endpoints',
      'smoke-tests',
      'monitor-metrics',
    ],
  },
};

class EnvironmentConfig {
  constructor(environment) {
    if (!ENVIRONMENTS[environment]) {
      throw new Error(`Unknown environment: ${environment}`);
    }
    this.env = environment;
    this.config = ENVIRONMENTS[environment];
  }

  getConfig() {
    return this.config;
  }

  getEnvVars() {
    return {
      DEPLOYMENT_ENV: this.env.toUpperCase(),
      ENVIRONMENT_NAME: this.config.name,
      STELLAR_NETWORK: this.config.network,
      API_BASE_URL: this.config.apiBaseUrl,
      HEALTH_CHECK_URL: this.config.healthCheckUrl,
      AUTO_DEPLOY: this.config.autoDeployOnPush ? 'true' : 'false',
      REQUIRES_APPROVAL: this.config.requiresApproval ? 'true' : 'false',
      RESPONSE_TIME_THRESHOLD: this.config.performanceThresholds.responseTime,
      ERROR_RATE_THRESHOLD: this.config.performanceThresholds.errorRate,
    };
  }

  validatePrerequisites() {
    const required = ['STELLAR_SECRET_KEY', 'STELLAR_PUBLIC_KEY', 'STELLAR_RPC_URL'];
    const missing = required.filter(key => !process.env[`${key}_${this.env.toUpperCase()}`]);

    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }

    return true;
  }

  getSecrets() {
    const envUpper = this.env.toUpperCase();
    return {
      secretKey: process.env[`STELLAR_SECRET_KEY_${envUpper}`],
      publicKey: process.env[`STELLAR_PUBLIC_KEY_${envUpper}`],
      rpcUrl: process.env[`STELLAR_RPC_URL_${envUpper}`],
    };
  }

  requiresPreDeploymentSteps() {
    return (this.config.preDeploymentSteps || []).length > 0;
  }

  getPreDeploymentSteps() {
    return this.config.preDeploymentSteps || [];
  }

  getPostDeploymentSteps() {
    return this.config.postDeploymentSteps || [];
  }

  meetsPerformanceThresholds(metrics) {
    const { responseTime, errorRate } = metrics;
    const thresholds = this.config.performanceThresholds;

    return {
      responseTimeOk: responseTime <= thresholds.responseTime,
      errorRateOk: errorRate <= thresholds.errorRate,
      allOk: responseTime <= thresholds.responseTime && errorRate <= thresholds.errorRate,
    };
  }

  getRetentionPolicies() {
    return this.config.retention;
  }

  static getAll() {
    return Object.keys(ENVIRONMENTS);
  }

  static getConfig(environment) {
    return new EnvironmentConfig(environment);
  }

  static listAll() {
    console.log('\n📋 Available Environments:\n');
    for (const [env, config] of Object.entries(ENVIRONMENTS)) {
      console.log(`  ${env.padEnd(15)} - ${config.name}`);
      console.log(`    Branch: ${config.branch}`);
      console.log(`    Network: ${config.network}`);
      console.log(`    URL: ${config.apiBaseUrl}`);
      console.log('');
    }
  }

  static exportConfig(environment, outputPath) {
    const config = new EnvironmentConfig(environment);
    const data = {
      environment,
      config: config.getConfig(),
      envVars: config.getEnvVars(),
    };

    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
    console.log(`✓ Configuration exported to: ${outputPath}`);
  }

  static validateEnvironment(environment) {
    try {
      const config = new EnvironmentConfig(environment);
      config.validatePrerequisites();
      console.log(`✓ Environment '${environment}' is valid`);
      return true;
    } catch (err) {
      console.error(`✗ Environment '${environment}' validation failed: ${err.message}`);
      return false;
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  try {
    if (command === 'list') {
      EnvironmentConfig.listAll();
    } else if (command === 'export' && args[1] && args[2]) {
      EnvironmentConfig.exportConfig(args[1], args[2]);
    } else if (command === 'validate' && args[1]) {
      const valid = EnvironmentConfig.validateEnvironment(args[1]);
      process.exit(valid ? 0 : 1);
    } else if (command === 'config' && args[1]) {
      const config = EnvironmentConfig.getConfig(args[1]);
      console.log(JSON.stringify(config.getConfig(), null, 2));
    } else {
      console.log(`
Usage:
  node scripts/pipeline/config.js list                           # List all environments
  node scripts/pipeline/config.js config <environment>           # Show config for environment
  node scripts/pipeline/config.js export <environment> <output>  # Export config to file
  node scripts/pipeline/config.js validate <environment>         # Validate environment setup
      `);
      process.exit(1);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = EnvironmentConfig;
