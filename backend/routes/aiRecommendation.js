const express = require('express');
const { body, query, validationResult } = require('express-validator');
const personalizationService = require('../services/personalizationService');
const healthRecommendationService = require('../services/healthRecommendationService');
const treatmentSuggestionService = require('../services/treatmentSuggestionService');
const costOptimizationService = require('../services/costOptimizationService');
const machineLearningService = require('../services/machineLearningService');
const dataPrivacyService = require('../services/dataPrivacyService');
const aiPerformanceMonitoringService = require('../services/aiPerformanceMonitoringService');
const { setCache, deleteCache } = require('../middleware/cache');

const router = express.Router();

// Initialize all AI services
async function initializeServices() {
  try {
    await personalizationService.initializeTables();
    await healthRecommendationService.initializeTables();
    await treatmentSuggestionService.initializeTables();
    await costOptimizationService.initializeTables();
    await machineLearningService.initializeTables();
    await dataPrivacyService.initializeTables();
    await aiPerformanceMonitoringService.initializeTables();
    console.log('AI recommendation services initialized successfully');
  } catch (error) {
    console.error('Error initializing AI services:', error);
  }
}

// Initialize services on module load
initializeServices();

// Personalization Routes
router.post('/personalization/profile', async (req, res, next) => {
  const { userId, profileData } = req.body;
  
  try {
    if (!userId || !profileData) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['userId', 'profileData']
      });
    }

    const profileId = await personalizationService.createUserProfile(userId, profileData);
    
    res.json({
      message: 'User profile created successfully',
      profileId: profileId,
      userId: userId
    });
  } catch (error) {
    console.error('Error creating user profile:', error);
    next(error);
  }
});

router.get('/personalization/profile/:userId', async (req, res, next) => {
  const { userId } = req.params;
  
  try {
    const profile = await personalizationService.getUserProfile(userId);
    
    if (!profile) {
      return res.status(404).json({
        error: 'Profile not found',
        userId: userId
      });
    }
    
    setCache(req.originalUrl, profile);
    res.json(profile);
  } catch (error) {
    console.error('Error getting user profile:', error);
    next(error);
  }
});

router.post('/personalization/preferences/:userId', async (req, res, next) => {
  const { userId } = req.params;
  const { preferences } = req.body;
  
  try {
    if (!preferences) {
      return res.status(400).json({
        error: 'Missing required field',
        required: ['preferences']
      });
    }

    await personalizationService.updateUserPreferences(userId, preferences);
    
    res.json({
      message: 'User preferences updated successfully',
      userId: userId
    });
  } catch (error) {
    console.error('Error updating user preferences:', error);
    next(error);
  }
});

router.post('/personalization/behavior/:userId', async (req, res, next) => {
  const { userId } = req.params;
  const { activityType, activityData, sessionId } = req.body;
  
  try {
    if (!activityType || !activityData) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['activityType', 'activityData']
      });
    }

    const recordId = await personalizationService.recordBehavioralData(userId, activityType, activityData, sessionId);
    
    res.json({
      message: 'Behavioral data recorded successfully',
      recordId: recordId,
      userId: userId
    });
  } catch (error) {
    console.error('Error recording behavioral data:', error);
    next(error);
  }
});

router.get('/personalization/behavior/:userId', async (req, res, next) => {
  const { userId } = req.params;
  const { days = 30 } = req.query;
  
  try {
    const patterns = await personalizationService.analyzeBehavioralPatterns(userId, parseInt(days));
    
    setCache(req.originalUrl, patterns);
    res.json(patterns);
  } catch (error) {
    console.error('Error analyzing behavioral patterns:', error);
    next(error);
  }
});

router.put('/personalization/behavior/:userId/patterns', async (req, res, next) => {
  const { userId } = req.params;
  
  try {
    const patterns = await personalizationService.updateBehavioralPatterns(userId);
    
    res.json({
      message: 'Behavioral patterns updated successfully',
      patterns: patterns
    });
  } catch (error) {
    console.error('Error updating behavioral patterns:', error);
    next(error);
  }
});

