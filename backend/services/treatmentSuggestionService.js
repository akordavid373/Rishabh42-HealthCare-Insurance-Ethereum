const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../database/healthcare.db');

class TreatmentSuggestionService {
  constructor() {
    this.db = null;
    this.treatmentCategories = {
      medication: {
        weight: 0.3,
        priority: 'high'
      },
      therapy: {
        weight: 0.25,
        priority: 'medium'
      },
      surgery: {
        weight: 0.2,
        priority: 'high'
      },
      lifestyle: {
        weight: 0.15,
        priority: 'medium'
      },
      alternative: {
        weight: 0.1,
        priority: 'low'
      }
    };
    
    this.treatmentProtocols = this.initializeTreatmentProtocols();
  }

  getDatabase() {
    if (!this.db) {
      this.db = new sqlite3.Database(DB_PATH);
    }
    return this.db;
  }

  // Initialize treatment protocols
  initializeTreatmentProtocols() {
    return {
      diabetes: {
        type1: {
          first_line: ['insulin_therapy', 'blood_glucose_monitoring', 'diabetes_education'],
          second_line: ['dietary_modification', 'exercise_program', 'continuous_glucose_monitor'],
          maintenance: ['regular_checkups', 'foot_care', 'eye_exams', 'kidney_function_tests']
        },
        type2: {
          first_line: ['metformin', 'dietary_changes', 'exercise_program'],
          second_line: ['sulfonylureas', 'dpp4_inhibitors', 'sglt2_inhibitors'],
          maintenance: ['regular_monitoring', 'weight_management', 'cardiovascular_risk_reduction']
        }
      },
      hypertension: {
        stage1: {
          first_line: ['lifestyle_modification', 'ace_inhibitors', 'arb_medications'],
          second_line: ['calcium_channel_blockers', 'diuretics'],
          maintenance: ['regular_monitoring', 'dietary_sodium_restriction', 'exercise']
        },
        stage2: {
          first_line: ['combination_therapy', 'ace_inhibitor_plus_diuretic'],
          second_line: ['multiple_medications', 'specialist_consultation'],
          maintenance: ['intensive_monitoring', 'lifestyle_program', 'regular_followups']
        }
      },
      depression: {
        mild: {
          first_line: ['psychotherapy', 'counseling', 'lifestyle_changes'],
          second_line: ['ssri_medications', 'snri_medications'],
          maintenance: ['continued_therapy', 'support_groups', 'lifestyle_maintenance']
        },
        moderate: {
          first_line: ['psychotherapy_plus_medication', 'ssri_medications'],
          second_line: ['combination_therapy', 'tms_therapy'],
          maintenance: ['long_term_therapy', 'medication_management', 'support_systems']
        },
        severe: {
          first_line: ['combination_therapy', 'psychiatrist_consultation', 'intensive_therapy'],
          second_line: ['ect_therapy', 'medication_adjustment'],
          maintenance: ['ongoing_care', 'crisis_intervention', 'support_services']
        }
      },
      chronic_pain: {
        mild: {
          first_line: ['physical_therapy', 'nsaid_medications', 'exercise'],
          second_line: ['nerve_pain_medications', 'topical_treatments'],
          maintenance: ['exercise_program', 'pain_management_techniques']
        },
        moderate: {
          first_line: ['multimodal_therapy', 'opioid_medications', 'intensive_pt'],
          second_line: ['interventional_procedures', 'psychological_therapy'],
          maintenance: ['comprehensive_pain_program', 'medication_review']
        },
        severe: {
          first_line: ['specialized_pain_clinic', 'advanced_interventions', 'multidisciplinary_approach'],
          second_line: ['neuromodulation', 'advanced_procedures'],
          maintenance: ['long_term_management', 'support_services']
        }
      }
    };
  }

