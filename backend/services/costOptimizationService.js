const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../database/healthcare.db');

class CostOptimizationService {
  constructor() {
    this.db = null;
    this.optimizationStrategies = {
      medication: {
        generic_substitution: 0.8,
        therapeutic_alternatives: 0.7,
        dose_optimization: 0.6,
        prior_authorization: 0.5
      },
      treatment: {
        preventative_care: 0.9,
        early_intervention: 0.8,
        alternative_therapies: 0.6,
        step_therapy: 0.7
      },
      insurance: {
        plan_optimization: 0.8,
        coverage_maximization: 0.7,
        deductible_management: 0.6,
        network_optimization: 0.9
      },
      lifestyle: {
        wellness_programs: 0.7,
        preventive_services: 0.8,
        health_coaching: 0.6,
        digital_health_tools: 0.5
      }
    };
    
    this.costBenchmarks = this.initializeCostBenchmarks();
  }

  getDatabase() {
    if (!this.db) {
      this.db = new sqlite3.Database(DB_PATH);
    }
    return this.db;
  }

  // Initialize cost benchmarks
  initializeCostBenchmarks() {
    return {
      medications: {
        'metformin': { brand: 150, generic: 25, savings: 83 },
        'lisinopril': { brand: 120, generic: 30, savings: 75 },
        'atorvastatin': { brand: 200, generic: 40, savings: 80 },
        'sertraline': { brand: 180, generic: 35, savings: 81 },
        'metoprolol': { brand: 100, generic: 25, savings: 75 }
      },
      treatments: {
        'physical_therapy': { average: 1500, range: [800, 2500] },
        'counseling': { average: 1200, range: [600, 2000] },
        'diabetes_education': { average: 800, range: [400, 1200] },
        'smoking_cessation': { average: 500, range: [200, 800] }
      },
      procedures: {
        'blood_pressure_screening': { average: 30, range: [20, 50] },
        'cholesterol_test': { average: 75, range: [50, 100] },
        'diabetes_screening': { average: 50, range: [30, 70] },
        'vaccination': { average: 80, range: [40, 120] }
      }
    };
  }

