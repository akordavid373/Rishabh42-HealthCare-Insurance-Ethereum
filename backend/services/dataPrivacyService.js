const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../database/healthcare.db');

class DataPrivacyService {
  constructor() {
    this.db = null;
    this.encryptionKey = process.env.ENCRYPTION_KEY || this.generateEncryptionKey();
    this.privacyLevels = {
      public: 0,
      internal: 1,
      confidential: 2,
      restricted: 3,
      phi: 4 // Protected Health Information
    };
    this.consentTypes = {
      treatment: 'treatment',
      payment: 'payment',
      healthcare_operations: 'healthcare_operations',
      research: 'research',
      marketing: 'marketing'
    };
    this.retentionPeriods = {
      medical_records: 7 * 365, // 7 years
      billing_records: 7 * 365, // 7 years
      phi_data: 7 * 365, // 7 years
      consent_records: 6 * 365, // 6 years
      audit_logs: 6 * 365 // 6 years
    };
  }

  getDatabase() {
    if (!this.db) {
      this.db = new sqlite3.Database(DB_PATH);
    }
    return this.db;
  }

  // Generate encryption key
  generateEncryptionKey() {
    return crypto.randomBytes(32).toString('hex');
  }

  // Initialize data privacy tables
  async initializeTables() {
    const db = this.getDatabase();
    
    const tables = [
      `CREATE TABLE IF NOT EXISTS consent_records (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        consent_type TEXT NOT NULL,
        consent_given BOOLEAN NOT NULL,
        consent_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        expiry_date DATETIME,
        purpose TEXT NOT NULL,
        data_categories TEXT NOT NULL,
        third_parties TEXT,
        withdrawal_date DATETIME,
        ip_address TEXT,
        user_agent TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )`,
      
      `CREATE TABLE IF NOT EXISTS data_access_logs (
        id TEXT PRIMARY KEY,
        user_id INTEGER,
        accessed_by INTEGER NOT NULL,
        data_type TEXT NOT NULL,
        data_id TEXT NOT NULL,
        access_purpose TEXT NOT NULL,
        access_method TEXT NOT NULL,
        access_granted BOOLEAN NOT NULL,
        access_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        ip_address TEXT,
        user_agent TEXT,
        session_id TEXT,
        FOREIGN KEY (user_id) REFERENCES users (id),
        FOREIGN KEY (accessed_by) REFERENCES users (id)
      )`,
      
      `CREATE TABLE IF NOT EXISTS data_retention_policies (
        id TEXT PRIMARY KEY,
        data_type TEXT NOT NULL,
        retention_period INTEGER NOT NULL,
        retention_unit TEXT NOT NULL,
        auto_delete BOOLEAN DEFAULT TRUE,
        notification_before_delete INTEGER DEFAULT 30,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      
      `CREATE TABLE IF NOT EXISTS encrypted_data (
        id TEXT PRIMARY KEY,
        data_type TEXT NOT NULL,
        data_id TEXT NOT NULL,
        encrypted_content TEXT NOT NULL,
        encryption_algorithm TEXT DEFAULT 'aes-256-gcm',
        iv TEXT NOT NULL,
        tag TEXT NOT NULL,
        privacy_level INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME
      )`,
      
      `CREATE TABLE IF NOT EXISTS data_subject_requests (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        request_type TEXT NOT NULL,
        request_data TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        processed_date DATETIME,
        response_data TEXT,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )`,
      
      `CREATE TABLE IF NOT EXISTS privacy_audits (
        id TEXT PRIMARY KEY,
        audit_type TEXT NOT NULL,
        audit_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        scope TEXT NOT NULL,
        findings TEXT NOT NULL,
        recommendations TEXT,
        status TEXT DEFAULT 'open',
        auditor_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (auditor_id) REFERENCES users (id)
      )`,
      
      `CREATE TABLE IF NOT EXISTS data_anonymization (
        id TEXT PRIMARY KEY,
        original_data_id TEXT NOT NULL,
        anonymized_data TEXT NOT NULL,
        anonymization_method TEXT NOT NULL,
        privacy_level INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

    // Initialize retention policies
    await this.initializeRetentionPolicies();
  }

  // Initialize retention policies
  async initializeRetentionPolicies() {
    const db = this.getDatabase();
    
    const policies = [
      { data_type: 'medical_records', retention_period: 7, retention_unit: 'years', auto_delete: true },
      { data_type: 'billing_records', retention_period: 7, retention_unit: 'years', auto_delete: true },
      { data_type: 'consent_records', retention_period: 6, retention_unit: 'years', auto_delete: true },
      { data_type: 'audit_logs', retention_period: 6, retention_unit: 'years', auto_delete: true },
      { data_type: 'user_profiles', retention_period: 10, retention_unit: 'years', auto_delete: false },
      { data_type: 'recommendation_history', retention_period: 5, retention_unit: 'years', auto_delete: true }
    ];

    for (const policy of policies) {
      await new Promise((resolve, reject) => {
        const query = `
          INSERT OR IGNORE INTO data_retention_policies 
          (id, data_type, retention_period, retention_unit, auto_delete)
          VALUES (?, ?, ?, ?, ?)
        `;
        
        db.run(query, [
          uuidv4(),
          policy.data_type,
          policy.retention_period,
          policy.retention_unit,
          policy.auto_delete
        ], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  }

  // Encrypt sensitive data
  encryptData(data, privacyLevel = 'confidential') {
    try {
      const dataString = JSON.stringify(data);
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipher('aes-256-gcm', this.encryptionKey);
      cipher.setAAD(Buffer.from(privacyLevel));
      
      let encrypted = cipher.update(dataString, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      const tag = cipher.getAuthTag();
      
      return {
        encryptedContent: encrypted,
        iv: iv.toString('hex'),
        tag: tag.toString('hex'),
        algorithm: 'aes-256-gcm'
      };
    } catch (error) {
      console.error('Error encrypting data:', error);
      throw error;
    }
  }

  // Decrypt sensitive data
  decryptData(encryptedData, iv, tag, privacyLevel = 'confidential') {
    try {
      const decipher = crypto.createDecipher('aes-256-gcm', this.encryptionKey);
      decipher.setAAD(Buffer.from(privacyLevel));
      decipher.setAuthTag(Buffer.from(tag, 'hex'));
      
      let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return JSON.parse(decrypted);
    } catch (error) {
      console.error('Error decrypting data:', error);
      throw error;
    }
  }

  // Store encrypted data
  async storeEncryptedData(dataType, dataId, data, privacyLevel = 'confidential', expiresAt = null) {
    const db = this.getDatabase();
    
    try {
      const encrypted = this.encryptData(data, privacyLevel);
      
      return new Promise((resolve, reject) => {
        const query = `
          INSERT INTO encrypted_data 
          (id, data_type, data_id, encrypted_content, encryption_algorithm, iv, tag, privacy_level, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        db.run(query, [
          uuidv4(),
          dataType,
          dataId,
          encrypted.encryptedContent,
          encrypted.algorithm,
          encrypted.iv,
          encrypted.tag,
          this.privacyLevels[privacyLevel],
          expiresAt
        ], function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        });
      });
    } catch (error) {
      console.error('Error storing encrypted data:', error);
      throw error;
    }
  }

  // Retrieve encrypted data
  async retrieveEncryptedData(dataType, dataId) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = `
        SELECT * FROM encrypted_data 
        WHERE data_type = ? AND data_id = ? 
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
      `;
      
      db.get(query, [dataType, dataId], (err, row) => {
        if (err) {
          reject(err);
        } else if (row) {
          try {
            const privacyLevel = Object.keys(this.privacyLevels).find(
              key => this.privacyLevels[key] === row.privacy_level
            );
            
            const decryptedData = this.decryptData(
              row.encrypted_content,
              row.iv,
              row.tag,
              privacyLevel
            );
            
            resolve(decryptedData);
          } catch (decryptError) {
            reject(decryptError);
          }
        } else {
          resolve(null);
        }
      });
    });
  }

  // Record consent
  async recordConsent(userId, consentType, consentGiven, purpose, dataCategories, thirdParties = null, expiryDate = null) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = `
        INSERT INTO consent_records 
        (id, user_id, consent_type, consent_given, purpose, data_categories, third_parties, expiry_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      db.run(query, [
        uuidv4(),
        userId,
        consentType,
        consentGiven,
        purpose,
        JSON.stringify(dataCategories),
        thirdParties ? JSON.stringify(thirdParties) : null,
        expiryDate
      ], function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
    });
  }

  // Check consent
  async checkConsent(userId, consentType, dataCategory = null) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = `
        SELECT * FROM consent_records 
        WHERE user_id = ? AND consent_type = ? AND consent_given = TRUE
        AND (expiry_date IS NULL OR expiry_date > CURRENT_TIMESTAMP)
        AND withdrawal_date IS NULL
        ORDER BY consent_date DESC
        LIMIT 1
      `;
      
      db.get(query, [userId, consentType], (err, row) => {
        if (err) {
          reject(err);
        } else if (row) {
          const dataCategories = JSON.parse(row.data_categories || '[]');
          const hasConsent = dataCategory ? dataCategories.includes(dataCategory) : true;
          
          resolve({
            hasConsent: hasConsent,
            consentRecord: row,
            dataCategories: dataCategories
          });
        } else {
          resolve({
            hasConsent: false,
            consentRecord: null,
            dataCategories: []
          });
        }
      });
    });
  }

  // Withdraw consent
  async withdrawConsent(userId, consentType, reason = null) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = `
        UPDATE consent_records 
        SET withdrawal_date = CURRENT_TIMESTAMP
        WHERE user_id = ? AND consent_type = ? AND consent_given = TRUE
        AND withdrawal_date IS NULL
      `;
      
      db.run(query, [userId, consentType], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  // Log data access
  async logDataAccess(userId, accessedBy, dataType, dataId, accessPurpose, accessMethod, accessGranted, ipAddress = null, userAgent = null, sessionId = null) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = `
        INSERT INTO data_access_logs 
        (id, user_id, accessed_by, data_type, data_id, access_purpose, access_method, access_granted, ip_address, user_agent, session_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      db.run(query, [
        uuidv4(),
        userId,
        accessedBy,
        dataType,
        dataId,
        accessPurpose,
        accessMethod,
        accessGranted,
        ipAddress,
        userAgent,
        sessionId
      ], function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
    });
  }

  // Check data access permissions
  async checkDataAccessPermissions(userId, requestingUserId, dataType, accessPurpose) {
    try {
      // Check if user is accessing their own data
      if (userId === requestingUserId) {
        return { hasPermission: true, reason: 'self_access' };
      }

      // Check consent for third-party access
      const consent = await this.checkConsent(userId, 'healthcare_operations');
      
      if (consent.hasConsent) {
        return { hasPermission: true, reason: 'consent_granted', consentRecord: consent.consentRecord };
      }

      // Check if requester has administrative privileges
      const requesterRole = await this.getUserRole(requestingUserId);
      if (requesterRole === 'admin' || requesterRole === 'provider') {
        return { hasPermission: true, reason: 'administrative_access', role: requesterRole };
      }

      return { hasPermission: false, reason: 'no_consent_or_permission' };
    } catch (error) {
      console.error('Error checking data access permissions:', error);
      return { hasPermission: false, reason: 'error_checking_permissions' };
    }
  }

  // Get user role
  async getUserRole(userId) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = 'SELECT role FROM users WHERE id = ?';
      
      db.get(query, [userId], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row ? row.role : null);
        }
      });
    });
  }

  // Anonymize data
  async anonymizeData(originalData, anonymizationMethod = 'generalization') {
    try {
      let anonymizedData = { ...originalData };
      
      switch (anonymizationMethod) {
        case 'generalization':
          anonymizedData = this.generalizeData(anonymizedData);
          break;
        case 'suppression':
          anonymizedData = this.suppressData(anonymizedData);
          break;
        case 'pseudonymization':
          anonymizedData = this.pseudonymizeData(anonymizedData);
          break;
        case 'aggregation':
          anonymizedData = this.aggregateData(anonymizedData);
          break;
        default:
          anonymizedData = this.generalizeData(anonymizedData);
      }

      // Store anonymization record
      await this.storeAnonymizationRecord(originalData.id || 'unknown', anonymizedData, anonymizationMethod);

      return anonymizedData;
    } catch (error) {
      console.error('Error anonymizing data:', error);
      throw error;
    }
  }

  // Generalize data
  generalizeData(data) {
    const generalized = { ...data };

    // Generalize age
    if (generalized.age) {
      if (generalized.age < 18) generalized.age_group = 'minor';
      else if (generalized.age < 30) generalized.age_group = '18-29';
      else if (generalized.age < 45) generalized.age_group = '30-44';
      else if (generalized.age < 60) generalized.age_group = '45-59';
      else generalized.age_group = '60+';
      delete generalized.age;
    }

    // Generalize dates
    if (generalized.date_of_birth) {
      generalized.birth_year = new Date(generalized.date_of_birth).getFullYear();
      delete generalized.date_of_birth;
    }

    // Generalize locations
    if (generalized.address) {
      generalized.state = 'Unknown';
      generalized.city = 'Unknown';
      delete generalized.address;
    }

    // Generalize phone numbers
    if (generalized.phone) {
      generalized.phone_area_code = generalized.phone.substring(0, 3);
      delete generalized.phone;
    }

    return generalized;
  }

  // Suppress data
  suppressData(data) {
    const suppressed = { ...data };

    // Remove direct identifiers
    const directIdentifiers = ['name', 'email', 'phone', 'address', 'ssn', 'medical_record_number'];
    directIdentifiers.forEach(identifier => {
      if (suppressed[identifier]) {
        delete suppressed[identifier];
      }
    });

    // Remove quasi-identifiers
    const quasiIdentifiers = ['date_of_birth', 'zip_code', 'ip_address'];
    quasiIdentifiers.forEach(identifier => {
      if (suppressed[identifier]) {
        delete suppressed[identifier];
      }
    });

    return suppressed;
  }

  // Pseudonymize data
  pseudonymizeData(data) {
    const pseudonymized = { ...data };

    // Create pseudonyms for direct identifiers
    if (pseudonymized.name) {
      pseudonymized.patient_id = crypto.createHash('sha256')
        .update(pseudonymized.name + this.encryptionKey)
        .digest('hex')
        .substring(0, 8);
      delete pseudonymized.name;
    }

    if (pseudonymized.email) {
      pseudonymized.email_hash = crypto.createHash('sha256')
        .update(pseudonymized.email + this.encryptionKey)
        .digest('hex')
        .substring(0, 8);
      delete pseudonymized.email;
    }

    return pseudonymized;
  }

  // Aggregate data
  aggregateData(data) {
    // For aggregation, we would typically aggregate multiple records
    // For single record, return summary statistics
    const aggregated = {};

    if (data.age) {
      aggregated.age_statistics = {
        min: data.age,
        max: data.age,
        avg: data.age,
        count: 1
      };
    }

    if (data.medical_conditions && Array.isArray(data.medical_conditions)) {
      aggregated.condition_count = data.medical_conditions.length;
      aggregated.condition_types = [...new Set(data.medical_conditions.map(c => c.type))];
    }

    return aggregated;
  }

  // Store anonymization record
  async storeAnonymizationRecord(originalDataId, anonymizedData, method) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = `
        INSERT INTO data_anonymization 
        (id, original_data_id, anonymized_data, anonymization_method, privacy_level)
        VALUES (?, ?, ?, ?, ?)
      `;
      
      db.run(query, [
        uuidv4(),
        originalDataId,
        JSON.stringify(anonymizedData),
        method,
        this.privacyLevels.internal
      ], function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
    });
  }

  // Process data subject request
  async processDataSubjectRequest(userId, requestType, requestData) {
    const db = this.getDatabase();
    
    try {
      // Create request record
      const requestId = await new Promise((resolve, reject) => {
        const query = `
          INSERT INTO data_subject_requests 
          (id, user_id, request_type, request_data, status)
          VALUES (?, ?, ?, ?, 'processing')
        `;
        
        db.run(query, [
          uuidv4(),
          userId,
          requestType,
          JSON.stringify(requestData)
        ], function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        });
      });

      // Process request based on type
      let responseData;
      switch (requestType) {
        case 'access':
          responseData = await this.processAccessRequest(userId, requestData);
          break;
        case 'rectification':
          responseData = await this.processRectificationRequest(userId, requestData);
          break;
        case 'erasure':
          responseData = await this.processErasureRequest(userId, requestData);
          break;
        case 'portability':
          responseData = await this.processPortabilityRequest(userId, requestData);
          break;
        case 'objection':
          responseData = await this.processObjectionRequest(userId, requestData);
          break;
        default:
          throw new Error('Unsupported request type');
      }

      // Update request with response
      await new Promise((resolve, reject) => {
        const query = `
          UPDATE data_subject_requests 
          SET status = 'completed', processed_date = CURRENT_TIMESTAMP, response_data = ?
          WHERE id = ?
        `;
        
        db.run(query, [JSON.stringify(responseData), requestId], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      return { requestId: requestId, status: 'completed', data: responseData };
    } catch (error) {
      console.error('Error processing data subject request:', error);
      throw error;
    }
  }

  // Process access request
  async processAccessRequest(userId, requestData) {
    const userData = await this.getUserData(userId);
    const consentRecords = await this.getUserConsentRecords(userId);
    const accessLogs = await this.getUserAccessLogs(userId);

    return {
      personal_data: userData,
      consent_records: consentRecords,
      access_logs: accessLogs,
      processing_date: new Date().toISOString()
    };
  }

  // Process rectification request
  async processRectificationRequest(userId, requestData) {
    const { fieldToUpdate, newValue, reason } = requestData;
    
    // Update user data
    const db = this.getDatabase();
    await new Promise((resolve, reject) => {
      const query = `UPDATE users SET ${fieldToUpdate} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
      db.run(query, [newValue, userId], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    return {
      field_updated: fieldToUpdate,
      updated_at: new Date().toISOString(),
      reason: reason
    };
  }

  // Process erasure request
  async processErasureRequest(userId, requestData) {
    const { dataTypes, reason } = requestData;
    
    // Anonymize or delete specified data
    for (const dataType of dataTypes) {
      if (dataType === 'all') {
        await this.anonymizeAllUserData(userId);
      } else {
        await this.anonymizeDataType(userId, dataType);
      }
    }

    return {
      data_erased: dataTypes,
      erased_at: new Date().toISOString(),
      reason: reason
    };
  }

  // Process portability request
  async processPortabilityRequest(userId, requestData) {
    const userData = await this.getUserData(userId);
    const consentRecords = await this.getUserConsentRecords(userId);
    
    // Format data in machine-readable format
    const portableData = {
      user_profile: userData,
      consent_history: consentRecords,
      export_date: new Date().toISOString(),
      format: 'json'
    };

    return portableData;
  }

  // Process objection request
  async processObjectionRequest(userId, requestData) {
    const { objectionType, reason } = requestData;
    
    // Update consent to reflect objection
    await this.withdrawConsent(userId, objectionType, reason);

    return {
      objection_processed: objectionType,
      processed_at: new Date().toISOString(),
      reason: reason
    };
  }

  // Get user data
  async getUserData(userId) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = `
        SELECT u.*, p.* FROM users u
        LEFT JOIN patients p ON u.id = p.user_id
        WHERE u.id = ?
      `;
      
      db.get(query, [userId], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  // Get user consent records
  async getUserConsentRecords(userId) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = 'SELECT * FROM consent_records WHERE user_id = ? ORDER BY consent_date DESC';
      
      db.all(query, [userId], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  // Get user access logs
  async getUserAccessLogs(userId, limit = 100) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = `
        SELECT dal.*, u.first_name, u.last_name, u.role
        FROM data_access_logs dal
        LEFT JOIN users u ON dal.accessed_by = u.id
        WHERE dal.user_id = ?
        ORDER BY dal.access_date DESC
        LIMIT ?
      `;
      
      db.all(query, [userId, limit], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  // Anonymize all user data
  async anonymizeAllUserData(userId) {
    // This would anonymize all data related to the user
    // Implementation would depend on specific data types
    console.log(`Anonymizing all data for user ${userId}`);
  }

  // Anonymize specific data type
  async anonymizeDataType(userId, dataType) {
    // This would anonymize specific data type for the user
    // Implementation would depend on specific data types
    console.log(`Anonymizing ${dataType} data for user ${userId}`);
  }

  // Run privacy audit
  async runPrivacyAudit(auditType = 'compliance') {
    const db = this.getDatabase();
    
    try {
      const findings = [];
      
      // Check for expired consents
      const expiredConsents = await this.checkExpiredConsents();
      if (expiredConsents.length > 0) {
        findings.push({
          type: 'expired_consent',
          severity: 'medium',
          description: `Found ${expiredConsents.length} expired consent records`,
          recommendations: ['Review and update expired consents', 'Notify affected users']
        });
      }

      // Check for data retention violations
      const retentionViolations = await this.checkRetentionViolations();
      if (retentionViolations.length > 0) {
        findings.push({
          type: 'retention_violation',
          severity: 'high',
          description: `Found ${retentionViolations.length} data retention violations`,
          recommendations: ['Review retention policies', 'Implement automated deletion']
        });
      }

      // Check for unauthorized access
      const unauthorizedAccess = await this.checkUnauthorizedAccess();
      if (unauthorizedAccess.length > 0) {
        findings.push({
          type: 'unauthorized_access',
          severity: 'critical',
          description: `Found ${unauthorizedAccess.length} unauthorized access attempts`,
          recommendations: ['Review access controls', 'Implement additional security measures']
        });
      }

      // Save audit record
      const auditId = await new Promise((resolve, reject) => {
        const query = `
          INSERT INTO privacy_audits 
          (id, audit_type, scope, findings, status)
          VALUES (?, ?, ?, ?, 'completed')
        `;
        
        db.run(query, [
          uuidv4(),
          auditType,
          'full_system',
          JSON.stringify(findings),
        ], function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        });
      });

      return {
        auditId: auditId,
        auditType: auditType,
        findings: findings,
        auditDate: new Date().toISOString(),
        status: 'completed'
      };
    } catch (error) {
      console.error('Error running privacy audit:', error);
      throw error;
    }
  }

  // Check expired consents
  async checkExpiredConsents() {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = `
        SELECT * FROM consent_records 
        WHERE expiry_date IS NOT NULL AND expiry_date < CURRENT_TIMESTAMP 
        AND withdrawal_date IS NULL
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

  // Check retention violations
  async checkRetentionViolations() {
    // This would check for data that exceeds retention periods
    // Implementation would depend on specific data types and retention policies
    return [];
  }

  // Check unauthorized access
  async checkUnauthorizedAccess() {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = `
        SELECT * FROM data_access_logs 
        WHERE access_granted = FALSE 
        AND access_date >= datetime('now', '-30 days')
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

  // Get privacy compliance status
  async getPrivacyComplianceStatus() {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = `
        SELECT 
          COUNT(*) as total_consents,
          COUNT(CASE WHEN consent_given = TRUE THEN 1 END) as active_consents,
          COUNT(CASE WHEN expiry_date < CURRENT_TIMESTAMP THEN 1 END) as expired_consents,
          COUNT(CASE WHEN withdrawal_date IS NOT NULL THEN 1 END) as withdrawn_consents,
          COUNT(DISTINCT user_id) as unique_users
        FROM consent_records
      `;
      
      db.get(query, [], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
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

module.exports = new DataPrivacyService();
