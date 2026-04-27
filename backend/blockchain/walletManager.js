const { Keypair, Account } = require('stellar-sdk');
const redis = require('redis');
const crypto = require('crypto');
const logger = require('../services/logger');

class WalletManager {
  constructor() {
    this.redisClient = redis.createClient();
    this.wallets = new Map();
    this.walletAccounts = new Map();
    this.encryptionKey = process.env.WALLET_ENCRYPTION_KEY || 'default-key-change-in-production';
  }

  /**
   * Generate new wallet
   */
  generateWallet(userId, walletName = 'default') {
    try {
      logger.info(`[WalletManager] Generating new wallet for user: ${userId}`);

      const keypair = Keypair.random();
      const walletId = this.generateWalletId();

      const wallet = {
        walletId,
        userId,
        name: walletName,
        publicKey: keypair.publicKey(),
        secretKey: this.encryptSecretKey(keypair.secret()),
        createdAt: new Date().toISOString(),
        status: 'active',
        balance: 0,
        transactions: [],
        type: 'stellar',
      };

      this.wallets.set(walletId, wallet);

      // Cache to Redis (without secret key)
      const walletPublic = { ...wallet };
      delete walletPublic.secretKey;
      this.redisClient.set(
        `wallet:${walletId}`,
        JSON.stringify(walletPublic),
        { EX: 86400 }
      );

      logger.info(`[WalletManager] Wallet generated successfully: ${walletId}`);
      return walletPublic;
    } catch (error) {
      logger.error(`[WalletManager] Failed to generate wallet: ${error.message}`);
      throw error;
    }
  }

