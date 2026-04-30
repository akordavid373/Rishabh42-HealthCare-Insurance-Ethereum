const EventEmitter = require('events');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { performance } = require('perf_hooks');
const crypto = require('crypto');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../database/healthcare.db');

class RealTimeProcessingService extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.streamProcessors = new Map();
    this.anomalyDetectors = new Map();
    this.alertHandlers = new Map();
    this.processingQueue = [];
    this.isProcessingQueue = false;
    this.metrics = {
      totalStreams: 0,
      activeStreams: 0,
      totalDataPoints: 0,
      anomaliesDetected: 0,
      alertsGenerated: 0,
      averageProcessingTime: 0,
      errorCount: 0,
      lastUpdated: new Date()
    };
    
    this.initializeService();
  }

  getDatabase() {
    if (!this.db) {
      this.db = new sqlite3.Database(DB_PATH);
    }
    return this.db;
  }

  async initializeService() {
    try {
      await this.initializeTables();
      await this.startQueueProcessor();
      await this.startMetricsCollector();
      
      console.log('Real-time Processing Service initialized successfully');
    } catch (error) {
      console.error('Error initializing Real-time Processing Service:', error);
    }
  }

  // Initialize database tables
  async initializeTables() {
    const db = this.getDatabase();
    
    const tables = [
      // Stream configurations
      `CREATE TABLE IF NOT EXISTS stream_configs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        data_type TEXT NOT NULL,
        source_system TEXT NOT NULL,
        processing_rules TEXT, -- JSON array of rules
        anomaly_rules TEXT, -- JSON array of anomaly detection rules
        alert_rules TEXT, -- JSON array of alert rules
        is_active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      
      // Stream data
      `CREATE TABLE IF NOT EXISTS stream_data (
        id TEXT PRIMARY KEY,
        stream_id TEXT NOT NULL,
        data_type TEXT NOT NULL,
        payload TEXT NOT NULL, -- JSON data
        metadata TEXT, -- JSON metadata
        source TEXT NOT NULL,
        timestamp DATETIME NOT NULL,
        processed BOOLEAN DEFAULT 0,
        processing_started_at DATETIME,
        processing_completed_at DATETIME,
        processing_time_ms INTEGER,
        status TEXT DEFAULT 'pending', -- pending, processing, completed, failed
        error_message TEXT
      )`,
      
      // Anomaly detections
      `CREATE TABLE IF NOT EXISTS anomaly_detections (
        id TEXT PRIMARY KEY,
        stream_id TEXT NOT NULL,
        stream_data_id TEXT NOT NULL,
        anomaly_type TEXT NOT NULL,
        severity TEXT NOT NULL, -- low, medium, high, critical
        confidence_score REAL NOT NULL,
        description TEXT NOT NULL,
        details TEXT, -- JSON details
        detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        resolved BOOLEAN DEFAULT 0,
        resolved_at DATETIME,
        resolved_by TEXT,
        FOREIGN KEY (stream_data_id) REFERENCES stream_data (id)
      )`,
      
      // Real-time alerts
      `CREATE TABLE IF NOT EXISTS real_time_alerts (
        id TEXT PRIMARY KEY,
        anomaly_id TEXT,
        stream_id TEXT NOT NULL,
        alert_type TEXT NOT NULL,
        priority TEXT NOT NULL, -- low, medium, high, critical
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        details TEXT, -- JSON details
        status TEXT DEFAULT 'active', -- active, acknowledged, resolved
        acknowledged_at DATETIME,
        acknowledged_by TEXT,
        resolved_at DATETIME,
        resolved_by TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (anomaly_id) REFERENCES anomaly_detections (id)
      )`,
      
      // Processing metrics
      `CREATE TABLE IF NOT EXISTS processing_metrics (
        id TEXT PRIMARY KEY,
        stream_id TEXT,
        metric_type TEXT NOT NULL, -- throughput, latency, error_rate, etc.
        metric_value REAL NOT NULL,
        unit TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        tags TEXT -- JSON tags
      )`,
      
      // Data validation rules
      `CREATE TABLE IF NOT EXISTS validation_rules (
        id TEXT PRIMARY KEY,
        stream_id TEXT NOT NULL,
        rule_name TEXT NOT NULL,
        rule_type TEXT NOT NULL, -- schema, format, business_logic
        rule_definition TEXT NOT NULL, -- JSON rule definition
        is_active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      
      // Performance optimization settings
      `CREATE TABLE IF NOT EXISTS optimization_settings (
        id TEXT PRIMARY KEY,
        setting_name TEXT NOT NULL UNIQUE,
        setting_value TEXT NOT NULL,
        description TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

    // Initialize default optimization settings
    await this.initializeDefaultSettings();
  }

  // Initialize default optimization settings
  async initializeDefaultSettings() {
    const defaultSettings = [
      { name: 'batch_size', value: '100', description: 'Number of items to process in each batch' },
      { name: 'processing_interval', value: '1000', description: 'Processing interval in milliseconds' },
      { name: 'max_queue_size', value: '10000', description: 'Maximum queue size before throttling' },
      { name: 'anomaly_threshold', value: '0.7', description: 'Confidence threshold for anomaly detection' },
      { name: 'enable_auto_scaling', value: 'true', description: 'Enable automatic scaling of processing resources' }
    ];

    for (const setting of defaultSettings) {
      await new Promise((resolve, reject) => {
        const query = `
          INSERT OR IGNORE INTO optimization_settings 
          (id, setting_name, setting_value, description)
          VALUES (?, ?, ?, ?)
        `;
        
        this.getDatabase().run(query, [
          uuidv4(),
          setting.name,
          setting.value,
          setting.description
        ], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  }

  // Create stream configuration
  async createStreamConfig(config) {
    const db = this.getDatabase();
    
    try {
      const streamId = uuidv4();
      
      await new Promise((resolve, reject) => {
        const query = `
          INSERT INTO stream_configs 
          (id, name, data_type, source_system, processing_rules, anomaly_rules, alert_rules, is_active)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        db.run(query, [
          streamId,
          config.name,
          config.data_type,
          config.source_system,
          JSON.stringify(config.processing_rules || []),
          JSON.stringify(config.anomaly_rules || []),
          JSON.stringify(config.alert_rules || []),
          config.is_active !== false
        ], function(err) {
          if (err) reject(err);
          else resolve();
        });
      });

      // Create validation rules if provided
      if (config.validation_rules) {
        for (const rule of config.validation_rules) {
          await this.createValidationRule(streamId, rule);
        }
      }

      return streamId;
    } catch (error) {
      console.error('Error creating stream config:', error);
      throw error;
    }
  }

  // Create validation rule
  async createValidationRule(streamId, rule) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = `
        INSERT INTO validation_rules 
        (id, stream_id, rule_name, rule_type, rule_definition)
        VALUES (?, ?, ?, ?, ?)
      `;
      
      db.run(query, [
        uuidv4(),
        streamId,
        rule.name,
        rule.type,
        JSON.stringify(rule.definition)
      ], function(err) {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  // Process incoming stream data
  async processStreamData(streamData) {
    const startTime = performance.now();
    
    try {
      // Validate stream data
      await this.validateStreamData(streamData);
      
      // Store stream data
      const dataId = await this.storeStreamData(streamData);
      
      // Add to processing queue
      this.processingQueue.push({
        id: dataId,
        streamData: { ...streamData, id: dataId },
        timestamp: new Date()
      });

      this.emit('data:received', { dataId, streamData });
      
      return dataId;
    } catch (error) {
      console.error('Error processing stream data:', error);
      this.metrics.errorCount++;
      throw error;
    }
  }

  // Validate stream data
  async validateStreamData(streamData) {
    const db = this.getDatabase();
    
    try {
      // Basic validation
      if (!streamData.stream_id || !streamData.data_type || !streamData.payload) {
        throw new Error('Missing required fields in stream data');
      }

      // Get validation rules for the stream
      const rules = await new Promise((resolve, reject) => {
        const query = 'SELECT * FROM validation_rules WHERE stream_id = ? AND is_active = 1';
        db.all(query, [streamData.stream_id], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      // Apply validation rules
      for (const rule of rules) {
        const ruleDefinition = JSON.parse(rule.rule_definition);
        
        switch (rule.rule_type) {
          case 'schema':
            await this.validateSchema(streamData.payload, ruleDefinition);
            break;
          case 'format':
            await this.validateFormat(streamData.payload, ruleDefinition);
            break;
          case 'business_logic':
            await this.validateBusinessLogic(streamData.payload, ruleDefinition);
            break;
        }
      }
    } catch (error) {
      console.error('Stream data validation failed:', error);
      throw error;
    }
  }

  // Validate data schema
  async validateSchema(payload, schema) {
    // Basic schema validation
    if (schema.required_fields) {
      const payloadObj = typeof payload === 'string' ? JSON.parse(payload) : payload;
      for (const field of schema.required_fields) {
        if (!(field in payloadObj)) {
          throw new Error(`Required field missing: ${field}`);
        }
      }
    }
  }

  // Validate data format
  async validateFormat(payload, formatRules) {
    // Format validation logic
    if (formatRules.data_type) {
      const expectedType = formatRules.data_type;
      const actualType = typeof payload;
      
      if (expectedType === 'json' && actualType === 'string') {
        try {
          JSON.parse(payload);
        } catch (e) {
          throw new Error('Invalid JSON format');
        }
      }
    }
  }

  // Validate business logic
  async validateBusinessLogic(payload, businessRules) {
    // Business logic validation
    const payloadObj = typeof payload === 'string' ? JSON.parse(payload) : payload;
    
    if (businessRules.value_ranges) {
      for (const [field, range] of Object.entries(businessRules.value_ranges)) {
        const value = payloadObj[field];
        if (value !== undefined) {
          if (range.min !== undefined && value < range.min) {
            throw new Error(`Value ${field} below minimum threshold`);
          }
          if (range.max !== undefined && value > range.max) {
            throw new Error(`Value ${field} above maximum threshold`);
          }
        }
      }
    }
  }

  // Store stream data
  async storeStreamData(streamData) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const dataId = uuidv4();
      const query = `
        INSERT INTO stream_data 
        (id, stream_id, data_type, payload, metadata, source, timestamp, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      db.run(query, [
        dataId,
        streamData.stream_id,
        streamData.data_type,
        typeof streamData.payload === 'string' ? streamData.payload : JSON.stringify(streamData.payload),
        JSON.stringify(streamData.metadata || {}),
        streamData.source,
        streamData.timestamp || new Date().toISOString(),
        'pending'
      ], function(err) {
        if (err) reject(err);
        else resolve(dataId);
      });
    });
  }

  // Process queued data
  async startQueueProcessor() {
    setInterval(async () => {
      if (!this.isProcessingQueue && this.processingQueue.length > 0) {
        this.isProcessingQueue = true;
        
        try {
          await this.processQueue();
        } catch (error) {
          console.error('Error processing queue:', error);
        } finally {
          this.isProcessingQueue = false;
        }
      }
    }, 1000); // Process every second
  }

  async processQueue() {
    const batchSize = await this.getOptimizationSetting('batch_size', 100);
    const batch = this.processingQueue.splice(0, batchSize);
    
    for (const item of batch) {
      try {
        await this.processDataItem(item);
      } catch (error) {
        console.error('Error processing data item:', error);
        await this.markDataItemFailed(item.id, error.message);
      }
    }
  }

  async processDataItem(item) {
    const startTime = performance.now();
    
    try {
      // Update processing status
      await this.updateDataItemStatus(item.id, 'processing', startTime);
      
      // Get stream configuration
      const streamConfig = await this.getStreamConfig(item.streamData.stream_id);
      
      // Apply processing rules
      const processedData = await this.applyProcessingRules(item.streamData, streamConfig);
      
      // Detect anomalies
      const anomalies = await this.detectAnomalies(item.streamData, streamConfig);
      
      // Generate alerts for anomalies
      for (const anomaly of anomalies) {
        await this.generateAlert(anomaly, streamConfig);
      }
      
      // Update metrics
      const processingTime = performance.now() - startTime;
      await this.updateProcessingMetrics(item.streamData.stream_id, 'processing_time', processingTime);
      
      // Mark as completed
      await this.updateDataItemStatus(item.id, 'completed', null, processingTime);
      
      this.emit('data:processed', {
        dataId: item.id,
        processingTime,
        anomaliesCount: anomalies.length
      });
      
    } catch (error) {
      console.error('Error processing data item:', error);
      throw error;
    }
  }

  // Get stream configuration
  async getStreamConfig(streamId) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = 'SELECT * FROM stream_configs WHERE id = ? AND is_active = 1';
      db.get(query, [streamId], (err, row) => {
        if (err) {
          reject(err);
        } else if (!row) {
          reject(new Error('Stream configuration not found'));
        } else {
          resolve({
            id: row.id,
            name: row.name,
            data_type: row.data_type,
            source_system: row.source_system,
            processing_rules: JSON.parse(row.processing_rules || '[]'),
            anomaly_rules: JSON.parse(row.anomaly_rules || '[]'),
            alert_rules: JSON.parse(row.alert_rules || '[]')
          });
        }
      });
    });
  }

  // Apply processing rules
  async applyProcessingRules(streamData, streamConfig) {
    let processedData = { ...streamData };
    
    for (const rule of streamConfig.processing_rules) {
      switch (rule.type) {
        case 'transform':
          processedData = await this.applyTransformRule(processedData, rule);
          break;
        case 'filter':
          processedData = await this.applyFilterRule(processedData, rule);
          break;
        case 'aggregate':
          processedData = await this.applyAggregateRule(processedData, rule);
          break;
      }
    }
    
    return processedData;
  }

  // Apply transform rule
  async applyTransformRule(data, rule) {
    // Transform data based on rule definition
    if (rule.field_mappings) {
      const payload = typeof data.payload === 'string' ? JSON.parse(data.payload) : data.payload;
      const transformedPayload = {};
      
      for (const [targetField, sourceField] of Object.entries(rule.field_mappings)) {
        transformedPayload[targetField] = payload[sourceField];
      }
      
      data.payload = JSON.stringify(transformedPayload);
    }
    
    return data;
  }

  // Apply filter rule
  async applyFilterRule(data, rule) {
    // Filter data based on rule definition
    if (rule.conditions) {
      const payload = typeof data.payload === 'string' ? JSON.parse(data.payload) : data.payload;
      
      for (const condition of rule.conditions) {
        const fieldValue = payload[condition.field];
        
        switch (condition.operator) {
          case 'equals':
            if (fieldValue !== condition.value) {
              throw new Error('Data filtered out by rule');
            }
            break;
          case 'greater_than':
            if (fieldValue <= condition.value) {
              throw new Error('Data filtered out by rule');
            }
            break;
          case 'less_than':
            if (fieldValue >= condition.value) {
              throw new Error('Data filtered out by rule');
            }
            break;
        }
      }
    }
    
    return data;
  }

  // Apply aggregate rule
  async applyAggregateRule(data, rule) {
    // Aggregate data based on rule definition
    // This would typically involve windowing and aggregation functions
    return data;
  }

  // Detect anomalies
  async detectAnomalies(streamData, streamConfig) {
    const anomalies = [];
    
    for (const rule of streamConfig.anomaly_rules) {
      const anomaly = await this.applyAnomalyRule(streamData, rule);
      if (anomaly) {
        anomalies.push(anomaly);
      }
    }
    
    return anomalies;
  }

  // Apply anomaly rule
  async applyAnomalyRule(streamData, rule) {
    const payload = typeof streamData.payload === 'string' ? JSON.parse(streamData.payload) : streamData.payload;
    
    switch (rule.type) {
      case 'statistical':
        return await this.detectStatisticalAnomaly(payload, rule);
      case 'pattern':
        return await this.detectPatternAnomaly(payload, rule);
      case 'threshold':
        return await this.detectThresholdAnomaly(payload, rule);
      case 'frequency':
        return await this.detectFrequencyAnomaly(streamData, rule);
      default:
        return null;
    }
  }

  // Detect statistical anomaly
  async detectStatisticalAnomaly(payload, rule) {
    // Statistical anomaly detection (e.g., z-score, isolation forest)
    if (rule.field && payload[rule.field] !== undefined) {
      const value = payload[rule.field];
      const mean = rule.mean || 0;
      const stdDev = rule.std_dev || 1;
      
      const zScore = Math.abs((value - mean) / stdDev);
      const threshold = rule.threshold || 3;
      
      if (zScore > threshold) {
        return {
          id: uuidv4(),
          stream_id: streamData.stream_id,
          stream_data_id: streamData.id,
          anomaly_type: 'statistical',
          severity: zScore > 4 ? 'critical' : zScore > 3 ? 'high' : 'medium',
          confidence_score: Math.min(zScore / threshold, 1),
          description: `Statistical anomaly detected in field ${rule.field}`,
          details: {
            field: rule.field,
            value: value,
            z_score: zScore,
            threshold: threshold
          }
        };
      }
    }
    
    return null;
  }

  // Detect pattern anomaly
  async detectPatternAnomaly(payload, rule) {
    // Pattern-based anomaly detection
    if (rule.pattern && payload[rule.field] !== undefined) {
      const value = payload[rule.field];
      const pattern = new RegExp(rule.pattern);
      
      if (!pattern.test(value)) {
        return {
          id: uuidv4(),
          stream_id: streamData.stream_id,
          stream_data_id: streamData.id,
          anomaly_type: 'pattern',
          severity: 'medium',
          confidence_score: 0.8,
          description: `Pattern anomaly detected in field ${rule.field}`,
          details: {
            field: rule.field,
            value: value,
            expected_pattern: rule.pattern
          }
        };
      }
    }
    
    return null;
  }

  // Detect threshold anomaly
  async detectThresholdAnomaly(payload, rule) {
    // Threshold-based anomaly detection
    if (rule.field && payload[rule.field] !== undefined) {
      const value = payload[rule.field];
      
      if (rule.min !== undefined && value < rule.min) {
        return {
          id: uuidv4(),
          stream_id: streamData.stream_id,
          stream_data_id: streamData.id,
          anomaly_type: 'threshold',
          severity: 'high',
          confidence_score: 0.9,
          description: `Value below minimum threshold in field ${rule.field}`,
          details: {
            field: rule.field,
            value: value,
            threshold: rule.min,
            type: 'minimum'
          }
        };
      }
      
      if (rule.max !== undefined && value > rule.max) {
        return {
          id: uuidv4(),
          stream_id: streamData.stream_id,
          stream_data_id: streamData.id,
          anomaly_type: 'threshold',
          severity: 'high',
          confidence_score: 0.9,
          description: `Value above maximum threshold in field ${rule.field}`,
          details: {
            field: rule.field,
            value: value,
            threshold: rule.max,
            type: 'maximum'
          }
        };
      }
    }
    
    return null;
  }

  // Detect frequency anomaly
  async detectFrequencyAnomaly(streamData, rule) {
    // Frequency-based anomaly detection
    const db = this.getDatabase();
    
    const recentData = await new Promise((resolve, reject) => {
      const query = `
        SELECT COUNT(*) as count 
        FROM stream_data 
        WHERE stream_id = ? AND source = ? AND timestamp > datetime('now', '-1 hour')
      `;
      
      db.get(query, [streamData.stream_id, streamData.source], (err, row) => {
        if (err) reject(err);
        else resolve(row.count);
      });
    });
    
    const maxFrequency = rule.max_frequency || 100;
    
    if (recentData > maxFrequency) {
      return {
        id: uuidv4(),
        stream_id: streamData.stream_id,
        stream_data_id: streamData.id,
        anomaly_type: 'frequency',
        severity: 'high',
        confidence_score: 0.8,
        description: `High frequency data detected from source ${streamData.source}`,
        details: {
          source: streamData.source,
          frequency: recentData,
          max_frequency: maxFrequency,
          time_window: '1 hour'
        }
      };
    }
    
    return null;
  }

  // Generate alert for anomaly
  async generateAlert(anomaly, streamConfig) {
    const db = this.getDatabase();
    
    try {
      // Store anomaly
      await new Promise((resolve, reject) => {
        const query = `
          INSERT INTO anomaly_detections 
          (id, stream_id, stream_data_id, anomaly_type, severity, confidence_score, description, details)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        db.run(query, [
          anomaly.id,
          anomaly.stream_id,
          anomaly.stream_data_id,
          anomaly.anomaly_type,
          anomaly.severity,
          anomaly.confidence_score,
          anomaly.description,
          JSON.stringify(anomaly.details || {})
        ], function(err) {
          if (err) reject(err);
          else resolve();
        });
      });

      // Check if alert should be generated
      const shouldAlert = await this.shouldGenerateAlert(anomaly, streamConfig);
      
      if (shouldAlert) {
        const alertId = uuidv4();
        const priority = this.mapSeverityToPriority(anomaly.severity);
        
        await new Promise((resolve, reject) => {
          const query = `
            INSERT INTO real_time_alerts 
            (id, anomaly_id, stream_id, alert_type, priority, title, message, details)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `;
          
          db.run(query, [
            alertId,
            anomaly.id,
            anomaly.stream_id,
            'anomaly_detected',
            priority,
            `Anomaly Detected: ${anomaly.anomaly_type}`,
            anomaly.description,
            JSON.stringify(anomaly.details || {})
          ], function(err) {
            if (err) reject(err);
            else resolve();
          });
        });

        this.metrics.alertsGenerated++;
        this.metrics.anomaliesDetected++;
        
        this.emit('alert:generated', {
          alertId,
          anomalyId: anomaly.id,
          streamId: anomaly.stream_id,
          priority,
          type: anomaly.anomaly_type
        });
      }
    } catch (error) {
      console.error('Error generating alert:', error);
      throw error;
    }
  }

  // Check if alert should be generated
  async shouldGenerateAlert(anomaly, streamConfig) {
    // Check alert rules
    for (const rule of streamConfig.alert_rules) {
      if (rule.anomaly_type === anomaly.anomaly_type || rule.anomaly_type === 'all') {
        if (rule.min_severity) {
          const severityLevels = { low: 1, medium: 2, high: 3, critical: 4 };
          if (severityLevels[anomaly.severity] >= severityLevels[rule.min_severity]) {
            return true;
          }
        }
        
        if (rule.min_confidence && anomaly.confidence_score >= rule.min_confidence) {
          return true;
        }
      }
    }
    
    return false;
  }

  // Map severity to priority
  mapSeverityToPriority(severity) {
    const mapping = {
      low: 'low',
      medium: 'medium',
      high: 'high',
      critical: 'critical'
    };
    return mapping[severity] || 'medium';
  }

  // Update data item status
  async updateDataItemStatus(dataId, status, processingStartedAt, processingTime) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      let query = 'UPDATE stream_data SET status = ?, processing_completed_at = CURRENT_TIMESTAMP';
      let params = [status];
      
      if (status === 'processing' && processingStartedAt) {
        query += ', processing_started_at = ?';
        params.push(new Date(processingStartedAt).toISOString());
      }
      
      if (status === 'completed' && processingTime) {
        query += ', processing_time_ms = ?, processed = 1';
        params.push(Math.round(processingTime));
      }
      
      query += ' WHERE id = ?';
      params.push(dataId);
      
      db.run(query, params, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  // Mark data item as failed
  async markDataItemFailed(dataId, errorMessage) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = `
        UPDATE stream_data 
        SET status = 'failed', error_message = ?, processing_completed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `;
      
      db.run(query, [errorMessage, dataId], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  // Update processing metrics
  async updateProcessingMetrics(streamId, metricType, value) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = `
        INSERT INTO processing_metrics 
        (id, stream_id, metric_type, metric_value, unit)
        VALUES (?, ?, ?, ?, ?)
      `;
      
      db.run(query, [
        uuidv4(),
        streamId,
        metricType,
        value,
        metricType === 'processing_time' ? 'milliseconds' : 'count'
      ], function(err) {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  // Get optimization setting
  async getOptimizationSetting(settingName, defaultValue) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = 'SELECT setting_value FROM optimization_settings WHERE setting_name = ?';
      db.get(query, [settingName], (err, row) => {
        if (err) {
          reject(err);
        } else if (row) {
          resolve(parseInt(row.setting_value) || defaultValue);
        } else {
          resolve(defaultValue);
        }
      });
    });
  }

  // Start metrics collector
  async startMetricsCollector() {
    setInterval(async () => {
      try {
        await this.collectMetrics();
      } catch (error) {
        console.error('Error collecting metrics:', error);
      }
    }, 30000); // Collect metrics every 30 seconds
  }

  // Collect system metrics
  async collectMetrics() {
    const db = this.getDatabase();
    
    try {
      // Get current metrics from database
      const totalDataPoints = await new Promise((resolve, reject) => {
        const query = 'SELECT COUNT(*) as count FROM stream_data';
        db.get(query, [], (err, row) => {
          if (err) reject(err);
          else resolve(row.count);
        });
      });

      const activeStreams = await new Promise((resolve, reject) => {
        const query = 'SELECT COUNT(DISTINCT stream_id) as count FROM stream_configs WHERE is_active = 1';
        db.get(query, [], (err, row) => {
          if (err) reject(err);
          else resolve(row.count);
        });
      });

      const averageProcessingTime = await new Promise((resolve, reject) => {
        const query = 'SELECT AVG(processing_time_ms) as avg_time FROM stream_data WHERE processed = 1 AND processing_time_ms IS NOT NULL';
        db.get(query, [], (err, row) => {
          if (err) reject(err);
          else resolve(row.avg_time || 0);
        });
      });

      // Update metrics
      this.metrics.totalDataPoints = totalDataPoints;
      this.metrics.activeStreams = activeStreams;
      this.metrics.averageProcessingTime = averageProcessingTime;
      this.metrics.lastUpdated = new Date();

      this.emit('metrics:updated', this.metrics);
    } catch (error) {
      console.error('Error collecting metrics:', error);
    }
  }

  // Get real-time analytics
  async getRealTimeAnalytics(streamId = null, period = 60) {
    const db = this.getDatabase();
    
    try {
      const cutoffDate = new Date();
      cutoffDate.setMinutes(cutoffDate.getMinutes() - period);
      
      let query = `
        SELECT 
          stream_id,
          COUNT(*) as total_data_points,
          COUNT(CASE WHEN processed = 1 THEN 1 END) as processed_data_points,
          AVG(processing_time_ms) as avg_processing_time,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count,
          COUNT(DISTINCT source) as unique_sources
        FROM stream_data
        WHERE timestamp >= ?
      `;
      
      const params = [cutoffDate.toISOString()];
      
      if (streamId) {
        query += ' AND stream_id = ?';
        params.push(streamId);
      }
      
      query += ' GROUP BY stream_id';
      
      const analytics = await new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      // Get anomaly statistics
      const anomalyStats = await this.getAnomalyStatistics(streamId, period);
      
      // Get alert statistics
      const alertStats = await this.getAlertStatistics(streamId, period);
      
      return {
        period_minutes: period,
        stream_analytics: analytics,
        anomaly_statistics: anomalyStats,
        alert_statistics: alertStats,
        system_metrics: this.metrics
      };
    } catch (error) {
      console.error('Error getting real-time analytics:', error);
      throw error;
    }
  }

  // Get anomaly statistics
  async getAnomalyStatistics(streamId = null, period = 60) {
    const db = this.getDatabase();
    
    const cutoffDate = new Date();
    cutoffDate.setMinutes(cutoffDate.getMinutes() - period);
    
    let query = `
      SELECT 
        anomaly_type,
        severity,
        COUNT(*) as count,
        AVG(confidence_score) as avg_confidence
      FROM anomaly_detections
      WHERE detected_at >= ?
    `;
    
    const params = [cutoffDate.toISOString()];
    
    if (streamId) {
      query += ' AND stream_id = ?';
      params.push(streamId);
    }
    
    query += ' GROUP BY anomaly_type, severity';
    
    return new Promise((resolve, reject) => {
      db.all(query, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  // Get alert statistics
  async getAlertStatistics(streamId = null, period = 60) {
    const db = this.getDatabase();
    
    const cutoffDate = new Date();
    cutoffDate.setMinutes(cutoffDate.getMinutes() - period);
    
    let query = `
      SELECT 
        alert_type,
        priority,
        status,
        COUNT(*) as count
      FROM real_time_alerts
      WHERE created_at >= ?
    `;
    
    const params = [cutoffDate.toISOString()];
    
    if (streamId) {
      query += ' AND stream_id = ?';
      params.push(streamId);
    }
    
    query += ' GROUP BY alert_type, priority, status';
    
    return new Promise((resolve, reject) => {
      db.all(query, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  // Get active alerts
  async getActiveAlerts(streamId = null, priority = null) {
    const db = this.getDatabase();
    
    let query = 'SELECT * FROM real_time_alerts WHERE status = \'active\'';
    const params = [];
    
    if (streamId) {
      query += ' AND stream_id = ?';
      params.push(streamId);
    }
    
    if (priority) {
      query += ' AND priority = ?';
      params.push(priority);
    }
    
    query += ' ORDER BY created_at DESC';
    
    return new Promise((resolve, reject) => {
      db.all(query, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  // Acknowledge alert
  async acknowledgeAlert(alertId, userId) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = `
        UPDATE real_time_alerts 
        SET status = 'acknowledged', acknowledged_at = CURRENT_TIMESTAMP, acknowledged_by = ?
        WHERE id = ?
      `;
      
      db.run(query, [userId, alertId], function(err) {
        if (err) reject(err);
        else if (this.changes === 0) {
          reject(new Error('Alert not found'));
        } else {
          resolve();
        }
      });
    });
  }

  // Resolve alert
  async resolveAlert(alertId, userId) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = `
        UPDATE real_time_alerts 
        SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP, resolved_by = ?
        WHERE id = ?
      `;
      
      db.run(query, [userId, alertId], function(err) {
        if (err) reject(err);
        else if (this.changes === 0) {
          reject(new Error('Alert not found'));
        } else {
          resolve();
        }
      });
    });
  }

  // Optimize performance
  async optimizePerformance() {
    try {
      const settings = await this.getOptimizationSettings();
      
      // Auto-scaling logic
      if (settings.enable_auto_scaling === 'true') {
        const queueSize = this.processingQueue.length;
        const maxQueueSize = parseInt(settings.max_queue_size);
        
        if (queueSize > maxQueueSize * 0.8) {
          // Scale up processing
          await this.scaleUpProcessing();
        } else if (queueSize < maxQueueSize * 0.2) {
          // Scale down processing
          await this.scaleDownProcessing();
        }
      }
      
      this.emit('performance:optimized', { settings, queueSize: this.processingQueue.length });
    } catch (error) {
      console.error('Error optimizing performance:', error);
    }
  }

  // Scale up processing
  async scaleUpProcessing() {
    // Implement scaling up logic (e.g., increase batch size, reduce processing interval)
    const currentBatchSize = await this.getOptimizationSetting('batch_size', 100);
    const newBatchSize = Math.min(currentBatchSize * 2, 500);
    
    await this.updateOptimizationSetting('batch_size', newBatchSize.toString());
    console.log(`Scaled up batch size to ${newBatchSize}`);
  }

  // Scale down processing
  async scaleDownProcessing() {
    // Implement scaling down logic (e.g., decrease batch size, increase processing interval)
    const currentBatchSize = await this.getOptimizationSetting('batch_size', 100);
    const newBatchSize = Math.max(currentBatchSize / 2, 10);
    
    await this.updateOptimizationSetting('batch_size', newBatchSize.toString());
    console.log(`Scaled down batch size to ${newBatchSize}`);
  }

  // Get optimization settings
  async getOptimizationSettings() {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = 'SELECT * FROM optimization_settings';
      db.all(query, [], (err, rows) => {
        if (err) reject(err);
        else {
          const settings = {};
          rows.forEach(row => {
            settings[row.setting_name] = row.setting_value;
          });
          resolve(settings);
        }
      });
    });
  }

  // Update optimization setting
  async updateOptimizationSetting(settingName, value) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = `
        UPDATE optimization_settings 
        SET setting_value = ?, updated_at = CURRENT_TIMESTAMP
        WHERE setting_name = ?
      `;
      
      db.run(query, [value, settingName], function(err) {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  // Close service
  close() {
    // Close database connection
    if (this.db) {
      this.db.close();
      this.db = null;
    }

    console.log('Real-time Processing Service closed');
  }
}

module.exports = new RealTimeProcessingService();
