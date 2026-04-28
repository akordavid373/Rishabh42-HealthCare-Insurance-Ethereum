const express = require('express');
const router = express.Router();
const logger = require('../services/logger');
const blockchainLayer = require('../blockchain');
const { authenticateToken } = require('../middleware/auth');

/**
 * =========================
 * HEALTH & STATUS ENDPOINTS
 * =========================
 */

// Health check
router.get('/health', async (req, res) => {
  try {
    const health = await blockchainLayer.healthCheck();
    res.json(health);
  } catch (error) {
    logger.error(`Blockchain health check failed: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// System status
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const status = blockchainLayer.getSystemStatus();
    res.json(status);
  } catch (error) {
    logger.error(`Failed to get blockchain status: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * =========================
 * SMART CONTRACT ENDPOINTS
 * =========================
 */

// Compile contract
router.post('/contracts/compile', authenticateToken, async (req, res) => {
  try {
    const { contractName, sourcePath } = req.body;
    if (!contractName || !sourcePath) {
      return res.status(400).json({
        error: 'contractName and sourcePath are required',
      });
    }

    const result = await blockchainLayer.smartContracts.compileContract(
      contractName,
      sourcePath
    );
    res.json(result);
  } catch (error) {
    logger.error(`Contract compilation failed: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Deploy contract
router.post('/contracts/deploy', authenticateToken, async (req, res) => {
  try {
    const { contractName, publicKey, secretKey, contractCode } = req.body;
    if (!contractName || !publicKey || !secretKey || !contractCode) {
      return res.status(400).json({
        error:
          'contractName, publicKey, secretKey, and contractCode are required',
      });
    }

    const result = await blockchainLayer.smartContracts.deployContract(
      contractName,
      publicKey,
      secretKey,
      contractCode
    );
    res.json(result);
  } catch (error) {
    logger.error(`Contract deployment failed: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// List deployed contracts
router.get('/contracts/deployed', authenticateToken, (req, res) => {
  try {
    const contracts = blockchainLayer.smartContracts.listDeployedContracts();
    res.json({ contracts, count: contracts.length });
  } catch (error) {
    logger.error(`Failed to list deployed contracts: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Get contract metadata
router.get('/contracts/:contractName', authenticateToken, (req, res) => {
  try {
    const { contractName } = req.params;
    const metadata = blockchainLayer.smartContracts.getContractMetadata(
      contractName
    );
    if (!metadata) {
      return res.status(404).json({ error: `Contract ${contractName} not found` });
    }
    res.json(metadata);
  } catch (error) {
    logger.error(`Failed to get contract metadata: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Verify contract deployment
router.post('/contracts/verify', authenticateToken, async (req, res) => {
  try {
    const { contractId } = req.body;
    if (!contractId) {
      return res.status(400).json({ error: 'contractId is required' });
    }

    const result = await blockchainLayer.smartContracts.verifyContractDeployment(
      contractId
    );
    res.json(result);
  } catch (error) {
    logger.error(`Contract verification failed: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Upgrade contract
router.post('/contracts/upgrade', authenticateToken, async (req, res) => {
  try {
    const { contractName, newCode, publicKey, secretKey } = req.body;
    if (!contractName || !newCode || !publicKey || !secretKey) {
      return res.status(400).json({
        error:
          'contractName, newCode, publicKey, and secretKey are required',
      });
    }

    const result = await blockchainLayer.smartContracts.upgradeContract(
      contractName,
      newCode,
      publicKey,
      secretKey
    );
    res.json(result);
  } catch (error) {
    logger.error(`Contract upgrade failed: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * =========================
 * TRANSACTION ENDPOINTS
 * =========================
 */

// Build transaction
router.post('/transactions/build', authenticateToken, async (req, res) => {
  try {
    const { sender, operations, options } = req.body;
    if (!sender || !operations || !Array.isArray(operations)) {
      return res
        .status(400)
        .json({ error: 'sender and operations array are required' });
    }

    const result = await blockchainLayer.transactions.buildTransaction(
      sender,
      operations,
      options
    );
    res.json(result);
  } catch (error) {
    logger.error(`Transaction build failed: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Sign transaction
router.post('/transactions/sign', authenticateToken, async (req, res) => {
  try {
    const { txId, secretKey } = req.body;
    if (!txId || !secretKey) {
      return res.status(400).json({ error: 'txId and secretKey are required' });
    }

    const result = await blockchainLayer.transactions.signTransaction(
      txId,
      secretKey
    );
    res.json(result);
  } catch (error) {
    logger.error(`Transaction signing failed: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Get transaction status
router.get('/transactions/:txId', authenticateToken, async (req, res) => {
  try {
    const { txId } = req.params;
    const status = await blockchainLayer.transactions.getTransactionStatus(txId);
    res.json(status);
  } catch (error) {
    logger.error(`Failed to get transaction status: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Get transaction history
router.get('/transactions/history/:publicKey', authenticateToken, (req, res) => {
  try {
    const { publicKey } = req.params;
    const limit = req.query.limit || 50;
    const history = blockchainLayer.transactions.getTransactionHistory(
      publicKey,
      parseInt(limit)
    );
    res.json({ history, count: history.length });
  } catch (error) {
    logger.error(`Failed to get transaction history: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Get transaction pool
router.get('/transactions/pool/status', authenticateToken, (req, res) => {
  try {
    const pool = blockchainLayer.transactions.getTransactionPool();
    res.json(pool);
  } catch (error) {
    logger.error(`Failed to get transaction pool: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Batch transactions
router.post('/transactions/batch', authenticateToken, async (req, res) => {
  try {
    const { transactions, batchSize } = req.body;
    if (!transactions || !Array.isArray(transactions)) {
      return res.status(400).json({ error: 'transactions array is required' });
    }

    const result = await blockchainLayer.transactions.batchTransactions(
      transactions,
      batchSize || 50
    );
    res.json(result);
  } catch (error) {
    logger.error(`Transaction batching failed: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * =========================
 * WALLET ENDPOINTS
 * =========================
 */

// Generate wallet
router.post('/wallets/generate', authenticateToken, async (req, res) => {
  try {
    const { userId, walletName } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const wallet = blockchainLayer.wallets.generateWallet(
      userId,
      walletName || 'default'
    );
    res.json(wallet);
  } catch (error) {
    logger.error(`Wallet generation failed: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Import wallet
router.post('/wallets/import', authenticateToken, async (req, res) => {
  try {
    const { userId, secretKey, walletName } = req.body;
    if (!userId || !secretKey) {
      return res
        .status(400)
        .json({ error: 'userId and secretKey are required' });
    }

    const wallet = blockchainLayer.wallets.importWallet(
      userId,
      secretKey,
      walletName || 'imported'
    );
    res.json(wallet);
  } catch (error) {
    logger.error(`Wallet import failed: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Get wallet
router.get('/wallets/:walletId', authenticateToken, (req, res) => {
  try {
    const { walletId } = req.params;
    const wallet = blockchainLayer.wallets.getWallet(walletId);
    res.json(wallet);
  } catch (error) {
    logger.error(`Failed to get wallet: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Get user wallets
router.get('/wallets/user/:userId', authenticateToken, (req, res) => {
  try {
    const { userId } = req.params;
    const wallets = blockchainLayer.wallets.getUserWallets(userId);
    res.json({ wallets, count: wallets.length });
  } catch (error) {
    logger.error(`Failed to get user wallets: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Get wallet transaction history
router.get('/wallets/:walletId/transactions', authenticateToken, (req, res) => {
  try {
    const { walletId } = req.params;
    const limit = req.query.limit || 50;
    const history = blockchainLayer.wallets.getTransactionHistory(
      walletId,
      parseInt(limit)
    );
    res.json({ history, count: history.length });
  } catch (error) {
    logger.error(`Failed to get wallet transactions: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Lock wallet
router.post('/wallets/:walletId/lock', authenticateToken, (req, res) => {
  try {
    const { walletId } = req.params;
    const wallet = blockchainLayer.wallets.lockWallet(walletId);
    res.json(wallet);
  } catch (error) {
    logger.error(`Failed to lock wallet: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Unlock wallet
router.post('/wallets/:walletId/unlock', authenticateToken, (req, res) => {
  try {
    const { walletId } = req.params;
    const wallet = blockchainLayer.wallets.unlockWallet(walletId);
    res.json(wallet);
  } catch (error) {
    logger.error(`Failed to unlock wallet: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * =========================
 * ORACLE ENDPOINTS
 * =========================
 */

// Register data feed
router.post('/oracles/feeds/register', authenticateToken, async (req, res) => {
  try {
    const { feedName, source, config } = req.body;
    if (!feedName || !source) {
      return res
        .status(400)
        .json({ error: 'feedName and source are required' });
    }

    const feed = blockchainLayer.oracles.registerDataFeed(
      feedName,
      source,
      config
    );
    res.json(feed);
  } catch (error) {
    logger.error(`Data feed registration failed: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Register price feed
router.post('/oracles/prices/register', authenticateToken, async (req, res) => {
  try {
    const { symbol, source } = req.body;
    if (!symbol) {
      return res.status(400).json({ error: 'symbol is required' });
    }

    const feed = blockchainLayer.oracles.registerPriceFeed(
      symbol,
      source || 'stellar'
    );
    res.json(feed);
  } catch (error) {
    logger.error(`Price feed registration failed: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Get current price
router.get('/oracles/prices/:symbol', authenticateToken, async (req, res) => {
  try {
    const { symbol } = req.params;
    const price = await blockchainLayer.oracles.fetchPrice(symbol);
    res.json(price);
  } catch (error) {
    logger.error(`Failed to fetch price: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// List active feeds
router.get('/oracles/feeds/active', authenticateToken, (req, res) => {
  try {
    const feeds = blockchainLayer.oracles.listActiveFeeds();
    res.json(feeds);
  } catch (error) {
    logger.error(`Failed to list active feeds: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * =========================
 * GAS OPTIMIZATION ENDPOINTS
 * =========================
 */

// Get current gas price
router.get('/gas/price', authenticateToken, async (req, res) => {
  try {
    const price = await blockchainLayer.gas.getCurrentGasPrice();
    res.json(price);
  } catch (error) {
    logger.error(`Failed to get gas price: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Estimate transaction fee
router.post('/gas/estimate-fee', authenticateToken, async (req, res) => {
  try {
    const { operationCount, priority } = req.body;
    const estimate = await blockchainLayer.gas.estimateTransactionFee(
      operationCount || 1,
      priority || 'standard'
    );
    res.json(estimate);
  } catch (error) {
    logger.error(`Fee estimation failed: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Optimize for cost
router.post('/gas/optimize/cost', authenticateToken, async (req, res) => {
  try {
    const { operations } = req.body;
    if (!operations || !Array.isArray(operations)) {
      return res.status(400).json({ error: 'operations array is required' });
    }

    const optimization = await blockchainLayer.gas.optimizeForCost(operations);
    res.json(optimization);
  } catch (error) {
    logger.error(`Cost optimization failed: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Optimize for speed
router.post('/gas/optimize/speed', authenticateToken, async (req, res) => {
  try {
    const { operations } = req.body;
    if (!operations || !Array.isArray(operations)) {
      return res.status(400).json({ error: 'operations array is required' });
    }

    const optimization = await blockchainLayer.gas.optimizeForSpeed(operations);
    res.json(optimization);
  } catch (error) {
    logger.error(`Speed optimization failed: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Estimate cost vs speed tradeoff
router.get('/gas/tradeoff/:operationCount', authenticateToken, (req, res) => {
  try {
    const { operationCount } = req.params;
    const tradeoff = blockchainLayer.gas.estimateTradeoff(
      parseInt(operationCount)
    );
    res.json(tradeoff);
  } catch (error) {
    logger.error(`Failed to estimate tradeoff: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * =========================
 * EVENT MONITORING ENDPOINTS
 * =========================
 */

// Get recent events
router.get('/events/recent', authenticateToken, async (req, res) => {
  try {
    const { source, limit } = req.query;
    const events = await blockchainLayer.events.getRecentEvents(
      source || null,
      parseInt(limit) || 100
    );
    res.json({ events, count: events.length });
  } catch (error) {
    logger.error(`Failed to get recent events: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Get event statistics
router.get('/events/statistics', authenticateToken, (req, res) => {
  try {
    const stats = blockchainLayer.events.getEventStatistics();
    res.json(stats);
  } catch (error) {
    logger.error(`Failed to get event statistics: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * =========================
 * SECURITY AUDIT ENDPOINTS
 * =========================
 */

// Audit smart contract
router.post('/security/audit/contract', authenticateToken, async (req, res) => {
  try {
    const { contractCode, contractName } = req.body;
    if (!contractCode || !contractName) {
      return res
        .status(400)
        .json({ error: 'contractCode and contractName are required' });
    }

    const result = await blockchainLayer.security.auditSmartContract(
      contractCode,
      contractName
    );
    res.json(result);
  } catch (error) {
    logger.error(`Smart contract audit failed: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Audit transaction
router.post('/security/audit/transaction', authenticateToken, async (req, res) => {
  try {
    const { transaction } = req.body;
    if (!transaction) {
      return res.status(400).json({ error: 'transaction is required' });
    }

    const result = await blockchainLayer.security.auditTransaction(transaction);
    res.json(result);
  } catch (error) {
    logger.error(`Transaction audit failed: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Generate audit report
router.get('/security/audit/report', authenticateToken, (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const report = blockchainLayer.security.generateAuditReport(
      startDate ? new Date(startDate) : null,
      endDate ? new Date(endDate) : null
    );
    res.json(report);
  } catch (error) {
    logger.error(`Failed to generate audit report: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
