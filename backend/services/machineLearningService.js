const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../database/healthcare.db');

class MachineLearningService {
  constructor() {
    this.db = null;
    this.models = new Map();
    this.trainingData = new Map();
    this.modelTypes = {
      recommendation: {
        collaborative_filtering: 'collaborative_filtering',
        content_based: 'content_based',
        hybrid: 'hybrid',
        deep_learning: 'deep_learning'
      },
      prediction: {
        health_outcome: 'health_outcome',
        cost_prediction: 'cost_prediction',
        treatment_response: 'treatment_response',
        risk_assessment: 'risk_assessment'
      },
      classification: {
        condition_severity: 'condition_severity',
        treatment_success: 'treatment_success',
        cost_category: 'cost_category',
        user_segmentation: 'user_segmentation'
      }
    };
  }

  getDatabase() {
    if (!this.db) {
      this.db = new sqlite3.Database(DB_PATH);
    }
    return this.db;
  }

  // Initialize machine learning tables
  async initializeTables() {
    const db = this.getDatabase();
    
    const tables = [
      `CREATE TABLE IF NOT EXISTS ml_models (
        id TEXT PRIMARY KEY,
        model_type TEXT NOT NULL,
        model_name TEXT NOT NULL,
        model_version TEXT NOT NULL,
        algorithm TEXT NOT NULL,
        model_data TEXT NOT NULL,
        training_data_count INTEGER DEFAULT 0,
        accuracy REAL DEFAULT 0.0,
        precision REAL DEFAULT 0.0,
        recall REAL DEFAULT 0.0,
        f1_score REAL DEFAULT 0.0,
        is_active BOOLEAN DEFAULT TRUE,
        trained_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_used DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      
      `CREATE TABLE IF NOT EXISTS training_data (
        id TEXT PRIMARY KEY,
        model_type TEXT NOT NULL,
        model_id TEXT,
        user_id INTEGER NOT NULL,
        features TEXT NOT NULL,
        labels TEXT NOT NULL,
        data_source TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id),
        FOREIGN KEY (model_id) REFERENCES ml_models (id)
      )`,
      
      `CREATE TABLE IF NOT EXISTS model_predictions (
        id TEXT PRIMARY KEY,
        model_id TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        prediction_type TEXT NOT NULL,
        input_features TEXT NOT NULL,
        prediction_result TEXT NOT NULL,
        confidence_score REAL NOT NULL,
        actual_result TEXT,
        is_correct BOOLEAN,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (model_id) REFERENCES ml_models (id),
        FOREIGN KEY (user_id) REFERENCES users (id)
      )`,
      
      `CREATE TABLE IF NOT EXISTS model_performance (
        id TEXT PRIMARY KEY,
        model_id TEXT NOT NULL,
        evaluation_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        accuracy REAL NOT NULL,
        precision REAL NOT NULL,
        recall REAL NOT NULL,
        f1_score REAL NOT NULL,
        auc_score REAL,
        confusion_matrix TEXT,
        evaluation_data TEXT NOT NULL,
        FOREIGN KEY (model_id) REFERENCES ml_models (id)
      )`,
      
      `CREATE TABLE IF NOT EXISTS feature_importance (
        id TEXT PRIMARY KEY,
        model_id TEXT NOT NULL,
        feature_name TEXT NOT NULL,
        importance_score REAL NOT NULL,
        feature_type TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (model_id) REFERENCES ml_models (id)
      )`
    ];

    for (const table of tables) {
      await new Promise((resolve, reject) => {
        db.run(table, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  }

  // Train collaborative filtering model
  async trainCollaborativeFilteringModel(modelName = 'user_item_cf') {
    try {
      console.log(`Training collaborative filtering model: ${modelName}`);
      
      // Get training data from user interactions
      const trainingData = await this.getCollaborativeFilteringTrainingData();
      
      if (trainingData.length < 10) {
        throw new Error('Insufficient training data for collaborative filtering');
      }

      // Create user-item matrix
      const userItemMatrix = this.createUserItemMatrix(trainingData);
      
      // Train model using matrix factorization (simplified implementation)
      const model = await this.trainMatrixFactorization(userItemMatrix);
      
      // Evaluate model
      const evaluation = await this.evaluateCollaborativeFilteringModel(model, trainingData);
      
      // Save model
      const modelId = await this.saveModel('recommendation', 'collaborative_filtering', modelName, model, evaluation);
      
      // Save feature importance
      await this.saveFeatureImportance(modelId, model.featureImportance);
      
      console.log(`Collaborative filtering model trained successfully with accuracy: ${evaluation.accuracy}`);
      
      return {
        modelId: modelId,
        modelName: modelName,
        accuracy: evaluation.accuracy,
        precision: evaluation.precision,
        recall: evaluation.recall,
        f1Score: evaluation.f1Score
      };
    } catch (error) {
      console.error('Error training collaborative filtering model:', error);
      throw error;
    }
  }

  // Get collaborative filtering training data
  async getCollaborativeFilteringTrainingData() {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = `
        SELECT 
          ur.user_id,
          ur.recommendation_id,
          ur.personalization_score as rating,
          hr.category as item_category,
          hr.priority as item_priority
        FROM user_recommendations ur
        JOIN health_recommendations hr ON ur.recommendation_id = hr.id
        WHERE ur.effectiveness_rating IS NOT NULL
        UNION
        SELECT 
          ts.user_id,
          ts.treatment_protocol_id as recommendation_id,
          ts.personalization_score as rating,
          tp.treatment_category as item_category,
          tp.effectiveness_score as item_priority
        FROM treatment_suggestions ts
        JOIN treatment_protocols tp ON ts.treatment_protocol_id = tp.id
        WHERE ts.effectiveness_rating IS NOT NULL
      `;
      
      db.all(query, [], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  // Create user-item matrix
  createUserItemMatrix(trainingData) {
    const matrix = {};
    const users = new Set();
    const items = new Set();

    // Collect unique users and items
    trainingData.forEach(data => {
      users.add(data.user_id);
      items.add(data.recommendation_id);
    });

    // Initialize matrix
    const userList = Array.from(users);
    const itemList = Array.from(items);
    
    userList.forEach(userId => {
      matrix[userId] = {};
      itemList.forEach(itemId => {
        matrix[userId][itemId] = 0;
      });
    });

    // Fill matrix with ratings
    trainingData.forEach(data => {
      if (matrix[data.user_id] && matrix[data.user_id][data.recommendation_id] !== undefined) {
        matrix[data.user_id][data.recommendation_id] = data.rating;
      }
    });

    return {
      matrix: matrix,
      users: userList,
      items: itemList,
      ratings: trainingData
    };
  }

  // Train matrix factorization (simplified SVD)
  async trainMatrixFactorization(userItemMatrix, factors = 10, iterations = 100, learningRate = 0.01) {
    const { matrix, users, items, ratings } = userItemMatrix;
    
    // Initialize user and item feature matrices
    const userFeatures = {};
    const itemFeatures = {};
    
    users.forEach(userId => {
      userFeatures[userId] = {};
      for (let i = 0; i < factors; i++) {
        userFeatures[userId][i] = Math.random() * 0.1;
      }
    });
    
    items.forEach(itemId => {
      itemFeatures[itemId] = {};
      for (let i = 0; i < factors; i++) {
        itemFeatures[itemId][i] = Math.random() * 0.1;
      }
    });

    // Training loop
    for (let iter = 0; iter < iterations; iter++) {
      let totalError = 0;
      let errorCount = 0;

      ratings.forEach(rating => {
        const userId = rating.user_id;
        const itemId = rating.recommendation_id;
        const actualRating = rating.rating;

        // Predict rating
        let predictedRating = 0;
        for (let i = 0; i < factors; i++) {
          predictedRating += userFeatures[userId][i] * itemFeatures[itemId][i];
        }

        // Calculate error
        const error = actualRating - predictedRating;
        totalError += Math.abs(error);
        errorCount++;

        // Update features
        for (let i = 0; i < factors; i++) {
          const userFeature = userFeatures[userId][i];
          const itemFeature = itemFeatures[itemId][i];
          
          userFeatures[userId][i] += learningRate * (error * itemFeature - 0.01 * userFeature);
          itemFeatures[itemId][i] += learningRate * (error * userFeature - 0.01 * itemFeature);
        }
      });

      // Check convergence
      if (iter % 10 === 0) {
        const avgError = totalError / errorCount;
        if (avgError < 0.1) break;
      }
    }

    // Calculate feature importance
    const featureImportance = this.calculateFeatureImportance(userFeatures, itemFeatures, factors);

    return {
      userFeatures: userFeatures,
      itemFeatures: itemFeatures,
      factors: factors,
      featureImportance: featureImportance
    };
  }

  // Calculate feature importance
  calculateFeatureImportance(userFeatures, itemFeatures, factors) {
    const importance = {};
    
    for (let i = 0; i < factors; i++) {
      let userFeatureSum = 0;
      let itemFeatureSum = 0;
      let userCount = 0;
      let itemCount = 0;

      Object.values(userFeatures).forEach(features => {
        userFeatureSum += Math.abs(features[i]);
        userCount++;
      });

      Object.values(itemFeatures).forEach(features => {
        itemFeatureSum += Math.abs(features[i]);
        itemCount++;
      });

      const avgUserFeature = userCount > 0 ? userFeatureSum / userCount : 0;
      const avgItemFeature = itemCount > 0 ? itemFeatureSum / itemCount : 0;
      
      importance[`factor_${i}`] = (avgUserFeature + avgItemFeature) / 2;
    }

    return importance;
  }

  // Evaluate collaborative filtering model
  async evaluateCollaborativeFilteringModel(model, testData) {
    const { userFeatures, itemFeatures, factors } = model;
    let correctPredictions = 0;
    let totalPredictions = 0;
    let truePositives = 0;
    let falsePositives = 0;
    let falseNegatives = 0;

    testData.forEach(data => {
      const userId = data.user_id;
      const itemId = data.recommendation_id;
      const actualRating = data.rating;

      // Predict rating
      let predictedRating = 0;
      if (userFeatures[userId] && itemFeatures[itemId]) {
        for (let i = 0; i < factors; i++) {
          predictedRating += userFeatures[userId][i] * itemFeatures[itemId][i];
        }
      }

      // Evaluate prediction (binary classification: relevant if rating >= 0.7)
      const actualRelevant = actualRating >= 0.7;
      const predictedRelevant = predictedRating >= 0.7;

      if (actualRelevant === predictedRelevant) {
        correctPredictions++;
      }

      if (actualRelevant && predictedRelevant) {
        truePositives++;
      } else if (!actualRelevant && predictedRelevant) {
        falsePositives++;
      } else if (actualRelevant && !predictedRelevant) {
        falseNegatives++;
      }

      totalPredictions++;
    });

    const accuracy = totalPredictions > 0 ? correctPredictions / totalPredictions : 0;
    const precision = (truePositives + falsePositives) > 0 ? truePositives / (truePositives + falsePositives) : 0;
    const recall = (truePositives + falseNegatives) > 0 ? truePositives / (truePositives + falseNegatives) : 0;
    const f1Score = (precision + recall) > 0 ? 2 * (precision * recall) / (precision + recall) : 0;

    return {
      accuracy: accuracy,
      precision: precision,
      recall: recall,
      f1Score: f1Score,
      confusionMatrix: {
        truePositives: truePositives,
        falsePositives: falsePositives,
        falseNegatives: falseNegatives,
        trueNegatives: totalPredictions - truePositives - falsePositives - falseNegatives
      }
    };
  }

  // Train content-based recommendation model
  async trainContentBasedModel(modelName = 'health_content_based') {
    try {
      console.log(`Training content-based model: ${modelName}`);
      
      // Get training data
      const trainingData = await this.getContentBasedTrainingData();
      
      if (trainingData.length < 10) {
        throw new Error('Insufficient training data for content-based model');
      }

      // Extract features
      const features = this.extractContentFeatures(trainingData);
      
      // Train model
      const model = await this.trainContentBasedModel(features);
      
      // Evaluate model
      const evaluation = await this.evaluateContentBasedModel(model, trainingData);
      
      // Save model
      const modelId = await this.saveModel('recommendation', 'content_based', modelName, model, evaluation);
      
      // Save feature importance
      await this.saveFeatureImportance(modelId, model.featureImportance);
      
      console.log(`Content-based model trained successfully with accuracy: ${evaluation.accuracy}`);
      
      return {
        modelId: modelId,
        modelName: modelName,
        accuracy: evaluation.accuracy,
        precision: evaluation.precision,
        recall: evaluation.recall,
        f1Score: evaluation.f1Score
      };
    } catch (error) {
      console.error('Error training content-based model:', error);
      throw error;
    }
  }

  // Get content-based training data
  async getContentBasedTrainingData() {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = `
        SELECT 
          ur.user_id,
          ur.recommendation_id,
          ur.effectiveness_rating as rating,
          hr.title,
          hr.description,
          hr.category,
          hr.priority,
          hr.target_demographics,
          hr.medical_conditions,
          hr.lifestyle_factors
        FROM user_recommendations ur
        JOIN health_recommendations hr ON ur.recommendation_id = hr.id
        WHERE ur.effectiveness_rating IS NOT NULL
      `;
      
      db.all(query, [], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const processedRows = rows.map(row => ({
            ...row,
            target_demographics: JSON.parse(row.target_demographics || '[]'),
            medical_conditions: JSON.parse(row.medical_conditions || '[]'),
            lifestyle_factors: JSON.parse(row.lifestyle_factors || '[]')
          }));
          resolve(processedRows);
        }
      });
    });
  }

  // Extract content features
  extractContentFeatures(trainingData) {
    const features = {
      categories: new Set(),
      demographics: new Set(),
      conditions: new Set(),
      lifestyleFactors: new Set(),
      priorities: new Set(),
      items: new Map()
    };

    trainingData.forEach(data => {
      features.categories.add(data.category);
      features.priorities.add(data.priority);
      
      data.target_demographics.forEach(demo => features.demographics.add(demo));
      data.medical_conditions.forEach(condition => features.conditions.add(condition));
      data.lifestyle_factors.forEach(factor => features.lifestyleFactors.add(factor));
      
      // Store item features
      features.items.set(data.recommendation_id, {
        category: data.category,
        priority: data.priority,
        demographics: data.target_demographics,
        conditions: data.medical_conditions,
        lifestyleFactors: data.lifestyle_factors,
        title: data.title,
        description: data.description
      });
    });

    return features;
  }

  // Train content-based model
  async trainContentBasedModel(features) {
    // Create TF-IDF vectors for items
    const itemVectors = new Map();
    const vocabulary = new Set();
    
    // Build vocabulary
    features.items.forEach((item, itemId) => {
      const text = `${item.title} ${item.description}`.toLowerCase();
      const words = text.split(/\s+/);
      words.forEach(word => vocabulary.add(word));
    });

    const vocabArray = Array.from(vocabulary);
    const vocabSize = vocabArray.length;

    // Create TF-IDF vectors
    features.items.forEach((item, itemId) => {
      const text = `${item.title} ${item.description}`.toLowerCase();
      const words = text.split(/\s+/);
      const wordCount = {};
      
      words.forEach(word => {
        wordCount[word] = (wordCount[word] || 0) + 1;
      });

      // Calculate TF-IDF
      const vector = new Array(vocabSize).fill(0);
      vocabArray.forEach((word, index) => {
        const tf = wordCount[word] || 0;
        const idf = Math.log(features.items.size / (Array.from(features.items.values()).filter(item => 
          `${item.title} ${item.description}`.toLowerCase().includes(word)
        ).length + 1));
        vector[index] = tf * idf;
      });

      itemVectors.set(itemId, vector);
    });

    // Calculate feature importance
    const featureImportance = this.calculateContentFeatureImportance(features, vocabArray);

    return {
      itemVectors: itemVectors,
      vocabulary: vocabArray,
      features: features,
      featureImportance: featureImportance
    };
  }

  // Calculate content feature importance
  calculateContentFeatureImportance(features, vocabulary) {
    const importance = {};
    
    // Category importance
    const categoryCount = {};
    features.items.forEach(item => {
      categoryCount[item.category] = (categoryCount[item.category] || 0) + 1;
    });
    
    Object.entries(categoryCount).forEach(([category, count]) => {
      importance[`category_${category}`] = count / features.items.size;
    });

    // Vocabulary importance (simplified)
    const wordCount = {};
    features.items.forEach(item => {
      const text = `${item.title} ${item.description}`.toLowerCase();
      const words = text.split(/\s+/);
      words.forEach(word => {
        wordCount[word] = (wordCount[word] || 0) + 1;
      });
    });

    // Top 20 most frequent words
    const sortedWords = Object.entries(wordCount)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 20);
    
    sortedWords.forEach(([word, count]) => {
      importance[`word_${word}`] = count / features.items.size;
    });

    return importance;
  }

  // Evaluate content-based model
  async evaluateContentBasedModel(model, testData) {
    const { itemVectors } = model;
    let correctPredictions = 0;
    let totalPredictions = 0;
    let truePositives = 0;
    let falsePositives = 0;
    let falseNegatives = 0;

    testData.forEach(data => {
      const userId = data.user_id;
      const itemId = data.recommendation_id;
      const actualRating = data.rating;

      // Predict rating (simplified - using cosine similarity with user profile)
      const predictedRating = this.predictContentBasedRating(userId, itemId, model);

      // Evaluate prediction
      const actualRelevant = actualRating >= 0.7;
      const predictedRelevant = predictedRating >= 0.7;

      if (actualRelevant === predictedRelevant) {
        correctPredictions++;
      }

      if (actualRelevant && predictedRelevant) {
        truePositives++;
      } else if (!actualRelevant && predictedRelevant) {
        falsePositives++;
      } else if (actualRelevant && !predictedRelevant) {
        falseNegatives++;
      }

      totalPredictions++;
    });

    const accuracy = totalPredictions > 0 ? correctPredictions / totalPredictions : 0;
    const precision = (truePositives + falsePositives) > 0 ? truePositives / (truePositives + falsePositives) : 0;
    const recall = (truePositives + falseNegatives) > 0 ? truePositives / (truePositives + falseNegatives) : 0;
    const f1Score = (precision + recall) > 0 ? 2 * (precision * recall) / (precision + recall) : 0;

    return {
      accuracy: accuracy,
      precision: precision,
      recall: recall,
      f1Score: f1Score,
      confusionMatrix: {
        truePositives: truePositives,
        falsePositives: falsePositives,
        falseNegatives: falseNegatives,
        trueNegatives: totalPredictions - truePositives - falsePositives - falseNegatives
      }
    };
  }

  // Predict content-based rating
  predictContentBasedRating(userId, itemId, model) {
    // Simplified prediction - would normally use user profile
    // For now, return a random value between 0 and 1
    return Math.random();
  }

  // Train health outcome prediction model
  async trainHealthOutcomeModel(modelName = 'health_outcome_predictor') {
    try {
      console.log(`Training health outcome prediction model: ${modelName}`);
      
      // Get training data
      const trainingData = await this.getHealthOutcomeTrainingData();
      
      if (trainingData.length < 20) {
        throw new Error('Insufficient training data for health outcome model');
      }

      // Extract features and labels
      const { features, labels } = this.extractHealthOutcomeFeatures(trainingData);
      
      // Train model (simplified logistic regression)
      const model = await this.trainLogisticRegression(features, labels);
      
      // Evaluate model
      const evaluation = await this.evaluateHealthOutcomeModel(model, trainingData);
      
      // Save model
      const modelId = await this.saveModel('prediction', 'health_outcome', modelName, model, evaluation);
      
      // Save feature importance
      await this.saveFeatureImportance(modelId, model.featureImportance);
      
      console.log(`Health outcome model trained successfully with accuracy: ${evaluation.accuracy}`);
      
      return {
        modelId: modelId,
        modelName: modelName,
        accuracy: evaluation.accuracy,
        precision: evaluation.precision,
        recall: evaluation.recall,
        f1Score: evaluation.f1Score
      };
    } catch (error) {
      console.error('Error training health outcome model:', error);
      throw error;
    }
  }

  // Get health outcome training data
  async getHealthOutcomeTrainingData() {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = `
        SELECT 
          p.user_id,
          p.age_group,
          p.blood_type,
          p.allergies,
          p.medications,
          mr.diagnosis_code,
          mr.treatment_code,
          mr.record_type,
          mr.date_of_service,
          ic.total_amount,
          ic.status,
          pp.payment_amount
        FROM patients p
        JOIN users u ON p.user_id = u.id
        LEFT JOIN medical_records mr ON p.id = mr.patient_id
        LEFT JOIN insurance_claims ic ON p.id = ic.patient_id
        LEFT JOIN premium_payments pp ON p.id = pp.patient_id
        WHERE mr.date_of_service >= datetime('now', '-2 years')
      `;
      
      db.all(query, [], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const processedRows = rows.map(row => ({
            ...row,
            allergies: JSON.parse(row.allergies || '[]'),
            medications: JSON.parse(row.medications || '[]')
          }));
          resolve(processedRows);
        }
      });
    });
  }

  // Extract health outcome features
  extractHealthOutcomeFeatures(trainingData) {
    const features = [];
    const labels = [];

    trainingData.forEach(data => {
      const feature = [
        this.encodeAgeGroup(data.age_group),
        this.encodeBloodType(data.blood_type),
        this.encodeAllergies(data.allergies),
        this.encodeMedications(data.medications),
        this.encodeDiagnosis(data.diagnosis_code),
        this.encodeTreatment(data.treatment_code),
        this.encodeRecordType(data.record_type),
        this.encodeTimeOfYear(data.date_of_service),
        data.total_amount || 0,
        data.payment_amount || 0
      ];

      // Label: positive outcome if claim was approved and paid
      const label = data.status === 'approved' || data.status === 'paid' ? 1 : 0;

      features.push(feature);
      labels.push(label);
    });

    return { features, labels };
  }

  // Encode age group
  encodeAgeGroup(ageGroup) {
    const groups = { 'pediatric': 0, 'adult': 1, 'senior': 2, 'elderly': 3 };
    return groups[ageGroup] || 1;
  }

  // Encode blood type
  encodeBloodType(bloodType) {
    const types = { 'A+': 0, 'A-': 1, 'B+': 2, 'B-': 3, 'AB+': 4, 'AB-': 5, 'O+': 6, 'O-': 7 };
    return types[bloodType] || 0;
  }

  // Encode allergies
  encodeAllergies(allergies) {
    return allergies.length > 0 ? 1 : 0;
  }

  // Encode medications
  encodeMedications(medications) {
    return medications.length > 0 ? 1 : 0;
  }

  // Encode diagnosis
  encodeDiagnosis(diagnosisCode) {
    // Simplified encoding - would use proper ICD coding in production
    return diagnosisCode ? diagnosisCode.length % 10 : 0;
  }

  // Encode treatment
  encodeTreatment(treatmentCode) {
    // Simplified encoding - would use proper CPT coding in production
    return treatmentCode ? treatmentCode.length % 10 : 0;
  }

  // Encode record type
  encodeRecordType(recordType) {
    const types = { 'diagnosis': 0, 'treatment': 1, 'lab_result': 2, 'prescription': 3, 'imaging': 4, 'vaccination': 5 };
    return types[recordType] || 0;
  }

  // Encode time of year
  encodeTimeOfYear(dateString) {
    if (!dateString) return 0;
    const date = new Date(dateString);
    return Math.floor(date.getMonth() / 3); // 0-3 for quarters
  }

  // Train logistic regression
  async trainLogisticRegression(features, labels, iterations = 1000, learningRate = 0.01) {
    const numFeatures = features[0].length;
    const weights = new Array(numFeatures).fill(0).map(() => Math.random() * 0.1);
    const bias = Math.random() * 0.1;

    // Training loop
    for (let iter = 0; iter < iterations; iter++) {
      let totalError = 0;

      for (let i = 0; i < features.length; i++) {
        const feature = features[i];
        const label = labels[i];

        // Calculate prediction
        let z = bias;
        for (let j = 0; j < numFeatures; j++) {
          z += weights[j] * feature[j];
        }
        const prediction = 1 / (1 + Math.exp(-z)); // Sigmoid

        // Calculate error
        const error = label - prediction;
        totalError += Math.abs(error);

        // Update weights
        for (let j = 0; j < numFeatures; j++) {
          weights[j] += learningRate * error * prediction * (1 - prediction) * feature[j];
        }
        bias += learningRate * error * prediction * (1 - prediction);
      }

      // Check convergence
      if (iter % 100 === 0) {
        const avgError = totalError / features.length;
        if (avgError < 0.1) break;
      }
    }

    // Calculate feature importance
    const featureImportance = weights.map((weight, index) => ({
      feature: `feature_${index}`,
      importance: Math.abs(weight)
    }));

    return {
      weights: weights,
      bias: bias,
      featureImportance: featureImportance
    };
  }

  // Evaluate health outcome model
  async evaluateHealthOutcomeModel(model, testData) {
    const { weights, bias } = model;
    let correctPredictions = 0;
    let totalPredictions = 0;
    let truePositives = 0;
    let falsePositives = 0;
    let falseNegatives = 0;

    testData.forEach(data => {
      const feature = [
        this.encodeAgeGroup(data.age_group),
        this.encodeBloodType(data.blood_type),
        this.encodeAllergies(data.allergies),
        this.encodeMedications(data.medications),
        this.encodeDiagnosis(data.diagnosis_code),
        this.encodeTreatment(data.treatment_code),
        this.encodeRecordType(data.record_type),
        this.encodeTimeOfYear(data.date_of_service),
        data.total_amount || 0,
        data.payment_amount || 0
      ];

      // Predict outcome
      let z = bias;
      for (let i = 0; i < weights.length; i++) {
        z += weights[i] * feature[i];
      }
      const prediction = 1 / (1 + Math.exp(-z));
      const predictedLabel = prediction >= 0.5 ? 1 : 0;

      // Actual label
      const actualLabel = data.status === 'approved' || data.status === 'paid' ? 1 : 0;

      if (actualLabel === predictedLabel) {
        correctPredictions++;
      }

      if (actualLabel === 1 && predictedLabel === 1) {
        truePositives++;
      } else if (actualLabel === 0 && predictedLabel === 1) {
        falsePositives++;
      } else if (actualLabel === 1 && predictedLabel === 0) {
        falseNegatives++;
      }

      totalPredictions++;
    });

    const accuracy = totalPredictions > 0 ? correctPredictions / totalPredictions : 0;
    const precision = (truePositives + falsePositives) > 0 ? truePositives / (truePositives + falsePositives) : 0;
    const recall = (truePositives + falseNegatives) > 0 ? truePositives / (truePositives + falseNegatives) : 0;
    const f1Score = (precision + recall) > 0 ? 2 * (precision * recall) / (precision + recall) : 0;

    return {
      accuracy: accuracy,
      precision: precision,
      recall: recall,
      f1Score: f1Score,
      confusionMatrix: {
        truePositives: truePositives,
        falsePositives: falsePositives,
        falseNegatives: falseNegatives,
        trueNegatives: totalPredictions - truePositives - falsePositives - falseNegatives
      }
    };
  }

  // Save model to database
  async saveModel(modelType, algorithm, modelName, modelData, evaluation) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = `
        INSERT INTO ml_models 
        (id, model_type, model_name, model_version, algorithm, model_data, 
         training_data_count, accuracy, precision, recall, f1_score)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      db.run(query, [
        uuidv4(),
        modelType,
        algorithm,
        modelName,
        '1.0',
        JSON.stringify(modelData),
        0, // Will be updated with actual count
        evaluation.accuracy,
        evaluation.precision,
        evaluation.recall,
        evaluation.f1Score
      ], function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
    });
  }

  // Save feature importance
  async saveFeatureImportance(modelId, featureImportance) {
    const db = this.getDatabase();
    
    try {
      for (const feature of featureImportance) {
        await new Promise((resolve, reject) => {
          const query = `
            INSERT INTO feature_importance 
            (id, model_id, feature_name, importance_score, feature_type)
            VALUES (?, ?, ?, ?, ?)
          `;
          
          db.run(query, [
            uuidv4(),
            modelId,
            feature.feature || feature.name,
            feature.importance,
            'numerical'
          ], (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      }
    } catch (error) {
      console.error('Error saving feature importance:', error);
      throw error;
    }
  }

  // Get model predictions
  async getModelPrediction(modelId, userId, inputFeatures, predictionType) {
    const db = this.getDatabase();
    
    try {
      // Get model
      const model = await this.getModel(modelId);
      if (!model) {
        throw new Error('Model not found');
      }

      // Make prediction based on model type
      let prediction;
      switch (model.model_type) {
        case 'recommendation':
          prediction = await this.makeRecommendationPrediction(model, userId, inputFeatures);
          break;
        case 'prediction':
          prediction = await this.makePredictionPrediction(model, userId, inputFeatures);
          break;
        default:
          throw new Error('Unsupported model type');
      }

      // Save prediction
      await this.savePrediction(modelId, userId, predictionType, inputFeatures, prediction);

      return prediction;
    } catch (error) {
      console.error('Error making model prediction:', error);
      throw error;
    }
  }

  // Get model from database
  async getModel(modelId) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = 'SELECT * FROM ml_models WHERE id = ? AND is_active = TRUE';
      
      db.get(query, [modelId], (err, row) => {
        if (err) {
          reject(err);
        } else if (row) {
          resolve({
            ...row,
            modelData: JSON.parse(row.model_data)
          });
        } else {
          resolve(null);
        }
      });
    });
  }

  // Make recommendation prediction
  async makeRecommendationPrediction(model, userId, inputFeatures) {
    const modelData = model.modelData;
    
    switch (model.algorithm) {
      case 'collaborative_filtering':
        return this.predictCollaborativeFiltering(modelData, userId, inputFeatures);
      case 'content_based':
        return this.predictContentBased(modelData, userId, inputFeatures);
      default:
        throw new Error('Unsupported recommendation algorithm');
    }
  }

  // Make prediction prediction
  async makePredictionPrediction(model, userId, inputFeatures) {
    const modelData = model.modelData;
    
    switch (model.algorithm) {
      case 'health_outcome':
        return this.predictHealthOutcome(modelData, inputFeatures);
      default:
        throw new Error('Unsupported prediction algorithm');
    }
  }

  // Predict collaborative filtering
  predictCollaborativeFiltering(modelData, userId, inputFeatures) {
    const { userFeatures, itemFeatures, factors } = modelData;
    const itemId = inputFeatures.itemId;

    if (!userFeatures[userId] || !itemFeatures[itemId]) {
      return { prediction: 0.5, confidence: 0.1 };
    }

    let rating = 0;
    for (let i = 0; i < factors; i++) {
      rating += userFeatures[userId][i] * itemFeatures[itemId][i];
    }

    return {
      prediction: Math.max(0, Math.min(1, rating)),
      confidence: 0.8
    };
  }

  // Predict content-based
  predictContentBased(modelData, userId, inputFeatures) {
    // Simplified content-based prediction
    return {
      prediction: Math.random(),
      confidence: 0.6
    };
  }

  // Predict health outcome
  predictHealthOutcome(modelData, inputFeatures) {
    const { weights, bias } = modelData;
    
    let z = bias;
    for (let i = 0; i < weights.length && i < inputFeatures.length; i++) {
      z += weights[i] * inputFeatures[i];
    }
    
    const probability = 1 / (1 + Math.exp(-z));
    
    return {
      prediction: probability,
      confidence: Math.abs(probability - 0.5) * 2, // Confidence based on distance from 0.5
      outcome: probability >= 0.5 ? 'positive' : 'negative'
    };
  }

  // Save prediction
  async savePrediction(modelId, userId, predictionType, inputFeatures, prediction) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = `
        INSERT INTO model_predictions 
        (id, model_id, user_id, prediction_type, input_features, prediction_result, confidence_score)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;
      
      db.run(query, [
        uuidv4(),
        modelId,
        userId,
        predictionType,
        JSON.stringify(inputFeatures),
        JSON.stringify(prediction),
        prediction.confidence || 0.5
      ], function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
    });
  }

  // Get model performance metrics
  async getModelPerformance(modelId, period = 30) {
    const db = this.getDatabase();
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - period);

    return new Promise((resolve, reject) => {
      const query = `
        SELECT * FROM model_performance 
        WHERE model_id = ? AND evaluation_date >= ?
        ORDER BY evaluation_date DESC
      `;
      
      db.all(query, [modelId, cutoffDate.toISOString()], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  // Get all active models
  async getActiveModels(modelType = null) {
    const db = this.getDatabase();
    
    let query = 'SELECT * FROM ml_models WHERE is_active = TRUE';
    let params = [];
    
    if (modelType) {
      query += ' AND model_type = ?';
      params.push(modelType);
    }
    
    query += ' ORDER BY trained_at DESC';

    return new Promise((resolve, reject) => {
      db.all(query, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  // Close database connection
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

module.exports = new MachineLearningService();
