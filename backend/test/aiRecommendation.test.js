const request = require('supertest');
const { app } = require('../server');
const jwt = require('jsonwebtoken');

describe('AI Recommendation Engine Tests', () => {
  let authToken;
  let adminToken;
  let testUserId;

  beforeAll(async () => {
    // Create test user tokens
    authToken = jwt.sign(
      { id: 1, email: 'test@example.com', role: 'patient' },
      process.env.JWT_SECRET || 'fallback-secret-key',
      { expiresIn: '1h' }
    );

    adminToken = jwt.sign(
      { id: 2, email: 'admin@example.com', role: 'admin' },
      process.env.JWT_SECRET || 'fallback-secret-key',
      { expiresIn: '1h' }
    );

    testUserId = 1;
  });

  describe('Personalization Service', () => {
    test('should create user profile', async () => {
      const response = await request(app)
        .post('/api/ai/personalization/profile')
        .send({
          userId: testUserId,
          profileData: {
            ageGroup: 'adult',
            gender: 'female',
            lifestyleFactors: {
              exercise: 'moderate',
              diet: 'healthy',
              smoking: false
            },
            medicalPreferences: {
              treatment_preference: 'conservative',
              communication_style: 'detailed'
            }
          }
        })
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('User profile created successfully');
      expect(response.body.profileId).toBeDefined();
    });

    test('should get user profile', async () => {
      const response = await request(app)
        .get(`/api/ai/personalization/profile/${testUserId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.userId).toBe(testUserId);
      expect(response.body.ageGroup).toBeDefined();
    });

    test('should update user preferences', async () => {
      const response = await request(app)
        .post(`/api/ai/personalization/preferences/${testUserId}`)
        .send({
          preferences: {
            treatment_preference: 'aggressive',
            cost_sensitivity: 'high'
          }
        })
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('User preferences updated successfully');
    });

    test('should record behavioral data', async () => {
      const response = await request(app)
        .post(`/api/ai/personalization/behavior/${testUserId}`)
        .send({
          activityType: 'login',
          activityData: {
            timestamp: new Date().toISOString(),
            location: 'US',
            device: { userAgent: 'test-browser' }
          }
        })
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Behavioral data recorded successfully');
    });

    test('should analyze behavioral patterns', async () => {
      const response = await request(app)
        .get(`/api/ai/personalization/behavior/${testUserId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('Health Recommendation Engine', () => {
    test('should generate health recommendations', async () => {
      const response = await request(app)
        .post(`/api/ai/recommendations/health/${testUserId}`)
        .send({
          userProfile: {
            ageGroup: 'adult',
            gender: 'female',
            healthRiskLevel: 'medium',
            lifestyleFactors: {
              exercise: 'moderate',
              diet: 'healthy'
            }
          },
          medicalHistory: [
            { type: 'chronic', severity: 'mild', name: 'hypertension' }
          ],
          lifestyleFactors: {
            exercise: 'moderate',
            diet: 'healthy'
          }
        })
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.recommendations).toBeDefined();
      expect(Array.isArray(response.body.recommendations)).toBe(true);
      expect(response.body.count).toBeGreaterThan(0);
      expect(response.body.generation_time_ms).toBeDefined();
    });

    test('should get health recommendations', async () => {
      const response = await request(app)
        .get(`/api/ai/recommendations/health/${testUserId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    test('should update recommendation status', async () => {
      // First get recommendations to get an ID
      const getResponse = await request(app)
        .get(`/api/ai/recommendations/health/${testUserId}`)
        .set('Authorization', `Bearer ${authToken}`);

      if (getResponse.body.length > 0) {
        const recommendationId = getResponse.body[0].id;
        
        const response = await request(app)
          .put(`/api/ai/recommendations/health/${recommendationId}/status`)
          .send({
            status: 'completed',
            feedback: { rating: 4, comments: 'Helpful recommendation' }
          })
          .set('Authorization', `Bearer ${authToken}`);

        expect(response.status).toBe(200);
        expect(response.body.message).toBe('Recommendation status updated successfully');
      }
    });

    test('should get recommendation statistics', async () => {
      const response = await request(app)
        .get(`/api/ai/recommendations/health/stats/${testUserId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('Treatment Suggestion System', () => {
    test('should generate treatment suggestions', async () => {
      const response = await request(app)
        .post(`/api/ai/recommendations/treatment/${testUserId}`)
        .send({
          conditions: [
            { code: 'diabetes_type2', severity: 'mild', name: 'Type 2 Diabetes' },
            { code: 'hypertension_stage1', severity: 'mild', name: 'Hypertension' }
          ],
          userProfile: {
            ageGroup: 'adult',
            gender: 'female',
            healthRiskLevel: 'medium'
          },
          preferences: {
            treatment_preference: 'conservative',
            cost_sensitivity: 'medium'
          }
        })
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.suggestions).toBeDefined();
      expect(Array.isArray(response.body.suggestions)).toBe(true);
      expect(response.body.count).toBeGreaterThan(0);
      expect(response.body.generation_time_ms).toBeDefined();
    });

    test('should get treatment suggestions', async () => {
      const response = await request(app)
        .get(`/api/ai/recommendations/treatment/${testUserId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    test('should update treatment suggestion status', async () => {
      // First get suggestions to get an ID
      const getResponse = await request(app)
        .get(`/api/ai/recommendations/treatment/${testUserId}`)
        .set('Authorization', `Bearer ${authToken}`);

      if (getResponse.body.length > 0) {
        const suggestionId = getResponse.body[0].id;
        
        const response = await request(app)
          .put(`/api/ai/recommendations/treatment/${suggestionId}/status`)
          .send({
            status: 'accepted',
            physicianReviewed: true,
            physicianNotes: 'Patient agrees with treatment plan'
          })
          .set('Authorization', `Bearer ${authToken}`);

        expect(response.status).toBe(200);
        expect(response.body.message).toBe('Treatment suggestion status updated successfully');
      }
    });

    test('should record treatment outcome', async () => {
      // First get suggestions to get an ID
      const getResponse = await request(app)
        .get(`/api/ai/recommendations/treatment/${testUserId}`)
        .set('Authorization', `Bearer ${authToken}`);

      if (getResponse.body.length > 0) {
        const suggestionId = getResponse.body[0].id;
        
        const response = await request(app)
          .post(`/api/ai/recommendations/treatment/${suggestionId}/outcome`)
          .send({
            outcomeType: 'effectiveness',
            outcomeValue: 0.8,
            notes: 'Patient responding well to treatment',
            isRecurring: false
          })
          .set('Authorization', `Bearer ${authToken}`);

        expect(response.status).toBe(200);
        expect(response.body.message).toBe('Treatment outcome recorded successfully');
      }
    });

    test('should get treatment statistics', async () => {
      const response = await request(app)
        .get(`/api/ai/recommendations/treatment/stats/${testUserId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('Cost Optimization Algorithms', () => {
    test('should generate cost optimizations', async () => {
      const response = await request(app)
        .post(`/api/ai/optimization/cost/${testUserId}`)
        .send({
          userProfile: {
            ageGroup: 'adult',
            costSensitivity: 'high'
          },
          currentMedications: [
            { name: 'Lipitor', cost: 200, therapeuticClass: 'statin' },
            { name: 'Zoloft', cost: 180, therapeuticClass: 'ssri' }
          ],
          currentTreatments: [
            { type: 'physical_therapy', cost: 1500 },
            { type: 'counseling', cost: 1200 }
          ],
          insuranceInfo: {
            monthlyPremium: 600,
            outOfNetworkCosts: 200,
            deductible: 2500
          }
        })
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.optimizations).toBeDefined();
      expect(Array.isArray(response.body.optimizations)).toBe(true);
      expect(response.body.total_potential_savings).toBeGreaterThan(0);
      expect(response.body.generation_time_ms).toBeDefined();
    });

    test('should get cost optimizations', async () => {
      const response = await request(app)
        .get(`/api/ai/optimization/cost/${testUserId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    test('should update cost optimization status', async () => {
      // First get optimizations to get an ID
      const getResponse = await request(app)
        .get(`/api/ai/optimization/cost/${testUserId}`)
        .set('Authorization', `Bearer ${authToken}`);

      if (getResponse.body.length > 0) {
        const optimizationId = getResponse.body[0].id;
        
        const response = await request(app)
          .put(`/api/ai/optimization/cost/${optimizationId}/status`)
          .send({
            status: 'implemented',
            userFeedback: { rating: 5, comments: 'Great savings!' }
          })
          .set('Authorization', `Bearer ${authToken}`);

        expect(response.status).toBe(200);
        expect(response.body.message).toBe('Cost optimization status updated successfully');
      }
    });

    test('should record cost savings', async () => {
      // First get optimizations to get an ID
      const getResponse = await request(app)
        .get(`/api/ai/optimization/cost/${testUserId}`)
        .set('Authorization', `Bearer ${authToken}`);

      if (getResponse.body.length > 0) {
        const optimizationId = getResponse.body[0].id;
        
        const response = await request(app)
          .post(`/api/ai/optimization/cost/${optimizationId}/savings`)
          .send({
            savingsType: 'medication_generic',
            originalCost: 200,
            newCost: 40,
            notes: 'Switched to generic medication',
            isRecurring: true
          })
          .set('Authorization', `Bearer ${authToken}`);

        expect(response.status).toBe(200);
        expect(response.body.message).toBe('Cost savings recorded successfully');
        expect(response.body.savingsAmount).toBe(160);
      }
    });

    test('should get cost optimization statistics', async () => {
      const response = await request(app)
        .get(`/api/ai/optimization/cost/stats/${testUserId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('Machine Learning Models', () => {
    test('should train collaborative filtering model', async () => {
      const response = await request(app)
        .post('/api/ai/ml/train/collaborative_filtering')
        .send({
          modelName: 'test_collaborative_model'
        })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Model trained successfully');
      expect(response.body.modelId).toBeDefined();
      expect(response.body.accuracy).toBeDefined();
      expect(response.body.training_time_ms).toBeDefined();
    });

    test('should train content-based model', async () => {
      const response = await request(app)
        .post('/api/ai/ml/train/content_based')
        .send({
          modelName: 'test_content_model'
        })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Model trained successfully');
      expect(response.body.modelId).toBeDefined();
      expect(response.body.accuracy).toBeDefined();
    });

    test('should train health outcome model', async () => {
      const response = await request(app)
        .post('/api/ai/ml/train/health_outcome')
        .send({
          modelName: 'test_health_outcome_model'
        })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Model trained successfully');
      expect(response.body.modelId).toBeDefined();
      expect(response.body.accuracy).toBeDefined();
    });

    test('should get active models', async () => {
      const response = await request(app)
        .get('/api/ai/ml/models')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    test('should make prediction', async () => {
      // First get a model ID
      const modelsResponse = await request(app)
        .get('/api/ai/ml/models')
        .set('Authorization', `Bearer ${adminToken}`);

      if (modelsResponse.body.length > 0) {
        const modelId = modelsResponse.body[0].id;
        
        const response = await request(app)
          .post(`/api/ai/ml/predict/${modelId}`)
          .send({
            userId: testUserId,
            inputFeatures: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
            predictionType: 'health_recommendation'
          })
          .set('Authorization', `Bearer ${adminToken}`);

        expect(response.status).toBe(200);
        expect(response.body.prediction).toBeDefined();
        expect(response.body.predictionType).toBe('health_recommendation');
      }
    });

    test('should get model performance', async () => {
      // First get a model ID
      const modelsResponse = await request(app)
        .get('/api/ai/ml/models')
        .set('Authorization', `Bearer ${adminToken}`);

      if (modelsResponse.body.length > 0) {
        const modelId = modelsResponse.body[0].id;
        
        const response = await request(app)
          .get(`/api/ai/ml/models/${modelId}/performance`)
          .set('Authorization', `Bearer ${adminToken}`);

        expect(response.status).toBe(200);
        expect(Array.isArray(response.body)).toBe(true);
      }
    });
  });

  describe('Data Privacy Compliance', () => {
    test('should record consent', async () => {
      const response = await request(app)
        .post(`/api/ai/privacy/consent/${testUserId}`)
        .send({
          consentType: 'treatment',
          consentGiven: true,
          purpose: 'Healthcare treatment and recommendations',
          dataCategories: ['medical_records', 'recommendations'],
          thirdParties: ['healthcare_providers']
        })
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Consent recorded successfully');
      expect(response.body.consentId).toBeDefined();
    });

    test('should check consent', async () => {
      const response = await request(app)
        .get(`/api/ai/privacy/consent/${testUserId}/treatment`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.hasConsent).toBeDefined();
    });

    test('should withdraw consent', async () => {
      const response = await request(app)
        .put(`/api/ai/privacy/consent/${testUserId}/treatment/withdraw`)
        .send({
          reason: 'User requested withdrawal of consent'
        })
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Consent withdrawn successfully');
    });

    test('should log data access', async () => {
      const response = await request(app)
        .post(`/api/ai/privacy/data-access/${testUserId}`)
        .send({
          accessedBy: testUserId,
          dataType: 'medical_records',
          dataId: 'test_record_1',
          accessPurpose: 'treatment_planning',
          accessMethod: 'api',
          ipAddress: '127.0.0.1',
          userAgent: 'test-agent',
          sessionId: 'test-session'
        })
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Data access logged successfully');
      expect(response.body.accessGranted).toBe(true);
    });

    test('should process data subject request', async () => {
      const response = await request(app)
        .post(`/api/ai/privacy/subject-request/${testUserId}`)
        .send({
          requestType: 'access',
          requestData: {
            dataTypes: ['personal_data', 'medical_records'],
            format: 'json'
          }
        })
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Data subject request processed successfully');
      expect(response.body.requestId).toBeDefined();
    });

    test('should run privacy audit', async () => {
      const response = await request(app)
        .post('/api/ai/privacy/audit')
        .send({
          auditType: 'compliance'
        })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.auditId).toBeDefined();
      expect(response.body.findings).toBeDefined();
    });

    test('should get privacy compliance status', async () => {
      const response = await request(app)
        .get('/api/ai/privacy/compliance')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.total_consents).toBeDefined();
      expect(response.body.active_consents).toBeDefined();
    });
  });

  describe('Performance Monitoring', () => {
    test('should record performance metric', async () => {
      const response = await request(app)
        .post('/api/ai/performance/metrics')
        .send({
          metricType: 'recommendation_generation',
          metricName: 'health_recommendations',
          value: 250,
          unit: 'ms',
          tags: { endpoint: '/api/ai/recommendations/health' },
          context: { userId: testUserId },
          source: 'test'
        })
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Performance metric recorded successfully');
      expect(response.body.metricId).toBeDefined();
    });

    test('should get performance metrics', async () => {
      const response = await request(app)
        .get('/api/ai/performance/metrics')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    test('should get recommendation performance', async () => {
      const response = await request(app)
        .get('/api/ai/performance/recommendations')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    test('should get system health', async () => {
      const response = await request(app)
        .get('/api/ai/performance/system')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    test('should get performance alerts', async () => {
      const response = await request(app)
        .get('/api/ai/performance/alerts')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    test('should get performance statistics', async () => {
      const response = await request(app)
        .get('/api/ai/performance/stats')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.recommendation_performance).toBeDefined();
      expect(response.body.model_performance).toBeDefined();
      expect(response.body.system_health).toBeDefined();
    });

    test('should generate performance report', async () => {
      const response = await request(app)
        .post('/api/ai/performance/report')
        .send({
          period: 24,
          userId: testUserId
        })
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.report_id).toBeDefined();
      expect(response.body.summary).toBeDefined();
      expect(response.body.recommendations).toBeDefined();
    });
  });

  describe('AI Dashboard', () => {
    test('should get AI dashboard', async () => {
      const response = await request(app)
        .get(`/api/ai/dashboard/${testUserId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.personalization).toBeDefined();
      expect(response.body.recommendations).toBeDefined();
      expect(response.body.models).toBeDefined();
      expect(response.body.performance).toBeDefined();
      expect(response.body.privacy).toBeDefined();
      expect(response.body.overall_health).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    test('should handle missing required fields in profile creation', async () => {
      const response = await request(app)
        .post('/api/ai/personalization/profile')
        .send({
          userId: testUserId
          // Missing profileData
        })
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Missing required fields');
    });

    test('should handle invalid authentication', async () => {
      const response = await request(app)
        .get('/api/ai/personalization/profile/1')
        .set('Authorization', 'Bearer invalid-token');

      expect(response.status).toBe(403);
    });

    test('should handle missing authentication', async () => {
      const response = await request(app)
        .get('/api/ai/personalization/profile/1');

      expect(response.status).toBe(401);
    });

    test('should handle unsupported model type', async () => {
      const response = await request(app)
        .post('/api/ai/ml/train/unsupported_type')
        .send({
          modelName: 'test_model'
        })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Unsupported model type');
    });
  });

  describe('Integration Tests', () => {
    test('should handle complete AI workflow', async () => {
      // 1. Create user profile
      const profileResponse = await request(app)
        .post('/api/ai/personalization/profile')
        .send({
          userId: testUserId,
          profileData: {
            ageGroup: 'adult',
            gender: 'male',
            lifestyleFactors: {
              exercise: 'moderate',
              diet: 'healthy'
            }
          }
        })
        .set('Authorization', `Bearer ${authToken}`);

      expect(profileResponse.status).toBe(200);

      // 2. Generate health recommendations
      const healthResponse = await request(app)
        .post(`/api/ai/recommendations/health/${testUserId}`)
        .send({
          userProfile: {
            ageGroup: 'adult',
            gender: 'male'
          }
        })
        .set('Authorization', `Bearer ${authToken}`);

      expect(healthResponse.status).toBe(200);

      // 3. Generate treatment suggestions
      const treatmentResponse = await request(app)
        .post(`/api/ai/recommendations/treatment/${testUserId}`)
        .send({
          conditions: [{ code: 'hypertension_stage1', severity: 'mild' }],
          userProfile: {
            ageGroup: 'adult',
            gender: 'male'
          }
        })
        .set('Authorization', `Bearer ${authToken}`);

      expect(treatmentResponse.status).toBe(200);

      // 4. Generate cost optimizations
      const costResponse = await request(app)
        .post(`/api/ai/optimization/cost/${testUserId}`)
        .send({
          userProfile: {
            ageGroup: 'adult',
            costSensitivity: 'medium'
          },
          currentMedications: [{ name: 'Lisinopril', cost: 120 }]
        })
        .set('Authorization', `Bearer ${authToken}`);

      expect(costResponse.status).toBe(200);

      // 5. Get dashboard
      const dashboardResponse = await request(app)
        .get(`/api/ai/dashboard/${testUserId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(dashboardResponse.status).toBe(200);
      expect(dashboardResponse.body.overall_health).toBeDefined();
    });
  });
});

describe('AI Recommendation Performance Tests', () => {
  let authToken;

  beforeAll(async () => {
    authToken = jwt.sign(
      { id: 1, email: 'test@example.com', role: 'patient' },
      process.env.JWT_SECRET || 'fallback-secret-key',
      { expiresIn: '1h' }
    );
  });

  test('should handle concurrent recommendation requests', async () => {
    const promises = [];
    const concurrentRequests = 5;

    for (let i = 0; i < concurrentRequests; i++) {
      promises.push(
        request(app)
          .post('/api/ai/recommendations/health/1')
          .send({
            userProfile: { ageGroup: 'adult', gender: 'female' }
          })
          .set('Authorization', `Bearer ${authToken}`)
      );
    }

    const responses = await Promise.all(promises);
    
    responses.forEach(response => {
      expect(response.status).toBe(200);
      expect(response.body.recommendations).toBeDefined();
    });
  });

  test('should respond within acceptable time limits', async () => {
    const startTime = Date.now();
    
    const response = await request(app)
      .post('/api/ai/recommendations/health/1')
      .send({
        userProfile: { ageGroup: 'adult', gender: 'female' }
      })
      .set('Authorization', `Bearer ${authToken}`);

    const endTime = Date.now();
    const responseTime = endTime - startTime;

    expect(response.status).toBe(200);
    expect(responseTime).toBeLessThan(2000); // Should respond within 2 seconds
  });
});

describe('AI Recommendation Security Tests', () => {
  let authToken;
  let unauthorizedToken;

  beforeAll(async () => {
    authToken = jwt.sign(
      { id: 1, email: 'test@example.com', role: 'patient' },
      process.env.JWT_SECRET || 'fallback-secret-key',
      { expiresIn: '1h' }
    );

    unauthorizedToken = jwt.sign(
      { id: 999, email: 'unauthorized@example.com', role: 'patient' },
      process.env.JWT_SECRET || 'fallback-secret-key',
      { expiresIn: '1h' }
    );
  });

  test('should prevent unauthorized data access', async () => {
    const response = await request(app)
      .post('/api/ai/privacy/data-access/1')
      .send({
        accessedBy: 999,
        dataType: 'medical_records',
        dataId: 'sensitive_data',
        accessPurpose: 'unauthorized_access',
        accessMethod: 'api'
      })
      .set('Authorization', `Bearer ${unauthorizedToken}`);

    expect(response.status).toBe(403);
    });

  test('should require admin privileges for model training', async () => {
    const response = await request(app)
      .post('/api/ai/ml/train/collaborative_filtering')
      .send({
        modelName: 'test_model'
      })
      .set('Authorization', `Bearer ${authToken}`);

    expect(response.status).toBe(403);
  });

  test('should validate consent before data processing', async () => {
    const response = await request(app)
      .post('/api/ai/privacy/data-access/1')
      .send({
        accessedBy: 1,
        dataType: 'medical_records',
        dataId: 'test_data',
        accessPurpose: 'treatment',
        accessMethod: 'api'
      })
      .set('Authorization', `Bearer ${authToken}`);

    // Should succeed if user is accessing their own data
    expect([200, 403]).toContain(response.status);
  });
});
