const axios = require('axios');
const redis = require('redis');
const logger = require('../services/logger');

class OracleService {
  constructor() {
    this.redisClient = redis.createClient();
    this.oracleEndpoints = {
      stellar: process.env.STELLAR_ORACLE_URL || 'https://api.stellar.org',
      chainlink: process.env.CHAINLINK_ORACLE_URL || 'https://api.chain.link',
      band: process.env.BAND_ORACLE_URL || 'https://api.bandprotocol.com',
    };
    this.dataFeeds = new Map();
    this.priceFeeds = new Map();
    this.updateInterval = 60000; // 1 minute
    this.feedListeners = new Map();
  }

  /**
   * Register data feed
   */
  registerDataFeed(feedName, source, config = {}) {
    try {
      logger.info(`[OracleService] Registering data feed: ${feedName}`);

      const feed = {
        name: feedName,
        source, // 'stellar', 'chainlink', 'band', 'custom'
        config: {
          updateInterval: config.updateInterval || this.updateInterval,
          retryAttempts: config.retryAttempts || 3,
          timeout: config.timeout || 10000,
          validationRules: config.validationRules || [],
          ...config,
        },
        status: 'active',
        registeredAt: new Date().toISOString(),
        lastUpdate: null,
        lastValue: null,
        updateHistory: [],
      };

      this.dataFeeds.set(feedName, feed);

      // Start polling feed
      this.startFeedPolling(feedName);

      logger.info(`[OracleService] Data feed registered: ${feedName}`);
      return feed;
    } catch (error) {
      logger.error(`[OracleService] Failed to register data feed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Register price feed
   */
  registerPriceFeed(symbol, source = 'stellar') {
    try {
      logger.info(`[OracleService] Registering price feed: ${symbol}`);

      const priceFeed = {
        symbol,
        source,
        currentPrice: null,
        previousPrice: null,
        priceHistory: [],
        lastUpdated: null,
        updateCount: 0,
        volatility: 0,
        status: 'active',
      };

      this.priceFeeds.set(symbol, priceFeed);

      // Start price updates
      this.startPricePolling(symbol);

      logger.info(`[OracleService] Price feed registered: ${symbol}`);
      return priceFeed;
    } catch (error) {
      logger.error(`[OracleService] Failed to register price feed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Fetch data from oracle
   */
  async fetchOracleData(feedName) {
    try {
      const feed = this.dataFeeds.get(feedName);
      if (!feed) {
        throw new Error(`Data feed ${feedName} not found`);
      }

      logger.debug(`[OracleService] Fetching data from oracle: ${feedName}`);

      let data = null;

      switch (feed.source) {
        case 'stellar':
          data = await this.fetchFromStellarOracle(feedName, feed.config);
          break;
        case 'chainlink':
          data = await this.fetchFromChainlink(feedName, feed.config);
          break;
        case 'band':
          data = await this.fetchFromBand(feedName, feed.config);
          break;
        default:
          throw new Error(`Unknown oracle source: ${feed.source}`);
      }

      // Validate data
      if (feed.config.validationRules.length > 0) {
        this.validateOracleData(data, feed.config.validationRules);
      }

      // Update feed
      feed.lastValue = data;
      feed.lastUpdate = new Date().toISOString();
      feed.updateHistory.push({
        value: data,
        timestamp: new Date().toISOString(),
      });

      // Keep only last 1000 updates
      if (feed.updateHistory.length > 1000) {
        feed.updateHistory.shift();
      }

      // Cache to Redis
      await this.redisClient.set(
        `oracle:feed:${feedName}`,
        JSON.stringify(data),
        { EX: 3600 }
      );

      return data;
    } catch (error) {
      logger.error(`[OracleService] Failed to fetch oracle data: ${error.message}`);
      throw error;
    }
  }

  /**
   * Fetch price from oracle
   */
  async fetchPrice(symbol) {
    try {
      const priceFeed = this.priceFeeds.get(symbol);
      if (!priceFeed) {
        throw new Error(`Price feed for ${symbol} not found`);
      }

      logger.debug(`[OracleService] Fetching price: ${symbol}`);

      let price = null;

      switch (priceFeed.source) {
        case 'stellar':
          price = await this.fetchPriceFromStellar(symbol);
          break;
        case 'chainlink':
          price = await this.fetchPriceFromChainlink(symbol);
          break;
        case 'band':
          price = await this.fetchPriceFromBand(symbol);
          break;
        default:
          throw new Error(`Unknown oracle source: ${priceFeed.source}`);
      }

      // Update price feed
      priceFeed.previousPrice = priceFeed.currentPrice;
      priceFeed.currentPrice = price;
      priceFeed.lastUpdated = new Date().toISOString();
      priceFeed.updateCount++;

      // Calculate volatility
      if (priceFeed.priceHistory.length > 0) {
        priceFeed.volatility = this.calculateVolatility(
          [priceFeed.previousPrice, priceFeed.currentPrice],
          priceFeed.priceHistory.slice(-20)
        );
      }

      priceFeed.priceHistory.push({
        price,
        timestamp: new Date().toISOString(),
      });

      // Keep only last 500 prices
      if (priceFeed.priceHistory.length > 500) {
        priceFeed.priceHistory.shift();
      }

      // Cache to Redis
      await this.redisClient.set(
        `oracle:price:${symbol}`,
        JSON.stringify(price),
        { EX: 60 }
      );

      // Notify listeners
      this.notifyListeners(symbol, price);

      return {
        symbol,
        price,
        previousPrice: priceFeed.previousPrice,
        timestamp: priceFeed.lastUpdated,
        volatility: priceFeed.volatility,
      };
    } catch (error) {
      logger.error(`[OracleService] Failed to fetch price: ${error.message}`);
      throw error;
    }
  }

  /**
   * Subscribe to price updates
   */
  subscribeToPriceUpdates(symbol, callback) {
    try {
      if (!this.feedListeners.has(symbol)) {
        this.feedListeners.set(symbol, []);
      }
      this.feedListeners.get(symbol).push(callback);
      logger.info(`[OracleService] Subscribed to price updates: ${symbol}`);
      return () => {
        // Unsubscribe function
        const listeners = this.feedListeners.get(symbol);
        const index = listeners.indexOf(callback);
        if (index > -1) {
          listeners.splice(index, 1);
        }
      };
    } catch (error) {
      logger.error(`[OracleService] Failed to subscribe: ${error.message}`);
      throw error;
    }
  }

  /**
   * Notify listeners of price changes
   */
  notifyListeners(symbol, price) {
    const listeners = this.feedListeners.get(symbol) || [];
    listeners.forEach(callback => {
      try {
        callback({ symbol, price, timestamp: new Date().toISOString() });
      } catch (e) {
        logger.error(`[OracleService] Listener callback error: ${e.message}`);
      }
    });
  }

  /**
   * Start feed polling
   */
  startFeedPolling(feedName) {
    const feed = this.dataFeeds.get(feedName);
    if (!feed) return;

    const pollInterval = setInterval(async () => {
      try {
        await this.fetchOracleData(feedName);
      } catch (error) {
        logger.warn(`[OracleService] Feed polling error for ${feedName}: ${error.message}`);
      }
    }, feed.config.updateInterval);

    feed.pollInterval = pollInterval;
  }

  /**
   * Start price polling
   */
  startPricePolling(symbol) {
    const pollInterval = setInterval(async () => {
      try {
        await this.fetchPrice(symbol);
      } catch (error) {
        logger.warn(`[OracleService] Price polling error for ${symbol}: ${error.message}`);
      }
    }, 60000); // Poll every minute

    const priceFeed = this.priceFeeds.get(symbol);
    if (priceFeed) {
      priceFeed.pollInterval = pollInterval;
    }
  }

  /**
   * Stop feed polling
   */
  stopFeedPolling(feedName) {
    const feed = this.dataFeeds.get(feedName);
    if (feed && feed.pollInterval) {
      clearInterval(feed.pollInterval);
      feed.status = 'inactive';
      logger.info(`[OracleService] Stopped polling for feed: ${feedName}`);
    }
  }

  /**
   * Validate oracle data
   */
  validateOracleData(data, validationRules) {
    for (const rule of validationRules) {
      if (!rule.validate(data)) {
        throw new Error(`Validation failed: ${rule.name}`);
      }
    }
  }

  /**
   * Calculate volatility
   */
  calculateVolatility(prices, history) {
    if (prices.length < 2) return 0;
    
    const allPrices = [...prices, ...history.map(h => h.price || h)].slice(-20);
    const mean = allPrices.reduce((a, b) => a + b, 0) / allPrices.length;
    const variance =
      allPrices.reduce((sum, price) => sum + Math.pow(price - mean, 2), 0) /
      allPrices.length;
    return Math.sqrt(variance);
  }

  /**
   * Fetch from Stellar Oracle
   */
  async fetchFromStellarOracle(feedName, config) {
    try {
      const response = await axios.get(
        `${this.oracleEndpoints.stellar}/feeds/${feedName}`,
        { timeout: config.timeout }
      );
      return response.data;
    } catch (error) {
      logger.error(`[OracleService] Stellar oracle fetch error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Fetch from Chainlink
   */
  async fetchFromChainlink(feedName, config) {
    try {
      const response = await axios.get(
        `${this.oracleEndpoints.chainlink}/feeds/${feedName}`,
        { timeout: config.timeout }
      );
      return response.data;
    } catch (error) {
      logger.error(`[OracleService] Chainlink oracle fetch error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Fetch from Band Protocol
   */
  async fetchFromBand(feedName, config) {
    try {
      const response = await axios.get(
        `${this.oracleEndpoints.band}/data/${feedName}`,
        { timeout: config.timeout }
      );
      return response.data;
    } catch (error) {
      logger.error(`[OracleService] Band protocol oracle fetch error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Fetch price from Stellar
   */
  async fetchPriceFromStellar(symbol) {
    try {
      const response = await axios.get(
        `${this.oracleEndpoints.stellar}/prices/${symbol}`
      );
      return response.data.price;
    } catch (error) {
      logger.error(`[OracleService] Stellar price fetch error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Fetch price from Chainlink
   */
  async fetchPriceFromChainlink(symbol) {
    try {
      const response = await axios.get(
        `${this.oracleEndpoints.chainlink}/prices/${symbol}`
      );
      return response.data.price;
    } catch (error) {
      logger.error(`[OracleService] Chainlink price fetch error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Fetch price from Band
   */
  async fetchPriceFromBand(symbol) {
    try {
      const response = await axios.get(
        `${this.oracleEndpoints.band}/prices/${symbol}`
      );
      return response.data.price;
    } catch (error) {
      logger.error(`[OracleService] Band price fetch error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get data feed status
   */
  getDataFeedStatus(feedName) {
    const feed = this.dataFeeds.get(feedName);
    if (!feed) {
      throw new Error(`Data feed ${feedName} not found`);
    }
    return {
      name: feedName,
      status: feed.status,
      source: feed.source,
      lastUpdate: feed.lastUpdate,
      lastValue: feed.lastValue,
      updateCount: feed.updateHistory.length,
    };
  }

  /**
   * Get price feed status
   */
  getPriceFeedStatus(symbol) {
    const priceFeed = this.priceFeeds.get(symbol);
    if (!priceFeed) {
      throw new Error(`Price feed for ${symbol} not found`);
    }
    return {
      symbol,
      status: priceFeed.status,
      currentPrice: priceFeed.currentPrice,
      previousPrice: priceFeed.previousPrice,
      volatility: priceFeed.volatility,
      lastUpdated: priceFeed.lastUpdated,
      updateCount: priceFeed.updateCount,
    };
  }

  /**
   * List all active feeds
   */
  listActiveFeeds() {
    return {
      dataFeeds: Array.from(this.dataFeeds.entries()).map(([name, feed]) => ({
        name,
        status: feed.status,
        source: feed.source,
      })),
      priceFeeds: Array.from(this.priceFeeds.entries()).map(([symbol, feed]) => ({
        symbol,
        status: feed.status,
        currentPrice: feed.currentPrice,
      })),
    };
  }
}

module.exports = new OracleService();
