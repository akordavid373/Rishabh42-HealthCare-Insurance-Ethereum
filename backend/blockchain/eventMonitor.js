const EventEmitter = require('events');
const redis = require('redis');
const logger = require('../services/logger');

class EventMonitor extends EventEmitter {
  constructor() {
    super();
    this.redisClient = redis.createClient();
    this.eventLog = [];
    this.maxLogSize = 10000;
    this.eventFilters = new Map();
    this.eventSubscriptions = new Map();
    this.eventStats = {
      totalEvents: 0,
      eventsByType: {},
      eventsBySource: {},
    };
  }

  /**
   * Register event
   */
  registerEvent(eventType, source, config = {}) {
    try {
      logger.info(`[EventMonitor] Registering event: ${eventType} from ${source}`);

      const event = {
        type: eventType,
        source,
        config: {
          tracked: config.tracked !== false,
          alertThreshold: config.alertThreshold || null,
          retentionDays: config.retentionDays || 7,
          ...config,
        },
        status: 'active',
        registeredAt: new Date().toISOString(),
        occurrences: 0,
        lastOccurrence: null,
      };

      this.eventFilters.set(`${source}:${eventType}`, event);

      logger.info(`[EventMonitor] Event registered: ${eventType}`);
      return event;
    } catch (error) {
      logger.error(`[EventMonitor] Failed to register event: ${error.message}`);
      throw error;
    }
  }

  /**
   * Log event
   */
  async logEvent(eventType, source, data = {}, severity = 'info') {
    try {
      const eventRecord = {
        id: this.generateEventId(),
        type: eventType,
        source,
        data,
        severity,
        timestamp: new Date().toISOString(),
      };

      // Add to in-memory log
      this.eventLog.push(eventRecord);
      if (this.eventLog.length > this.maxLogSize) {
        this.eventLog.shift();
      }

      // Update statistics
      this.updateEventStats(eventType, source);

      // Cache to Redis
      await this.redisClient.set(
        `event:${eventRecord.id}`,
        JSON.stringify(eventRecord),
        { EX: 2592000 } // 30 days
      );

      // Add to sorted set for time-based queries
      await this.redisClient.zAdd(
        `events:${source}`,
        { score: Date.now(), member: eventRecord.id }
      );

      // Emit event
      this.emit('event', eventRecord);
      this.emit(`${source}:${eventType}`, eventRecord);

      // Check if alert should be triggered
      this.checkAlertConditions(eventType, source);

      logger.debug(`[EventMonitor] Event logged: ${eventType} from ${source}`);
      return eventRecord;
    } catch (error) {
      logger.error(`[EventMonitor] Failed to log event: ${error.message}`);
      throw error;
    }
  }

  /**
   * Log smart contract event
   */
  async logContractEvent(contractName, eventName, params, txHash) {
    try {
      return await this.logEvent(
        'smart_contract_event',
        `contract:${contractName}`,
        {
          eventName,
          params,
          transactionHash: txHash,
          contractName,
        },
        'info'
      );
    } catch (error) {
      logger.error(`[EventMonitor] Failed to log contract event: ${error.message}`);
      throw error;
    }
  }

  /**
   * Log transaction event
   */
  async logTransactionEvent(txHash, status, amount, details = {}) {
    try {
      return await this.logEvent(
        'transaction',
        'blockchain',
        {
          transactionHash: txHash,
          status,
          amount,
          ...details,
        },
        status === 'failed' ? 'error' : 'info'
      );
    } catch (error) {
      logger.error(`[EventMonitor] Failed to log transaction event: ${error.message}`);
      throw error;
    }
  }

