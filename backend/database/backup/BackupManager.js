const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { EventEmitter } = require('events');

class BackupManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      backupDirectory: config.backupDirectory || path.join(__dirname, 'backups'),
      retentionDays: config.retentionDays || 30,
      compressionEnabled: config.compressionEnabled !== false,
      encryptionEnabled: config.encryptionEnabled || false,
      encryptionKey: config.encryptionKey || null,
      backupInterval: config.backupInterval || 3600000, // 1 hour
      maxBackupSize: config.maxBackupSize || 1073741824, // 1GB
      parallelBackups: config.parallelBackups || false,
      checksumEnabled: config.checksumEnabled !== false
    };
    
    this.primaryDbPath = config.primaryDbPath || path.join(__dirname, '..', 'healthcare.db');
    this.backupSchedule = new Map();
    this.backupHistory = [];
    this.isBackupRunning = false;
    this.backupIntervalId = null;
    
    this.ensureBackupDirectory();
  }

  ensureBackupDirectory() {
    if (!fs.existsSync(this.config.backupDirectory)) {
      fs.mkdirSync(this.config.backupDirectory, { recursive: true });
    }
    
    // Create subdirectories
    const subdirs = ['full', 'incremental', 'differential', 'logs'];
    subdirs.forEach(dir => {
      const fullPath = path.join(this.config.backupDirectory, dir);
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
      }
    });
  }

  async startScheduledBackups() {
    if (this.backupIntervalId) {
      console.log('Backup scheduling is already running');
      return;
    }

    console.log('Starting scheduled database backups...');
    
    this.backupIntervalId = setInterval(async () => {
      try {
        await this.createBackup('full');
      } catch (error) {
        console.error('Scheduled backup error:', error);
        this.emit('backupError', error);
      }
    }, this.config.backupInterval);
    
    this.emit('backupScheduleStarted');
  }

  stopScheduledBackups() {
    if (this.backupIntervalId) {
      clearInterval(this.backupIntervalId);
      this.backupIntervalId = null;
      console.log('Scheduled backups stopped');
      this.emit('backupScheduleStopped');
    }
  }

  async createBackup(type = 'full', options = {}) {
    if (this.isBackupRunning && !this.config.parallelBackups) {
      throw new Error('Backup is already in progress');
    }

    this.isBackupRunning = true;
    const startTime = Date.now();
    const backupId = this.generateBackupId();
    
    try {
      console.log(`Starting ${type} backup: ${backupId}`);
      
      const backupInfo = {
        id: backupId,
        type: type,
        startTime: new Date(),
        status: 'in_progress',
        sourceDb: this.primaryDbPath,
        size: 0,
        compressed: this.config.compressionEnabled,
        encrypted: this.config.encryptionEnabled
      };

      // Create backup based on type
      let backupPath;
      switch (type) {
        case 'full':
          backupPath = await this.createFullBackup(backupId, options);
          break;
        case 'incremental':
          backupPath = await this.createIncrementalBackup(backupId, options);
          break;
        case 'differential':
          backupPath = await this.createDifferentialBackup(backupId, options);
          break;
        default:
          throw new Error(`Unknown backup type: ${type}`);
      }

      // Get backup file size
      const stats = fs.statSync(backupPath);
      backupInfo.size = stats.size;
      backupInfo.endTime = new Date();
      backupInfo.duration = Date.now() - startTime;
      backupInfo.status = 'completed';
      backupInfo.path = backupPath;

      // Calculate checksum if enabled
      if (this.config.checksumEnabled) {
        backupInfo.checksum = await this.calculateChecksum(backupPath);
      }

      // Add to history
      this.backupHistory.push(backupInfo);
      
      // Clean up old backups
      await this.cleanupOldBackups();
      
      console.log(`Backup completed: ${backupId} (${backupInfo.duration}ms)`);
      this.emit('backupCompleted', backupInfo);
      
      return backupInfo;
      
    } catch (error) {
      console.error(`Backup failed: ${backupId}`, error);
      this.emit('backupError', { backupId, error });
      throw error;
    } finally {
      this.isBackupRunning = false;
    }
  }

  async createFullBackup(backupId, options = {}) {
    const backupDir = path.join(this.config.backupDirectory, 'full');
    const backupPath = path.join(backupDir, `${backupId}.db`);
    
    // Create backup using SQLite backup API
    const sourceDb = new sqlite3.Database(this.primaryDbPath);
    const backupDb = new sqlite3.Database(backupPath);
    
    await new Promise((resolve, reject) => {
      sourceDb.backup(backupDb, (progress) => {
        if (progress.remaining === 0) {
          sourceDb.close();
          backupDb.close();
          resolve();
        }
      }, (err) => {
        if (err) {
          reject(err);
        }
      });
    });
    
    // Apply post-processing
    return await this.postProcessBackup(backupPath, backupId);
  }

  async createIncrementalBackup(backupId, options = {}) {
    // For SQLite, incremental backup is based on WAL file changes
    const backupDir = path.join(this.config.backupDirectory, 'incremental');
    const backupPath = path.join(backupDir, `${backupId}.wal`);
    
    const walPath = this.primaryDbPath + '-wal';
    
    if (!fs.existsSync(walPath)) {
      throw new Error('No WAL file found - ensure WAL mode is enabled');
    }
    
    // Copy WAL file
    fs.copyFileSync(walPath, backupPath);
    
    return await this.postProcessBackup(backupPath, backupId);
  }

  async createDifferentialBackup(backupId, options = {}) {
    // Differential backup copies the entire database but only changes since last full backup
    const lastFullBackup = this.getLastFullBackup();
    
    if (!lastFullBackup) {
      console.log('No full backup found, creating full backup instead');
      return await this.createFullBackup(backupId, options);
    }
    
    const backupDir = path.join(this.config.backupDirectory, 'differential');
    const backupPath = path.join(backupDir, `${backupId}.db`);
    
    // Create differential backup
    const sourceDb = new sqlite3.Database(this.primaryDbPath);
    const backupDb = new sqlite3.Database(backupPath);
    
    await new Promise((resolve, reject) => {
      sourceDb.backup(backupDb, (progress) => {
        if (progress.remaining === 0) {
          sourceDb.close();
          backupDb.close();
          resolve();
        }
      }, (err) => {
        if (err) {
          reject(err);
        }
      });
    });
    
    return await this.postProcessBackup(backupPath, backupId);
  }

  async postProcessBackup(backupPath, backupId) {
    let processedPath = backupPath;
    
    // Compress if enabled
    if (this.config.compressionEnabled) {
      processedPath = await this.compressBackup(backupPath, backupId);
    }
    
    // Encrypt if enabled
    if (this.config.encryptionEnabled && this.config.encryptionKey) {
      processedPath = await this.encryptBackup(processedPath, backupId);
    }
    
    // Remove original if compressed/encrypted
    if (processedPath !== backupPath) {
      fs.unlinkSync(backupPath);
    }
    
    return processedPath;
  }

  async compressBackup(backupPath, backupId) {
    const compressedPath = backupPath + '.gz';
    
    return new Promise((resolve, reject) => {
      const readStream = fs.createReadStream(backupPath);
      const writeStream = fs.createWriteStream(compressedPath);
      const gzip = zlib.createGzip();
      
      readStream.pipe(gzip).pipe(writeStream);
      
      writeStream.on('finish', () => {
        resolve(compressedPath);
      });
      
      writeStream.on('error', reject);
      readStream.on('error', reject);
      gzip.on('error', reject);
    });
  }

  async encryptBackup(backupPath, backupId) {
    const encryptedPath = backupPath + '.enc';
    const algorithm = 'aes-256-gcm';
    const key = crypto.scryptSync(this.config.encryptionKey, 'salt', 32);
    const iv = crypto.randomBytes(16);
    
    const cipher = crypto.createCipher(algorithm, key, iv);
    
    const input = fs.readFileSync(backupPath);
    const encrypted = Buffer.concat([cipher.update(input), cipher.final()]);
    const authTag = cipher.getAuthTag();
    
    // Combine IV, auth tag, and encrypted data
    const combined = Buffer.concat([iv, authTag, encrypted]);
    fs.writeFileSync(encryptedPath, combined);
    
    return encryptedPath;
  }

  async calculateChecksum(filePath) {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    
    return new Promise((resolve, reject) => {
      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  generateBackupId() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const random = Math.random().toString(36).substring(2, 8);
    return `backup_${timestamp}_${random}`;
  }

  getLastFullBackup() {
    return this.backupHistory
      .filter(backup => backup.type === 'full' && backup.status === 'completed')
      .sort((a, b) => new Date(b.endTime) - new Date(a.endTime))[0];
  }

  async restoreBackup(backupId, targetPath = null) {
    const backupInfo = this.backupHistory.find(backup => backup.id === backupId);
    
    if (!backupInfo) {
      throw new Error(`Backup not found: ${backupId}`);
    }
    
    const restorePath = targetPath || this.primaryDbPath + '.restored';
    
    console.log(`Restoring backup: ${backupId} to ${restorePath}`);
    
    try {
      // Decrypt if needed
      let sourcePath = backupInfo.path;
      if (backupInfo.encrypted) {
        sourcePath = await this.decryptBackup(sourcePath, backupId);
      }
      
      // Decompress if needed
      if (backupInfo.compressed) {
        sourcePath = await this.decompressBackup(sourcePath, backupId);
      }
      
      // Copy backup to restore location
      fs.copyFileSync(sourcePath, restorePath);
      
      // Clean up temporary files
      if (sourcePath !== backupInfo.path) {
        fs.unlinkSync(sourcePath);
      }
      
      console.log(`Backup restored successfully: ${backupId}`);
      this.emit('backupRestored', { backupId, restorePath });
      
      return restorePath;
      
    } catch (error) {
      console.error(`Restore failed: ${backupId}`, error);
      this.emit('restoreError', { backupId, error });
      throw error;
    }
  }

  async decryptBackup(encryptedPath, backupId) {
    const decryptedPath = encryptedPath.replace('.enc', '.dec');
    const algorithm = 'aes-256-gcm';
    const key = crypto.scryptSync(this.config.encryptionKey, 'salt', 32);
    
    const encrypted = fs.readFileSync(encryptedPath);
    const iv = encrypted.slice(0, 16);
    const authTag = encrypted.slice(16, 32);
    const ciphertext = encrypted.slice(32);
    
    const decipher = crypto.createDecipher(algorithm, key, iv);
    decipher.setAuthTag(authTag);
    
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    fs.writeFileSync(decryptedPath, decrypted);
    
    return decryptedPath;
  }

  async decompressBackup(compressedPath, backupId) {
    const decompressedPath = compressedPath.replace('.gz', '');
    
    return new Promise((resolve, reject) => {
      const readStream = fs.createReadStream(compressedPath);
      const writeStream = fs.createWriteStream(decompressedPath);
      const gunzip = zlib.createGunzip();
      
      readStream.pipe(gunzip).pipe(writeStream);
      
      writeStream.on('finish', () => resolve(decompressedPath));
      writeStream.on('error', reject);
      readStream.on('error', reject);
      gunzip.on('error', reject);
    });
  }

  async cleanupOldBackups() {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.retentionDays);
    
    const backupsToDelete = this.backupHistory.filter(backup => 
      new Date(backup.endTime) < cutoffDate && backup.status === 'completed'
    );
    
    for (const backup of backupsToDelete) {
      try {
        if (fs.existsSync(backup.path)) {
          fs.unlinkSync(backup.path);
        }
        
        // Remove from history
        const index = this.backupHistory.indexOf(backup);
        if (index > -1) {
          this.backupHistory.splice(index, 1);
        }
        
        console.log(`Deleted old backup: ${backup.id}`);
        
      } catch (error) {
        console.error(`Error deleting backup ${backup.id}:`, error);
      }
    }
    
    if (backupsToDelete.length > 0) {
      this.emit('backupsCleanedUp', { deletedCount: backupsToDelete.length });
    }
  }

  async verifyBackup(backupId) {
    const backupInfo = this.backupHistory.find(backup => backup.id === backupId);
    
    if (!backupInfo) {
      throw new Error(`Backup not found: ${backupId}`);
    }
    
    if (!backupInfo.checksum) {
      throw new Error(`No checksum available for backup: ${backupId}`);
    }
    
    const currentChecksum = await this.calculateChecksum(backupInfo.path);
    const isValid = currentChecksum === backupInfo.checksum;
    
    const verificationResult = {
      backupId,
      isValid,
      expectedChecksum: backupInfo.checksum,
      actualChecksum: currentChecksum,
      verificationTime: new Date()
    };
    
    this.emit('backupVerified', verificationResult);
    
    return verificationResult;
  }

  getBackupHistory() {
    return this.backupHistory.sort((a, b) => new Date(b.endTime) - new Date(a.endTime));
  }

  getBackupStatistics() {
    const stats = {
      totalBackups: this.backupHistory.length,
      successfulBackups: this.backupHistory.filter(b => b.status === 'completed').length,
      failedBackups: this.backupHistory.filter(b => b.status === 'failed').length,
      totalSize: this.backupHistory.reduce((sum, b) => sum + (b.size || 0), 0),
      averageBackupTime: 0,
      lastBackupTime: null,
      backupTypes: {
        full: 0,
        incremental: 0,
        differential: 0
      }
    };
    
    const successfulBackups = this.backupHistory.filter(b => b.status === 'completed');
    
    if (successfulBackups.length > 0) {
      stats.averageBackupTime = successfulBackups.reduce((sum, b) => sum + (b.duration || 0), 0) / successfulBackups.length;
      stats.lastBackupTime = new Date(Math.max(...successfulBackups.map(b => new Date(b.endTime))));
    }
    
    this.backupHistory.forEach(backup => {
      if (stats.backupTypes[backup.type] !== undefined) {
        stats.backupTypes[backup.type]++;
      }
    });
    
    return stats;
  }

  async createBackupSchedule(name, type, interval, options = {}) {
    const schedule = {
      name,
      type,
      interval,
      options,
      enabled: true,
      lastRun: null,
      nextRun: new Date(Date.now() + interval),
      runCount: 0
    };
    
    this.backupSchedule.set(name, schedule);
    
    // Start the scheduled backup
    this.startBackupSchedule(name);
    
    this.emit('backupScheduleCreated', schedule);
    
    return schedule;
  }

  startBackupSchedule(name) {
    const schedule = this.backupSchedule.get(name);
    if (!schedule || !schedule.enabled) {
      return;
    }
    
    const intervalId = setInterval(async () => {
      if (!schedule.enabled) {
        clearInterval(intervalId);
        return;
      }
      
      try {
        await this.createBackup(schedule.type, schedule.options);
        schedule.lastRun = new Date();
        schedule.nextRun = new Date(Date.now() + schedule.interval);
        schedule.runCount++;
        
        this.emit('scheduledBackupExecuted', { name, schedule });
        
      } catch (error) {
        console.error(`Scheduled backup error (${name}):`, error);
        this.emit('scheduledBackupError', { name, error });
      }
    }, schedule.interval);
    
    schedule.intervalId = intervalId;
  }

  stopBackupSchedule(name) {
    const schedule = this.backupSchedule.get(name);
    if (schedule && schedule.intervalId) {
      clearInterval(schedule.intervalId);
      schedule.intervalId = null;
      schedule.enabled = false;
      
      this.emit('backupScheduleStopped', { name });
    }
  }

  deleteBackupSchedule(name) {
    this.stopBackupSchedule(name);
    this.backupSchedule.delete(name);
    
    this.emit('backupScheduleDeleted', { name });
  }

  getBackupSchedules() {
    return Array.from(this.backupSchedule.values());
  }
}

module.exports = BackupManager;
