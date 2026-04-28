const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const BackupManager = require('../backup/BackupManager');
const ReplicationManager = require('../replication/ReplicationManager');

class DisasterRecoveryManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      recoveryDirectory: config.recoveryDirectory || path.join(__dirname, 'recovery'),
      maxRecoveryPoints: config.maxRecoveryPoints || 10,
      healthCheckInterval: config.healthCheckInterval || 30000, // 30 seconds
      failoverThreshold: config.failoverThreshold || 3, // 3 consecutive failures
      recoveryTimeout: config.recoveryTimeout || 300000, // 5 minutes
      autoFailoverEnabled: config.autoFailoverEnabled !== false,
      backupRetentionDays: config.backupRetentionDays || 90,
      remoteBackupEnabled: config.remoteBackupEnabled || false,
      remoteBackupPath: config.remoteBackupPath || null
    };
    
    this.backupManager = null;
    this.replicationManager = null;
    this.healthStatus = {
      primary: 'healthy',
      replicas: [],
      lastCheck: new Date(),
      consecutiveFailures: 0
    };
    
    this.recoveryPlan = null;
    this.isRecovering = false;
    this.healthCheckIntervalId = null;
    
    this.ensureRecoveryDirectory();
    this.initializeManagers();
  }

  ensureRecoveryDirectory() {
    if (!fs.existsSync(this.config.recoveryDirectory)) {
      fs.mkdirSync(this.config.recoveryDirectory, { recursive: true });
    }
    
    // Create subdirectories
    const subdirs = ['snapshots', 'logs', 'plans', 'scripts'];
    subdirs.forEach(dir => {
      const fullPath = path.join(this.config.recoveryDirectory, dir);
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
      }
    });
  }

  initializeManagers() {
    // Initialize backup manager with disaster recovery configuration
    this.backupManager = new BackupManager({
      backupDirectory: path.join(this.config.recoveryDirectory, 'backups'),
      retentionDays: this.config.backupRetentionDays,
      compressionEnabled: true,
      encryptionEnabled: true,
      backupInterval: 1800000 // 30 minutes
    });
    
    // Initialize replication manager
    this.replicationManager = new ReplicationManager({
      primaryDbPath: this.config.primaryDbPath,
      replicaDirectory: path.join(this.config.recoveryDirectory, 'replicas'),
      replicaCount: 2,
      replicationInterval: 10000 // 10 seconds
    });
    
    // Set up event listeners
    this.setupEventListeners();
  }

  setupEventListeners() {
    // Backup events
    this.backupManager.on('backupCompleted', (backupInfo) => {
      this.emit('backupCompleted', backupInfo);
      this.createRecoveryPoint(backupInfo);
    });
    
    this.backupManager.on('backupError', (error) => {
      this.emit('backupError', error);
      this.handleBackupError(error);
    });
    
    // Replication events
    this.replicationManager.on('replicationError', (error) => {
      this.emit('replicationError', error);
      this.handleReplicationError(error);
    });
    
    this.replicationManager.on('replicaPromoted', (data) => {
      this.emit('replicaPromoted', data);
      this.handleReplicaPromotion(data);
    });
  }

  async startDisasterRecovery() {
    console.log('Starting disaster recovery system...');
    
    try {
      // Start backup manager
      await this.backupManager.startScheduledBackups();
      
      // Start replication
      await this.replicationManager.startReplication();
      
      // Start health monitoring
      this.startHealthMonitoring();
      
      // Create initial recovery plan
      await this.createRecoveryPlan();
      
      // Create initial recovery point
      await this.createRecoveryPoint();
      
      this.emit('disasterRecoveryStarted');
      console.log('Disaster recovery system started successfully');
      
    } catch (error) {
      console.error('Error starting disaster recovery:', error);
      this.emit('disasterRecoveryError', error);
      throw error;
    }
  }

  async stopDisasterRecovery() {
    console.log('Stopping disaster recovery system...');
    
    try {
      // Stop health monitoring
      this.stopHealthMonitoring();
      
      // Stop replication
      await this.replicationManager.stopReplication();
      
      // Stop backups
      this.backupManager.stopScheduledBackups();
      
      // Close all connections
      await this.replicationManager.closeAllConnections();
      
      this.emit('disasterRecoveryStopped');
      console.log('Disaster recovery system stopped');
      
    } catch (error) {
      console.error('Error stopping disaster recovery:', error);
      this.emit('disasterRecoveryError', error);
      throw error;
    }
  }

  startHealthMonitoring() {
    if (this.healthCheckIntervalId) {
      return;
    }
    
    this.healthCheckIntervalId = setInterval(async () => {
      await this.performHealthCheck();
    }, this.config.healthCheckInterval);
    
    console.log('Health monitoring started');
  }

  stopHealthMonitoring() {
    if (this.healthCheckIntervalId) {
      clearInterval(this.healthCheckIntervalId);
      this.healthCheckIntervalId = null;
      console.log('Health monitoring stopped');
    }
  }

  async performHealthCheck() {
    try {
      const healthResults = {
        primary: await this.checkPrimaryHealth(),
        replicas: await this.checkReplicaHealth(),
        backups: await this.checkBackupHealth(),
        timestamp: new Date()
      };
      
      this.healthStatus = {
        ...healthResults,
        lastCheck: new Date(),
        consecutiveFailures: healthResults.primary.status === 'healthy' ? 0 : this.healthStatus.consecutiveFailures + 1
      };
      
      // Check if failover is needed
      if (this.config.autoFailoverEnabled && this.healthStatus.consecutiveFailures >= this.config.failoverThreshold) {
        console.log('Failover threshold reached, initiating automatic failover');
        await this.initiateFailover();
      }
      
      this.emit('healthCheckCompleted', this.healthStatus);
      
    } catch (error) {
      console.error('Health check error:', error);
      this.emit('healthCheckError', error);
    }
  }

  async checkPrimaryHealth() {
    try {
      // Check if primary database is accessible
      const isAccessible = await this.testDatabaseConnection(this.config.primaryDbPath);
      
      if (!isAccessible) {
        return {
          status: 'unhealthy',
          error: 'Database not accessible',
          lastCheck: new Date()
        };
      }
      
      // Check database file integrity
      const integrityCheck = await this.checkDatabaseIntegrity(this.config.primaryDbPath);
      
      return {
        status: integrityCheck.isValid ? 'healthy' : 'corrupted',
        integrity: integrityCheck,
        lastCheck: new Date()
      };
      
    } catch (error) {
      return {
        status: 'error',
        error: error.message,
        lastCheck: new Date()
      };
    }
  }

  async checkReplicaHealth() {
    const replicaStatus = [];
    
    try {
      const replicationStatus = this.replicationManager.getReplicationStatus();
      
      for (const replica of replicationStatus.replicas) {
        const isHealthy = replica.status === 'synced' && replica.lag < 30000; // 30 seconds lag threshold
        
        replicaStatus.push({
          id: replica.id,
          status: isHealthy ? 'healthy' : 'unhealthy',
          lag: replica.lag,
          lastSync: replica.lastSync,
          queueSize: replica.queueSize
        });
      }
      
    } catch (error) {
      console.error('Error checking replica health:', error);
    }
    
    return replicaStatus;
  }

  async checkBackupHealth() {
    try {
      const backupStats = this.backupManager.getBackupStatistics();
      const lastBackup = this.backupManager.getBackupHistory()[0];
      
      return {
        totalBackups: backupStats.totalBackups,
        successfulBackups: backupStats.successfulBackups,
        lastBackupTime: lastBackup ? lastBackup.endTime : null,
        status: backupStats.successfulBackups > 0 ? 'healthy' : 'warning'
      };
      
    } catch (error) {
      return {
        status: 'error',
        error: error.message
      };
    }
  }

  async testDatabaseConnection(dbPath) {
    return new Promise((resolve) => {
      if (!fs.existsSync(dbPath)) {
        resolve(false);
        return;
      }
      
      const sqlite3 = require('sqlite3').verbose();
      const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
      
      db.get('SELECT 1', (err) => {
        db.close();
        resolve(!err);
      });
    });
  }

  async checkDatabaseIntegrity(dbPath) {
    return new Promise((resolve) => {
      const sqlite3 = require('sqlite3').verbose();
      const db = new sqlite3.Database(dbPath);
      
      db.get('PRAGMA integrity_check', (err, row) => {
        db.close();
        
        if (err) {
          resolve({ isValid: false, error: err.message });
        } else {
          const result = row ? Object.values(row)[0] : 'ok';
          resolve({ isValid: result === 'ok', result });
        }
      });
    });
  }

  async initiateFailover() {
    if (this.isRecovering) {
      console.log('Recovery is already in progress');
      return;
    }
    
    this.isRecovering = true;
    console.log('Initiating database failover...');
    
    try {
      // Find healthy replica
      const healthyReplica = this.healthStatus.replicas.find(r => r.status === 'healthy');
      
      if (!healthyReplica) {
        throw new Error('No healthy replicas available for failover');
      }
      
      // Promote replica to primary
      await this.replicationManager.promoteReplica(healthyReplica.id);
      
      // Update recovery plan
      await this.updateRecoveryPlan('failover', {
        promotedReplica: healthyReplica.id,
        timestamp: new Date()
      });
      
      this.emit('failoverCompleted', { promotedReplica: healthyReplica.id });
      console.log('Failover completed successfully');
      
    } catch (error) {
      console.error('Failover failed:', error);
      this.emit('failoverFailed', error);
      throw error;
    } finally {
      this.isRecovering = false;
    }
  }

  async createRecoveryPlan() {
    const plan = {
      id: this.generatePlanId(),
      created: new Date(),
      version: '1.0',
      rto: 300000, // 5 minutes Recovery Time Objective
      rpo: 60000,  // 1 minute Recovery Point Objective
      steps: [
        {
          id: 1,
          name: 'Detect failure',
          description: 'Monitor primary database health',
          automated: true,
          timeout: 30000
        },
        {
          id: 2,
          name: 'Initiate failover',
          description: 'Promote healthy replica to primary',
          automated: this.config.autoFailoverEnabled,
          timeout: 60000
        },
        {
          id: 3,
          name: 'Verify new primary',
          description: 'Check database integrity and connectivity',
          automated: true,
          timeout: 30000
        },
        {
          id: 4,
          name: 'Update application configuration',
          description: 'Redirect application traffic to new primary',
          automated: false,
          timeout: 120000
        },
        {
          id: 5,
          name: 'Re-establish replication',
          description: 'Set up replication from new primary',
          automated: true,
          timeout: 180000
        }
      ],
      contacts: [
        {
          name: 'Database Administrator',
          email: 'dba@healthcare.com',
          role: 'primary'
        },
        {
          name: 'DevOps Team',
          email: 'devops@healthcare.com',
          role: 'secondary'
        }
      ]
    };
    
    this.recoveryPlan = plan;
    
    // Save plan to file
    const planPath = path.join(this.config.recoveryDirectory, 'plans', `${plan.id}.json`);
    fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));
    
    this.emit('recoveryPlanCreated', plan);
    console.log(`Recovery plan created: ${plan.id}`);
    
    return plan;
  }

  async updateRecoveryPlan(action, data) {
    if (!this.recoveryPlan) {
      await this.createRecoveryPlan();
    }
    
    const update = {
      action,
      data,
      timestamp: new Date()
    };
    
    if (!this.recoveryPlan.history) {
      this.recoveryPlan.history = [];
    }
    
    this.recoveryPlan.history.push(update);
    this.recoveryPlan.lastUpdated = new Date();
    
    // Save updated plan
    const planPath = path.join(this.config.recoveryDirectory, 'plans', `${this.recoveryPlan.id}.json`);
    fs.writeFileSync(planPath, JSON.stringify(this.recoveryPlan, null, 2));
    
    this.emit('recoveryPlanUpdated', update);
  }

  async createRecoveryPoint(backupInfo = null) {
    const recoveryPoint = {
      id: this.generateRecoveryPointId(),
      timestamp: new Date(),
      type: backupInfo ? backupInfo.type : 'snapshot',
      backupId: backupInfo ? backupInfo.id : null,
      primaryStatus: this.healthStatus.primary,
      replicaStatus: this.healthStatus.replicas,
      metadata: {
        databaseSize: await this.getDatabaseSize(),
        tableCount: await this.getTableCount(),
        recordCount: await this.getRecordCount()
      }
    };
    
    // Save recovery point
    const recoveryPointPath = path.join(this.config.recoveryDirectory, 'snapshots', `${recoveryPoint.id}.json`);
    fs.writeFileSync(recoveryPointPath, JSON.stringify(recoveryPoint, null, 2));
    
    // Clean up old recovery points
    await this.cleanupOldRecoveryPoints();
    
    this.emit('recoveryPointCreated', recoveryPoint);
    console.log(`Recovery point created: ${recoveryPoint.id}`);
    
    return recoveryPoint;
  }

  async cleanupOldRecoveryPoints() {
    const snapshotsDir = path.join(this.config.recoveryDirectory, 'snapshots');
    const files = fs.readdirSync(snapshotsDir);
    
    if (files.length <= this.config.maxRecoveryPoints) {
      return;
    }
    
    // Sort files by modification time and delete oldest
    const fileStats = files.map(file => ({
      name: file,
      path: path.join(snapshotsDir, file),
      mtime: fs.statSync(path.join(snapshotsDir, file)).mtime
    }));
    
    fileStats.sort((a, b) => a.mtime - b.mtime);
    
    const filesToDelete = fileStats.slice(0, files.length - this.config.maxRecoveryPoints);
    
    for (const file of filesToDelete) {
      fs.unlinkSync(file.path);
      console.log(`Deleted old recovery point: ${file.name}`);
    }
  }

  async executeRecovery(recoveryPointId = null) {
    if (this.isRecovering) {
      throw new Error('Recovery is already in progress');
    }
    
    this.isRecovering = true;
    console.log('Executing disaster recovery...');
    
    try {
      // Find recovery point or use latest
      let recoveryPoint;
      if (recoveryPointId) {
        recoveryPoint = await this.loadRecoveryPoint(recoveryPointId);
      } else {
        recoveryPoint = await this.getLatestRecoveryPoint();
      }
      
      if (!recoveryPoint) {
        throw new Error('No recovery point available');
      }
      
      console.log(`Using recovery point: ${recoveryPoint.id}`);
      
      // Execute recovery steps
      for (const step of this.recoveryPlan.steps) {
        console.log(`Executing recovery step: ${step.name}`);
        
        const startTime = Date.now();
        const result = await this.executeRecoveryStep(step);
        
        if (Date.now() - startTime > step.timeout) {
          throw new Error(`Recovery step timeout: ${step.name}`);
        }
        
        if (!result.success) {
          throw new Error(`Recovery step failed: ${step.name} - ${result.error}`);
        }
      }
      
      this.emit('recoveryCompleted', { recoveryPointId: recoveryPoint.id });
      console.log('Disaster recovery completed successfully');
      
    } catch (error) {
      console.error('Recovery failed:', error);
      this.emit('recoveryFailed', error);
      throw error;
    } finally {
      this.isRecovering = false;
    }
  }

  async executeRecoveryStep(step) {
    switch (step.id) {
      case 1: // Detect failure
        return { success: true };
        
      case 2: // Initiate failover
        if (step.automated) {
          await this.initiateFailover();
          return { success: true };
        } else {
          return { success: false, error: 'Manual intervention required' };
        }
        
      case 3: // Verify new primary
        const healthCheck = await this.performHealthCheck();
        return { 
          success: healthCheck.primary.status === 'healthy',
          data: healthCheck
        };
        
      case 4: // Update application configuration
        return { 
          success: false, 
          error: 'Manual intervention required - update application config' 
        };
        
      case 5: // Re-establish replication
        await this.replicationManager.startReplication();
        return { success: true };
        
      default:
        return { success: false, error: 'Unknown recovery step' };
    }
  }

  async loadRecoveryPoint(recoveryPointId) {
    const recoveryPointPath = path.join(this.config.recoveryDirectory, 'snapshots', `${recoveryPointId}.json`);
    
    if (!fs.existsSync(recoveryPointPath)) {
      throw new Error(`Recovery point not found: ${recoveryPointId}`);
    }
    
    const data = fs.readFileSync(recoveryPointPath, 'utf8');
    return JSON.parse(data);
  }

  async getLatestRecoveryPoint() {
    const snapshotsDir = path.join(this.config.recoveryDirectory, 'snapshots');
    const files = fs.readdirSync(snapshotsDir);
    
    if (files.length === 0) {
      return null;
    }
    
    // Find most recent file
    let latestFile = null;
    let latestTime = new Date(0);
    
    for (const file of files) {
      const filePath = path.join(snapshotsDir, file);
      const mtime = fs.statSync(filePath).mtime;
      
      if (mtime > latestTime) {
        latestTime = mtime;
        latestFile = file;
      }
    }
    
    if (latestFile) {
      return await this.loadRecoveryPoint(latestFile.replace('.json', ''));
    }
    
    return null;
  }

  async getDatabaseSize() {
    try {
      const stats = fs.statSync(this.config.primaryDbPath);
      return stats.size;
    } catch (error) {
      return 0;
    }
  }

  async getTableCount() {
    return new Promise((resolve) => {
      const sqlite3 = require('sqlite3').verbose();
      const db = new sqlite3.Database(this.config.primaryDbPath);
      
      db.get("SELECT COUNT(*) as count FROM sqlite_master WHERE type='table'", (err, row) => {
        db.close();
        resolve(err ? 0 : row.count);
      });
    });
  }

  async getRecordCount() {
    return new Promise((resolve) => {
      const sqlite3 = require('sqlite3').verbose();
      const db = new sqlite3.Database(this.config.primaryDbPath);
      
      db.get("SELECT SUM(COUNT) as total FROM (SELECT COUNT(*) as COUNT FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%')", (err, row) => {
        db.close();
        resolve(err ? 0 : row.total || 0);
      });
    });
  }

  generatePlanId() {
    return `plan_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  generateRecoveryPointId() {
    return `recovery_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  getDisasterRecoveryStatus() {
    return {
      isRecovering: this.isRecovering,
      healthStatus: this.healthStatus,
      recoveryPlan: this.recoveryPlan,
      config: this.config,
      lastHealthCheck: this.healthStatus.lastCheck
    };
  }

  getRecoveryHistory() {
    const snapshotsDir = path.join(this.config.recoveryDirectory, 'snapshots');
    const files = fs.readdirSync(snapshotsDir);
    
    return files.map(file => {
      const filePath = path.join(snapshotsDir, file);
      const stats = fs.statSync(filePath);
      
      return {
        id: file.replace('.json', ''),
        filename: file,
        created: stats.mtime,
        size: stats.size
      };
    }).sort((a, b) => b.created - a.created);
  }

  handleBackupError(error) {
    console.error('Backup error in disaster recovery:', error);
    // Could implement additional error handling here
  }

  handleReplicationError(error) {
    console.error('Replication error in disaster recovery:', error);
    // Could implement additional error handling here
  }

  handleReplicaPromotion(data) {
    console.log('Replica promotion handled in disaster recovery:', data);
    // Update recovery plan with promotion info
    this.updateRecoveryPlan('replica_promotion', data);
  }
}

module.exports = DisasterRecoveryManager;