  // Initialize treatment suggestion tables
  async initializeTables() {
    const db = this.getDatabase();
    
    const tables = [
      `CREATE TABLE IF NOT EXISTS treatment_protocols (
        id TEXT PRIMARY KEY,
        condition_code TEXT NOT NULL,
        condition_name TEXT NOT NULL,
        severity_level TEXT NOT NULL,
        treatment_category TEXT NOT NULL,
        treatment_name TEXT NOT NULL,
        treatment_description TEXT,
        effectiveness_score REAL DEFAULT 0.5,
        evidence_level TEXT DEFAULT 'moderate',
        side_effects TEXT,
        contraindications TEXT,
        cost_tier TEXT DEFAULT 'medium',
        duration TEXT,
        frequency TEXT,
        is_first_line BOOLEAN DEFAULT FALSE,
        is_active BOOLEAN DEFAULT TRUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      
      `CREATE TABLE IF NOT EXISTS treatment_suggestions (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        condition_code TEXT NOT NULL,
        severity_level TEXT NOT NULL,
        treatment_protocol_id TEXT NOT NULL,
        personalization_score REAL NOT NULL,
        confidence_score REAL NOT NULL,
        priority_score REAL NOT NULL,
        status TEXT DEFAULT 'suggested',
        suggested_by TEXT DEFAULT 'ai',
        physician_reviewed BOOLEAN DEFAULT FALSE,
        physician_notes TEXT,
        user_accepted BOOLEAN,
        user_feedback TEXT,
        effectiveness_rating REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )`,
      
      `CREATE TABLE IF NOT EXISTS treatment_outcomes (
        id TEXT PRIMARY KEY,
        treatment_suggestion_id TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        outcome_type TEXT NOT NULL,
        outcome_value REAL NOT NULL,
        outcome_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        notes TEXT,
        FOREIGN KEY (treatment_suggestion_id) REFERENCES treatment_suggestions (id),
        FOREIGN KEY (user_id) REFERENCES users (id)
      )`,
      
      `CREATE TABLE IF NOT EXISTS treatment_evidence (
        id TEXT PRIMARY KEY,
        treatment_protocol_id TEXT NOT NULL,
        study_title TEXT NOT NULL,
        study_type TEXT NOT NULL,
        sample_size INTEGER,
        effect_size REAL,
        confidence_interval TEXT,
        p_value REAL,
        publication_date DATE,
        source TEXT NOT NULL,
        quality_score REAL DEFAULT 0.5,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (treatment_protocol_id) REFERENCES treatment_protocols (id)
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

    // Initialize base treatment protocols
    await this.initializeBaseTreatmentProtocols();
  }

  // Initialize base treatment protocols
  async initializeBaseTreatmentProtocols() {
    const db = this.getDatabase();
    
    const baseProtocols = [
      // Diabetes Treatments
      {
        condition_code: 'diabetes_type1',
        condition_name: 'Type 1 Diabetes',
        severity_level: 'all',
        treatment_category: 'medication',
        treatment_name: 'Insulin Therapy',
        treatment_description: 'Multiple daily insulin injections or insulin pump therapy for blood glucose control',
        effectiveness_score: 0.95,
        evidence_level: 'high',
        side_effects: JSON.stringify(['hypoglycemia', 'weight_gain', 'injection_site_reactions']),
        contraindications: JSON.stringify(['insulin_allergy', 'hypoglycemia_unawareness']),
        cost_tier: 'high',
        duration: 'lifelong',
        frequency: 'daily',
        is_first_line: true
      },
      {
        condition_code: 'diabetes_type2',
        condition_name: 'Type 2 Diabetes',
        severity_level: 'mild',
        treatment_category: 'medication',
        treatment_name: 'Metformin',
        treatment_description: 'First-line oral medication for type 2 diabetes management',
        effectiveness_score: 0.8,
        evidence_level: 'high',
        side_effects: JSON.stringify(['gastrointestinal_issues', 'lactic_acidosis_rare']),
        contraindications: JSON.stringify(['renal_impairment', 'liver_disease']),
        cost_tier: 'low',
        duration: 'long_term',
        frequency: 'twice_daily',
        is_first_line: true
      },
      
      // Hypertension Treatments
      {
        condition_code: 'hypertension_stage1',
        condition_name: 'Hypertension Stage 1',
        severity_level: 'mild',
        treatment_category: 'medication',
        treatment_name: 'ACE Inhibitors',
        treatment_description: 'Angiotensin-converting enzyme inhibitors for blood pressure control',
        effectiveness_score: 0.85,
        evidence_level: 'high',
        side_effects: JSON.stringify(['dry_cough', 'hyperkalemia', 'angioedema_rare']),
        contraindications: JSON.stringify(['pregnancy', 'bilateral_artery_stenosis']),
        cost_tier: 'medium',
        duration: 'long_term',
        frequency: 'daily',
        is_first_line: true
      },
      {
        condition_code: 'hypertension_stage2',
        condition_name: 'Hypertension Stage 2',
        severity_level: 'moderate',
        treatment_category: 'medication',
        treatment_name: 'Combination Therapy',
        treatment_description: 'Multiple antihypertensive medications for better blood pressure control',
        effectiveness_score: 0.9,
        evidence_level: 'high',
        side_effects: JSON.stringify(['medication_side_effects', 'drug_interactions']),
        contraindications: JSON.stringify(['severe_hypotension', 'renal_impairment']),
        cost_tier: 'high',
        duration: 'long_term',
        frequency: 'daily',
        is_first_line: true
      },
      
      // Depression Treatments
      {
        condition_code: 'depression_mild',
        condition_name: 'Mild Depression',
        severity_level: 'mild',
        treatment_category: 'therapy',
        treatment_name: 'Cognitive Behavioral Therapy',
        treatment_description: 'Psychotherapy focusing on changing negative thought patterns and behaviors',
        effectiveness_score: 0.75,
        evidence_level: 'high',
        side_effects: JSON.stringify(['emotional_discomfort', 'time_commitment']),
        contraindications: JSON.stringify(['severe_cognitive_impairment', 'psychosis']),
        cost_tier: 'medium',
        duration: '12_16_weeks',
        frequency: 'weekly',
        is_first_line: true
      },
      {
        condition_code: 'depression_moderate',
        condition_name: 'Moderate Depression',
        severity_level: 'moderate',
        treatment_category: 'medication',
        treatment_name: 'SSRI Medications',
        treatment_description: 'Selective serotonin reuptake inhibitors for depression treatment',
        effectiveness_score: 0.8,
        evidence_level: 'high',
        side_effects: JSON.stringify(['nausea', 'sexual_dysfunction', 'weight_changes', 'insomnia']),
        contraindications: JSON.stringify(['bipolar_disorder', 'maoi_use']),
        cost_tier: 'medium',
        duration: '6_12_months',
        frequency: 'daily',
        is_first_line: true
      },
      
      // Chronic Pain Treatments
      {
        condition_code: 'chronic_pain_mild',
        condition_name: 'Mild Chronic Pain',
        severity_level: 'mild',
        treatment_category: 'medication',
        treatment_name: 'NSAID Medications',
        treatment_description: 'Non-steroidal anti-inflammatory drugs for pain management',
        effectiveness_score: 0.7,
        evidence_level: 'moderate',
        side_effects: JSON.stringify(['gastrointestinal_bleeding', 'kidney_problems', 'cardiovascular_risk']),
        contraindications: JSON.stringify(['gi_bleeding_history', 'kidney_disease', 'cardiovascular_disease']),
        cost_tier: 'low',
        duration: 'short_term',
        frequency: 'as_needed',
        is_first_line: true
      },
      {
        condition_code: 'chronic_pain_moderate',
        condition_name: 'Moderate Chronic Pain',
        severity_level: 'moderate',
        treatment_category: 'therapy',
        treatment_name: 'Physical Therapy',
        treatment_description: 'Therapeutic exercises and manual therapy for pain management',
        effectiveness_score: 0.75,
        evidence_level: 'high',
        side_effects: JSON.stringify(['muscle_soreness', 'temporary_discomfort']),
        contraindications: JSON.stringify(['severe_osteoporosis', 'recent_surgery']),
        cost_tier: 'medium',
        duration: '6_12_weeks',
        frequency: '2_3_times_weekly',
        is_first_line: true
      }
    ];

    for (const protocol of baseProtocols) {
      await new Promise((resolve, reject) => {
        const query = `
          INSERT OR IGNORE INTO treatment_protocols 
          (id, condition_code, condition_name, severity_level, treatment_category, treatment_name, 
           treatment_description, effectiveness_score, evidence_level, side_effects, contraindications, 
           cost_tier, duration, frequency, is_first_line)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        db.run(query, [
          uuidv4(),
          protocol.condition_code,
          protocol.condition_name,
          protocol.severity_level,
          protocol.treatment_category,
          protocol.treatment_name,
          protocol.treatment_description,
          protocol.effectiveness_score,
          protocol.evidence_level,
          protocol.side_effects,
          protocol.contraindications,
          protocol.cost_tier,
          protocol.duration,
          protocol.frequency,
          protocol.is_first_line
        ], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  }

  // Generate treatment suggestions for user
  async generateTreatmentSuggestions(userId, conditions, userProfile, preferences) {
    try {
      const allProtocols = await this.getAllTreatmentProtocols();
      const suggestions = [];

      for (const condition of conditions) {
        const conditionProtocols = allProtocols.filter(p => 
          p.condition_code === condition.code || 
          p.condition_code === `${condition.code}_${condition.severity}`
        );

        for (const protocol of conditionProtocols) {
          if (!protocol.is_active) continue;

          const score = await this.calculateTreatmentScore(
            protocol,
            condition,
            userProfile,
            preferences
          );

          if (score >= 0.3) { // Minimum threshold
            suggestions.push({
              ...protocol,
              condition: condition,
              personalizationScore: score,
              confidenceScore: this.calculateConfidenceScore(protocol, condition),
              priorityScore: this.calculateTreatmentPriorityScore(protocol, score)
            });
          }
        }
      }

      // Sort by priority score and personalization score
      suggestions.sort((a, b) => {
        if (b.priorityScore !== a.priorityScore) {
          return b.priorityScore - a.priorityScore;
        }
        return b.personalizationScore - a.personalizationScore;
      });

      // Save suggestions to database
      await this.saveTreatmentSuggestions(userId, suggestions.slice(0, 15)); // Top 15 suggestions

      return suggestions.slice(0, 15);
    } catch (error) {
      console.error('Error generating treatment suggestions:', error);
      throw error;
    }
  }

  // Get all treatment protocols
  async getAllTreatmentProtocols() {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = 'SELECT * FROM treatment_protocols WHERE is_active = TRUE';
      
      db.all(query, [], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const protocols = rows.map(row => ({
            ...row,
            side_effects: JSON.parse(row.side_effects || '[]'),
            contraindications: JSON.parse(row.contraindications || '[]')
          }));
          resolve(protocols);
        }
      });
    });
  }

  // Calculate treatment score for user
  async calculateTreatmentScore(protocol, condition, userProfile, preferences) {
    let score = 0;
    let factors = 0;

    // Severity matching
    const severityScore = this.getSeverityRelevance(protocol.severity_level, condition.severity);
    score += severityScore * 0.3;
    factors += 0.3;

    // Effectiveness and evidence
    const effectivenessScore = (protocol.effectiveness_score + this.getEvidenceWeight(protocol.evidence_level)) / 2;
    score += effectivenessScore * 0.25;
    factors += 0.25;

    // User preferences
    if (preferences && preferences.treatmentPreferences) {
      const preferenceScore = this.getTreatmentPreferenceScore(protocol.treatment_category, preferences.treatmentPreferences);
      score += preferenceScore * 0.2;
      factors += 0.2;
    }

    // Cost sensitivity
    if (preferences && preferences.costSensitivity) {
      const costScore = this.getCostRelevanceScore(protocol.cost_tier, preferences.costSensitivity);
      score += costScore * 0.15;
      factors += 0.15;
    }

    // Safety considerations
    const safetyScore = this.getSafetyScore(protocol, userProfile, condition);
    score += safetyScore * 0.1;
    factors += 0.1;

    return factors > 0 ? score : 0;
  }

  // Get severity relevance score
  getSeverityRelevance(protocolSeverity, conditionSeverity) {
    if (protocolSeverity === 'all') return 1.0;
    if (protocolSeverity === conditionSeverity) return 1.0;
    
    // Adjacent severity levels get partial score
    const severityLevels = ['mild', 'moderate', 'severe'];
    const protocolIndex = severityLevels.indexOf(protocolSeverity);
    const conditionIndex = severityLevels.indexOf(conditionSeverity);
    
    if (Math.abs(protocolIndex - conditionIndex) === 1) {
      return 0.7;
    }
    
    return 0.3;
  }

  // Get evidence weight
  getEvidenceWeight(evidenceLevel) {
    const weights = {
      'high': 1.0,
      'moderate': 0.7,
      'low': 0.4,
      'very_low': 0.2
    };
    
    return weights[evidenceLevel] || 0.5;
  }

  // Get treatment preference score
  getTreatmentPreferenceScore(treatmentCategory, userPreferences) {
    const preference = userPreferences[treatmentCategory];
    
    if (!preference) return 0.5;
    
    if (preference === 'preferred') return 1.0;
    if (preference === 'acceptable') return 0.7;
    if (preference === 'avoid') return 0.1;
    
    return 0.5;
  }

  // Get cost relevance score
  getCostRelevanceScore(costTier, costSensitivity) {
    const costScores = {
      'low': { 'high': 0.9, 'medium': 0.8, 'low': 0.6 },
      'medium': { 'high': 0.6, 'medium': 0.8, 'low': 0.9 },
      'high': { 'high': 0.3, 'medium': 0.6, 'low': 0.9 }
    };
    
    return costScores[costTier]?.[costSensitivity] || 0.5;
  }

  // Get safety score
  getSafetyScore(protocol, userProfile, condition) {
    let safetyScore = 0.8; // Base safety score
    
    // Check for contraindications
    if (userProfile.allergies) {
      const hasContraindication = protocol.contraindications.some(contra => 
        userProfile.allergies.some(allergy => 
          allergy.toLowerCase().includes(contra.toLowerCase()) ||
          contra.toLowerCase().includes(allergy.toLowerCase())
        )
      );
      
      if (hasContraindication) {
        safetyScore -= 0.5;
      }
    }
    
    // Check age appropriateness
    if (userProfile.ageGroup) {
      const ageRestrictions = this.getAgeRestrictions(protocol.treatment_name);
      if (ageRestrictions && !ageRestrictions.includes(userProfile.ageGroup)) {
        safetyScore -= 0.3;
      }
    }
    
    // Check comorbidities
    if (userProfile.medicalHistory) {
      const comorbidityRisk = this.checkComorbidityRisk(protocol, userProfile.medicalHistory);
      safetyScore -= comorbidityRisk;
    }
    
    return Math.max(0, safetyScore);
  }

  // Get age restrictions for treatment
  getAgeRestrictions(treatmentName) {
    const restrictions = {
      'SSRI Medications': ['adult', 'senior'],
      'ACE Inhibitors': ['adult', 'senior', 'elderly'],
      'Metformin': ['adult', 'senior', 'elderly'],
      'Insulin Therapy': ['pediatric', 'adult', 'senior', 'elderly']
    };
    
    return restrictions[treatmentName];
  }

  // Check comorbidity risk
  checkComorbidityRisk(protocol, medicalHistory) {
    let risk = 0;
    
    // High-risk comorbidity combinations
    const highRiskCombinations = [
      { treatment: 'NSAID Medications', comorbidities: ['renal_disease', 'gi_bleeding'] },
      { treatment: 'SSRI Medications', comorbidities: ['bipolar_disorder', 'liver_disease'] },
      { treatment: 'ACE Inhibitors', comorbidities: ['pregnancy', 'bilateral_artery_stenosis'] }
    ];
    
    const highRisk = highRiskCombinations.find(risk => 
      risk.treatment === protocol.treatment_name
    );
    
    if (highRisk) {
      const hasComorbidity = highRisk.comorbidities.some(comorbidity =>
        medicalHistory.some(condition =>
          condition.type === comorbidity ||
          condition.name?.toLowerCase().includes(comorbidity.toLowerCase())
        )
      );
      
      if (hasComorbidity) {
        risk += 0.4;
      }
    }
    
    return risk;
  }

  // Calculate confidence score
  calculateConfidenceScore(protocol, condition) {
    let confidence = protocol.effectiveness_score;
    
    // Boost confidence for first-line treatments
    if (protocol.is_first_line) {
      confidence += 0.1;
    }
    
    // Boost confidence for high evidence level
    if (protocol.evidence_level === 'high') {
      confidence += 0.1;
    }
    
    // Reduce confidence for very new or experimental treatments
    if (protocol.evidence_level === 'very_low') {
      confidence -= 0.2;
    }
    
    return Math.min(1.0, Math.max(0, confidence));
  }

  // Calculate treatment priority score
  calculateTreatmentPriorityScore(protocol, personalizationScore) {
    const categoryWeight = this.treatmentCategories[protocol.treatment_category]?.weight || 0.5;
    const priorityWeight = this.getPriorityWeight(protocol);
    
    return (personalizationScore * 0.4) + (priorityWeight * 0.3) + (categoryWeight * 0.3);
  }

  // Get priority weight
  getPriorityWeight(protocol) {
    const weights = {
      'critical': 1.0,
      'high': 0.8,
      'medium': 0.6,
      'low': 0.4
    };
    
    // Determine priority based on treatment category and effectiveness
    if (protocol.treatment_category === 'medication' && protocol.effectiveness_score > 0.8) {
      return weights['high'];
    } else if (protocol.treatment_category === 'surgery') {
      return weights['high'];
    } else if (protocol.treatment_category === 'therapy') {
      return weights['medium'];
    } else {
      return weights['medium'];
    }
  }

  // Save treatment suggestions
  async saveTreatmentSuggestions(userId, suggestions) {
    const db = this.getDatabase();
    
    try {
      for (const suggestion of suggestions) {
        await new Promise((resolve, reject) => {
          const query = `
            INSERT OR REPLACE INTO treatment_suggestions 
            (id, user_id, condition_code, severity_level, treatment_protocol_id, 
             personalization_score, confidence_score, priority_score, status, suggested_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'suggested', 'ai')
          `;
          
          db.run(query, [
            uuidv4(),
            userId,
            suggestion.condition.code,
            suggestion.condition.severity || 'unknown',
            suggestion.id,
            suggestion.personalizationScore,
            suggestion.confidenceScore,
            suggestion.priorityScore
          ], (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      }
    } catch (error) {
      console.error('Error saving treatment suggestions:', error);
      throw error;
    }
  }

  // Get user treatment suggestions
  async getUserTreatmentSuggestions(userId, status = 'suggested', limit = 20) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = `
        SELECT ts.*, tp.treatment_name, tp.treatment_description, tp.treatment_category, 
               tp.cost_tier, tp.duration, tp.frequency, tp.side_effects, tp.contraindications
        FROM treatment_suggestions ts
        JOIN treatment_protocols tp ON ts.treatment_protocol_id = tp.id
        WHERE ts.user_id = ? AND ts.status = ?
        ORDER BY ts.priority_score DESC, ts.personalization_score DESC
        LIMIT ?
      `;
      
      db.all(query, [userId, status, limit], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const suggestions = rows.map(row => ({
            ...row,
            side_effects: JSON.parse(row.side_effects || '[]'),
            contraindications: JSON.parse(row.contraindications || '[]')
          }));
          resolve(suggestions);
        }
      });
    });
  }

  // Update treatment suggestion status
  async updateTreatmentSuggestionStatus(suggestionId, status, physicianReviewed = false, physicianNotes = null) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = `
        UPDATE treatment_suggestions 
        SET status = ?, physician_reviewed = ?, physician_notes = ?
        WHERE id = ?
      `;
      
      db.run(query, [status, physicianReviewed, physicianNotes, suggestionId], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  // Record treatment outcome
  async recordTreatmentOutcome(suggestionId, userId, outcomeType, outcomeValue, notes = null) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = `
        INSERT INTO treatment_outcomes 
        (id, treatment_suggestion_id, user_id, outcome_type, outcome_value, notes)
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      
      db.run(query, [uuidv4(), suggestionId, userId, outcomeType, outcomeValue, notes], function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
    });
  }

  // Get treatment effectiveness metrics
  async getTreatmentEffectivenessMetrics(treatmentName = null, period = 90) {
    const db = this.getDatabase();
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - period);

    let query = `
      SELECT 
        tp.treatment_name,
        tp.treatment_category,
        AVG(ts.effectiveness_rating) as avg_effectiveness,
        COUNT(ts.effectiveness_rating) as rating_count,
        COUNT(CASE WHEN ts.user_accepted = TRUE THEN 1 END) as acceptance_count,
        COUNT(*) as total_suggestions,
        AVG(to.outcome_value) as avg_outcome_score
      FROM treatment_suggestions ts
      JOIN treatment_protocols tp ON ts.treatment_protocol_id = tp.id
      LEFT JOIN treatment_outcomes to ON ts.id = to.treatment_suggestion_id
      WHERE ts.created_at >= ?
    `;
    
    let params = [cutoffDate.toISOString()];

    if (treatmentName) {
      query += ' AND tp.treatment_name = ?';
      params.push(treatmentName);
    }

    query += ' GROUP BY tp.id, tp.treatment_name, tp.treatment_category ORDER BY avg_effectiveness DESC';

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

  // Get treatment statistics
  async getTreatmentStats(userId = null, period = 30) {
    const db = this.getDatabase();
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - period);

    let query = `
      SELECT 
        COUNT(*) as total_suggestions,
        COUNT(CASE WHEN status = 'accepted' THEN 1 END) as accepted_suggestions,
        COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected_suggestions,
        COUNT(CASE WHEN physician_reviewed = TRUE THEN 1 END) as physician_reviewed,
        AVG(effectiveness_rating) as avg_effectiveness_rating,
        tp.treatment_category,
        COUNT(*) as category_count
      FROM treatment_suggestions ts
      JOIN treatment_protocols tp ON ts.treatment_protocol_id = tp.id
      WHERE ts.created_at >= ?
    `;
    
    let params = [cutoffDate.toISOString()];

    if (userId) {
      query += ' AND ts.user_id = ?';
      params.push(userId);
    }

    query += ' GROUP BY tp.treatment_category';

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

module.exports = new TreatmentSuggestionService();