// Health Recommendation Routes
router.post('/recommendations/health/:userId', async (req, res, next) => {
  const { userId } = req.params;
  const { userProfile, medicalHistory, lifestyleFactors } = req.body;
  
  try {
    if (!userProfile) {
      return res.status(400).json({
        error: 'Missing required field',
        required: ['userProfile']
      });
    }

    const startTime = Date.now();
    const recommendations = await healthRecommendationService.generateHealthRecommendations(
      userId, userProfile, medicalHistory || [], lifestyleFactors || {}
    );
    const generationTime = Date.now() - startTime;

    // Record performance
    await aiPerformanceMonitoringService.recordRecommendationPerformance(
      userId, 'health', generationTime, null, null, null, null, { timestamp: new Date().toISOString() }
    );

    res.json({
      recommendations: recommendations,
      count: recommendations.length,
      generated_at: new Date().toISOString(),
      generation_time_ms: generationTime
    });
  } catch (error) {
    console.error('Error generating health recommendations:', error);
    next(error);
  }
});

router.get('/recommendations/health/:userId', async (req, res, next) => {
  const { userId } = req.params;
  const { status = 'pending', limit = 20 } = req.query;
  
  try {
    const recommendations = await healthRecommendationService.getUserRecommendations(userId, status, parseInt(limit));
    
    setCache(req.originalUrl, recommendations);
    res.json(recommendations);
  } catch (error) {
    console.error('Error getting health recommendations:', error);
    next(error);
  }
});

router.put('/recommendations/health/:recommendationId/status', async (req, res, next) => {
  const { recommendationId } = req.params;
  const { status, feedback } = req.body;
  
  try {
    if (!status) {
      return res.status(400).json({
        error: 'Missing required field',
        required: ['status']
      });
    }

    await healthRecommendationService.updateRecommendationStatus(recommendationId, status, feedback);
    
    deleteCache(`/api/ai/recommendations/health/*`);
    
    res.json({
      message: 'Recommendation status updated successfully',
      recommendationId: recommendationId,
      status: status
    });
  } catch (error) {
    console.error('Error updating recommendation status:', error);
    next(error);
  }
});

router.get('/recommendations/health/stats/:userId?', async (req, res, next) => {
  const { userId } = req.params;
  const { period = 30 } = req.query;
  
  try {
    const stats = await healthRecommendationService.getRecommendationStats(userId, parseInt(period));
    
    setCache(req.originalUrl, stats);
    res.json(stats);
  } catch (error) {
    console.error('Error getting recommendation stats:', error);
    next(error);
  }
});

// Treatment Suggestion Routes
router.post('/recommendations/treatment/:userId', async (req, res, next) => {
  const { userId } = req.params;
  const { conditions, userProfile, preferences } = req.body;
  
  try {
    if (!conditions || !Array.isArray(conditions)) {
      return res.status(400).json({
        error: 'Missing required field',
        required: ['conditions']
      });
    }

    const startTime = Date.now();
    const suggestions = await treatmentSuggestionService.generateTreatmentSuggestions(
      userId, conditions, userProfile || {}, preferences || {}
    );
    const generationTime = Date.now() - startTime;

    // Record performance
    await aiPerformanceMonitoringService.recordRecommendationPerformance(
      userId, 'treatment', generationTime, null, null, null, null, { timestamp: new Date().toISOString() }
    );

    res.json({
      suggestions: suggestions,
      count: suggestions.length,
      generated_at: new Date().toISOString(),
      generation_time_ms: generationTime
    });
  } catch (error) {
    console.error('Error generating treatment suggestions:', error);
    next(error);
  }
});

router.get('/recommendations/treatment/:userId', async (req, res, next) => {
  const { userId } = req.params;
  const { status = 'suggested', limit = 20 } = req.query;
  
  try {
    const suggestions = await treatmentSuggestionService.getUserTreatmentSuggestions(userId, status, parseInt(limit));
    
    setCache(req.originalUrl, suggestions);
    res.json(suggestions);
  } catch (error) {
    console.error('Error getting treatment suggestions:', error);
    next(error);
  }
});

router.put('/recommendations/treatment/:suggestionId/status', async (req, res, next) => {
  const { suggestionId } = req.params;
  const { status, physicianReviewed = false, physicianNotes = null } = req.body;
  
  try {
    if (!status) {
      return res.status(400).json({
        error: 'Missing required field',
        required: ['status']
      });
    }

    await treatmentSuggestionService.updateTreatmentSuggestionStatus(suggestionId, status, physicianReviewed, physicianNotes);
    
    deleteCache(`/api/ai/recommendations/treatment/*`);
    
    res.json({
      message: 'Treatment suggestion status updated successfully',
      suggestionId: suggestionId,
      status: status
    });
  } catch (error) {
    console.error('Error updating treatment suggestion status:', error);
    next(error);
  }
});

