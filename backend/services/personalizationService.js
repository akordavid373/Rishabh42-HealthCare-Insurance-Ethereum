const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../database/healthcare.db');

class PersonalizationService {
  constructor() {
    this.db = null;
    this.userProfiles = new Map();
    this.preferenceWeights = {
      age: 0.2,
      gender: 0.1,
      medical_history: 0.3,
      lifestyle: 0.15,
      preferences: 0.15,
      behavior: 0.1
    };
  }

  getDatabase() {
    if (!this.db) {
      this.db = new sqlite3.Database(DB_PATH);
    }
    return this.db;
  }

  // Initialize personalization tables
  async initializeTables() {
    const db = this.getDatabase();
    
    const tables = [
      `CREATE TABLE IF NOT EXISTS user_profiles (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        age_group TEXT,
        gender TEXT,
        health_risk_level TEXT DEFAULT 'medium',
        lifestyle_factors TEXT,
        medical_preferences TEXT,
        behavioral_patterns TEXT,
        last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )`,
      
      `CREATE TABLE IF NOT EXISTS recommendation_history (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        recommendation_type TEXT NOT NULL,
        recommendation_data TEXT NOT NULL,
        context TEXT NOT NULL,
        relevance_score REAL NOT NULL,
        user_feedback TEXT,
        accepted BOOLEAN,
        viewed_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )`,
      
      `CREATE TABLE IF NOT EXISTS user_preferences (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        preference_type TEXT NOT NULL,
        preference_value TEXT NOT NULL,
        weight REAL DEFAULT 1.0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )`,
      
      `CREATE TABLE IF NOT EXISTS behavioral_data (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        activity_type TEXT NOT NULL,
        activity_data TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        session_id TEXT,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )`,
      
      `CREATE TABLE IF NOT EXISTS personalization_models (
        id TEXT PRIMARY KEY,
        model_type TEXT NOT NULL,
        model_version TEXT NOT NULL,
        model_data TEXT NOT NULL,
        accuracy REAL DEFAULT 0.0,
        is_active BOOLEAN DEFAULT TRUE,
        trained_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_used DATETIME DEFAULT CURRENT_TIMESTAMP
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

  // Create or update user profile
  async createUserProfile(userId, profileData) {
    const db = this.getDatabase();
    
    try {
      const profileId = uuidv4();
      
      // Calculate health risk level based on medical history and factors
      const healthRiskLevel = this.calculateHealthRiskLevel(profileData);
      
      await new Promise((resolve, reject) => {
        const query = `
          INSERT OR REPLACE INTO user_profiles 
          (id, user_id, age_group, gender, health_risk_level, lifestyle_factors, medical_preferences, behavioral_patterns, last_updated)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `;
        
        db.run(query, [
          profileId,
          userId,
          profileData.ageGroup || 'unknown',
          profileData.gender || 'unknown',
          healthRiskLevel,
          JSON.stringify(profileData.lifestyleFactors || {}),
          JSON.stringify(profileData.medicalPreferences || {}),
          JSON.stringify(profileData.behavioralPatterns || {})
        ], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Cache the profile
      this.userProfiles.set(userId, {
        id: profileId,
        ...profileData,
        healthRiskLevel: healthRiskLevel,
        lastUpdated: new Date().toISOString()
      });

      return profileId;
    } catch (error) {
      console.error('Error creating user profile:', error);
      throw error;
    }
  }

  // Calculate health risk level
  calculateHealthRiskLevel(profileData) {
    let riskScore = 0;
    
    // Age-based risk
    const ageGroup = profileData.ageGroup;
    if (ageGroup === 'senior') riskScore += 30;
    else if (ageGroup === 'elderly') riskScore += 40;
    else if (ageGroup === 'adult') riskScore += 10;
    
    // Lifestyle factors
    const lifestyle = profileData.lifestyleFactors || {};
    if (lifestyle.smoking) riskScore += 25;
    if (lifestyle.alcoholConsumption === 'heavy') riskScore += 15;
    if (lifestyle.exerciseFrequency === 'none') riskScore += 20;
    if (lifestyle.diet === 'unhealthy') riskScore += 10;
    if (lifestyle.stressLevel === 'high') riskScore += 10;
    
    // Medical history factors
    const medicalHistory = profileData.medicalHistory || [];
    const chronicConditions = medicalHistory.filter(condition => 
      condition.type === 'chronic' || condition.severity === 'severe'
    );
    riskScore += chronicConditions.length * 15;
    
    // Determine risk level
    if (riskScore >= 70) return 'high';
    if (riskScore >= 40) return 'medium';
    return 'low';
  }

  // Get user profile
  async getUserProfile(userId) {
    const db = this.getDatabase();
    
    // Check cache first
    if (this.userProfiles.has(userId)) {
      return this.userProfiles.get(userId);
    }
    
    return new Promise((resolve, reject) => {
      const query = 'SELECT * FROM user_profiles WHERE user_id = ?';
      
      db.get(query, [userId], (err, row) => {
        if (err) {
          reject(err);
        } else if (row) {
          const profile = {
            id: row.id,
            userId: row.user_id,
            ageGroup: row.age_group,
            gender: row.gender,
            healthRiskLevel: row.health_risk_level,
            lifestyleFactors: JSON.parse(row.lifestyle_factors || '{}'),
            medicalPreferences: JSON.parse(row.medical_preferences || '{}'),
            behavioralPatterns: JSON.parse(row.behavioral_patterns || '{}'),
            lastUpdated: row.last_updated,
            createdAt: row.created_at
          };
          
          // Cache the profile
          this.userProfiles.set(userId, profile);
          resolve(profile);
        } else {
          resolve(null);
        }
      });
    });
  }

  // Update user preferences
  async updateUserPreferences(userId, preferences) {
    const db = this.getDatabase();
    
    try {
      for (const [type, value] of Object.entries(preferences)) {
        await new Promise((resolve, reject) => {
          const query = `
            INSERT OR REPLACE INTO user_preferences 
            (id, user_id, preference_type, preference_value, weight, updated_at)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          `;
          
          db.run(query, [
            uuidv4(),
            userId,
            type,
            JSON.stringify(value),
            this.getPreferenceWeight(type)
          ], (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      }
      
      // Update cached profile
      const profile = this.userProfiles.get(userId);
      if (profile) {
        profile.medicalPreferences = { ...profile.medicalPreferences, ...preferences };
        profile.lastUpdated = new Date().toISOString();
      }
      
    } catch (error) {
      console.error('Error updating user preferences:', error);
      throw error;
    }
  }

  // Get preference weight
  getPreferenceWeight(preferenceType) {
    const weights = {
      'treatment_preference': 0.3,
      'communication_style': 0.2,
      'appointment_reminder': 0.15,
      'privacy_level': 0.25,
      'cost_sensitivity': 0.2,
      'provider_preference': 0.15
    };
    
    return weights[preferenceType] || 0.1;
  }

  // Record behavioral data
  async recordBehavioralData(userId, activityType, activityData, sessionId = null) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = `
        INSERT INTO behavioral_data 
        (id, user_id, activity_type, activity_data, timestamp, session_id)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
      `;
      
      db.run(query, [
        uuidv4(),
        userId,
        activityType,
        JSON.stringify(activityData),
        sessionId
      ], function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
    });
  }

  // Analyze behavioral patterns
  async analyzeBehavioralPatterns(userId, days = 30) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      
      const query = `
        SELECT activity_type, activity_data, timestamp
        FROM behavioral_data
        WHERE user_id = ? AND timestamp >= ?
        ORDER BY timestamp ASC
      `;
      
      db.all(query, [userId, cutoffDate.toISOString()], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const patterns = this.extractBehavioralPatterns(rows);
          resolve(patterns);
        }
      });
    });
  }

  // Extract behavioral patterns from activity data
  extractBehavioralPatterns(activities) {
    const patterns = {
      appointmentFrequency: 0,
      preferredTimes: [],
      treatmentAcceptance: 0,
      communicationEngagement: 0,
      costSensitivity: 0,
      providerLoyalty: new Map(),
      healthAwareness: 0
    };

    activities.forEach(activity => {
      const data = JSON.parse(activity.activity_data);
      const timestamp = new Date(activity.timestamp);
      
      switch (activity.activity_type) {
        case 'appointment_scheduled':
          patterns.appointmentFrequency++;
          patterns.preferredTimes.push(timestamp.getHours());
          break;
          
        case 'treatment_accepted':
          patterns.treatmentAcceptance++;
          break;
          
        case 'treatment_declined':
          patterns.treatmentAcceptance--;
          break;
          
        case 'message_sent':
        case 'portal_login':
          patterns.communicationEngagement++;
          break;
          
        case 'cost_inquiry':
          patterns.costSensitivity++;
          break;
          
        case 'provider_visit':
          const providerId = data.providerId;
          patterns.providerLoyalty.set(providerId, (patterns.providerLoyalty.get(providerId) || 0) + 1);
          break;
          
        case 'health_content_viewed':
          patterns.healthAwareness++;
          break;
      }
    });

    // Calculate averages and normalize
    const totalActivities = activities.length;
    if (totalActivities > 0) {
      patterns.treatmentAcceptance = Math.max(0, patterns.treatmentAcceptance / totalActivities);
      patterns.communicationEngagement = patterns.communicationEngagement / totalActivities;
      patterns.costSensitivity = patterns.costSensitivity / totalActivities;
      patterns.healthAwareness = patterns.healthAwareness / totalActivities;
      
      // Most preferred time
      if (patterns.preferredTimes.length > 0) {
        const hourCounts = {};
        patterns.preferredTimes.forEach(hour => {
          hourCounts[hour] = (hourCounts[hour] || 0) + 1;
        });
        patterns.mostPreferredTime = Object.keys(hourCounts).reduce((a, b) => 
          hourCounts[a] > hourCounts[b] ? a : b
        );
      }
    }

    return patterns;
  }

  // Calculate personalization score for recommendations
  async calculatePersonalizationScore(userId, recommendationData) {
    const profile = await this.getUserProfile(userId);
    if (!profile) return 0.5; // Default score if no profile exists

    let score = 0;
    let totalWeight = 0;

    // Age-based scoring
    if (recommendationData.ageRelevance && profile.ageGroup) {
      const ageScore = this.getAgeRelevanceScore(profile.ageGroup, recommendationData.ageRelevance);
      score += ageScore * this.preferenceWeights.age;
      totalWeight += this.preferenceWeights.age;
    }

    // Gender-based scoring
    if (recommendationData.genderRelevance && profile.gender) {
      const genderScore = this.getGenderRelevanceScore(profile.gender, recommendationData.genderRelevance);
      score += genderScore * this.preferenceWeights.gender;
      totalWeight += this.preferenceWeights.gender;
    }

    // Health risk level scoring
    if (recommendationData.riskLevelRelevance && profile.healthRiskLevel) {
      const riskScore = this.getRiskRelevanceScore(profile.healthRiskLevel, recommendationData.riskLevelRelevance);
      score += riskScore * this.preferenceWeights.medical_history;
      totalWeight += this.preferenceWeights.medical_history;
    }

    // Lifestyle factors scoring
    if (recommendationData.lifestyleRelevance && profile.lifestyleFactors) {
      const lifestyleScore = this.getLifestyleRelevanceScore(profile.lifestyleFactors, recommendationData.lifestyleRelevance);
      score += lifestyleScore * this.preferenceWeights.lifestyle;
      totalWeight += this.preferenceWeights.lifestyle;
    }

    // Medical preferences scoring
    if (recommendationData.preferenceRelevance && profile.medicalPreferences) {
      const preferenceScore = this.getPreferenceRelevanceScore(profile.medicalPreferences, recommendationData.preferenceRelevance);
      score += preferenceScore * this.preferenceWeights.preferences;
      totalWeight += this.preferenceWeights.preferences;
    }

    // Behavioral patterns scoring
    if (recommendationData.behaviorRelevance && profile.behavioralPatterns) {
      const behaviorScore = this.getBehaviorRelevanceScore(profile.behavioralPatterns, recommendationData.behaviorRelevance);
      score += behaviorScore * this.preferenceWeights.behavior;
      totalWeight += this.preferenceWeights.behavior;
    }

    return totalWeight > 0 ? score / totalWeight : 0.5;
  }

  // Get age relevance score
  getAgeRelevanceScore(userAgeGroup, recommendationAgeGroups) {
    if (!Array.isArray(recommendationAgeGroups)) {
      recommendationAgeGroups = [recommendationAgeGroups];
    }
    
    return recommendationAgeGroups.includes(userAgeGroup) ? 1.0 : 0.3;
  }

  // Get gender relevance score
  getGenderRelevanceScore(userGender, recommendationGenders) {
    if (!Array.isArray(recommendationGenders)) {
      recommendationGenders = [recommendationGenders];
    }
    
    return recommendationGenders.includes(userGender) || recommendationGenders.includes('all') ? 1.0 : 0.4;
  }

  // Get risk relevance score
  getRiskRelevanceScore(userRiskLevel, recommendationRiskLevels) {
    if (!Array.isArray(recommendationRiskLevels)) {
      recommendationRiskLevels = [recommendationRiskLevels];
    }
    
    if (recommendationRiskLevels.includes(userRiskLevel)) {
      return 1.0;
    }
    
    // Partial score for close risk levels
    const riskHierarchy = { 'low': 0, 'medium': 1, 'high': 2 };
    const userRiskValue = riskHierarchy[userRiskLevel] || 1;
    
    for (const recRisk of recommendationRiskLevels) {
      const recRiskValue = riskHierarchy[recRisk] || 1;
      if (Math.abs(userRiskValue - recRiskValue) <= 1) {
        return 0.7;
      }
    }
    
    return 0.3;
  }

  // Get lifestyle relevance score
  getLifestyleRelevanceScore(userLifestyle, recommendationLifestyleFactors) {
    let score = 0;
    let factors = 0;

    for (const [factor, recommendationValue] of Object.entries(recommendationLifestyleFactors)) {
      const userValue = userLifestyle[factor];
      
      if (userValue !== undefined) {
        factors++;
        if (recommendationValue === 'any') {
          score += 1.0;
        } else if (Array.isArray(recommendationValue)) {
          score += recommendationValue.includes(userValue) ? 1.0 : 0.3;
        } else {
          score += userValue === recommendationValue ? 1.0 : 0.2;
        }
      }
    }

    return factors > 0 ? score / factors : 0.5;
  }

  // Get preference relevance score
  getPreferenceRelevanceScore(userPreferences, recommendationPreferences) {
    let score = 0;
    let factors = 0;

    for (const [preference, recommendationValue] of Object.entries(recommendationPreferences)) {
      const userValue = userPreferences[preference];
      
      if (userValue !== undefined) {
        factors++;
        if (recommendationValue === 'any') {
          score += 1.0;
        } else if (Array.isArray(recommendationValue)) {
          score += recommendationValue.includes(userValue) ? 1.0 : 0.4;
        } else {
          score += userValue === recommendationValue ? 1.0 : 0.3;
        }
      }
    }

    return factors > 0 ? score / factors : 0.5;
  }

  // Get behavior relevance score
  getBehaviorRelevanceScore(userBehavior, recommendationBehaviorFactors) {
    let score = 0;
    let factors = 0;

    for (const [factor, recommendationValue] of Object.entries(recommendationBehaviorFactors)) {
      const userValue = userBehavior[factor];
      
      if (userValue !== undefined) {
        factors++;
        
        switch (factor) {
          case 'treatmentAcceptance':
            if (recommendationValue === 'high' && userValue >= 0.7) score += 1.0;
            else if (recommendationValue === 'medium' && userValue >= 0.4) score += 0.8;
            else if (recommendationValue === 'low') score += 0.6;
            else score += 0.3;
            break;
            
          case 'communicationEngagement':
            if (recommendationValue === 'high' && userValue >= 0.6) score += 1.0;
            else if (recommendationValue === 'medium' && userValue >= 0.3) score += 0.8;
            else score += 0.4;
            break;
            
          case 'costSensitivity':
            if (recommendationValue === 'high' && userValue >= 0.5) score += 1.0;
            else if (recommendationValue === 'low' && userValue < 0.3) score += 1.0;
            else score += 0.5;
            break;
            
          case 'healthAwareness':
            if (recommendationValue === 'high' && userValue >= 0.5) score += 1.0;
            else if (recommendationValue === 'medium' && userValue >= 0.2) score += 0.8;
            else score += 0.4;
            break;
            
          default:
            score += 0.5;
        }
      }
    }

    return factors > 0 ? score / factors : 0.5;
  }

  // Update user profile with behavioral patterns
  async updateBehavioralPatterns(userId) {
    try {
      const patterns = await this.analyzeBehavioralPatterns(userId);
      
      const db = this.getDatabase();
      await new Promise((resolve, reject) => {
        const query = `
          UPDATE user_profiles 
          SET behavioral_patterns = ?, last_updated = CURRENT_TIMESTAMP
          WHERE user_id = ?
        `;
        
        db.run(query, [JSON.stringify(patterns), userId], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Update cached profile
      const profile = this.userProfiles.get(userId);
      if (profile) {
        profile.behavioralPatterns = patterns;
        profile.lastUpdated = new Date().toISOString();
      }

      return patterns;
    } catch (error) {
      console.error('Error updating behavioral patterns:', error);
      throw error;
    }
  }

  // Get recommendation history for learning
  async getRecommendationHistory(userId, limit = 100) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = `
        SELECT * FROM recommendation_history 
        WHERE user_id = ? 
        ORDER BY created_at DESC 
        LIMIT ?
      `;
      
      db.all(query, [userId, limit], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const history = rows.map(row => ({
            ...row,
            recommendationData: JSON.parse(row.recommendation_data),
            context: JSON.parse(row.context)
          }));
          resolve(history);
        }
      });
    });
  }

  // Record recommendation feedback
  async recordRecommendationFeedback(userId, recommendationId, feedback) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = `
        UPDATE recommendation_history 
        SET user_feedback = ?, accepted = ?
        WHERE id = ? AND user_id = ?
      `;
      
      db.run(query, [
        JSON.stringify(feedback),
        feedback.accepted || false,
        recommendationId,
        userId
      ], (err) => {
        if (err) reject(err);
        else resolve();
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

module.exports = new PersonalizationService();
