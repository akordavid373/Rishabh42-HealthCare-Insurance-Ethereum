const request = require('supertest');
const { app, io } = require('../server');
const { initializeDatabase } = require('../database/init');

describe('Healthcare API Tests', () => {
  let server;
  let authToken;
  let testUserId;
  let testPatientId;

  beforeAll(async () => {
    await initializeDatabase();
    server = app.listen(0);
  });

  afterAll(async () => {
    if (server) {
      server.close();
    }
    if (io) {
      io.close();
    }
  });

  describe('Authentication Endpoints', () => {
    test('POST /api/auth/register - Register new user', async () => {
      const userData = {
        email: 'testpatient@example.com',
        password: 'password123',
        firstName: 'John',
        lastName: 'Doe',
        role: 'patient',
        dateOfBirth: '1990-01-01',
        phone: '555-1234-5678'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(201);

      expect(response.body.message).toBe('User registered successfully');
      expect(response.body.user.email).toBe(userData.email);
      expect(response.body.tokens.accessToken).toBeDefined();
      expect(response.body.tokens.refreshToken).toBeDefined();

      authToken = response.body.tokens.accessToken;
      testUserId = response.body.user.id;
    });

    test('POST /api/auth/login - User login', async () => {
      const loginData = {
        email: 'testpatient@example.com',
        password: 'password123'
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(loginData)
        .expect(200);

      expect(response.body.message).toBe('Login successful');
      expect(response.body.user.email).toBe(loginData.email);
      expect(response.body.tokens.accessToken).toBeDefined();
    });

    test('POST /api/auth/login - Invalid credentials', async () => {
      const loginData = {
        email: 'testpatient@example.com',
        password: 'wrongpassword'
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(loginData)
        .expect(401);

      expect(response.body.error).toBe('Invalid credentials');
    });
  });

  describe('Patient Endpoints', () => {
    beforeAll(async () => {
      const patientData = {
        userId: testUserId,
        medicalRecordNumber: 'MRN123456',
        insuranceProvider: 'Test Insurance Co',
        insurancePolicyNumber: 'POL123456',
        emergencyContactName: 'Jane Doe',
        emergencyContactPhone: '555-9876-5432',
        bloodType: 'O+',
        allergies: 'Penicillin',
        medications: 'Lisinopril 10mg'
      };

      const response = await request(app)
        .post('/api/patients')
        .set('Authorization', `Bearer ${authToken}`)
        .send(patientData)
        .expect(201);

      testPatientId = response.body.patientId;
    });

    test('GET /api/patients/dashboard/:patientId - Get dashboard data', async () => {
      const response = await request(app)
        .get(`/api/patients/dashboard/${testPatientId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.first_name).toBe('John');
      expect(response.body.last_name).toBe('Doe');
      expect(response.body.total_medical_records).toBeDefined();
      expect(response.body.total_claims).toBeDefined();
      expect(response.body.upcoming_appointments).toBeDefined();
    });

    test('GET /api/patients/:patientId - Get patient details', async () => {
      const response = await request(app)
        .get(`/api/patients/${testPatientId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.medical_record_number).toBe('MRN123456');
      expect(response.body.insurance_provider).toBe('Test Insurance Co');
    });

    test('PUT /api/patients/:patientId - Update patient profile', async () => {
      const updateData = {
        allergies: 'Penicillin, Sulfa'
      };

      const response = await request(app)
        .put(`/api/patients/${testPatientId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body.message).toBe('Patient profile updated successfully');
    });
  });

  describe('Medical Records Endpoints', () => {
    let recordId;

    test('POST /api/medical-records - Create medical record', async () => {
      const recordData = {
        patientId: testPatientId,
        providerId: testUserId,
        recordType: 'diagnosis',
        title: 'Annual Checkup',
        description: 'Routine annual physical examination',
        diagnosisCode: 'Z00.00',
        dateOfService: '2024-01-15',
        facilityName: 'Test Medical Center',
        notes: 'Patient in good health'
      };

      const response = await request(app)
        .post('/api/medical-records')
        .set('Authorization', `Bearer ${authToken}`)
        .send(recordData)
        .expect(201);

      expect(response.body.message).toBe('Medical record created successfully');
      recordId = response.body.recordId;
    });

    test('GET /api/medical-records/patient/:patientId - Get patient records', async () => {
      const response = await request(app)
        .get(`/api/medical-records/patient/${testPatientId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.records).toBeDefined();
      expect(response.body.pagination).toBeDefined();
      expect(Array.isArray(response.body.records)).toBe(true);
    });

    test('GET /api/medical-records/:recordId - Get specific record', async () => {
      const response = await request(app)
        .get(`/api/medical-records/${recordId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.title).toBe('Annual Checkup');
      expect(response.body.record_type).toBe('diagnosis');
    });
  });

  describe('Insurance Claims Endpoints', () => {
    let claimId;

    test('POST /api/claims - Create insurance claim', async () => {
      const claimData = {
        patientId: testPatientId,
        claimNumber: 'CLM789012',
        serviceDate: '2024-01-15',
        providerName: 'Test Medical Center',
        diagnosisCodes: 'Z00.00',
        procedureCodes: '99396',
        totalAmount: 150.00,
        insuranceAmount: 120.00,
        patientResponsibility: 30.00,
        notes: 'Preventive care visit'
      };

      const response = await request(app)
        .post('/api/claims')
        .set('Authorization', `Bearer ${authToken}`)
        .send(claimData)
        .expect(201);

      expect(response.body.message).toBe('Claim created successfully');
      claimId = response.body.claimId;
    });

    test('GET /api/claims/patient/:patientId - Get patient claims', async () => {
      const response = await request(app)
        .get(`/api/claims/patient/${testPatientId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.claims).toBeDefined();
      expect(response.body.pagination).toBeDefined();
      expect(Array.isArray(response.body.claims)).toBe(true);
    });

    test('GET /api/claims/summary/:patientId - Get claims summary', async () => {
      const response = await request(app)
        .get(`/api/claims/summary/${testPatientId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.total_claims).toBeDefined();
      expect(response.body.total_billed).toBeDefined();
      expect(response.body.total_paid).toBeDefined();
    });

    test('PUT /api/claims/:claimId/status - Update claim status', async () => {
      const updateData = {
        status: 'approved',
        processingDate: new Date().toISOString(),
        paymentDate: new Date().toISOString()
      };

      const response = await request(app)
        .put(`/api/claims/${claimId}/status`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body.message).toBe('Claim status updated successfully');
    });
  });

  describe('Appointments Endpoints', () => {
    let appointmentId;

    test('POST /api/appointments - Schedule appointment', async () => {
      const appointmentData = {
        patientId: testPatientId,
        providerId: testUserId,
        appointmentDate: '2024-12-15T10:00:00Z',
        durationMinutes: 30,
        appointmentType: 'consultation',
        notes: 'Follow-up consultation',
        virtual: false
      };

      const response = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${authToken}`)
        .send(appointmentData)
        .expect(201);

      expect(response.body.message).toBe('Appointment created successfully');
      appointmentId = response.body.appointmentId;
    });

    test('GET /api/appointments/upcoming/:patientId - Get upcoming appointments', async () => {
      const response = await request(app)
        .get(`/api/appointments/upcoming/${testPatientId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });

    test('GET /api/appointments/:appointmentId - Get specific appointment', async () => {
      const response = await request(app)
        .get(`/api/appointments/${appointmentId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.appointment_type).toBe('consultation');
      expect(response.body.virtual).toBe(false);
    });
  });

  describe('Payments Endpoints', () => {
    let paymentId;

    test('POST /api/payments - Record payment', async () => {
      const paymentData = {
        patientId: testPatientId,
        paymentAmount: 250.00,
        paymentDate: '2024-01-01',
        paymentMethod: 'credit_card',
        insuranceProvider: 'Test Insurance Co',
        policyNumber: 'POL123456',
        coveragePeriodStart: '2024-01-01',
        coveragePeriodEnd: '2024-12-31'
      };

      const response = await request(app)
        .post('/api/payments')
        .set('Authorization', `Bearer ${authToken}`)
        .send(paymentData)
        .expect(201);

      expect(response.body.message).toBe('Payment recorded successfully');
      paymentId = response.body.paymentId;
    });

    test('GET /api/payments/patient/:patientId - Get patient payments', async () => {
      const response = await request(app)
        .get(`/api/payments/patient/${testPatientId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.payments).toBeDefined();
      expect(response.body.pagination).toBeDefined();
      expect(Array.isArray(response.body.payments)).toBe(true);
    });

    test('GET /api/payments/summary/:patientId - Get payments summary', async () => {
      const response = await request(app)
        .get(`/api/payments/summary/${testPatientId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.total_payments).toBeDefined();
      expect(response.body.total_amount).toBeDefined();
      expect(response.body.total_paid).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    test('GET /api/protected-endpoint - No token provided', async () => {
      const response = await request(app)
        .get('/api/patients/1')
        .expect(401);

      expect(response.body.error).toBe('Access token required');
    });

    test('GET /api/protected-endpoint - Invalid token', async () => {
      const response = await request(app)
        .get('/api/patients/1')
        .set('Authorization', 'Bearer invalid-token')
        .expect(403);

      expect(response.body.error).toBe('Invalid token');
    });

    test('GET /api/nonexistent - Route not found', async () => {
      const response = await request(app)
        .get('/api/nonexistent')
        .expect(404);
    });
  });

  describe('Health Check', () => {
    test('GET /api/health - Health check endpoint', async () => {
      const response = await request(app)
        .get('/api/health')
        .expect(200);

      expect(response.body.status).toBe('OK');
      expect(response.body.timestamp).toBeDefined();
      expect(response.body.uptime).toBeDefined();
    });
  });
});
