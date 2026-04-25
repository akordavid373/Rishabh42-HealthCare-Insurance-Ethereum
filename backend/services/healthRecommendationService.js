const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../database/healthcare.db');

class HealthRecommendationService {
  constructor() {
    this.db = null;
    this.recommendationCategories = {
      preventive_care: {
        weight: 0.25,
        priority: 'high'
      },
      lifestyle: {
        weight: 0.20,
        priority: 'medium'
      },
      medication: {
        weight: 0.20,
        priority: 'high'
      },
      screening: {
        weight: 0.15,
        priority: 'high'
      },
      wellness: {
        weight: 0.10,
        priority: 'low'
      },
      emergency: {
        weight: 0.10,
        priority: 'critical'
      }
    };
    
    this.recommendationRules = this.initializeRecommendationRules();
  }

  getDatabase() {
    if (!this.db) {
      this.db = new sqlite3.Database(DB_PATH);
    }
    return this.db;
  }

  // Initialize recommendation rules
  initializeRecommendationRules() {
    return {
      age_based: {
        pediatric: {
          age_range: [0, 17],
          recommendations: [
            'vaccinations',
            'growth_monitoring',
            'developmental_screening',
            'nutrition_counseling'
          ]
        },
        adult: {
          age_range: [18, 64],
          recommendations: [
            'annual_physical',
            'blood_pressure_check',
            'cholesterol_screening',
            'cancer_screenings',
            'mental_health_screening'
          ]
        },
        senior: {
          age_range: [65, 84],
          recommendations: [
            'annual_physical',
            'bone_density_scan',
            'cognitive_assessment',
            'medication_review',
            'fall_prevention'
          ]
        },
        elderly: {
          age_range: [85, 120],
          recommendations: [
            'comprehensive_geriatric_assessment',
            'medication_optimization',
            'functional_assessment',
            'palliative_care_planning'
          ]
        }
      },
      condition_based: {
        diabetes: {
          recommendations: [
            'hba1c_monitoring',
            'foot_exam',
            'eye_exam',
            'kidney_function_test',
            'diabetes_education'
          ]
        },
        hypertension: {
          recommendations: [
            'blood_pressure_monitoring',
            'cardiovascular_risk_assessment',
            'lifestyle_modification',
            'medication_adherence'
          ]
        },
        heart_disease: {
          recommendations: [
            'cardiac_stress_test',
            'lipid_panel',
            'ecg_monitoring',
            'cardiac_rehabilitation'
          ]
        },
        obesity: {
          recommendations: [
            'bmi_monitoring',
            'nutrition_counseling',
            'exercise_program',
            'metabolic_panel',
            'weight_management'
          ]
        }
      },
      lifestyle_based: {
        smoking: {
          recommendations: [
            'smoking_cessation_program',
            'lung_cancer_screening',
            'cardiovascular_risk_assessment',
            'nicotine_replacement_therapy'
          ]
        },
        sedentary: {
          recommendations: [
            'exercise_program',
            'physical_therapy_consultation',
            'cardiovascular_fitness_test',
            'ergonomic_assessment'
          ]
        },
        poor_nutrition: {
          recommendations: [
            'nutrition_counseling',
            'dietitian_consultation',
            'nutritional_deficiency_screening',
            'meal_planning'
          ]
        },
        high_stress: {
          recommendations: [
            'stress_management_program',
            'mental_health_screening',
            'mindfulness_training',
            'sleep_assessment'
          ]
        }
      }
    };
  }

