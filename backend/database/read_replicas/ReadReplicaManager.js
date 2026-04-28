const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');

class ReadReplicaManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this.primaryDbPath = config.primaryDbPath || path.join(__dirname, '..', 'healthcare.db');
    this.replicaDirectory = config.replicaDirectory || path.join(__dirname, 'read_replicas');
    this.replicaCount = config.replicaCount || 3;
    this.syncInterval = config.syncInterval || 10000; // 10 seconds
    this.loadBalancingStrategy = config.loadBalancingStrategy || 'round_robin'; // round_robin, least_connections, weighted
    
    this.primaryDb = null;
    this.readReplicas = new Map();
    this.currentReplicaIndex = 0;
    this.isSyncing = false;
    this.syncIntervalId = null;
    this.queryStats = {
      totalQueries: 0,
      replicaQueries: 0,
      primaryQueries: 0,
      avgResponseTime: 0
    };
    
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
      
      // Initialize read replicas
      for (let i = 0; i < this.replicaCount; i++) {
        const replicaPath = path.join(this.replicaDirectory, `read_replica_${i}.db`);
        const replica = new sqlite3.Database(replicaPath);
        
        this.readReplicas.set(i, {
          db: replica,
          path: replicaPath,
          id: i,
          status: 'initializing',
          lastSync: null,
          syncInProgress: false,
          connectionCount: 0,
          totalQueries: 0,
          avgResponseTime: 0,
          weight: 1,
          isHealthy: true
        });
        
        console.log(`Initialized read replica ${i} at ${replicaPath}`);
      }
      
      // Set up read replicas for read-only operations
      await this.setupReadOnlyReplicas();
      
    } catch (error) {
      console.error('Error initializing read replica connections:', error);
      throw error;
    }
  }

  async setupReadOnlyReplicas() {
    // Copy primary schema to replicas
    const tables = await this.getPrimarySchema();
    
    for (let replicaId = 0; replicaId < this.replicaCount; replicaId++) {
      const replica = this.readReplicas.get(replicaId);
      
      // Create tables on replica
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
      
      // Set replica to read-only mode
      await new Promise((resolve) => {
        replica.db.run('PRAGMA query_only = ON', (err) => {
          if (err) {
            console.error(`Error setting replica ${replicaId} to read-only:`, err);
          } else {
            console.log(`Read replica ${replicaId} set to read-only mode`);
          }
          resolve();
        });
      });
      
      replica.status = 'ready';
      console.log(`Read replica ${replicaId} initialized successfully`);
    }
    
    // Start synchronization
    this.startSynchronization();
  }

  async getPrimarySchema() {
    return new Promise((resolve, reject) => {
      this.primaryDb.all(
        "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows);
          }
        }
      );
    });
  }

  startSynchronization() {
    if (this.isSyncing) {
      console.log('Read replica synchronization is already running');
      return;
    }

    this.isSyncing = true;
    console.log('Starting read replica synchronization...');
    
    this.syncIntervalId = setInterval(async () => {
      try {
        await this.synchronizeReplicas();
      } catch (error) {
        console.error('Read replica sync error:', error);
        this.emit('syncError', error);
      }
    }, this.syncInterval);
    
    this.emit('syncStarted');
  }

  stopSynchronization() {
    if (!this.isSyncing) {
      return;
    }

    this.isSyncing = false;
    if (this.syncIntervalId) {
      clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }
    console.log('Read replica synchronization stopped');
    this.emit('syncStopped');
  }

  async synchronizeReplicas() {
    const startTime = Date.now();
    
    try {
      // Get all tables that need synchronization
      const tables = await this.getPrimarySchema();
      
      // Sync each replica
      const syncPromises = [];
      
      for (let replicaId = 0; replicaId < this.replicaCount; replicaId++) {
        syncPromises.push(this.synchronizeReplica(replicaId, tables));
      }
      
      await Promise.allSettled(syncPromises);
      
      const duration = Date.now() - startTime;
      console.log(`Read replica synchronization completed in ${duration}ms`);
      this.emit('syncCompleted', { duration });
      
    } catch (error) {
      console.error('Error during read replica synchronization:', error);
      this.emit('syncError', error);
    }
  }

  async synchronizeReplica(replicaId, tables) {
    const replica = this.readReplicas.get(replicaId);
    if (!replica || replica.syncInProgress) {
      return;
    }

    replica.syncInProgress = true;
    
    try {
      for (const table of tables) {
        await this.synchronizeTable(replicaId, table.name);
      }
      
      replica.lastSync = new Date();
      replica.status = 'synced';
      
    } catch (error) {
      replica.status = 'error';
      console.error(`Error synchronizing replica ${replicaId}:`, error);
      throw error;
    } finally {
      replica.syncInProgress = false;
    }
  }

  async synchronizeTable(replicaId, tableName) {
    const replica = this.readReplicas.get(replicaId);
    
    // Get data from primary
    const primaryData = await new Promise((resolve, reject) => {
      this.primaryDb.all(`SELECT * FROM ${tableName}`, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
    
    // Clear replica table
    await new Promise((resolve, reject) => {
      replica.db.run(`DELETE FROM ${tableName}`, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
    
    // Insert data into replica
    if (primaryData.length > 0) {
      const columns = Object.keys(primaryData[0]);
      const placeholders = columns.map(() => '?').join(', ');
      const insertSql = `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`;
      
      for (const row of primaryData) {
        const values = columns.map(col => row[col]);
        
        await new Promise((resolve, reject) => {
          replica.db.run(insertSql, values, (err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        });
      }
    }
  }

  async executeReadQuery(query, params = []) {
    const startTime = Date.now();
    this.queryStats.totalQueries++;
    
    try {
      // Select replica based on load balancing strategy
      const replicaId = this.selectReplica();
      const replica = this.readReplicas.get(replicaId);
      
      if (!replica || !replica.isHealthy) {
        // Fallback to primary if no healthy replicas
        return await this.executeOnPrimary(query, params);
      }
      
      replica.connectionCount++;
      replica.totalQueries++;
      
      const result = await new Promise((resolve, reject) => {
        replica.db.all(query, params, (err, rows) => {
          replica.connectionCount--;
          
          if (err) {
            replica.isHealthy = false;
            reject(err);
          } else {
            const responseTime = Date.now() - startTime;
            replica.avgResponseTime = (replica.avgResponseTime + responseTime) / 2;
            resolve(rows);
          }
        });
      });
      
      this.queryStats.replicaQueries++;
      this.queryStats.avgResponseTime = (this.queryStats.avgResponseTime + (Date.now() - startTime)) / 2;
      
      return result;
      
    } catch (error) {
      console.error('Read query error, falling back to primary:', error);
      this.queryStats.primaryQueries++;
      return await this.executeOnPrimary(query, params);
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

  selectReplica() {
    const healthyReplicas = Array.from(this.readReplicas.values())
      .filter(replica => replica.isHealthy && replica.status === 'synced');
    
    if (healthyReplicas.length === 0) {
      return -1; // No healthy replicas
    }
    
    switch (this.loadBalancingStrategy) {
      case 'round_robin':
        return this.roundRobinSelection(healthyReplicas);
      case 'least_connections':
        return this.leastConnectionsSelection(healthyReplicas);
      case 'weighted':
        return this.weightedSelection(healthyReplicas);
      default:
        return this.roundRobinSelection(healthyReplicas);
    }
  }

  roundRobinSelection(healthyReplicas) {
    const replica = healthyReplicas[this.currentReplicaIndex % healthyReplicas.length];
    this.currentReplicaIndex++;
    return replica.id;
  }

  leastConnectionsSelection(healthyReplicas) {
    return healthyReplicas.reduce((min, replica) => 
      replica.connectionCount < min.connectionCount ? replica : min
    ).id;
  }

  weightedSelection(healthyReplicas) {
    const totalWeight = healthyReplicas.reduce((sum, replica) => sum + replica.weight, 0);
    let random = Math.random() * totalWeight;
    
    for (const replica of healthyReplicas) {
      random -= replica.weight;
      if (random <= 0) {
        return replica.id;
      }
    }
    
    return healthyReplicas[0].id;
  }

  async healthCheck() {
    const healthResults = [];
    
    for (const [replicaId, replica] of this.readReplicas) {
      const startTime = Date.now();
      
      try {
        // Simple health check query
        await new Promise((resolve, reject) => {
          replica.db.get('SELECT 1', (err, row) => {
            if (err) {
              reject(err);
            } else {
              resolve(row);
            }
          });
        });
        
        const responseTime = Date.now() - startTime;
        replica.isHealthy = responseTime < 5000; // 5 second threshold
        
        healthResults.push({
          replicaId,
          healthy: replica.isHealthy,
          responseTime,
          status: replica.status
        });
        
      } catch (error) {
        replica.isHealthy = false;
        healthResults.push({
          replicaId,
          healthy: false,
          error: error.message,
          status: replica.status
        });
      }
    }
    
    return healthResults;
  }

  getReplicaStats() {
    const stats = {
      queryStats: this.queryStats,
      loadBalancingStrategy: this.loadBalancingStrategy,
      isSyncing: this.isSyncing,
      replicas: []
    };
    
    for (const [replicaId, replica] of this.readReplicas) {
      stats.replicas.push({
        id: replicaId,
        status: replica.status,
        isHealthy: replica.isHealthy,
        lastSync: replica.lastSync,
        connectionCount: replica.connectionCount,
        totalQueries: replica.totalQueries,
        avgResponseTime: replica.avgResponseTime,
        weight: replica.weight
      });
    }
    
    return stats;
  }

  async addReplica() {
    const newReplicaId = this.replicaCount;
    const replicaPath = path.join(this.replicaDirectory, `read_replica_${newReplicaId}.db`);
    const replica = new sqlite3.Database(replicaPath);
    
    this.readReplicas.set(newReplicaId, {
      db: replica,
      path: replicaPath,
      id: newReplicaId,
      status: 'initializing',
      lastSync: null,
      syncInProgress: false,
      connectionCount: 0,
      totalQueries: 0,
      avgResponseTime: 0,
      weight: 1,
      isHealthy: true
    });
    
    this.replicaCount++;
    
    // Initialize the new replica
    await this.setupReadOnlyReplicas();
    
    console.log(`Added new read replica ${newReplicaId}`);
    this.emit('replicaAdded', { replicaId: newReplicaId });
    
    return newReplicaId;
  }

  async removeReplica(replicaId) {
    const replica = this.readReplicas.get(replicaId);
    if (!replica) {
      throw new Error(`Replica ${replicaId} not found`);
    }
    
    // Close the replica connection
    await new Promise((resolve) => {
      replica.db.close(resolve);
    });
    
    // Remove replica file
    if (fs.existsSync(replica.path)) {
      fs.unlinkSync(replica.path);
    }
    
    this.readReplicas.delete(replicaId);
    this.replicaCount--;
    
    console.log(`Removed read replica ${replicaId}`);
    this.emit('replicaRemoved', { replicaId });
  }

  async closeAllConnections() {
    // Stop synchronization
    this.stopSynchronization();
    
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
    for (const [replicaId, replica] of this.readReplicas) {
      closePromises.push(
        new Promise((resolve) => {
          replica.db.close(resolve);
        })
      );
    }
    
    await Promise.all(closePromises);
    console.log('All read replica connections closed');
  }
}

module.exports = ReadReplicaManager;
