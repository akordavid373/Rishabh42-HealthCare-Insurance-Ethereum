/**
 * Comprehensive Test Script for All Four Issue Implementations
 * 
 * This script tests:
 * #45 API Monitoring and Analytics
 * #38 Email Service Integration  
 * #50 Real-time Data Processing Pipeline
 * #41 Rate Limiting and Throttling
 */

const http = require('http');

// Test configuration
const BASE_URL = 'http://localhost:5000';
const TEST_USER = {
  id: 'test-user-123',
  email: 'test@example.com',
  role: 'admin'
};

// Test results tracking
const testResults = {
  apiMonitoring: { passed: 0, failed: 0, errors: [] },
  emailService: { passed: 0, failed: 0, errors: [] },
  realTimeProcessing: { passed: 0, failed: 0, errors: [] },
  rateLimiting: { passed: 0, failed: 0, errors: [] }
};

// Helper function to make HTTP requests
function makeRequest(path, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 5000,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer mock-token-${TEST_USER.id}`
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const jsonBody = body ? JSON.parse(body) : {};
          resolve({ status: res.statusCode, data: jsonBody });
        } catch (e) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

// Test helper functions
function logTest(category, testName, passed, error = null) {
  const status = passed ? 'PASS' : 'FAIL';
  console.log(`[${category.toUpperCase()}] ${testName}: ${status}`);
  
  if (passed) {
    testResults[category].passed++;
  } else {
    testResults[category].failed++;
    if (error) {
      testResults[category].errors.push(`${testName}: ${error}`);
      console.error(`  Error: ${error}`);
    }
  }
}

// API Monitoring and Analytics Tests (#45)
async function testAPIMonitoring() {
  console.log('\n=== Testing API Monitoring and Analytics (#45) ===');
  
  try {
    // Test 1: Get real-time metrics
    const metricsResponse = await makeRequest('/api/monitoring/metrics/realtime');
    logTest('apiMonitoring', 'Get real-time metrics', 
      metricsResponse.status === 200, 
      metricsResponse.status !== 200 ? `Status: ${metricsResponse.status}` : null);

    // Test 2: Get API performance analytics
    const analyticsResponse = await makeRequest('/api/monitoring/analytics/api-performance');
    logTest('apiMonitoring', 'Get API performance analytics', 
      analyticsResponse.status === 200,
      analyticsResponse.status !== 200 ? `Status: ${analyticsResponse.status}` : null);

    // Test 3: Get dashboard data
    const dashboardResponse = await makeRequest('/api/monitoring/dashboard');
    logTest('apiMonitoring', 'Get dashboard data', 
      dashboardResponse.status === 200,
      dashboardResponse.status !== 200 ? `Status: ${dashboardResponse.status}` : null);

    // Test 4: Get performance reports
    const reportsResponse = await makeRequest('/api/monitoring/reports');
    logTest('apiMonitoring', 'Get performance reports', 
      reportsResponse.status === 200,
      reportsResponse.status !== 200 ? `Status: ${reportsResponse.status}` : null);

    // Test 5: Get active alerts
    const alertsResponse = await makeRequest('/api/monitoring/alerts');
    logTest('apiMonitoring', 'Get active alerts', 
      alertsResponse.status === 200,
      alertsResponse.status !== 200 ? `Status: ${alertsResponse.status}` : null);

  } catch (error) {
    logTest('apiMonitoring', 'API Monitoring connection test', false, error.message);
  }
}

// Email Service Integration Tests (#38)
async function testEmailService() {
  console.log('\n=== Testing Email Service Integration (#38) ===');
  
  try {
    // Test 1: Create email template
    const templateData = {
      name: 'Test Template',
      subject: 'Test Subject',
      html_body: '<h1>Test HTML Body</h1>',
      text_body: 'Test Text Body',
      variables: ['name', 'message'],
      category: 'test'
    };
    
    const templateResponse = await makeRequest('/api/email/templates', 'POST', templateData);
    logTest('emailService', 'Create email template', 
      templateResponse.status === 201,
      templateResponse.status !== 201 ? `Status: ${templateResponse.status}` : null);

    // Test 2: Get email templates
    const templatesResponse = await makeRequest('/api/email/templates');
    logTest('emailService', 'Get email templates', 
      templatesResponse.status === 200,
      templatesResponse.status !== 200 ? `Status: ${templatesResponse.status}` : null);

    // Test 3: Send immediate email
    const emailData = {
      to: 'test@example.com',
      subject: 'Test Email',
      html_body: '<h1>Test Email</h1>',
      template_name: 'Test Template',
      variables: { name: 'Test User', message: 'This is a test' }
    };
    
    const sendResponse = await makeRequest('/api/email/send', 'POST', emailData);
    logTest('emailService', 'Send immediate email', 
      sendResponse.status === 200,
      sendResponse.status !== 200 ? `Status: ${sendResponse.status}` : null);

    // Test 4: Schedule email campaign
    const campaignData = {
      name: 'Test Campaign',
      template_id: 'test-template-id',
      schedule_type: 'immediate',
      recipients: [
        { email: 'test1@example.com', name: 'Test User 1' },
        { email: 'test2@example.com', name: 'Test User 2' }
      ]
    };
    
    const campaignResponse = await makeRequest('/api/email/campaigns', 'POST', campaignData);
    logTest('emailService', 'Schedule email campaign', 
      campaignResponse.status === 201,
      campaignResponse.status !== 201 ? `Status: ${campaignResponse.status}` : null);

    // Test 5: Get email analytics
    const analyticsResponse = await makeRequest('/api/email/analytics');
    logTest('emailService', 'Get email analytics', 
      analyticsResponse.status === 200,
      analyticsResponse.status !== 200 ? `Status: ${analyticsResponse.status}` : null);

  } catch (error) {
    logTest('emailService', 'Email Service connection test', false, error.message);
  }
}

// Real-time Data Processing Pipeline Tests (#50)
async function testRealTimeProcessing() {
  console.log('\n=== Testing Real-time Data Processing Pipeline (#50) ===');
  
  try {
    // Test 1: Create stream configuration
    const streamConfigData = {
      name: 'Test Stream',
      data_type: 'test_data',
      source_system: 'test_system',
      processing_rules: [
        { type: 'transform', field_mappings: { output_field: 'input_field' } }
      ],
      anomaly_rules: [
        { type: 'threshold', field: 'value', max: 100 }
      ],
      alert_rules: [
        { anomaly_type: 'all', min_severity: 'medium' }
      ]
    };
    
    const streamConfigResponse = await makeRequest('/api/realtime/streams/config', 'POST', streamConfigData);
    logTest('realTimeProcessing', 'Create stream configuration', 
      streamConfigResponse.status === 201,
      streamConfigResponse.status !== 201 ? `Status: ${streamConfigResponse.status}` : null);

    // Test 2: Process stream data
    const streamData = {
      stream_id: 'test-stream-id',
      data_type: 'test_data',
      payload: JSON.stringify({ value: 50, timestamp: Date.now() }),
      source: 'test_source',
      metadata: { test: true }
    };
    
    const processDataResponse = await makeRequest('/api/realtime/streams/data', 'POST', streamData);
    logTest('realTimeProcessing', 'Process stream data', 
      processDataResponse.status === 201,
      processDataResponse.status !== 201 ? `Status: ${processDataResponse.status}` : null);

    // Test 3: Get real-time analytics
    const analyticsResponse = await makeRequest('/api/realtime/analytics');
    logTest('realTimeProcessing', 'Get real-time analytics', 
      analyticsResponse.status === 200,
      analyticsResponse.status !== 200 ? `Status: ${analyticsResponse.status}` : null);

    // Test 4: Get active alerts
    const alertsResponse = await makeRequest('/api/realtime/alerts');
    logTest('realTimeProcessing', 'Get active alerts', 
      alertsResponse.status === 200,
      alertsResponse.status !== 200 ? `Status: ${alertsResponse.status}` : null);

    // Test 5: Get system metrics
    const metricsResponse = await makeRequest('/api/realtime/metrics');
    logTest('realTimeProcessing', 'Get system metrics', 
      metricsResponse.status === 200,
      metricsResponse.status !== 200 ? `Status: ${metricsResponse.status}` : null);

    // Test 6: Optimize performance
    const optimizeData = {
      enable_auto_scaling: true,
      batch_size: 50
    };
    
    const optimizeResponse = await makeRequest('/api/realtime/optimize', 'POST', optimizeData);
    logTest('realTimeProcessing', 'Optimize performance', 
      optimizeResponse.status === 200,
      optimizeResponse.status !== 200 ? `Status: ${optimizeResponse.status}` : null);

  } catch (error) {
    logTest('realTimeProcessing', 'Real-time Processing connection test', false, error.message);
  }
}

// Rate Limiting and Throttling Tests (#41)
async function testRateLimiting() {
  console.log('\n=== Testing Rate Limiting and Throttling (#41) ===');
  
  try {
    // Test 1: Create rate limit configuration
    const rateLimitConfigData = {
      name: 'Test Rate Limit',
      scope: 'per_user',
      limit_type: 'per_minute',
      max_requests: 10,
      window_size: 60,
      priority: 1
    };
    
    const configResponse = await makeRequest('/api/rate-limiting/configs', 'POST', rateLimitConfigData);
    logTest('rateLimiting', 'Create rate limit configuration', 
      configResponse.status === 201,
      configResponse.status !== 201 ? `Status: ${configResponse.status}` : null);

    // Test 2: Check rate limit
    const checkResponse = await makeRequest('/api/rate-limiting/check?identifier=test-user&endpoint=/api/test');
    logTest('rateLimiting', 'Check rate limit', 
      checkResponse.status === 200,
      checkResponse.status !== 200 ? `Status: ${checkResponse.status}` : null);

    // Test 3: Add whitelist entry
    const whitelistData = {
      identifier: '192.168.1.100',
      type: 'ip',
      unlimited: false,
      custom_limit: 1000,
      reason: 'Test whitelist entry'
    };
    
    const whitelistResponse = await makeRequest('/api/rate-limiting/whitelist', 'POST', whitelistData);
    logTest('rateLimiting', 'Add whitelist entry', 
      whitelistResponse.status === 201,
      whitelistResponse.status !== 201 ? `Status: ${whitelistResponse.status}` : null);

    // Test 4: Get rate limiting statistics
    const statsResponse = await makeRequest('/api/rate-limiting/statistics');
    logTest('rateLimiting', 'Get rate limiting statistics', 
      statsResponse.status === 200,
      statsResponse.status !== 200 ? `Status: ${statsResponse.status}` : null);

    // Test 5: Get system metrics
    const metricsResponse = await makeRequest('/api/rate-limiting/metrics');
    logTest('rateLimiting', 'Get system metrics', 
      metricsResponse.status === 200,
      metricsResponse.status !== 200 ? `Status: ${metricsResponse.status}` : null);

    // Test 6: Get health status
    const healthResponse = await makeRequest('/api/rate-limiting/health');
    logTest('rateLimiting', 'Get health status', 
      healthResponse.status === 200,
      healthResponse.status !== 200 ? `Status: ${healthResponse.status}` : null);

    // Test 7: Test rate limiting by making multiple requests
    console.log('Testing rate limiting with multiple requests...');
    let rateLimitHit = false;
    
    for (let i = 0; i < 15; i++) {
      const response = await makeRequest('/api/rate-limiting/check?identifier=test-user-ratelimit&endpoint=/api/test');
      if (response.status === 429) {
        rateLimitHit = true;
        break;
      }
    }
    
    logTest('rateLimiting', 'Rate limiting enforcement', rateLimitHit, 
      rateLimitHit ? 'Rate limit properly enforced' : 'Rate limit not triggered');

  } catch (error) {
    logTest('rateLimiting', 'Rate Limiting connection test', false, error.message);
  }
}

// Integration test to check all services work together
async function testIntegration() {
  console.log('\n=== Testing Integration Between Services ===');
  
  try {
    // Test that all services are accessible
    const healthEndpoints = [
      '/api/health',
      '/api/monitoring/health',
      '/api/rate-limiting/health'
    ];
    
    for (const endpoint of healthEndpoints) {
      try {
        const response = await makeRequest(endpoint);
        logTest('integration', `Health check: ${endpoint}`, 
          response.status === 200,
          response.status !== 200 ? `Status: ${response.status}` : null);
      } catch (error) {
        logTest('integration', `Health check: ${endpoint}`, false, error.message);
      }
    }

    // Test that services can interact (e.g., monitoring can track rate limiting)
    console.log('Testing cross-service functionality...');
    
    // Make a request that should be tracked by monitoring and potentially rate limited
    const testResponse = await makeRequest('/api/monitoring/metrics/realtime');
    logTest('integration', 'Cross-service request tracking', 
      testResponse.status === 200,
      testResponse.status !== 200 ? `Status: ${testResponse.status}` : null);

  } catch (error) {
    logTest('integration', 'Integration test', false, error.message);
  }
}

// Print test summary
function printTestSummary() {
  console.log('\n' + '='.repeat(80));
  console.log('TEST SUMMARY');
  console.log('='.repeat(80));
  
  let totalPassed = 0;
  let totalFailed = 0;
  
  Object.entries(testResults).forEach(([category, results]) => {
    console.log(`\n${category.toUpperCase()}:`);
    console.log(`  Passed: ${results.passed}`);
    console.log(`  Failed: ${results.failed}`);
    
    if (results.errors.length > 0) {
      console.log('  Errors:');
      results.errors.forEach(error => console.log(`    - ${error}`));
    }
    
    totalPassed += results.passed;
    totalFailed += results.failed;
  });
  
  console.log('\nOVERALL:');
  console.log(`  Total Passed: ${totalPassed}`);
  console.log(`  Total Failed: ${totalFailed}`);
  console.log(`  Success Rate: ${((totalPassed / (totalPassed + totalFailed)) * 100).toFixed(2)}%`);
  
  if (totalFailed === 0) {
    console.log('\nAll tests PASSED! All four issue implementations are working correctly.');
  } else {
    console.log(`\n${totalFailed} tests failed. Please review the errors above.`);
  }
  
  console.log('='.repeat(80));
}

// Main test runner
async function runAllTests() {
  console.log('Starting comprehensive test suite for all four issue implementations...');
  console.log('Make sure the server is running on http://localhost:5000');
  
  try {
    await testAPIMonitoring();
    await testEmailService();
    await testRealTimeProcessing();
    await testRateLimiting();
    await testIntegration();
    
    printTestSummary();
  } catch (error) {
    console.error('Test suite failed:', error);
  }
}

// Run tests if this script is executed directly
if (require.main === module) {
  runAllTests();
}

module.exports = {
  runAllTests,
  testAPIMonitoring,
  testEmailService,
  testRealTimeProcessing,
  testRateLimiting,
  testIntegration,
  testResults
};
