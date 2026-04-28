const { TransactionBuilder, Networks, Keypair, FeeBumpTransaction, Account } = require('stellar-sdk');
const redis = require('redis');
const logger = require('../services/logger');
const crypto = require('crypto');

class TransactionManager {
  constructor() {
    this.redisClient = redis.createClient();
    this.networkPassphrase = process.env.STELLAR_NETWORK || Networks.TESTNET_NETWORK_PASSPHRASE;
    this.transactions = new Map();
    this.transactionPool = [];
    this.maxPoolSize = 1000;
    this.transactionFees = {
      standard: 100,
      priority: 500,
      urgent: 1000,
    };
    this.nonces = new Map();
  }

  /**
   * Build transaction
   */
  async buildTransaction(sender, operations, options = {}) {
    try {
      logger.info(`[TransactionManager] Building transaction for sender: ${sender}`);

      const {
        fee = this.transactionFees.standard,
        timeout = 300,
        memo = null,
        maxLedger = null,
      } = options;

      // Get account sequence
      const account = new Account(sender, this.getNonce(sender));

      const builder = new TransactionBuilder(account, {
        fee,
        networkPassphrase: this.networkPassphrase,
        v1: true,
      });

      // Add operations
      operations.forEach(op => builder.addOperation(op));

      // Add memo if provided
      if (memo) {
        builder.addMemo(Keypair.fromPublicKey(sender).memo());
      }

      // Set timeout
      builder.setTimeout(timeout);

      if (maxLedger) {
        builder.setMaxLedger(maxLedger);
      }

      const transaction = builder.build();

      // Store transaction
      const txId = transaction.hash().toString('hex');
      this.transactions.set(txId, {
        id: txId,
        sender,
        operations,
        fee,
        status: 'unsigned',
        createdAt: new Date().toISOString(),
        transaction,
      });

      logger.info(`[TransactionManager] Transaction built: ${txId}`);
      return { txId, transaction };
    } catch (error) {
      logger.error(`[TransactionManager] Transaction build failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Sign transaction
   */
  async signTransaction(txId, secretKey) {
    try {
      logger.info(`[TransactionManager] Signing transaction: ${txId}`);

      const txRecord = this.transactions.get(txId);
      if (!txRecord) {
        throw new Error(`Transaction ${txId} not found`);
      }

      const keypair = Keypair.fromSecret(secretKey);
      txRecord.transaction.sign(keypair);
      txRecord.status = 'signed';
      txRecord.signedAt = new Date().toISOString();
      txRecord.signer = keypair.publicKey();

      // Cache to Redis
      await this.redisClient.set(
        `tx:signed:${txId}`,
        JSON.stringify(txRecord),
        { EX: 3600 }
      );

      logger.info(`[TransactionManager] Transaction signed: ${txId}`);
      return txRecord;
    } catch (error) {
      logger.error(`[TransactionManager] Transaction signing failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Submit transaction to blockchain
   */
  async submitTransaction(txId, client) {
    try {
      logger.info(`[TransactionManager] Submitting transaction: ${txId}`);

      const txRecord = this.transactions.get(txId);
      if (!txRecord) {
        throw new Error(`Transaction ${txId} not found`);
      }

      if (txRecord.status !== 'signed') {
        throw new Error(`Transaction must be signed before submission. Status: ${txRecord.status}`);
      }

      const result = await client.submitTransaction(txRecord.transaction);

      txRecord.status = 'submitted';
      txRecord.submittedAt = new Date().toISOString();
      txRecord.blockchainTxHash = result.hash;
      txRecord.ledger = result.ledger_attr;

      // Add to transaction pool
      this.addToPool(txRecord);

      // Cache to Redis
      await this.redisClient.set(
        `tx:submitted:${txId}`,
        JSON.stringify(txRecord),
        { EX: 86400 }
      );

      logger.info(`[TransactionManager] Transaction submitted successfully: ${txId}`);
      return txRecord;
    } catch (error) {
      logger.error(`[TransactionManager] Transaction submission failed: ${error.message}`);
      txRecord = this.transactions.get(txId);
      if (txRecord) {
        txRecord.status = 'failed';
        txRecord.failedAt = new Date().toISOString();
        txRecord.error = error.message;
      }
      throw error;
    }
  }

  /**
   * Get transaction status
   */
  async getTransactionStatus(txId) {
    try {
      const txRecord = this.transactions.get(txId);
      if (!txRecord) {
        // Try Redis
        const cached = await this.redisClient.get(`tx:submitted:${txId}`);
        if (cached) {
          return JSON.parse(cached);
        }
        throw new Error(`Transaction ${txId} not found`);
      }
      return txRecord;
    } catch (error) {
      logger.error(`[TransactionManager] Failed to get transaction status: ${error.message}`);
      throw error;
    }
  }

  /**
   * Track multiple transactions
   */
  async trackTransactions(txIds) {
    const statuses = [];
    for (const txId of txIds) {
      try {
        statuses.push(await this.getTransactionStatus(txId));
      } catch (e) {
        statuses.push({ txId, error: e.message });
      }
    }
    return statuses;
  }

  /**
   * Batch transactions for efficiency
   */
  async batchTransactions(transactions, batchSize = 50) {
    try {
      logger.info(`[TransactionManager] Batching ${transactions.length} transactions`);

      const batches = [];
      for (let i = 0; i < transactions.length; i += batchSize) {
        batches.push(transactions.slice(i, i + batchSize));
      }

      return {
        totalTransactions: transactions.length,
        batchCount: batches.length,
        batches,
        createdAt: new Date().toISOString(),
      };
    } catch (error) {
      logger.error(`[TransactionManager] Batch transaction failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Add transaction to pool
   */
  addToPool(transaction) {
    this.transactionPool.push(transaction);
    if (this.transactionPool.length > this.maxPoolSize) {
      this.transactionPool.shift(); // Remove oldest
    }
  }

  /**
   * Get transaction pool
   */
  getTransactionPool() {
    return {
      size: this.transactionPool.length,
      maxSize: this.maxPoolSize,
      transactions: this.transactionPool,
      poolUtilization: `${((this.transactionPool.length / this.maxPoolSize) * 100).toFixed(2)}%`,
    };
  }

  /**
   * Retry failed transaction
   */
  async retryTransaction(txId, client, maxRetries = 3) {
    try {
      logger.info(`[TransactionManager] Retrying transaction: ${txId}`);

      const txRecord = this.transactions.get(txId);
      if (!txRecord) {
        throw new Error(`Transaction ${txId} not found`);
      }

      let retryCount = 0;
      while (retryCount < maxRetries) {
        try {
          const result = await this.submitTransaction(txId, client);
          return result;
        } catch (error) {
          retryCount++;
          logger.warn(
            `[TransactionManager] Retry ${retryCount}/${maxRetries} for ${txId}: ${error.message}`
          );
          if (retryCount >= maxRetries) throw error;
          await this.sleep(1000 * retryCount); // Exponential backoff
        }
      }
    } catch (error) {
      logger.error(`[TransactionManager] Transaction retry failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Cancel pending transaction
   */
  async cancelTransaction(txId) {
    try {
      const txRecord = this.transactions.get(txId);
      if (!txRecord) {
        throw new Error(`Transaction ${txId} not found`);
      }

      if (txRecord.status === 'submitted' || txRecord.status === 'confirmed') {
        throw new Error(`Cannot cancel transaction with status: ${txRecord.status}`);
      }

      txRecord.status = 'cancelled';
      txRecord.cancelledAt = new Date().toISOString();

      logger.info(`[TransactionManager] Transaction cancelled: ${txId}`);
      return txRecord;
    } catch (error) {
      logger.error(`[TransactionManager] Transaction cancellation failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get nonce for account
   */
  getNonce(publicKey) {
    if (!this.nonces.has(publicKey)) {
      this.nonces.set(publicKey, 0);
    }
    const nonce = this.nonces.get(publicKey);
    this.nonces.set(publicKey, nonce + 1);
    return nonce.toString();
  }

  /**
   * Utility: Sleep function
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get transaction history
   */
  getTransactionHistory(publicKey, limit = 50) {
    return Array.from(this.transactions.values())
      .filter(tx => tx.sender === publicKey)
      .slice(-limit)
      .reverse();
  }
}

module.exports = new TransactionManager();