router.post('/recommendations/treatment/:suggestionId/outcome', async (req, res, next) => {
  const { suggestionId } = req.params;
  const { outcomeType, outcomeValue, notes, isRecurring = false } = req.body;
  
  try {
    if (!outcomeType || outcomeValue === undefined) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['outcomeType', 'outcomeValue']
      });
    }

    const outcomeId = await treatmentSuggestionService.recordTreatmentOutcome(suggestionId, null, outcomeType, outcomeValue, isRecurring, notes);
    
    res.json({
      message: 'Treatment outcome recorded successfully',
      outcomeId: outcomeId,
      suggestionId: suggestionId
    });
  } catch (error) {
    console.error('Error recording treatment outcome:', error);
    next(error);
  }
});

router.get('/recommendations/treatment/stats/:userId?', async (req, res, next) => {
  const { userId } = req.params;
  const { period = 30 } = req.query;
  
  try {
    const stats = await treatmentSuggestionService.getTreatmentStats(userId, parseInt(period));
    
    setCache(req.originalUrl, stats);
    res.json(stats);
  } catch (error) {
    console.error('Error getting treatment stats:', error);
    next(error);
  }
});

// Cost Optimization Routes
router.post('/optimization/cost/:userId', async (req, res, next) => {
  const { userId } = req.params;
  const { currentMedications, currentTreatments, insuranceInfo, userProfile } = req.body;
  
  try {
    if (!userProfile) {
      return res.status(400).json({
        error: 'Missing required field',
        required: ['userProfile']
      });
    }

    const startTime = Date.now();
    const optimizations = await costOptimizationService.generateCostOptimizations(
      userId, userProfile, currentMedications || [], currentTreatments || [], insuranceInfo || {}
    );
    const generationTime = Date.now() - startTime;

    // Record performance
    await aiPerformanceMonitoringService.recordRecommendationPerformance(
      userId, 'cost_optimization', generationTime, null, null, null, null, { timestamp: new Date().toISOString() }
    );

    res.json({
      optimizations: optimizations,
      count: optimizations.length,
      total_potential_savings: optimizations.reduce((sum, opt) => sum + opt.potentialSavings, 0),
      generated_at: new Date().toISOString(),
      generation_time_ms: generationTime
    });
  } catch (error) {
    console.error('Error generating cost optimizations:', error);
    next(error);
  }
});

router.get('/optimization/cost/:userId', async (req, res, next) => {
  const { userId } = req.params;
  const { status = 'suggested', limit = 20 } = req.query;
  
  try {
    const optimizations = await costOptimizationService.getUserCostOptimizations(userId, status, parseInt(limit));
    
    setCache(req.originalUrl, optimizations);
    res.json(optimizations);
  } catch (error) {
    console.error('Error getting cost optimizations:', error);
    next(error);
  }
});

router.put('/optimization/cost/:optimizationId/status', async (req, res, next) => {
  const { optimizationId } = req.params;
  const { status, userFeedback } = req.body;
  
  try {
    if (!status) {
      return res.status(400).json({
        error: 'Missing required field',
        required: ['status']
      });
    }

    await costOptimizationService.updateOptimizationStatus(optimizationId, status, userFeedback);
    
    deleteCache(`/api/ai/optimization/cost/*`);
    
    res.json({
      message: 'Cost optimization status updated successfully',
      optimizationId: optimizationId,
      status: status
    });
  } catch (error) {
    console.error('Error updating cost optimization status:', error);
    next(error);
  }
});

router.post('/optimization/cost/:optimizationId/savings', async (req, res, next) => {
  const { optimizationId } = req.params;
  const { savingsType, originalCost, newCost, notes, isRecurring = false } = req.body;
  
  try {
    if (!savingsType || originalCost === undefined || newCost === undefined) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['savingsType', 'originalCost', 'newCost']
      });
    }

    const savingsId = await costOptimizationService.recordCostSavings(optimizationId, savingsType, originalCost, newCost, isRecurring, notes);
    
    res.json({
      message: 'Cost savings recorded successfully',
      savingsId: savingsId,
      savingsAmount: originalCost - newCost
    });
  } catch (error) {
    console.error('Error recording cost savings:', error);
    next(error);
  }
});

router.get('/optimization/cost/stats/:userId?', async (req, res, next) => {
  const { userId } = req.params;
  const { period = 90 } = req.query;
  
  try {
    const stats = await costOptimizationService.getCostSavingsStats(userId, parseInt(period));
    
    setCache(req.originalUrl, stats);
    res.json(stats);
  } catch (error) {
    console.error('Error getting cost optimization stats:', error);
    next(error);
  }
});