  // Initialize cost optimization tables
  async initializeTables() {
    const db = this.getDatabase();
    
    const tables = [
      `CREATE TABLE IF NOT EXISTS cost_optimization_rules (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        strategy TEXT NOT NULL,
        condition TEXT NOT NULL,
        recommendation TEXT NOT NULL,
        potential_savings REAL NOT NULL,
        implementation_cost REAL DEFAULT 0,
        priority_score REAL DEFAULT 0.5,
        evidence_level TEXT DEFAULT 'moderate',
        is_active BOOLEAN DEFAULT TRUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      
      `CREATE TABLE IF NOT EXISTS user_cost_optimizations (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        optimization_rule_id TEXT NOT NULL,
        current_cost REAL NOT NULL,
        optimized_cost REAL NOT NULL,
        potential_savings REAL NOT NULL,
        implementation_status TEXT DEFAULT 'suggested',
        acceptance_probability REAL DEFAULT 0.5,
        user_feedback TEXT,
        implemented_at DATETIME,
        savings_realized REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id),
        FOREIGN KEY (optimization_rule_id) REFERENCES cost_optimization_rules (id)
      )`,
      
      `CREATE TABLE IF NOT EXISTS cost_savings_tracking (
        id TEXT PRIMARY KEY,
        user_optimization_id TEXT NOT NULL,
        savings_type TEXT NOT NULL,
        original_cost REAL NOT NULL,
        new_cost REAL NOT NULL,
        savings_amount REAL NOT NULL,
        savings_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_recurring BOOLEAN DEFAULT FALSE,
        notes TEXT,
        FOREIGN KEY (user_optimization_id) REFERENCES user_cost_optimizations (id)
      )`,
      
      `CREATE TABLE IF NOT EXISTS medication_alternatives (
        id TEXT PRIMARY KEY,
        brand_name TEXT NOT NULL,
        generic_name TEXT NOT NULL,
        therapeutic_class TEXT NOT NULL,
        brand_cost REAL NOT NULL,
        generic_cost REAL NOT NULL,
        savings_percentage REAL NOT NULL,
        efficacy_equivalence TEXT DEFAULT 'equivalent',
        is_available BOOLEAN DEFAULT TRUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      
      `CREATE TABLE IF NOT EXISTS insurance_optimization_data (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        current_plan TEXT NOT NULL,
        suggested_plan TEXT NOT NULL,
        current_premium REAL NOT NULL,
        suggested_premium REAL NOT NULL,
        coverage_improvement TEXT,
        annual_savings REAL NOT NULL,
        switching_costs REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
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

    // Initialize base optimization rules
    await this.initializeOptimizationRules();
    await this.initializeMedicationAlternatives();
  }

  // Initialize optimization rules
  async initializeOptimizationRules() {
    const db = this.getDatabase();
    
    const baseRules = [
      // Medication optimization rules
      {
        category: 'medication',
        strategy: 'generic_substitution',
        condition: 'brand_name_medication',
        recommendation: 'Switch to generic equivalent when available',
        potential_savings: 0.75,
        implementation_cost: 0,
        priority_score: 0.9,
        evidence_level: 'high'
      },
      {
        category: 'medication',
        strategy: 'therapeutic_alternatives',
        condition: 'expensive_brand_medication',
        recommendation: 'Consider therapeutic alternatives with similar efficacy',
        potential_savings: 0.4,
        implementation_cost: 50,
        priority_score: 0.7,
        evidence_level: 'moderate'
      },
      {
        category: 'medication',
        strategy: 'dose_optimization',
        condition: 'suboptimal_dosing',
        recommendation: 'Optimize medication dosage for effectiveness and cost',
        potential_savings: 0.3,
        implementation_cost: 25,
        priority_score: 0.6,
        evidence_level: 'moderate'
      },
      
      // Treatment optimization rules
      {
        category: 'treatment',
        strategy: 'preventative_care',
        condition: 'high_risk_patient',
        recommendation: 'Invest in preventative care to reduce future costs',
        potential_savings: 0.5,
        implementation_cost: 200,
        priority_score: 0.8,
        evidence_level: 'high'
      },
      {
        category: 'treatment',
        strategy: 'early_intervention',
        condition: 'early_stage_condition',
        recommendation: 'Early intervention can prevent costly complications',
        potential_savings: 0.6,
        implementation_cost: 150,
        priority_score: 0.8,
        evidence_level: 'high'
      },
      {
        category: 'treatment',
        strategy: 'alternative_therapies',
        condition: 'chronic_condition',
        recommendation: 'Consider cost-effective alternative therapies',
        potential_savings: 0.35,
        implementation_cost: 100,
        priority_score: 0.6,
        evidence_level: 'moderate'
      },
      
      // Insurance optimization rules
      {
        category: 'insurance',
        strategy: 'plan_optimization',
        condition: 'suboptimal_plan',
        recommendation: 'Review and optimize insurance plan for better coverage',
        potential_savings: 0.25,
        implementation_cost: 0,
        priority_score: 0.7,
        evidence_level: 'moderate'
      },
      {
        category: 'insurance',
        strategy: 'coverage_maximization',
        condition: 'underutilized_benefits',
        recommendation: 'Maximize insurance benefits and preventive coverage',
        potential_savings: 0.3,
        implementation_cost: 0,
        priority_score: 0.6,
        evidence_level: 'high'
      },
      {
        category: 'insurance',
        strategy: 'network_optimization',
        condition: 'out_of_network_usage',
        recommendation: 'Use in-network providers to reduce costs',
        potential_savings: 0.4,
        implementation_cost: 0,
        priority_score: 0.9,
        evidence_level: 'high'
      },
      
      // Lifestyle optimization rules
      {
        category: 'lifestyle',
        strategy: 'wellness_programs',
        condition: 'sedentary_lifestyle',
        recommendation: 'Participate in wellness programs for health benefits',
        potential_savings: 0.2,
        implementation_cost: 50,
        priority_score: 0.5,
        evidence_level: 'moderate'
      },
      {
        category: 'lifestyle',
        strategy: 'preventive_services',
        condition: 'missed_preventive_care',
        recommendation: 'Utilize covered preventive services to avoid future costs',
        potential_savings: 0.3,
        implementation_cost: 0,
        priority_score: 0.7,
        evidence_level: 'high'
      }
    ];

    for (const rule of baseRules) {
      await new Promise((resolve, reject) => {
        const query = `
          INSERT OR IGNORE INTO cost_optimization_rules 
          (id, category, strategy, condition, recommendation, potential_savings, 
           implementation_cost, priority_score, evidence_level)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        db.run(query, [
          uuidv4(),
          rule.category,
          rule.strategy,
          rule.condition,
          rule.recommendation,
          rule.potential_savings,
          rule.implementation_cost,
          rule.priority_score,
          rule.evidence_level
        ], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  }

  // Initialize medication alternatives
  async initializeMedicationAlternatives() {
    const db = this.getDatabase();
    
    const alternatives = [
      { brand_name: 'Lipitor', generic_name: 'Atorvastatin', therapeutic_class: 'statin', brand_cost: 200, generic_cost: 40, savings_percentage: 80 },
      { brand_name: 'Zocor', generic_name: 'Simvastatin', therapeutic_class: 'statin', brand_cost: 180, generic_cost: 35, savings_percentage: 81 },
      { brand_name: 'Prinivil', generic_name: 'Lisinopril', therapeutic_class: 'ace_inhibitor', brand_cost: 120, generic_cost: 30, savings_percentage: 75 },
      { brand_name: 'Zoloft', generic_name: 'Sertraline', therapeutic_class: 'ssri', brand_cost: 180, generic_cost: 35, savings_percentage: 81 },
      { brand_name: 'Prozac', generic_name: 'Fluoxetine', therapeutic_class: 'ssri', brand_cost: 160, generic_cost: 30, savings_percentage: 81 },
      { brand_name: 'Glucophage', generic_name: 'Metformin', therapeutic_class: 'diabetes', brand_cost: 150, generic_cost: 25, savings_percentage: 83 },
      { brand_name: 'Lopressor', generic_name: 'Metoprolol', therapeutic_class: 'beta_blocker', brand_cost: 100, generic_cost: 25, savings_percentage: 75 },
      { brand_name: 'Norvasc', generic_name: 'Amlodipine', therapeutic_class: 'calcium_channel_blocker', brand_cost: 140, generic_cost: 35, savings_percentage: 75 }
    ];

    for (const alt of alternatives) {
      await new Promise((resolve, reject) => {
        const query = `
          INSERT OR IGNORE INTO medication_alternatives 
          (id, brand_name, generic_name, therapeutic_class, brand_cost, generic_cost, savings_percentage)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `;
        
        db.run(query, [
          uuidv4(),
          alt.brand_name,
          alt.generic_name,
          alt.therapeutic_class,
          alt.brand_cost,
          alt.generic_cost,
          alt.savings_percentage
        ], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  }

  // Generate cost optimization recommendations
  async generateCostOptimizations(userId, userProfile, currentMedications, currentTreatments, insuranceInfo) {
    try {
      const allRules = await this.getAllOptimizationRules();
      const optimizations = [];

      // Analyze medications for optimization opportunities
      const medicationOptimizations = await this.analyzeMedicationCosts(userId, currentMedications, userProfile);
      optimizations.push(...medicationOptimizations);

      // Analyze treatments for optimization opportunities
      const treatmentOptimizations = await this.analyzeTreatmentCosts(userId, currentTreatments, userProfile);
      optimizations.push(...treatmentOptimizations);

      // Analyze insurance for optimization opportunities
      const insuranceOptimizations = await this.analyzeInsuranceCosts(userId, insuranceInfo, userProfile);
      optimizations.push(...insuranceOptimizations);

      // Analyze lifestyle for optimization opportunities
      const lifestyleOptimizations = await this.analyzeLifestyleCosts(userId, userProfile);
      optimizations.push(...lifestyleOptimizations);

      // Sort by potential savings and priority
      optimizations.sort((a, b) => {
        const scoreA = a.potentialSavings * a.priorityScore;
        const scoreB = b.potentialSavings * b.priorityScore;
        return scoreB - scoreA;
      });

      // Save optimizations to database
      await this.saveUserOptimizations(userId, optimizations.slice(0, 20)); // Top 20 optimizations

      return optimizations.slice(0, 20);
    } catch (error) {
      console.error('Error generating cost optimizations:', error);
      throw error;
    }
  }

  // Get all optimization rules
  async getAllOptimizationRules() {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = 'SELECT * FROM cost_optimization_rules WHERE is_active = TRUE';
      
      db.all(query, [], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  // Analyze medication costs
  async analyzeMedicationCosts(userId, medications, userProfile) {
    const db = this.getDatabase();
    const optimizations = [];

    try {
      // Get medication alternatives
      const alternatives = await this.getMedicationAlternatives();

      for (const medication of medications) {
        // Check for generic substitution
        const genericAlt = alternatives.find(alt => 
          alt.brand_name.toLowerCase() === medication.name?.toLowerCase() ||
          alt.generic_name.toLowerCase() === medication.name?.toLowerCase()
        );

        if (genericAlt && genericAlt.generic_cost < medication.cost) {
          const savings = medication.cost - genericAlt.generic_cost;
          const savingsPercentage = (savings / medication.cost) * 100;

          optimizations.push({
            id: uuidv4(),
            category: 'medication',
            strategy: 'generic_substitution',
            medication: medication,
            alternative: genericAlt,
            currentCost: medication.cost,
            optimizedCost: genericAlt.generic_cost,
            potentialSavings: savings,
            savingsPercentage: savingsPercentage,
            implementationCost: 0,
            priorityScore: 0.9,
            acceptanceProbability: this.calculateAcceptanceProbability('medication', 'generic_substitution', userProfile),
            recommendation: `Switch ${medication.name} to generic ${genericAlt.generic_name} for $${savings.toFixed(2)} savings (${savingsPercentage.toFixed(1)}%)`
          });
        }

        // Check for therapeutic alternatives
        const therapeuticAlts = alternatives.filter(alt => 
          alt.therapeutic_class === medication.therapeuticClass &&
          alt.generic_name.toLowerCase() !== medication.name?.toLowerCase()
        );

        for (const alt of therapeuticAlts) {
          if (alt.generic_cost < medication.cost) {
            const savings = medication.cost - alt.generic_cost;
            const savingsPercentage = (savings / medication.cost) * 100;

            optimizations.push({
              id: uuidv4(),
              category: 'medication',
              strategy: 'therapeutic_alternatives',
              medication: medication,
              alternative: alt,
              currentCost: medication.cost,
              optimizedCost: alt.generic_cost,
              potentialSavings: savings,
              savingsPercentage: savingsPercentage,
              implementationCost: 50,
              priorityScore: 0.7,
              acceptanceProbability: this.calculateAcceptanceProbability('medication', 'therapeutic_alternatives', userProfile),
              recommendation: `Consider ${alt.generic_name} as therapeutic alternative to ${medication.name} for $${savings.toFixed(2)} savings (${savingsPercentage.toFixed(1)}%)`
            });
          }
        }
      }
    } catch (error) {
      console.error('Error analyzing medication costs:', error);
    }

    return optimizations;
  }

  // Analyze treatment costs
  async analyzeTreatmentCosts(userId, treatments, userProfile) {
    const optimizations = [];

    try {
      for (const treatment of treatments) {
        const benchmark = this.costBenchmarks.treatments[treatment.type];
        
        if (benchmark && treatment.cost > benchmark.average) {
          const potentialSavings = treatment.cost - benchmark.average;
          const savingsPercentage = (potentialSavings / treatment.cost) * 100;

          optimizations.push({
            id: uuidv4(),
            category: 'treatment',
            strategy: 'cost_optimization',
            treatment: treatment,
            benchmark: benchmark,
            currentCost: treatment.cost,
            optimizedCost: benchmark.average,
            potentialSavings: potentialSavings,
            savingsPercentage: savingsPercentage,
            implementationCost: 100,
            priorityScore: 0.6,
            acceptanceProbability: this.calculateAcceptanceProbability('treatment', 'cost_optimization', userProfile),
            recommendation: `Optimize ${treatment.type} treatment cost from $${treatment.cost.toFixed(2)} to $${benchmark.average.toFixed(2)} for $${potentialSavings.toFixed(2)} savings (${savingsPercentage.toFixed(1)}%)`
          });
        }

        // Check for preventative care opportunities
        if (treatment.type === 'chronic_condition_management' && treatment.cost > 1000) {
          const preventativeCost = this.costBenchmarks.treatments.preventative_care?.average || 800;
          const potentialSavings = treatment.cost * 0.3; // Assume 30% reduction with preventative care

          optimizations.push({
            id: uuidv4(),
            category: 'treatment',
            strategy: 'preventative_care',
            treatment: treatment,
            currentCost: treatment.cost,
            optimizedCost: treatment.cost - potentialSavings,
            potentialSavings: potentialSavings,
            savingsPercentage: (potentialSavings / treatment.cost) * 100,
            implementationCost: preventativeCost,
            priorityScore: 0.8,
            acceptanceProbability: this.calculateAcceptanceProbability('treatment', 'preventative_care', userProfile),
            recommendation: `Invest $${preventativeCost.toFixed(2)} in preventative care to potentially save $${potentialSavings.toFixed(2)} on ${treatment.type} management`
          });
        }
      }
    } catch (error) {
      console.error('Error analyzing treatment costs:', error);
    }

    return optimizations;
  }

  // Analyze insurance costs
  async analyzeInsuranceCosts(userId, insuranceInfo, userProfile) {
    const optimizations = [];

    try {
      // Check for plan optimization opportunities
      if (insuranceInfo.monthlyPremium > 500) {
        const potentialSavings = insuranceInfo.monthlyPremium * 0.15; // Assume 15% savings with better plan
        const annualSavings = potentialSavings * 12;

        optimizations.push({
          id: uuidv4(),
          category: 'insurance',
          strategy: 'plan_optimization',
          insuranceInfo: insuranceInfo,
          currentCost: insuranceInfo.monthlyPremium,
          optimizedCost: insuranceInfo.monthlyPremium - potentialSavings,
          potentialSavings: annualSavings,
          savingsPercentage: 15,
          implementationCost: 0,
          priorityScore: 0.7,
          acceptanceProbability: this.calculateAcceptanceProbability('insurance', 'plan_optimization', userProfile),
          recommendation: `Review insurance plan options to potentially save $${annualSavings.toFixed(2)} annually ($${potentialSavings.toFixed(2)} per month)`
        });
      }

      // Check for network optimization
      if (insuranceInfo.outOfNetworkCosts > 0) {
        const potentialSavings = insuranceInfo.outOfNetworkCosts * 0.4; // Assume 40% savings with in-network

        optimizations.push({
          id: uuidv4(),
          category: 'insurance',
          strategy: 'network_optimization',
          insuranceInfo: insuranceInfo,
          currentCost: insuranceInfo.outOfNetworkCosts,
          optimizedCost: insuranceInfo.outOfNetworkCosts - potentialSavings,
          potentialSavings: potentialSavings,
          savingsPercentage: 40,
          implementationCost: 0,
          priorityScore: 0.9,
          acceptanceProbability: this.calculateAcceptanceProbability('insurance', 'network_optimization', userProfile),
          recommendation: `Use in-network providers to save $${potentialSavings.toFixed(2)} on out-of-network costs`
        });
      }

      // Check for deductible optimization
      if (insuranceInfo.deductible > 2000) {
        const potentialSavings = insuranceInfo.deductible * 0.2; // Assume 20% savings with better plan

        optimizations.push({
          id: uuidv4(),
          category: 'insurance',
          strategy: 'deductible_management',
          insuranceInfo: insuranceInfo,
          currentCost: insuranceInfo.deductible,
          optimizedCost: insuranceInfo.deductible - potentialSavings,
          potentialSavings: potentialSavings,
          savingsPercentage: 20,
          implementationCost: 0,
          priorityScore: 0.6,
          acceptanceProbability: this.calculateAcceptanceProbability('insurance', 'deductible_management', userProfile),
          recommendation: `Consider plans with lower deductibles to save $${potentialSavings.toFixed(2)} annually`
        });
      }
    } catch (error) {
      console.error('Error analyzing insurance costs:', error);
    }

    return optimizations;
  }

  // Analyze lifestyle costs
  async analyzeLifestyleCosts(userId, userProfile) {
    const optimizations = [];

    try {
      const lifestyleFactors = userProfile.lifestyleFactors || {};

      // Wellness program recommendations
      if (lifestyleFactors.sedentary || lifestyleFactors.poor_nutrition) {
        const wellnessCost = 50;
        const potentialSavings = 200; // Estimated annual savings from improved health

        optimizations.push({
          id: uuidv4(),
          category: 'lifestyle',
          strategy: 'wellness_programs',
          lifestyleFactors: lifestyleFactors,
          currentCost: 0,
          optimizedCost: -potentialSavings, // Negative cost = savings
          potentialSavings: potentialSavings,
          savingsPercentage: 100,
          implementationCost: wellnessCost,
          priorityScore: 0.5,
          acceptanceProbability: this.calculateAcceptanceProbability('lifestyle', 'wellness_programs', userProfile),
          recommendation: `Join wellness program for $${wellnessCost} to potentially save $${potentialSavings} annually`
        });
      }

      // Preventive services utilization
      if (userProfile.ageGroup === 'senior' || userProfile.healthRiskLevel === 'high') {
        const preventiveServices = this.costBenchmarks.procedures;
        let totalPreventiveCost = 0;
        let totalPotentialSavings = 0;

        Object.entries(preventiveServices).forEach(([service, data]) => {
          totalPreventiveCost += data.average;
          totalPotentialSavings += data.average * 2; // Assume preventive care saves 2x the cost
        });

        optimizations.push({
          id: uuidv4(),
          category: 'lifestyle',
          strategy: 'preventive_services',
          userProfile: userProfile,
          currentCost: 0,
          optimizedCost: -totalPotentialSavings,
          potentialSavings: totalPotentialSavings,
          savingsPercentage: 100,
          implementationCost: totalPreventiveCost,
          priorityScore: 0.7,
          acceptanceProbability: this.calculateAcceptanceProbability('lifestyle', 'preventive_services', userProfile),
          recommendation: `Utilize preventive services for $${totalPreventiveCost.toFixed(2)} to potentially save $${totalPotentialSavings.toFixed(2)} annually`
        });
      }
    } catch (error) {
      console.error('Error analyzing lifestyle costs:', error);
    }

    return optimizations;
  }

  // Get medication alternatives
  async getMedicationAlternatives() {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = 'SELECT * FROM medication_alternatives WHERE is_available = TRUE';
      
      db.all(query, [], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  // Calculate acceptance probability
  calculateAcceptanceProbability(category, strategy, userProfile) {
    let baseProbability = 0.5;

    // Adjust based on user preferences
    if (userProfile.medicalPreferences) {
      const preferences = userProfile.medicalPreferences;
      
      if (category === 'medication' && preferences.cost_sensitivity === 'high') {
        baseProbability += 0.3;
      }
      
      if (category === 'treatment' && preferences.treatment_preference === 'conservative') {
        baseProbability -= 0.2;
      }
      
      if (category === 'insurance' && preferences.plan_preference === 'cost_focused') {
        baseProbability += 0.2;
      }
    }

    // Adjust based on strategy
    const strategyAdjustments = {
      'generic_substitution': 0.8,
      'therapeutic_alternatives': 0.6,
      'preventative_care': 0.7,
      'plan_optimization': 0.5,
      'network_optimization': 0.9,
      'wellness_programs': 0.4
    };

    baseProbability += (strategyAdjustments[strategy] || 0) - 0.5;

    return Math.min(1.0, Math.max(0, baseProbability));
  }

  // Save user optimizations
  async saveUserOptimizations(userId, optimizations) {
    const db = this.getDatabase();
    
    try {
      for (const optimization of optimizations) {
        await new Promise((resolve, reject) => {
          const query = `
            INSERT OR REPLACE INTO user_cost_optimizations 
            (id, user_id, optimization_rule_id, current_cost, optimized_cost, 
             potential_savings, implementation_status, acceptance_probability)
            VALUES (?, ?, ?, ?, ?, 'suggested', ?)
          `;
          
          db.run(query, [
            optimization.id,
            userId,
            optimization.id, // Use same ID for simplicity
            optimization.currentCost,
            optimization.optimizedCost,
            optimization.potentialSavings,
            optimization.acceptanceProbability
          ], (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      }
    } catch (error) {
      console.error('Error saving user optimizations:', error);
      throw error;
    }
  }

  // Get user cost optimizations
  async getUserCostOptimizations(userId, status = 'suggested', limit = 20) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = `
        SELECT * FROM user_cost_optimizations 
        WHERE user_id = ? AND implementation_status = ?
        ORDER BY potential_savings DESC, priority_score DESC
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

  // Update optimization status
  async updateOptimizationStatus(optimizationId, status, userFeedback = null) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      let query = 'UPDATE user_cost_optimizations SET implementation_status = ?';
      let params = [status];

      if (status === 'implemented') {
        query += ', implemented_at = CURRENT_TIMESTAMP';
      }

      if (userFeedback) {
        query += ', user_feedback = ?';
        params.push(JSON.stringify(userFeedback));
      }

      query += ' WHERE id = ?';
      params.push(optimizationId);

      db.run(query, params, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  // Record cost savings
  async recordCostSavings(optimizationId, savingsType, originalCost, newCost, isRecurring = false, notes = null) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = `
        INSERT INTO cost_savings_tracking 
        (id, user_optimization_id, savings_type, original_cost, new_cost, savings_amount, is_recurring, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      const savingsAmount = originalCost - newCost;
      
      db.run(query, [
        uuidv4(),
        optimizationId,
        savingsType,
        originalCost,
        newCost,
        savingsAmount,
        isRecurring,
        notes
      ], function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
    });
  }

  // Get cost savings statistics
  async getCostSavingsStats(userId = null, period = 90) {
    const db = this.getDatabase();
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - period);

    let query = `
      SELECT 
        SUM(savings_amount) as total_savings,
        COUNT(*) as total_optimizations,
        COUNT(CASE WHEN is_recurring = TRUE THEN 1 END) as recurring_savings,
        AVG(savings_amount) as avg_savings,
        savings_type,
        COUNT(*) as type_count
      FROM cost_savings_tracking cst
      JOIN user_cost_optimizations uco ON cst.user_optimization_id = uco.id
      WHERE cst.savings_date >= ?
    `;
    
    let params = [cutoffDate.toISOString()];

    if (userId) {
      query += ' AND uco.user_id = ?';
      params.push(userId);
    }

    query += ' GROUP BY savings_type';

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

  // Get optimization effectiveness metrics
  async getOptimizationEffectiveness(period = 180) {
    const db = this.getDatabase();
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - period);

    return new Promise((resolve, reject) => {
      const query = `
        SELECT 
          uco.category,
          uco.strategy,
          COUNT(*) as total_suggestions,
          COUNT(CASE WHEN uco.implementation_status = 'implemented' THEN 1 END) as implemented_count,
          AVG(cst.savings_amount) as avg_actual_savings,
          AVG(uco.potential_savings) as avg_potential_savings,
          COUNT(cst.savings_amount) as with_savings_data
        FROM user_cost_optimizations uco
        LEFT JOIN cost_savings_tracking cst ON uco.id = cst.user_optimization_id
        WHERE uco.created_at >= ?
        GROUP BY uco.category, uco.strategy
        ORDER BY (COUNT(CASE WHEN uco.implementation_status = 'implemented' THEN 1 END) / COUNT(*)) DESC
      `;
      
      db.all(query, [cutoffDate.toISOString()], (err, rows) => {
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

module.exports = new CostOptimizationService();
