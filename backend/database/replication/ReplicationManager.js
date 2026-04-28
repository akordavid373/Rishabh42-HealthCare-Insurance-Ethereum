const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');

class ReplicationManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this.primaryDbPath = config.primaryDbPath || path.join(__dirname, '..', 'healthcare.db');
    this.replicaDirectory = config.replicaDirectory || path.join(__dirname, 'replicas');
    this.replicaCount = config.replicaCount || 2;
    this.replicationInterval = config.replicationInterval || 5000; // 5 seconds
    this.maxLag = config.maxLag || 30000; // 30 seconds max lag
    
    this.primaryDb = null;
    this.replicas = new Map();
    this.replicationLog = [];
    this.isReplicating = false;
    this.lastReplicationTime = null;
    
    this.ensureReplicaDirectory();
    this.initializeConnections();
  }

  ensureReplicaDirectory() {
    if (!fs.existsSync(this.replicaDirectory)) {
      fs.mkdirSync(this.replicaDirectory, { recursive: true });
    }
  }

  async initializeConnections() {
    try {
      // Connect to primary database
      this.primaryDb = new sqlite3.Database(this.primaryDbPath);
      console.log(`Connected to primary database: ${this.primaryDbPath}`);
      
      // Initialize replicas
      for (let i = 0; i < this.replicaCount; i++) {
        const replicaPath = path.join(this.replicaDirectory, `replica_${i}.db`);
        const replica = new sqlite3.Database(replicaPath);
        
        this.replicas.set(i, {
          db: replica,
          path: replicaPath,
          id: i,
          status: 'initializing',
          lastSync: null,
          lag: 0,
          syncQueue: []
        });
        
        console.log(`Initialized replica ${i} at ${replicaPath}`);
      }
      
      // Enable WAL mode on primary for better concurrency
      await this.executeOnPrimary('PRAGMA journal_mode=WAL');
      await this.executeOnPrimary('PRAGMA synchronous=NORMAL');
      
      // Initialize replica schemas
      await this.initializeReplicaSchemas();
      
    } catch (error) {
      console.error('Error initializing replication connections:', error);
      throw error;
    }
  }

  async executeOnPrimary(query, params = []) {
    return new Promise((resolve, reject) => {
      this.primaryDb.all(query, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  async executeOnReplica(replicaId, query, params = []) {
    const replica = this.replicas.get(replicaId);
    if (!replica) {
      throw new Error(`Replica ${replicaId} not found`);
    }

    return new Promise((resolve, reject) => {
      replica.db.all(query, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  async initializeReplicaSchemas() {
    // Get schema from primary
    const tables = await this.executeOnPrimary(
      "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    );
    
    // Create tables on each replica
    for (let replicaId = 0; replicaId < this.replicaCount; replicaId++) {
      const replica = this.replicas.get(replicaId);
      
      for (const table of tables) {
        await new Promise((resolve, reject) => {
          replica.db.run(table.sql, (err) => {
            if (err) {
              console.error(`Error creating table ${table.name} on replica ${replicaId}:`, err);
              reject(err);
            } else {
              resolve();
            }
          });
        });
      }
      
      replica.status = 'ready';
      console.log(`Schema initialized for replica ${replicaId}`);
    }
  }

  async startReplication() {
    if (this.isReplicating) {
      console.log('Replication is already running');
      return;
    }

    this.isReplicating = true;
    console.log('Starting database replication...');
    
    this.replicationInterval = setInterval(async () => {
      try {
        await this.performReplication();
      } catch (error) {
        console.error('Replication error:', error);
        this.emit('replicationError', error);
      }
    }, this.replicationInterval);
    
    this.emit('replicationStarted');
  }

  async stopReplication() {
    if (!this.isReplicating) {
      return;
    }

    this.isReplicating = false;
    clearInterval(this.replicationInterval);
    console.log('Replication stopped');
    this.emit('replicationStopped');
  }

  async performReplication() {
    const startTime = Date.now();
    
    try {
      // Get changes from primary since last replication
      const changes = await this.getChangesFromPrimary();
      
      if (changes.length === 0) {
        return;
      }
      
      // Apply changes to all replicas
      const replicationPromises = [];
      
      for (let replicaId = 0; replicaId < this.replicaCount; replicaId++) {
        replicationPromises.push(this.applyChangesToReplica(replicaId, changes));
      }
      
      await Promise.allSettled(replicationPromises);
      
      this.lastReplicationTime = new Date();
      
      // Log replication
      this.replicationLog.push({
        timestamp: this.lastReplicationTime,
        changesCount: changes.length,
        duration: Date.now() - startTime,
        success: true
      });
      
      // Keep log size manageable
      if (this.replicationLog.length > 1000) {
        this.replicationLog = this.replicationLog.slice(-500);
      }
      
      this.emit('replicationCompleted', {
        changesCount: changes.length,
        duration: Date.now() - startTime
      });
      
    } catch (error) {
      console.error('Error during replication:', error);
      this.emit('replicationError', error);
    }
  }

  async getChangesFromPrimary() {
    // Get all tables that need replication
    const tables = await this.executeOnPrimary(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    );
    
    const changes = [];
    
    for (const table of tables) {
      // Get recent changes based on updated_at timestamp if available
      const lastSyncTime = this.lastReplicationTime ? this.lastReplicationTime.toISOString() : '1970-01-01T00:00:00.000Z';
      
      let query = `SELECT * FROM ${table.name}`;
      let hasTimestamp = false;
      
      // Check if table has updated_at column
      const tableInfo = await this.executeOnPrimary(`PRAGMA table_info(${table.name})`);
      const hasUpdatedAt = tableInfo.some(col => col.name === 'updated_at');
      
      if (hasUpdatedAt) {
        query += ` WHERE updated_at > ?`;
        hasTimestamp = true;
      }
      
      try {
        const rows = hasUpdatedAt 
          ? await this.executeOnPrimary(query, [lastSyncTime])
          : await this.executeOnPrimary(query);
        
        if (rows.length > 0) {
          changes.push({
            table: table.name,
            rows: rows,
            hasTimestamp: hasTimestamp
          });
        }
      } catch (error) {
        console.error(`Error getting changes for table ${table.name}:`, error);
      }
    }
    
    return changes;
  }

  async applyChangesToReplica(replicaId, changes) {
    const replica = this.replicas.get(replicaId);
    if (!replica) {
      throw new Error(`Replica ${replicaId} not found`);
    }

    const startTime = Date.now();
    
    try {
      for (const change of changes) {
        await this.applyTableChangesToReplica(replicaId, change);
      }
      
      replica.lastSync = new Date();
      replica.lag = Date.now() - startTime;
      replica.status = 'synced';
      
    } catch (error) {
      replica.status = 'error';
      console.error(`Error applying changes to replica ${replicaId}:`, error);
      throw error;
    }
  }

  async applyTableChangesToReplica(replicaId, change) {
    const replica = this.replicas.get(replicaId);
    const { table, rows } = change;
    
    for (const row of rows) {
      // Check if row exists
      const existingRows = await new Promise((resolve, reject) => {
        const primaryKey = row.id ? 'id' : 'rowid';
        replica.db.get(
          `SELECT * FROM ${table} WHERE ${primaryKey} = ?`,
          [row[primaryKey]],
          (err, row) => {
            if (err) {
              reject(err);
            } else {
              resolve(row);
            }
          }
        );
      });
      
      if (existingRows) {
        // Update existing row
        const columns = Object.keys(row).filter(key => key !== 'rowid');
        const setClause = columns.map(col => `${col} = ?`).join(', ');
        const values = columns.map(col => row[col]);
        
        await new Promise((resolve, reject) => {
          replica.db.run(
            `UPDATE ${table} SET ${setClause} WHERE id = ?`,
            [...values, row.id],
            (err) => {
              if (err) {
                reject(err);
              } else {
                resolve();
              }
            }
          );
        });
      } else {
        // Insert new row
        const columns = Object.keys(row).filter(key => key !== 'rowid');
        const placeholders = columns.map(() => '?').join(', ');
        const values = columns.map(col => row[col]);
        
        await new Promise((resolve, reject) => {
          replica.db.run(
            `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
            values,
            (err) => {
              if (err) {
                reject(err);
              } else {
                resolve();
              }
            }
          );
        });
      }
    }
  }

  async promoteReplica(replicaId) {
    const replica = this.replicas.get(replicaId);
    if (!replica) {
      throw new Error(`Replica ${replicaId} not found`);
    }

    console.log(`Promoting replica ${replicaId} to primary...`);
    
    // Stop replication
    await this.stopReplication();
    
    // Close current primary
    await new Promise((resolve) => {
      this.primaryDb.close(resolve);
    });
    
    // Copy replica to primary location
    fs.copyFileSync(replica.path, this.primaryDbPath);
    
    // Reconnect to new primary
    this.primaryDb = new sqlite3.Database(this.primaryDbPath);
    
    // Update replica configuration
    replica.status = 'primary';
    
    console.log(`Replica ${replicaId} promoted to primary successfully`);
    this.emit('replicaPromoted', { replicaId });
    
    // Restart replication with new primary
    await this.startReplication();
  }

  getReplicationStatus() {
    const status = {
      isReplicating: this.isReplicating,
      lastReplicationTime: this.lastReplicationTime,
      primaryPath: this.primaryDbPath,
      replicas: [],
      recentLog: this.replicationLog.slice(-10)
    };
    
    for (const [replicaId, replica] of this.replicas) {
      status.replicas.push({
        id: replicaId,
        path: replica.path,
        status: replica.status,
        lastSync: replica.lastSync,
        lag: replica.lag,
        queueSize: replica.syncQueue.length
      });
    }
    
    return status;
  }

  async failoverToHealthyReplica() {
    const healthyReplicas = [];
    
    for (const [replicaId, replica] of this.replicas) {
      if (replica.status === 'synced' && replica.lag < this.maxLag) {
        healthyReplicas.push({ replicaId, lag: replica.lag });
      }
    }
    
    if (healthyReplicas.length === 0) {
      throw new Error('No healthy replicas available for failover');
    }
    
    // Choose replica with least lag
    const bestReplica = healthyReplicas.sort((a, b) => a.lag - b.lag)[0];
    
    console.log(`Failing over to replica ${bestReplica.replicaId} (lag: ${bestReplica.lag}ms)`);
    await this.promoteReplica(bestReplica.replicaId);
    
    return bestReplica.replicaId;
  }

  async closeAllConnections() {
    // Stop replication
    await this.stopReplication();
    
    // Close all connections
    const closePromises = [];
    
    // Close primary
    if (this.primaryDb) {
      closePromises.push(
        new Promise((resolve) => {
          this.primaryDb.close(resolve);
        })
      );
    }
    
    // Close replicas
    for (const [replicaId, replica] of this.replicas) {
      closePromises.push(
        new Promise((resolve) => {
          replica.db.close(resolve);
        })
      );
    }
    
    await Promise.all(closePromises);
    console.log('All replication connections closed');
  }
}

module.exports = ReplicationManager;