// Machine Learning Routes
router.post('/ml/train/:modelType', async (req, res, next) => {
  const { modelType } = req.params;
  const { modelName } = req.body;
  
  try {
    let result;
    const startTime = Date.now();
    
    switch (modelType) {
      case 'collaborative_filtering':
        result = await machineLearningService.trainCollaborativeFilteringModel(modelName);
        break;
      case 'content_based':
        result = await machineLearningService.trainContentBasedModel(modelName);
        break;
      case 'health_outcome':
        result = await machineLearningService.trainHealthOutcomeModel(modelName);
        break;
      default:
        return res.status(400).json({
          error: 'Unsupported model type',
          supportedTypes: ['collaborative_filtering', 'content_based', 'health_outcome']
        });
    }
    
    const trainingTime = Date.now() - startTime;
    
    // Record model performance
    await aiPerformanceMonitoringService.recordModelPerformance(
      result.modelId, modelType, modelName, trainingTime, result.accuracy, result.precision, result.recall, result.f1Score, 0, 0
    );

    res.json({
      message: 'Model trained successfully',
      modelId: result.modelId,
      modelName: result.modelName,
      modelType: modelType,
      accuracy: result.accuracy,
      precision: result.precision,
      recall: result.recall,
      f1Score: result.f1Score,
      training_time_ms: trainingTime
    });
  } catch (error) {
    console.error('Error training model:', error);
    next(error);
  }
});

router.post('/ml/predict/:modelId', async (req, res, next) => {
  const { modelId } = req.params;
  const { userId, inputFeatures, predictionType } = req.body;
  
  try {
    if (!userId || !inputFeatures || !predictionType) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['userId', 'inputFeatures', 'predictionType']
      });
    }

    const prediction = await machineLearningService.getModelPrediction(modelId, userId, inputFeatures, predictionType);
    
    res.json({
      prediction: prediction,
      modelId: modelId,
      userId: userId,
      predictionType: predictionType,
      generated_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error making prediction:', error);
    next(error);
  }
});

router.get('/ml/models', async (req, res, next) => {
  const { modelType } = req.query;
  
  try {
    const models = await machineLearningService.getActiveModels(modelType);
    
    setCache(req.originalUrl, models);
    res.json(models);
  } catch (error) {
    console.error('Error getting models:', error);
    next(error);
  }
});

router.get('/ml/models/:modelId/performance', async (req, res, next) => {
  const { modelId } = req.params;
  const { period = 30 } = req.query;
  
  try {
    const performance = await machineLearningService.getModelPerformance(modelId, parseInt(period));
    
    setCache(req.originalUrl, performance);
    res.json(performance);
  } catch (error) {
    console.error('Error getting model performance:', error);
    next(error);
  }
});

// Data Privacy Routes
router.post('/privacy/consent/:userId', async (req, res, next) => {
  const { userId } = req.params;
  const { consentType, consentGiven, purpose, dataCategories, thirdParties, expiryDate } = req.body;
  
  try {
    if (!consentType || consentGiven === undefined || !purpose || !dataCategories) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['consentType', 'consentGiven', 'purpose', 'dataCategories']
      });
    }

    const consentId = await dataPrivacyService.recordConsent(userId, consentType, consentGiven, purpose, dataCategories, thirdParties, expiryDate);
    
    res.json({
      message: 'Consent recorded successfully',
      consentId: consentId,
      userId: userId,
      consentType: consentType,
      consentGiven: consentGiven
    });
  } catch (error) {
    console.error('Error recording consent:', error);
    next(error);
  }
});

router.get('/privacy/consent/:userId/:consentType', async (req, res, next) => {
  const { userId, consentType } = req.params;
  
  try {
    const consent = await dataPrivacyService.checkConsent(userId, consentType);
    
    setCache(req.originalUrl, consent);
    res.json(consent);
  } catch (error) {
    console.error('Error checking consent:', error);
    next(error);
  }
});

router.put('/privacy/consent/:userId/:consentType/withdraw', async (req, res, next) => {
  const { userId, consentType } = req.params;
  const { reason } = req.body;
  
  try {
    await dataPrivacyService.withdrawConsent(userId, consentType, reason);
    
    res.json({
      message: 'Consent withdrawn successfully',
      userId: userId,
      consentType: consentType
    });
  } catch (error) {
    console.error('Error withdrawing consent:', error);
    next(error);
  }
});

