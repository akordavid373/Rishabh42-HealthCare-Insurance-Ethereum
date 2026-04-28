const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

class ShardingManager {
  constructor(config = {}) {
    this.shardCount = config.shardCount || 4;
    this.shardingStrategy = config.shardingStrategy || 'hash'; // hash, range, directory
    this.shardDirectory = config.shardDirectory || path.join(__dirname, 'shards');
    this.shards = new Map();
    this.shardConfigs = new Map();
    
    this.ensureShardDirectory();
    this.initializeShards();
  }

  ensureShardDirectory() {
    if (!fs.existsSync(this.shardDirectory)) {
      fs.mkdirSync(this.shardDirectory, { recursive: true });
    }
  }

  initializeShards() {
    for (let i = 0; i < this.shardCount; i++) {
      const shardPath = path.join(this.shardDirectory, `shard_${i}.db`);
      const shard = new sqlite3.Database(shardPath);
      
      this.shards.set(i, shard);
      this.shardConfigs.set(i, {
        path: shardPath,
        id: i,
        status: 'active',
        lastAccess: new Date(),
        queryCount: 0
      });
      
      console.log(`Initialized shard ${i} at ${shardPath}`);
    }
  }

  getShardKey(value, strategy = this.shardingStrategy) {
    switch (strategy) {
      case 'hash':
        return this.hashSharding(value);
      case 'range':
        return this.rangeSharding(value);
      case 'directory':
        return this.directorySharding(value);
      default:
        return this.hashSharding(value);
    }
  }

  hashSharding(value) {
    const hash = crypto.createHash('md5').update(String(value)).digest('hex');
    const shardId = parseInt(hash.substring(0, 8), 16) % this.shardCount;
    return shardId;
  }

  rangeSharding(value) {
    const numValue = parseInt(value) || 0;
    return Math.floor(numValue / Math.ceil(1000000 / this.shardCount)) % this.shardCount;
  }

  directorySharding(value) {
    const directories = ['patients', 'claims', 'payments', 'medical_records'];
    const index = directories.indexOf(value.toLowerCase());
    return index >= 0 ? index : this.hashSharding(value);
  }

  async executeQuery(shardKey, query, params = []) {
    const shardId = this.getShardKey(shardKey);
    const shard = this.shards.get(shardId);
    const config = this.shardConfigs.get(shardId);
    
    if (!shard) {
      throw new Error(`Shard ${shardId} not found`);
    }

    config.lastAccess = new Date();
    config.queryCount++;

    return new Promise((resolve, reject) => {
      shard.all(query, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  async executeWrite(shardKey, query, params = []) {
    const shardId = this.getShardKey(shardKey);
    const shard = this.shards.get(shardId);
    const config = this.shardConfigs.get(shardId);
    
    if (!shard) {
      throw new Error(`Shard ${shardId} not found`);
    }

    config.lastAccess = new Date();
    config.queryCount++;

    return new Promise((resolve, reject) => {
      shard.run(query, params, function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({ id: this.lastID, changes: this.changes });
        }
      });
    });
  }

  async executeTransaction(operations) {
    const results = [];
    
    for (const operation of operations) {
      const { shardKey, query, params, type } = operation;
      
      try {
        if (type === 'read') {
          const result = await this.executeQuery(shardKey, query, params);
          results.push({ success: true, data: result });
        } else if (type === 'write') {
          const result = await this.executeWrite(shardKey, query, params);
          results.push({ success: true, data: result });
        }
      } catch (error) {
        results.push({ success: false, error: error.message });
      }
    }
    
    return results;
  }

  async distributeQuery(query, params = []) {
    const allResults = [];
    
    for (let i = 0; i < this.shardCount; i++) {
      try {
        const shard = this.shards.get(i);
        const config = this.shardConfigs.get(i);
        
        config.lastAccess = new Date();
        config.queryCount++;
        
        const result = await new Promise((resolve, reject) => {
          shard.all(query, params, (err, rows) => {
            if (err) {
              reject(err);
            } else {
              resolve(rows);
            }
          });
        });
        
        allResults.push(...result);
      } catch (error) {
        console.error(`Error querying shard ${i}:`, error);
      }
    }
    
    return allResults;
  }

  getShardStats() {
    const stats = [];
    
    for (const [shardId, config] of this.shardConfigs) {
      const shardPath = config.path;
      const size = fs.existsSync(shardPath) ? fs.statSync(shardPath).size : 0;
      
      stats.push({
        shardId,
        path: config.path,
        status: config.status,
        queryCount: config.queryCount,
        lastAccess: config.lastAccess,
        sizeBytes: size,
        sizeMB: (size / (1024 * 1024)).toFixed(2)
      });
    }
    
    return stats;
  }

  async rebalanceShards() {
    const stats = this.getShardStats();
    const avgSize = stats.reduce((sum, stat) => sum + stat.sizeBytes, 0) / stats.length;
    
    const recommendations = [];
    
    for (const stat of stats) {
      const sizeRatio = stat.sizeBytes / avgSize;
      
      if (sizeRatio > 1.5) {
        recommendations.push({
          shardId: stat.shardId,
          action: 'split',
          reason: `Shard is ${sizeRatio.toFixed(2)}x larger than average`,
          sizeMB: stat.sizeMB
        });
      } else if (sizeRatio < 0.5) {
        recommendations.push({
          shardId: stat.shardId,
          action: 'merge',
          reason: `Shard is ${(1/sizeRatio).toFixed(2)}x smaller than average`,
          sizeMB: stat.sizeMB
        });
      }
    }
    
    return recommendations;
  }

  async closeAllShards() {
    const closePromises = [];
    
    for (const [shardId, shard] of this.shards) {
      closePromises.push(
        new Promise((resolve, reject) => {
          shard.close((err) => {
            if (err) {
              reject(err);
            } else {
              console.log(`Closed shard ${shardId}`);
              resolve();
            }
          });
        })
      );
    }
    
    await Promise.all(closePromises);
  }

  async createShardTables(shardId) {
    const shard = this.shards.get(shardId);
    
    const tables = [
      `CREATE TABLE IF NOT EXISTS patients_shard_${shardId} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        medical_record_number TEXT UNIQUE NOT NULL,
        insurance_provider TEXT,
        insurance_policy_number TEXT,
        emergency_contact_name TEXT,
        emergency_contact_phone TEXT,
        blood_type TEXT,
        allergies TEXT,
        medications TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      
      `CREATE TABLE IF NOT EXISTS medical_records_shard_${shardId} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER NOT NULL,
        provider_id INTEGER NOT NULL,
        record_type TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        diagnosis_code TEXT,
        treatment_code TEXT,
        date_of_service DATE NOT NULL,
        facility_name TEXT,
        provider_name TEXT,
        notes TEXT,
        attachments TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      
      `CREATE TABLE IF NOT EXISTS insurance_claims_shard_${shardId} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER NOT NULL,
        claim_number TEXT UNIQUE NOT NULL,
        service_date DATE NOT NULL,
        provider_name TEXT NOT NULL,
        diagnosis_codes TEXT,
        procedure_codes TEXT,
        total_amount DECIMAL(10,2) NOT NULL,
        insurance_amount DECIMAL(10,2),
        patient_responsibility DECIMAL(10,2),
        status TEXT NOT NULL,
        submission_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        processing_date DATETIME,
        payment_date DATETIME,
        denial_reason TEXT,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`
    ];

    for (const tableSql of tables) {
      await new Promise((resolve, reject) => {
        shard.run(tableSql, (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    }
    
    console.log(`Created tables for shard ${shardId}`);
  }
}

module.exports = ShardingManager;