  /**
   * Subscribe to events
   */
  subscribeToEvents(eventType, source, callback) {
    try {
      const key = `${source}:${eventType}`;
      if (!this.eventSubscriptions.has(key)) {
        this.eventSubscriptions.set(key, []);
      }
      this.eventSubscriptions.get(key).push(callback);

      // Also attach listener
      this.on(`${source}:${eventType}`, callback);

      logger.info(`[EventMonitor] Subscribed to events: ${eventType} from ${source}`);

      // Return unsubscribe function
      return () => {
        const callbacks = this.eventSubscriptions.get(key);
        const index = callbacks.indexOf(callback);
        if (index > -1) {
          callbacks.splice(index, 1);
        }
        this.off(`${source}:${eventType}`, callback);
      };
    } catch (error) {
      logger.error(`[EventMonitor] Failed to subscribe to events: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get recent events
   */
  async getRecentEvents(source = null, limit = 100) {
    try {
      if (source) {
        const cached = await this.redisClient.zRange(
          `events:${source}`,
          -limit,
          -1
        );
        
        const events = [];
        for (const eventId of cached) {
          const eventData = await this.redisClient.get(`event:${eventId}`);
          if (eventData) {
            events.push(JSON.parse(eventData));
          }
        }
        return events.reverse();
      }

      return this.eventLog.slice(-limit).reverse();
    } catch (error) {
      logger.error(`[EventMonitor] Failed to get recent events: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get events by type
   */
  getEventsByType(eventType, limit = 50) {
    try {
      return this.eventLog
        .filter(e => e.type === eventType)
        .slice(-limit)
        .reverse();
    } catch (error) {
      logger.error(`[EventMonitor] Failed to get events by type: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get event statistics
   */
  getEventStatistics() {
    try {
      return {
        totalEvents: this.eventStats.totalEvents,
        eventsByType: this.eventStats.eventsByType,
        eventsBySource: this.eventStats.eventsBySource,
        logSize: this.eventLog.length,
        maxLogSize: this.maxLogSize,
        oldestEvent: this.eventLog[0]?.timestamp || null,
        newestEvent: this.eventLog[this.eventLog.length - 1]?.timestamp || null,
      };
    } catch (error) {
      logger.error(`[EventMonitor] Failed to get event statistics: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check alert conditions
   */
  checkAlertConditions(eventType, source) {
    try {
      const eventKey = `${source}:${eventType}`;
      const eventConfig = this.eventFilters.get(eventKey);

      if (!eventConfig || !eventConfig.config.alertThreshold) {
        return;
      }

      const recentCount = this.eventLog.filter(
        e => e.type === eventType && e.source === source
      ).length;

      if (recentCount >= eventConfig.config.alertThreshold) {
        logger.warn(
          `[EventMonitor] Alert triggered: ${eventType} from ${source} (${recentCount} occurrences)`
        );
        this.emit('alert', {
          type: eventType,
          source,
          occurrences: recentCount,
          threshold: eventConfig.config.alertThreshold,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      logger.error(`[EventMonitor] Failed to check alert conditions: ${error.message}`);
    }
  }

  /**
   * Update event statistics
   */
  updateEventStats(eventType, source) {
    this.eventStats.totalEvents++;

    if (!this.eventStats.eventsByType[eventType]) {
      this.eventStats.eventsByType[eventType] = 0;
    }
    this.eventStats.eventsByType[eventType]++;

    if (!this.eventStats.eventsBySource[source]) {
      this.eventStats.eventsBySource[source] = 0;
    }
    this.eventStats.eventsBySource[source]++;
  }

  /**
   * Generate event ID
   */
  generateEventId() {
    return 'evt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Clear old events
   */
  clearOldEvents(daysOld = 7) {
    try {
      const cutoffTime = Date.now() - daysOld * 24 * 60 * 60 * 1000;
      const beforeLength = this.eventLog.length;

      this.eventLog = this.eventLog.filter(
        e => new Date(e.timestamp).getTime() > cutoffTime
      );

      const removed = beforeLength - this.eventLog.length;
      logger.info(`[EventMonitor] Cleared ${removed} old events`);

      return { removed, remaining: this.eventLog.length };
    } catch (error) {
      logger.error(`[EventMonitor] Failed to clear old events: ${error.message}`);
      throw error;
    }
  }

  /**
   * Export events
   */
  async exportEvents(source = null, format = 'json') {
    try {
      let events = source
        ? this.eventLog.filter(e => e.source === source)
        : this.eventLog;

      if (format === 'csv') {
        return this.eventsToCSV(events);
      }

      return JSON.stringify(events, null, 2);
    } catch (error) {
      logger.error(`[EventMonitor] Failed to export events: ${error.message}`);
      throw error;
    }
  }

  /**
   * Convert events to CSV
   */
  eventsToCSV(events) {
    try {
      const headers = ['ID', 'Type', 'Source', 'Severity', 'Timestamp'];
      const rows = events.map(e => [
        e.id,
        e.type,
        e.source,
        e.severity,
        e.timestamp,
      ]);

      const csv = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
      ].join('\n');

      return csv;
    } catch (error) {
      logger.error(`[EventMonitor] Failed to convert to CSV: ${error.message}`);
      throw error;
    }
  }
}

module.exports = new EventMonitor();
