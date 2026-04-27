/**
 * Blockchain Integration Layer - Main Module
 * Provides comprehensive blockchain services including smart contracts, transactions, 
 * wallets, oracles, events, gas optimization, and security auditing
 */

const smartContractManager = require('./smartContractManager');
const transactionManager = require('./transactionManager');
const oracleService = require('./oracleService');
const walletManager = require('./walletManager');
const eventMonitor = require('./eventMonitor');
const gasOptimizer = require('./gasOptimizer');
const securityAuditor = require('./securityAuditor');

class BlockchainIntegrationLayer {
  constructor() {
    this.smartContracts = smartContractManager;
    this.transactions = transactionManager;
    this.oracles = oracleService;
    this.wallets = walletManager;
    this.events = eventMonitor;
    this.gas = gasOptimizer;
    this.security = securityAuditor;
    this.initialized = false;
  }

  /**
   * Initialize blockchain layer
   */
  async initialize() {
    try {
      console.log('[BlockchainIntegrationLayer] Initializing blockchain layer...');
      
      // Initialize core services
      this.setupEventListeners();
      
      this.initialized = true;
      console.log('[BlockchainIntegrationLayer] Blockchain layer initialized successfully');
      
      return {
        initialized: true,
        timestamp: new Date().toISOString(),
        services: {
          smartContracts: true,
          transactions: true,
          oracles: true,
          wallets: true,
          events: true,
          gas: true,
          security: true,
        },
      };
    } catch (error) {
      console.error(`[BlockchainIntegrationLayer] Initialization failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Listen for security alerts
    this.events.on('alert', alert => {
      console.warn('[BlockchainIntegrationLayer] Security Alert:', alert);
    });

    // Listen for transaction events
    this.events.on('blockchain:transaction', event => {
      console.log('[BlockchainIntegrationLayer] Transaction Event:', event);
    });
  }

  /**
   * Get system status
   */
  getSystemStatus() {
    return {
      initialized: this.initialized,
      timestamp: new Date().toISOString(),
      services: {
        smartContracts: {
          deployed: this.smartContracts.listDeployedContracts().length,
          status: 'operational',
        },
        transactions: {
          poolSize: this.transactions.getTransactionPool().size,
          status: 'operational',
        },
        wallets: {
          status: 'operational',
        },
        oracles: {
          dataFeeds: this.oracles.listActiveFeeds().dataFeeds.length,
          priceFeeds: this.oracles.listActiveFeeds().priceFeeds.length,
          status: 'operational',
        },
        events: {
          totalEvents: this.events.getEventStatistics().totalEvents,
          status: 'operational',
        },
        security: {
          auditLog: this.security.auditLog.length,
          status: 'operational',
        },
      },
    };
  }

  /**
   * Shutdown blockchain layer
   */
  async shutdown() {
    try {
      console.log('[BlockchainIntegrationLayer] Shutting down blockchain layer...');
      this.initialized = false;
      return { shutdown: true, timestamp: new Date().toISOString() };
    } catch (error) {
      console.error(`[BlockchainIntegrationLayer] Shutdown failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get health check
   */
  async healthCheck() {
    return {
      status: this.initialized ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      services: {
        smartContracts: 'healthy',
        transactions: 'healthy',
        oracles: 'healthy',
        wallets: 'healthy',
        events: 'healthy',
        security: 'healthy',
      },
    };
  }
}

module.exports = new BlockchainIntegrationLayer();