router.post('/privacy/data-access/:userId', async (req, res, next) => {
  const { userId } = req.params;
  const { accessedBy, dataType, dataId, accessPurpose, accessMethod, ipAddress, userAgent, sessionId } = req.body;
  
  try {
    if (!accessedBy || !dataType || !dataId || !accessPurpose || !accessMethod) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['accessedBy', 'dataType', 'dataId', 'accessPurpose', 'accessMethod']
      });
    }

    // Check permissions
    const permissions = await dataPrivacyService.checkDataAccessPermissions(userId, accessedBy, dataType, accessPurpose);
    
    if (!permissions.hasPermission) {
      return res.status(403).json({
        error: 'Access denied',
        reason: permissions.reason
      });
    }

    // Log access
    const logId = await dataPrivacyService.logDataAccess(userId, accessedBy, dataType, dataId, accessPurpose, accessMethod, true, ipAddress, userAgent, sessionId);
    
    res.json({
      message: 'Data access logged successfully',
      logId: logId,
      accessGranted: true,
      reason: permissions.reason
    });
  } catch (error) {
    console.error('Error logging data access:', error);
    next(error);
  }
});

router.post('/privacy/subject-request/:userId', async (req, res, next) => {
  const { userId } = req.params;
  const { requestType, requestData } = req.body;
  
  try {
    if (!requestType || !requestData) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['requestType', 'requestData']
      });
    }

    const result = await dataPrivacyService.processDataSubjectRequest(userId, requestType, requestData);
    
    res.json({
      message: 'Data subject request processed successfully',
      requestId: result.requestId,
      status: result.status,
      data: result.data
    });
  } catch (error) {
    console.error('Error processing data subject request:', error);
    next(error);
  }
});

router.post('/privacy/audit', async (req, res, next) => {
  const { auditType = 'compliance' } = req.body;
  
  try {
    const audit = await dataPrivacyService.runPrivacyAudit(auditType);
    
    res.json(audit);
  } catch (error) {
    console.error('Error running privacy audit:', error);
    next(error);
  }
});

router.get('/privacy/compliance', async (req, res, next) => {
  try {
    const compliance = await dataPrivacyService.getPrivacyComplianceStatus();
    
    setCache(req.originalUrl, compliance);
    res.json(compliance);
  } catch (error) {
    console.error('Error getting privacy compliance status:', error);
    next(error);
  }
});

// Performance Monitoring Routes
router.post('/performance/metrics', async (req, res, next) => {
  const { metricType, metricName, value, unit, tags, context, source } = req.body;
  
  try {
    if (!metricType || !metricName || value === undefined || !unit) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['metricType', 'metricName', 'value', 'unit']
      });
    }

    const metricId = await aiPerformanceMonitoringService.recordMetric(metricType, metricName, value, unit, tags || {}, context || {}, source || 'api');
    
    res.json({
      message: 'Performance metric recorded successfully',
      metricId: metricId
    });
  } catch (error) {
    console.error('Error recording performance metric:', error);
    next(error);
  }
});

router.get('/performance/metrics', async (req, res, next) => {
  const { metricType, metricName, period = 24, limit = 1000 } = req.query;
  
  try {
    const metrics = await aiPerformanceMonitoringService.getMetrics(metricType, metricName, parseInt(period), parseInt(limit));
    
    setCache(req.originalUrl, metrics);
    res.json(metrics);
  } catch (error) {
    console.error('Error getting performance metrics:', error);
    next(error);
  }
});

router.get('/performance/recommendations', async (req, res, next) => {
  const { userId, period = 24, limit = 1000 } = req.query;
  
  try {
    const performance = await aiPerformanceMonitoringService.getRecommendationPerformance(userId, parseInt(period), parseInt(limit));
    
    setCache(req.originalUrl, performance);
    res.json(performance);
  } catch (error) {
    console.error('Error getting recommendation performance:', error);
    next(error);
  }
});

router.get('/performance/models', async (req, res, next) => {
  const { modelId, period = 24, limit = 100 } = req.query;
  
  try {
    const performance = await aiPerformanceMonitoringService.getModelPerformance(modelId, parseInt(period), parseInt(limit));
    
    setCache(req.originalUrl, performance);
    res.json(performance);
  } catch (error) {
    console.error('Error getting model performance:', error);
    next(error);
  }
});

router.get('/performance/system', async (req, res, next) => {
  const { period = 24, limit = 1000 } = req.query;
  
  try {
    const health = await aiPerformanceMonitoringService.getSystemHealth(parseInt(period), parseInt(limit));
    
    setCache(req.originalUrl, health);
    res.json(health);
  } catch (error) {
    console.error('Error getting system health:', error);
    next(error);
  }
});

