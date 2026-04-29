/**
 * Performance Testing Suite
 * Tests API response times, throughput, and resource usage under load.
 */

const request = require('supertest');
const { app } = require('../server');
const { initializeDatabase } = require('../database/init');

// Performance thresholds (ms)
const THRESHOLDS = {
  fast: 200,    // Simple reads
  medium: 500,  // Complex queries
  slow: 2000,   // Heavy operations
};

describe('Performance Tests', () => {
  let server;
  let authToken;

  beforeAll(async () => {
    await initializeDatabase();
    server = app.listen(0);

    // Get auth token for authenticated endpoints
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: `perf_test_${Date.now()}@example.com`,
        password: 'PerfTest123!',
        firstName: 'Perf',
        lastName: 'Test',
        role: 'patient',
        dateOfBirth: '1990-01-01',
        phone: '555-0000-0001',
      });
    authToken = res.body?.tokens?.accessToken;
  });

  afterAll(() => {
    if (server) server.close();
  });

  describe('Response Time Benchmarks', () => {
    test('Health check endpoint responds within threshold', async () => {
      const start = Date.now();
      await request(app).get('/api/health').expect(200);
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(THRESHOLDS.fast);
    });

    test('Auth login responds within threshold', async () => {
      // Register a user first
      const email = `login_perf_${Date.now()}@example.com`;
      await request(app).post('/api/auth/register').send({
        email,
        password: 'PerfTest123!',
        firstName: 'Login',
        lastName: 'Perf',
        role: 'patient',
        dateOfBirth: '1990-01-01',
        phone: '555-0000-0002',
      });

      const start = Date.now();
      await request(app)
        .post('/api/auth/login')
        .send({ email, password: 'PerfTest123!' });
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(THRESHOLDS.medium);
    });

    test('Patient list endpoint responds within threshold', async () => {
      if (!authToken) return;
      const start = Date.now();
      await request(app)
        .get('/api/patients')
        .set('Authorization', `Bearer ${authToken}`);
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(THRESHOLDS.medium);
    });
  });

  describe('Concurrent Request Handling', () => {
    test('handles 10 concurrent health check requests', async () => {
      const concurrency = 10;
      const start = Date.now();

      const requests = Array.from({ length: concurrency }, () =>
        request(app).get('/api/health')
      );

      const responses = await Promise.all(requests);
      const duration = Date.now() - start;

      const successCount = responses.filter((r) => r.status === 200).length;
      expect(successCount).toBe(concurrency);
      // All 10 concurrent requests should complete within 2s total
      expect(duration).toBeLessThan(2000);
    });

    test('handles 5 concurrent auth requests without errors', async () => {
      const concurrency = 5;
      const requests = Array.from({ length: concurrency }, (_, i) =>
        request(app)
          .post('/api/auth/register')
          .send({
            email: `concurrent_${Date.now()}_${i}@example.com`,
            password: 'ConcTest123!',
            firstName: 'Conc',
            lastName: `User${i}`,
            role: 'patient',
            dateOfBirth: '1990-01-01',
            phone: `555-${String(i).padStart(4, '0')}-0001`,
          })
      );

      const responses = await Promise.all(requests);
      const successCount = responses.filter((r) => r.status === 201).length;
      expect(successCount).toBe(concurrency);
    });
  });

  describe('Throughput Tests', () => {
    test('processes 20 sequential requests within time budget', async () => {
      const count = 20;
      const timeBudget = 10000; // 10 seconds for 20 requests
      const start = Date.now();

      for (let i = 0; i < count; i++) {
        await request(app).get('/api/health');
      }

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(timeBudget);

      const rps = count / (duration / 1000);
      // Should achieve at least 2 requests per second
      expect(rps).toBeGreaterThan(2);
    });
  });

  describe('Memory and Resource Stability', () => {
    test('memory usage stays stable across repeated requests', async () => {
      const initialMemory = process.memoryUsage().heapUsed;

      // Make 50 requests
      for (let i = 0; i < 50; i++) {
        await request(app).get('/api/health');
      }

      // Force GC if available
      if (global.gc) global.gc();

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryGrowthMB = (finalMemory - initialMemory) / 1024 / 1024;

      // Memory growth should be less than 50MB for 50 simple requests
      expect(memoryGrowthMB).toBeLessThan(50);
    });
  });
});