  // Initialize health recommendation tables
  async initializeTables() {
    const db = this.getDatabase();
    
    const tables = [
      `CREATE TABLE IF NOT EXISTS health_recommendations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        category TEXT NOT NULL,
        priority TEXT NOT NULL,
        target_demographics TEXT,
        medical_conditions TEXT,
        lifestyle_factors TEXT,
        evidence_level TEXT DEFAULT 'moderate',
        effectiveness_score REAL DEFAULT 0.5,
        cost_impact TEXT DEFAULT 'medium',
        time_commitment TEXT DEFAULT 'medium',
        is_active BOOLEAN DEFAULT TRUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      
      `CREATE TABLE IF NOT EXISTS user_recommendations (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        recommendation_id TEXT NOT NULL,
        personalization_score REAL NOT NULL,
        relevance_score REAL NOT NULL,
        priority_score REAL NOT NULL,
        status TEXT DEFAULT 'pending',
        scheduled_date DATETIME,
        completed_date DATETIME,
        user_feedback TEXT,
        effectiveness_rating REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id),
        FOREIGN KEY (recommendation_id) REFERENCES health_recommendations (id)
      )`,
      
      `CREATE TABLE IF NOT EXISTS recommendation_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        template_data TEXT NOT NULL,
        conditions TEXT NOT NULL,
        auto_generate BOOLEAN DEFAULT TRUE,
        is_active BOOLEAN DEFAULT TRUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      
      `CREATE TABLE IF NOT EXISTS recommendation_feedback (
        id TEXT PRIMARY KEY,
        user_recommendation_id TEXT NOT NULL,
        feedback_type TEXT NOT NULL,
        rating INTEGER CHECK (rating >= 1 AND rating <= 5),
        comments TEXT,
        helpful BOOLEAN,
        implemented BOOLEAN,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_recommendation_id) REFERENCES user_recommendations (id)
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

    // Initialize base recommendations
    await this.initializeBaseRecommendations();
  }

  // Initialize base health recommendations
  async initializeBaseRecommendations() {
    const db = this.getDatabase();
    
    const baseRecommendations = [
      // Preventive Care
      {
        title: 'Annual Physical Examination',
        description: 'Comprehensive annual health check-up including vital signs, physical exam, and health counseling',
        category: 'preventive_care',
        priority: 'high',
        target_demographics: JSON.stringify(['adult', 'senior', 'elderly']),
        evidence_level: 'high',
        effectiveness_score: 0.9,
        cost_impact: 'medium',
        time_commitment: 'low'
      },
      {
        title: 'Blood Pressure Screening',
        description: 'Regular blood pressure monitoring to detect hypertension early',
        category: 'screening',
        priority: 'high',
        target_demographics: JSON.stringify(['adult', 'senior', 'elderly']),
        evidence_level: 'high',
        effectiveness_score: 0.85,
        cost_impact: 'low',
        time_commitment: 'low'
      },
      {
        title: 'Cholesterol Screening',
        description: 'Lipid panel test to assess cardiovascular risk',
        category: 'screening',
        priority: 'high',
        target_demographics: JSON.stringify(['adult', 'senior']),
        evidence_level: 'high',
        effectiveness_score: 0.8,
        cost_impact: 'medium',
        time_commitment: 'low'
      },
      {
        title: 'Colorectal Cancer Screening',
        description: 'Screening for colorectal cancer based on age and risk factors',
        category: 'screening',
        priority: 'high',
        target_demographics: JSON.stringify(['adult', 'senior']),
        medical_conditions: JSON.stringify(['family_history_colorectal_cancer', 'inflammatory_bowel_disease']),
        evidence_level: 'high',
        effectiveness_score: 0.85,
        cost_impact: 'high',
        time_commitment: 'medium'
      },
      
      // Lifestyle Recommendations
      {
        title: 'Regular Exercise Program',
        description: '150 minutes of moderate-intensity aerobic activity per week',
        category: 'lifestyle',
        priority: 'medium',
        target_demographics: JSON.stringify(['adult', 'senior']),
        lifestyle_factors: JSON.stringify(['sedentary', 'overweight']),
        evidence_level: 'high',
        effectiveness_score: 0.8,
        cost_impact: 'low',
        time_commitment: 'medium'
      },
      {
        title: 'Healthy Diet Counseling',
        description: 'Nutritional counseling for balanced diet and weight management',
        category: 'lifestyle',
        priority: 'medium',
        target_demographics: JSON.stringify(['adult', 'senior']),
        lifestyle_factors: JSON.stringify(['poor_nutrition', 'obesity']),
        evidence_level: 'moderate',
        effectiveness_score: 0.75,
        cost_impact: 'low',
        time_commitment: 'medium'
      },
      {
        title: 'Smoking Cessation Program',
        description: 'Comprehensive smoking cessation support including counseling and medication',
        category: 'lifestyle',
        priority: 'high',
        target_demographics: JSON.stringify(['adult', 'senior']),
        lifestyle_factors: JSON.stringify(['smoking']),
        evidence_level: 'high',
        effectiveness_score: 0.7,
        cost_impact: 'medium',
        time_commitment: 'high'
      },
      
      // Condition-Specific Recommendations
      {
        title: 'Diabetes Management Education',
        description: 'Education program for diabetes self-management and lifestyle modifications',
        category: 'medication',
        priority: 'high',
        medical_conditions: JSON.stringify(['diabetes']),
        evidence_level: 'high',
        effectiveness_score: 0.85,
        cost_impact: 'low',
        time_commitment: 'medium'
      },
      {
        title: 'Medication Adherence Support',
        description: 'Program to improve medication adherence through reminders and education',
        category: 'medication',
        priority: 'high',
        medical_conditions: JSON.stringify(['chronic_conditions']),
        evidence_level: 'moderate',
        effectiveness_score: 0.8,
        cost_impact: 'low',
        time_commitment: 'low'
      },
      
      // Wellness Recommendations
      {
        title: 'Stress Management Program',
        description: 'Mindfulness and stress reduction techniques for mental wellness',
        category: 'wellness',
        priority: 'low',
        target_demographics: JSON.stringify(['adult', 'senior']),
        lifestyle_factors: JSON.stringify(['high_stress']),
        evidence_level: 'moderate',
        effectiveness_score: 0.7,
        cost_impact: 'low',
        time_commitment: 'medium'
      },
      {
        title: 'Sleep Hygiene Education',
        description: 'Education on improving sleep quality and duration',
        category: 'wellness',
        priority: 'low',
        target_demographics: JSON.stringify(['adult', 'senior']),
        lifestyle_factors: JSON.stringify(['poor_sleep']),
        evidence_level: 'moderate',
        effectiveness_score: 0.65,
        cost_impact: 'low',
        time_commitment: 'low'
      }
    ];

    for (const rec of baseRecommendations) {
      await new Promise((resolve, reject) => {
        const query = `
          INSERT OR IGNORE INTO health_recommendations 
          (id, title, description, category, priority, target_demographics, medical_conditions, 
           lifestyle_factors, evidence_level, effectiveness_score, cost_impact, time_commitment)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        db.run(query, [
          uuidv4(),
          rec.title,
          rec.description,
          rec.category,
          rec.priority,
          rec.target_demographics || JSON.stringify([]),
          rec.medical_conditions || JSON.stringify([]),
          rec.lifestyle_factors || JSON.stringify([]),
          rec.evidence_level,
          rec.effectiveness_score,
          rec.cost_impact,
          rec.time_commitment
        ], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  }

  // Generate personalized health recommendations
  async generateHealthRecommendations(userId, userProfile, medicalHistory, lifestyleFactors) {
    try {
      const allRecommendations = await this.getAllRecommendations();
      const personalizedRecs = [];

      for (const recommendation of allRecommendations) {
        if (!recommendation.is_active) continue;

        const score = await this.calculateRecommendationScore(
          recommendation,
          userProfile,
          medicalHistory,
          lifestyleFactors
        );

        if (score >= 0.3) { // Minimum threshold
          personalizedRecs.push({
            ...recommendation,
            personalizationScore: score,
            priorityScore: this.calculatePriorityScore(recommendation, score)
          });
        }
      }

      // Sort by priority score and personalization score
      personalizedRecs.sort((a, b) => {
        if (b.priorityScore !== a.priorityScore) {
          return b.priorityScore - a.priorityScore;
        }
        return b.personalizationScore - a.personalizationScore;
      });

      // Save recommendations to database
      await this.saveUserRecommendations(userId, personalizedRecs.slice(0, 10)); // Top 10 recommendations

      return personalizedRecs.slice(0, 10);
    } catch (error) {
      console.error('Error generating health recommendations:', error);
      throw error;
    }
  }

  // Get all recommendations from database
  async getAllRecommendations() {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = 'SELECT * FROM health_recommendations WHERE is_active = TRUE';
      
      db.all(query, [], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const recommendations = rows.map(row => ({
            ...row,
            target_demographics: JSON.parse(row.target_demographics || '[]'),
            medical_conditions: JSON.parse(row.medical_conditions || '[]'),
            lifestyle_factors: JSON.parse(row.lifestyle_factors || '[]')
          }));
          resolve(recommendations);
        }
      });
    });
  }

  // Calculate recommendation score for user
  async calculateRecommendationScore(recommendation, userProfile, medicalHistory, lifestyleFactors) {
    let score = 0;
    let factors = 0;

    // Demographic relevance
    if (recommendation.target_demographics.length > 0) {
      const demographicScore = this.getDemographicRelevance(userProfile, recommendation.target_demographics);
      score += demographicScore * 0.3;
      factors += 0.3;
    }

    // Medical condition relevance
    if (recommendation.medical_conditions.length > 0) {
      const medicalScore = this.getMedicalRelevance(medicalHistory, recommendation.medical_conditions);
      score += medicalScore * 0.4;
      factors += 0.4;
    }

    // Lifestyle relevance
    if (recommendation.lifestyle_factors.length > 0) {
      const lifestyleScore = this.getLifestyleRelevance(lifestyleFactors, recommendation.lifestyle_factors);
      score += lifestyleScore * 0.2;
      factors += 0.2;
    }

    // Evidence level and effectiveness
    const evidenceScore = this.getEvidenceScore(recommendation.evidence_level, recommendation.effectiveness_score);
    score += evidenceScore * 0.1;
    factors += 0.1;

    return factors > 0 ? score : 0;
  }

  // Get demographic relevance score
  getDemographicRelevance(userProfile, targetDemographics) {
    if (!userProfile || !userProfile.ageGroup) return 0.3;

    const ageGroup = userProfile.ageGroup;
    const gender = userProfile.gender;

    let score = 0;
    let matches = 0;

    for (const demographic of targetDemographics) {
      matches++;
      
      if (demographic === 'all' || demographic === ageGroup) {
        score += 1.0;
      } else if (demographic === 'adult' && ['adult', 'senior', 'elderly'].includes(ageGroup)) {
        score += 0.8;
      } else if (demographic === 'senior' && ['senior', 'elderly'].includes(ageGroup)) {
        score += 0.8;
      } else if (demographic === gender) {
        score += 0.5;
      } else {
        score += 0.1;
      }
    }

    return matches > 0 ? score / matches : 0.1;
  }

  // Get medical relevance score
  getMedicalRelevance(medicalHistory, targetConditions) {
    if (!medicalHistory || medicalHistory.length === 0) return 0.2;

    let score = 0;
    let matches = 0;

    for (const condition of targetConditions) {
      matches++;
      
      const hasCondition = medicalHistory.some(med => 
        med.type === condition || 
        med.code === condition ||
        med.name?.toLowerCase().includes(condition.toLowerCase())
      );

      if (hasCondition) {
        score += 1.0;
      } else {
        score += 0.1;
      }
    }

    return matches > 0 ? score / matches : 0.1;
  }

  // Get lifestyle relevance score
  getLifestyleRelevance(lifestyleFactors, targetLifestyleFactors) {
    if (!lifestyleFactors) return 0.2;

    let score = 0;
    let matches = 0;

    for (const factor of targetLifestyleFactors) {
      matches++;
      
      const hasFactor = Object.keys(lifestyleFactors).some(key => 
        key === factor || 
        key.toLowerCase().includes(factor.toLowerCase())
      );

      if (hasFactor) {
        score += 1.0;
      } else {
        score += 0.1;
      }
    }

    return matches > 0 ? score / matches : 0.1;
  }

  // Get evidence score
  getEvidenceScore(evidenceLevel, effectivenessScore) {
    const evidenceWeights = {
      'high': 1.0,
      'moderate': 0.7,
      'low': 0.4,
      'very_low': 0.2
    };

    const evidenceWeight = evidenceWeights[evidenceLevel] || 0.5;
    return (evidenceWeight + effectivenessScore) / 2;
  }

  // Calculate priority score
  calculatePriorityScore(recommendation, personalizationScore) {
    const priorityWeights = {
      'critical': 1.0,
      'high': 0.8,
      'medium': 0.6,
      'low': 0.4
    };

    const categoryWeight = this.recommendationCategories[recommendation.category]?.weight || 0.5;
    const priorityWeight = priorityWeights[recommendation.priority] || 0.5;

    return (personalizationScore * 0.4) + (priorityWeight * 0.4) + (categoryWeight * 0.2);
  }

  // Save user recommendations
  async saveUserRecommendations(userId, recommendations) {
    const db = this.getDatabase();
    
    try {
      for (const rec of recommendations) {
        await new Promise((resolve, reject) => {
          const query = `
            INSERT OR REPLACE INTO user_recommendations 
            (id, user_id, recommendation_id, personalization_score, relevance_score, priority_score, status)
            VALUES (?, ?, ?, ?, ?, ?, 'pending')
          `;
          
          db.run(query, [
            uuidv4(),
            userId,
            rec.id,
            rec.personalizationScore,
            rec.personalizationScore,
            rec.priorityScore
          ], (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      }
    } catch (error) {
      console.error('Error saving user recommendations:', error);
      throw error;
    }
  }

  // Get user recommendations
  async getUserRecommendations(userId, status = 'pending', limit = 20) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = `
        SELECT ur.*, hr.title, hr.description, hr.category, hr.priority, hr.cost_impact, hr.time_commitment
        FROM user_recommendations ur
        JOIN health_recommendations hr ON ur.recommendation_id = hr.id
        WHERE ur.user_id = ? AND ur.status = ?
        ORDER BY ur.priority_score DESC, ur.personalization_score DESC
        LIMIT ?
      `;
      
      db.all(query, [userId, status, limit], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  // Update recommendation status
  async updateRecommendationStatus(userRecommendationId, status, feedback = null) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      let query = 'UPDATE user_recommendations SET status = ?';
      let params = [status];

      if (status === 'completed') {
        query += ', completed_date = CURRENT_TIMESTAMP';
      }

      if (feedback) {
        query += ', user_feedback = ?, effectiveness_rating = ?';
        params.push(JSON.stringify(feedback), feedback.rating || null);
      }

      query += ' WHERE id = ?';
      params.push(userRecommendationId);

      db.run(query, params, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  // Get recommendation statistics
  async getRecommendationStats(userId = null, period = 30) {
    const db = this.getDatabase();
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - period);

    let query = `
      SELECT 
        COUNT(*) as total_recommendations,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_recommendations,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_recommendations,
        AVG(effectiveness_rating) as avg_effectiveness_rating,
        hr.category,
        COUNT(*) as category_count
      FROM user_recommendations ur
      JOIN health_recommendations hr ON ur.recommendation_id = hr.id
      WHERE ur.created_at >= ?
    `;
    
    let params = [cutoffDate.toISOString()];

    if (userId) {
      query += ' AND ur.user_id = ?';
      params.push(userId);
    }

    query += ' GROUP BY hr.category';

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

  // Get recommendation effectiveness metrics
  async getRecommendationEffectiveness(category = null, period = 90) {
    const db = this.getDatabase();
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - period);

    let query = `
      SELECT 
        hr.title,
        hr.category,
        AVG(ur.effectiveness_rating) as avg_rating,
        COUNT(ur.effectiveness_rating) as rating_count,
        COUNT(CASE WHEN ur.status = 'completed' THEN 1 END) as completion_count,
        COUNT(*) as total_count
      FROM user_recommendations ur
      JOIN health_recommendations hr ON ur.recommendation_id = hr.id
      WHERE ur.created_at >= ? AND ur.effectiveness_rating IS NOT NULL
    `;
    
    let params = [cutoffDate.toISOString()];

    if (category) {
      query += ' AND hr.category = ?';
      params.push(category);
    }

    query += ' GROUP BY hr.id, hr.title, hr.category ORDER BY avg_rating DESC';

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

module.exports = new HealthRecommendationService();