router.get('/performance/alerts', async (req, res, next) => {
  const { status = 'active', severity, limit = 50 } = req.query;
  
  try {
    const alerts = await aiPerformanceMonitoringService.getAlerts(status, severity, parseInt(limit));
    
    setCache(req.originalUrl, alerts);
    res.json(alerts);
  } catch (error) {
    console.error('Error getting performance alerts:', error);
    next(error);
  }
});

router.get('/performance/stats', async (req, res, next) => {
  const { period = 24 } = req.query;
  
  try {
    const stats = await aiPerformanceMonitoringService.getPerformanceStats(parseInt(period));
    
    setCache(req.originalUrl, stats);
    res.json(stats);
  } catch (error) {
    console.error('Error getting performance stats:', error);
    next(error);
  }
});

router.post('/performance/report', async (req, res, next) => {
  const { period = 24, userId } = req.body;
  
  try {
    const report = await aiPerformanceMonitoringService.generatePerformanceReport(parseInt(period), userId);
    
    res.json(report);
  } catch (error) {
    console.error('Error generating performance report:', error);
    next(error);
  }
});

// AI Dashboard Summary
router.get('/dashboard/:userId', async (req, res, next) => {
  const { userId } = req.params;
  const { period = 24 } = req.query;
  
  try {
    // Get comprehensive AI overview
    const [
      personalizationProfile,
      healthRecommendations,
      treatmentSuggestions,
      costOptimizations,
      modelPerformance,
      performanceStats,
      complianceStatus
    ] = await Promise.all([
      personalizationService.getUserProfile(userId),
      healthRecommendationService.getUserRecommendations(userId, 'pending', 5),
      treatmentSuggestionService.getUserTreatmentSuggestions(userId, 'suggested', 5),
      costOptimizationService.getUserCostOptimizations(userId, 'suggested', 5),
      machineLearningService.getActiveModels(),
      aiPerformanceMonitoringService.getPerformanceStats(parseInt(period)),
      dataPrivacyService.getPrivacyComplianceStatus()
    ]);

    const dashboard = {
      personalization: {
        profile: personalizationProfile,
        has_profile: !!personalizationProfile
      },
      recommendations: {
        health: healthRecommendations,
        treatment: treatmentSuggestions,
        cost_optimization: costOptimizations,
        total_count: healthRecommendations.length + treatmentSuggestions.length + costOptimizations.length
      },
      models: {
        active_models: modelPerformance,
        total_count: modelPerformance.length
      },
      performance: performanceStats,
      privacy: complianceStatus,
      overall_health: {
        ai_score: this.calculateOverallAIScore(performanceStats),
        risk_level: this.calculateOverallRiskLevel(performanceStats),
        compliance_status: complianceStatus.total_consents > 0 ? 'compliant' : 'pending',
        last_updated: new Date().toISOString()
      }
    };

    setCache(req.originalUrl, dashboard);
    res.json(dashboard);
  } catch (error) {
    console.error('Error getting AI dashboard:', error);
    next(error);
  }
});

// Helper functions for dashboard
function calculateOverallAIScore(performanceStats) {
  let score = 100;
  
  // Deduct points for poor performance
  if (performanceStats.recommendation_performance.avg_generation_time > 1000) {
    score -= 10;
  }
  
  if (performanceStats.model_performance.avg_accuracy < 0.8) {
    score -= 15;
  }
  
  if (performanceStats.system_health.avg_cpu_usage > 80) {
    score -= 10;
  }
  
  if (performanceStats.alerts.critical_alerts > 0) {
    score -= performanceStats.alerts.critical_alerts * 5;
  }
  
  return Math.max(0, Math.min(100, score));
}

function calculateOverallRiskLevel(performanceStats) {
  const criticalAlerts = performanceStats.alerts.critical_alerts || 0;
  const avgAccuracy = performanceStats.model_performance.avg_accuracy || 0;
  const avgCpuUsage = performanceStats.system_health.avg_cpu_usage || 0;
  
  if (criticalAlerts > 0 || avgAccuracy < 0.5 || avgCpuUsage > 90) {
    return 'critical';
  }
  
  if (criticalAlerts > 2 || avgAccuracy < 0.7 || avgCpuUsage > 70) {
    return 'high';
  }
  
  if (avgAccuracy < 0.8 || avgCpuUsage > 50) {
    return 'medium';
  }
  
  return 'low';
}

module.exports = router;