  /**
   * Import wallet from secret key
   */
  importWallet(userId, secretKey, walletName = 'imported') {
    try {
      logger.info(`[WalletManager] Importing wallet for user: ${userId}`);

      const keypair = Keypair.fromSecret(secretKey);
      const walletId = this.generateWalletId();

      const wallet = {
        walletId,
        userId,
        name: walletName,
        publicKey: keypair.publicKey(),
        secretKey: this.encryptSecretKey(secretKey),
        createdAt: new Date().toISOString(),
        importedAt: new Date().toISOString(),
        status: 'active',
        balance: 0,
        transactions: [],
        type: 'stellar',
      };

      this.wallets.set(walletId, wallet);

      const walletPublic = { ...wallet };
      delete walletPublic.secretKey;

      logger.info(`[WalletManager] Wallet imported successfully: ${walletId}`);
      return walletPublic;
    } catch (error) {
      logger.error(`[WalletManager] Failed to import wallet: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get wallet by ID
   */
  getWallet(walletId) {
    try {
      const wallet = this.wallets.get(walletId);
      if (!wallet) {
        throw new Error(`Wallet ${walletId} not found`);
      }

      const walletPublic = { ...wallet };
      delete walletPublic.secretKey;
      return walletPublic;
    } catch (error) {
      logger.error(`[WalletManager] Failed to get wallet: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get user wallets
   */
  getUserWallets(userId) {
    try {
      const userWallets = Array.from(this.wallets.values()).filter(
        w => w.userId === userId
      );

      return userWallets.map(wallet => {
        const w = { ...wallet };
        delete w.secretKey;
        return w;
      });
    } catch (error) {
      logger.error(`[WalletManager] Failed to get user wallets: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get wallet balance
   */
  async getWalletBalance(walletId, client) {
    try {
      const wallet = this.wallets.get(walletId);
      if (!wallet) {
        throw new Error(`Wallet ${walletId} not found`);
      }

      // Fetch from Stellar network
      const account = await client.loadAccount(wallet.publicKey);
      
      const balances = account.balances.map(balance => ({
        asset: balance.asset_type === 'native' ? 'XLM' : balance.asset_code,
        amount: balance.balance,
        issuerId: balance.asset_issuer || null,
      }));

      wallet.balance = balances;
      wallet.lastBalanceUpdate = new Date().toISOString();

      // Cache balance
      await this.redisClient.set(
        `wallet:balance:${walletId}`,
        JSON.stringify(balances),
        { EX: 300 } // 5 minutes
      );

      return balances;
    } catch (error) {
      logger.error(`[WalletManager] Failed to get wallet balance: ${error.message}`);
      throw error;
    }
  }

  /**
   * Transfer funds
   */
  async transferFunds(fromWalletId, toPublicKey, amount, asset = 'native') {
    try {
      logger.info(`[WalletManager] Transferring ${amount} ${asset} from ${fromWalletId}`);

      const wallet = this.wallets.get(fromWalletId);
      if (!wallet) {
        throw new Error(`Wallet ${fromWalletId} not found`);
      }

      const secretKey = this.decryptSecretKey(wallet.secretKey);
      const keypair = Keypair.fromSecret(secretKey);

      const transfer = {
        from: wallet.publicKey,
        to: toPublicKey,
        amount,
        asset,
        timestamp: new Date().toISOString(),
        status: 'pending',
      };

      wallet.transactions.push(transfer);

      logger.info(`[WalletManager] Transfer initiated: ${fromWalletId}`);
      return transfer;
    } catch (error) {
      logger.error(`[WalletManager] Failed to transfer funds: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get transaction history
   */
  getTransactionHistory(walletId, limit = 50) {
    try {
      const wallet = this.wallets.get(walletId);
      if (!wallet) {
        throw new Error(`Wallet ${walletId} not found`);
      }

      return wallet.transactions.slice(-limit).reverse();
    } catch (error) {
      logger.error(`[WalletManager] Failed to get transaction history: ${error.message}`);
      throw error;
    }
  }

  /**
   * Export wallet (securely)
   */
  exportWallet(walletId, password) {
    try {
      const wallet = this.wallets.get(walletId);
      if (!wallet) {
        throw new Error(`Wallet ${walletId} not found`);
      }

      const secretKey = this.decryptSecretKey(wallet.secretKey);

      // Encrypt with password
      const encrypted = this.encryptWithPassword(secretKey, password);

      return {
        walletId,
        publicKey: wallet.publicKey,
        encrypted,
        exportedAt: new Date().toISOString(),
        warning: 'Store this securely. Anyone with this data and password can access your funds.',
      };
    } catch (error) {
      logger.error(`[WalletManager] Failed to export wallet: ${error.message}`);
      throw error;
    }
  }

  /**
   * Create account on blockchain
   */
  async createBlockchainAccount(walletId, fundingAmount, client) {
    try {
      logger.info(`[WalletManager] Creating blockchain account for wallet: ${walletId}`);

      const wallet = this.wallets.get(walletId);
      if (!wallet) {
        throw new Error(`Wallet ${walletId} not found`);
      }

      // This would typically be done through a funding service
      // For now, we'll simulate the account creation

      this.walletAccounts.set(walletId, {
        publicKey: wallet.publicKey,
        createdAt: new Date().toISOString(),
        funded: true,
        initialFunding: fundingAmount,
      });

      logger.info(`[WalletManager] Blockchain account created: ${wallet.publicKey}`);
      return {
        walletId,
        publicKey: wallet.publicKey,
        accountCreated: true,
        initialFunding: fundingAmount,
      };
    } catch (error) {
      logger.error(`[WalletManager] Failed to create blockchain account: ${error.message}`);
      throw error;
    }
  }

  /**
   * Verify wallet ownership
   */
  verifyWalletOwnership(walletId, userId) {
    try {
      const wallet = this.wallets.get(walletId);
      if (!wallet) {
        throw new Error(`Wallet ${walletId} not found`);
      }

      return wallet.userId === userId;
    } catch (error) {
      logger.error(`[WalletManager] Failed to verify wallet ownership: ${error.message}`);
      throw error;
    }
  }

  /**
   * Encrypt secret key
   */
  encryptSecretKey(secretKey) {
    try {
      const cipher = crypto.createCipher('aes-256-cbc', this.encryptionKey);
      let encrypted = cipher.update(secretKey, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      return encrypted;
    } catch (error) {
      logger.error(`[WalletManager] Failed to encrypt secret key: ${error.message}`);
      throw error;
    }
  }

  /**
   * Decrypt secret key
   */
  decryptSecretKey(encryptedKey) {
    try {
      const decipher = crypto.createDecipher('aes-256-cbc', this.encryptionKey);
      let decrypted = decipher.update(encryptedKey, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (error) {
      logger.error(`[WalletManager] Failed to decrypt secret key: ${error.message}`);
      throw error;
    }
  }

  /**
   * Encrypt with password
   */
  encryptWithPassword(data, password) {
    try {
      const salt = crypto.randomBytes(16);
      const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);

      let encrypted = cipher.update(data, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      return salt.toString('hex') + ':' + iv.toString('hex') + ':' + encrypted;
    } catch (error) {
      logger.error(`[WalletManager] Failed to encrypt with password: ${error.message}`);
      throw error;
    }
  }

  /**
   * Generate wallet ID
   */
  generateWalletId() {
    return 'wallet_' + crypto.randomBytes(16).toString('hex');
  }

  /**
   * Lock wallet (for security)
   */
  lockWallet(walletId) {
    try {
      const wallet = this.wallets.get(walletId);
      if (wallet) {
        wallet.status = 'locked';
        wallet.lockedAt = new Date().toISOString();
      }
      return wallet;
    } catch (error) {
      logger.error(`[WalletManager] Failed to lock wallet: ${error.message}`);
      throw error;
    }
  }

  /**
   * Unlock wallet
   */
  unlockWallet(walletId) {
    try {
      const wallet = this.wallets.get(walletId);
      if (wallet) {
        wallet.status = 'active';
        wallet.unlockedAt = new Date().toISOString();
      }
      return wallet;
    } catch (error) {
      logger.error(`[WalletManager] Failed to unlock wallet: ${error.message}`);
      throw error;
    }
  }

  /**
   * Delete wallet
   */
  deleteWallet(walletId) {
    try {
      logger.warn(`[WalletManager] Deleting wallet: ${walletId}`);
      this.wallets.delete(walletId);
      this.walletAccounts.delete(walletId);
      this.redisClient.del(`wallet:${walletId}`);
      return true;
    } catch (error) {
      logger.error(`[WalletManager] Failed to delete wallet: ${error.message}`);
      throw error;
    }
  }
}

module.exports = new WalletManager();
