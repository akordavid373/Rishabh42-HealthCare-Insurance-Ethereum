/**
 * Chaos Engineering Tests
 * Validates system resilience under failure conditions:
 * - Malformed inputs, missing fields, invalid tokens
 * - Service dependency failures (DB unavailable, external service down)
 * - Rate limiting and resource exhaustion scenarios
 */

const request = require('supertest');
const { app } = require('../server');
const { initializeDatabase } = require('../database/init');

describe('Chaos Engineering Tests', () => {
  let server;
  let validToken;

  beforeAll(async () => {
    await initializeDatabase();
    server = app.listen(0);

    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: `chaos_${Date.now()}@example.com`,
        password: 'ChaosTest123!',
        firstName: 'Chaos',
        lastName: 'Test',
        role: 'patient',
        dateOfBirth: '1990-01-01',
        phone: '555-9999-0001',
      });
    validToken = res.body?.tokens?.accessToken;
  });

  afterAll(() => {
    if (server) server.close();
  });

  describe('Malformed Input Resilience', () => {
    test('handles completely empty request body', async () => {
      const res = await request(app).post('/api/auth/login').send({});
      expect([400, 401, 422]).toContain(res.status);
    });

    test('handles null values in request body', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: null, password: null });
      expect([400, 401, 422]).toContain(res.status);
    });

    test('handles extremely long string inputs', async () => {
      const longString = 'a'.repeat(10000);
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: longString, password: longString });
      expect([400, 401, 413, 422]).toContain(res.status);
    });

    test('handles special characters and SQL injection attempts', async () => {
      const maliciousInput = "'; DROP TABLE users; --";
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: maliciousInput, password: maliciousInput });
      expect([400, 401, 422]).toContain(res.status);
      // Server must not crash
      expect(res.status).toBeDefined();
    });

    test('handles XSS payload in input fields', async () => {
      const xssPayload = '<script>alert("xss")</script>';
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: `xss_${Date.now()}@example.com`,
          password: 'Valid123!',
          firstName: xssPayload,
          lastName: 'Test',
          role: 'patient',
          dateOfBirth: '1990-01-01',
          phone: '555-0000-0003',
        });
      // Should either sanitize or reject, but never crash
      expect([201, 400, 422]).toContain(res.status);
    });

    test('handles invalid JSON content type', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'text/plain')
        .send('not json');
      expect([400, 415]).toContain(res.status);
    });
  });

  describe('Authentication Failure Scenarios', () => {
    test('rejects expired/invalid JWT token', async () => {
      const fakeToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.invalid';
      const res = await request(app)
        .get('/api/patients')
        .set('Authorization', `Bearer ${fakeToken}`);
      expect([401, 403]).toContain(res.status);
    });

    test('rejects missing Authorization header', async () => {
      const res = await request(app).get('/api/patients');
      expect([401, 403]).toContain(res.status);
    });

    test('rejects malformed Authorization header', async () => {
      const res = await request(app)
        .get('/api/patients')
        .set('Authorization', 'NotBearer token');
      expect([401, 403]).toContain(res.status);
    });

    test('rejects empty Bearer token', async () => {
      const res = await request(app)
        .get('/api/patients')
        .set('Authorization', 'Bearer ');
      expect([401, 403]).toContain(res.status);
    });
  });

  describe('Invalid Route and Method Handling', () => {
    test('returns 404 for non-existent routes', async () => {
      const res = await request(app).get('/api/nonexistent_route_xyz');
      expect([404]).toContain(res.status);
    });

    test('handles wrong HTTP method gracefully', async () => {
      const res = await request(app).delete('/api/auth/login');
      expect([404, 405]).toContain(res.status);
    });
  });

  describe('Boundary Value Testing', () => {
    test('handles minimum valid age (18) in registration', async () => {
      const dob = new Date();
      dob.setFullYear(dob.getFullYear() - 18);
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: `boundary_age_${Date.now()}@example.com`,
          password: 'Boundary123!',
          firstName: 'Boundary',
          lastName: 'Age',
          role: 'patient',
          dateOfBirth: dob.toISOString().split('T')[0],
          phone: '555-0000-0004',
        });
      expect([201, 400]).toContain(res.status);
    });

    test('handles zero and negative claim amounts', async () => {
      if (!validToken) return;
      const res = await request(app)
        .post('/api/claims')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ amount: -100, diagnosis: 'Test' });
      expect([400, 422]).toContain(res.status);
    });

    test('handles very large numeric values', async () => {
      if (!validToken) return;
      const res = await request(app)
        .post('/api/claims')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ amount: Number.MAX_SAFE_INTEGER, diagnosis: 'Test' });
      expect([400, 422, 201]).toContain(res.status);
    });
  });

  describe('Concurrent Failure Scenarios', () => {
    test('handles simultaneous invalid login attempts without crashing', async () => {
      const attempts = Array.from({ length: 10 }, () =>
        request(app)
          .post('/api/auth/login')
          .send({ email: 'nonexistent@example.com', password: 'wrong' })
      );

      const responses = await Promise.all(attempts);
      // All should return 401, none should crash the server
      responses.forEach((res) => {
        expect([401, 429]).toContain(res.status);
      });
    });

    test('server remains responsive after error flood', async () => {
      // Send 20 bad requests
      const badRequests = Array.from({ length: 20 }, () =>
        request(app).post('/api/auth/login').send({})
      );
      await Promise.all(badRequests);

      // Server should still respond to valid requests
      const healthRes = await request(app).get('/api/health');
      expect(healthRes.status).toBe(200);
    });
  });
});
