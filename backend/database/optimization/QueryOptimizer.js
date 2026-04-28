const { EventEmitter } = require('events');

class QueryOptimizer extends EventEmitter {
  constructor(config = {}) {
    super();
    this.queryCache = new Map();
    this.queryStats = new Map();
    this.slowQueryThreshold = config.slowQueryThreshold || 1000; // 1 second
    this.cacheSize = config.cacheSize || 1000;
    this.optimizationRules = new Map();
    this.indexRecommendations = new Map();
    
    this.initializeOptimizationRules();
  }

  initializeOptimizationRules() {
    // Rule 1: Add LIMIT to large result sets
    this.optimizationRules.set('large_result_set', {
      pattern: /SELECT\s+.*\s+FROM\s+\w+(?!\s+LIMIT)/i,
      suggestion: 'Consider adding LIMIT clause to prevent large result sets',
      priority: 'medium'
    });

    // Rule 2: Use specific columns instead of SELECT *
    this.optimizationRules.set('select_star', {
      pattern: /SELECT\s+\s*\*\s*\s+FROM/i,
      suggestion: 'Avoid SELECT *, specify only required columns',
      priority: 'high'
    });

    // Rule 3: Use WHERE clause effectively
    this.optimizationRules.set('missing_where', {
      pattern: /SELECT\s+.*\s+FROM\s+\w+(?!\s+WHERE)(?!\s+LIMIT)/i,
      suggestion: 'Consider adding WHERE clause to filter results',
      priority: 'medium'
    });

    // Rule 4: Use indexed columns in WHERE
    this.optimizationRules.set('non_indexed_where', {
      pattern: /WHERE\s+\w+\s*=\s*['"]/i,
      suggestion: 'Ensure WHERE clause uses indexed columns',
      priority: 'high'
    });

    // Rule 5: Avoid subqueries when possible
    this.optimizationRules.set('complex_subquery', {
      pattern: /SELECT\s+.*\s+FROM\s+\(.*SELECT.*\)/i,
      suggestion: 'Consider using JOIN instead of subquery for better performance',
      priority: 'medium'
    });
  }

  async optimizeQuery(query, params = [], context = {}) {
    const startTime = Date.now();
    const queryHash = this.generateQueryHash(query, params);
    
    // Check cache first
    if (this.queryCache.has(queryHash)) {
      const cachedResult = this.queryCache.get(queryHash);
      this.updateQueryStats(queryHash, Date.now() - startTime, true);
      return cachedResult;
    }

    // Analyze and optimize query
    const analysis = this.analyzeQuery(query);
    const optimizedQuery = this.applyOptimizations(query, analysis);
    
    // Execute query (this would be passed to the actual database)
    const result = {
      originalQuery: query,
      optimizedQuery: optimizedQuery,
      analysis: analysis,
      executionTime: Date.now() - startTime,
      recommendations: this.generateRecommendations(analysis)
    };

    // Cache result if small enough
    if (this.queryCache.size < this.cacheSize) {
      this.queryCache.set(queryHash, result);
    }

    this.updateQueryStats(queryHash, Date.now() - startTime, false);
    this.emit('queryOptimized', result);

    return result;
  }

  generateQueryHash(query, params) {
    const crypto = require('crypto');
    const queryStr = `${query}:${JSON.stringify(params)}`;
    return crypto.createHash('md5').update(queryStr).digest('hex');
  }

  analyzeQuery(query) {
    const analysis = {
      queryType: this.getQueryType(query),
      tables: this.extractTables(query),
      columns: this.extractColumns(query),
      conditions: this.extractConditions(query),
      joins: this.extractJoins(query),
      aggregations: this.extractAggregations(query),
      subqueries: this.extractSubqueries(query),
      issues: [],
      optimizations: []
    };

    // Apply optimization rules
    for (const [ruleName, rule] of this.optimizationRules) {
      if (rule.pattern.test(query)) {
        analysis.issues.push({
          rule: ruleName,
          message: rule.suggestion,
          priority: rule.priority
        });
      }
    }

    // Check for potential performance issues
    this.checkPerformanceIssues(analysis);

    return analysis;
  }

  getQueryType(query) {
    const queryUpper = query.trim().toUpperCase();
    if (queryUpper.startsWith('SELECT')) return 'SELECT';
    if (queryUpper.startsWith('INSERT')) return 'INSERT';
    if (queryUpper.startsWith('UPDATE')) return 'UPDATE';
    if (queryUpper.startsWith('DELETE')) return 'DELETE';
    if (queryUpper.startsWith('CREATE')) return 'CREATE';
    if (queryUpper.startsWith('DROP')) return 'DROP';
    if (queryUpper.startsWith('ALTER')) return 'ALTER';
    return 'UNKNOWN';
  }

  extractTables(query) {
    const tablePattern = /FROM\s+(\w+)|JOIN\s+(\w+)/gi;
    const tables = [];
    let match;
    
    while ((match = tablePattern.exec(query)) !== null) {
      const table = match[1] || match[2];
      if (table && !tables.includes(table)) {
        tables.push(table);
      }
    }
    
    return tables;
  }

  extractColumns(query) {
    const selectMatch = query.match(/SELECT\s+(.*?)\s+FROM/i);
    if (!selectMatch) return [];
    
    const columns = selectMatch[1];
    if (columns.trim() === '*') return ['*'];
    
    return columns.split(',').map(col => col.trim().replace(/`/g, ''));
  }

  extractConditions(query) {
    const whereMatch = query.match(/WHERE\s+(.*?)(?:\s+GROUP\s+BY|\s+ORDER\s+BY|\s+LIMIT|$)/i);
    if (!whereMatch) return [];
    
    const conditions = whereMatch[1];
    const conditionPattern = /(\w+)\s*(=|!=|>|<|>=|<=|LIKE|IN|BETWEEN)\s*([^,\s]+|'[^']*'|"[^"]*")/gi;
    const extractedConditions = [];
    let match;
    
    while ((match = conditionPattern.exec(conditions)) !== null) {
      extractedConditions.push({
        column: match[1],
        operator: match[2],
        value: match[3]
      });
    }
    
    return extractedConditions;
  }

  extractJoins(query) {
    const joinPattern = /(INNER|LEFT|RIGHT|FULL)\s+JOIN\s+(\w+)\s+ON\s+(.+?)(?=\s+(INNER|LEFT|RIGHT|FULL)\s+JOIN|\s+WHERE|\s+GROUP\s+BY|\s+ORDER\s+BY|\s+LIMIT|$)/gi;
    const joins = [];
    let match;
    
    while ((match = joinPattern.exec(query)) !== null) {
      joins.push({
        type: match[1],
        table: match[2],
        condition: match[3].trim()
      });
    }
    
    return joins;
  }

  extractAggregations(query) {
    const aggPattern = /(COUNT|SUM|AVG|MIN|MAX)\s*\(\s*(.*?)\s*\)/gi;
    const aggregations = [];
    let match;
    
    while ((match = aggPattern.exec(query)) !== null) {
      aggregations.push({
        function: match[1],
        column: match[2]
      });
    }
    
    return aggregations;
  }

  extractSubqueries(query) {
    const subqueryPattern = /\(\s*SELECT\s+.*?\s+FROM\s+.*?\)/gi;
    const subqueries = [];
    let match;
    
    while ((match = subqueryPattern.exec(query)) !== null) {
      subqueries.push(match[0]);
    }
    
    return subqueries;
  }

  checkPerformanceIssues(analysis) {
    // Check for missing indexes
    if (analysis.conditions.length > 0 && analysis.queryType === 'SELECT') {
      analysis.conditions.forEach(condition => {
        const indexKey = `${analysis.tables[0]}_${condition.column}`;
        if (!this.indexRecommendations.has(indexKey)) {
          this.indexRecommendations.set(indexKey, {
            table: analysis.tables[0],
            column: condition.column,
            reason: 'Frequently used in WHERE clause',
            priority: 'high'
          });
        }
      });
    }

    // Check for complex joins
    if (analysis.joins.length > 3) {
      analysis.issues.push({
        rule: 'complex_joins',
        message: 'Query involves multiple joins, consider breaking into simpler queries',
        priority: 'medium'
      });
    }

    // Check for missing pagination
    if (analysis.queryType === 'SELECT' && !query.toLowerCase().includes('limit')) {
      analysis.issues.push({
        rule: 'missing_pagination',
        message: 'Large result set without LIMIT clause, add pagination',
        priority: 'high'
      });
    }
  }

  applyOptimizations(query, analysis) {
    let optimizedQuery = query;

    // Add LIMIT if missing and it's a SELECT query
    if (analysis.queryType === 'SELECT' && !query.toLowerCase().includes('limit')) {
      optimizedQuery += ' LIMIT 1000';
      analysis.optimizations.push({
        type: 'pagination',
        description: 'Added LIMIT 1000 to prevent large result sets'
      });
    }

    // Replace SELECT * with specific columns if possible
    if (analysis.columns.includes('*') && analysis.tables.length > 0) {
      // This is a simplified optimization - in practice, you'd need schema information
      analysis.optimizations.push({
        type: 'column_selection',
        description: 'Consider specifying only required columns instead of SELECT *'
      });
    }

    return optimizedQuery;
  }

  generateRecommendations(analysis) {
    const recommendations = [];

    // Index recommendations
    for (const [key, recommendation] of this.indexRecommendations) {
      recommendations.push({
        type: 'index',
        table: recommendation.table,
        column: recommendation.column,
        sql: `CREATE INDEX idx_${recommendation.table}_${recommendation.column} ON ${recommendation.table}(${recommendation.column})`,
        priority: recommendation.priority,
        reason: recommendation.reason
      });
    }

    // Query optimization recommendations
    analysis.issues.forEach(issue => {
      recommendations.push({
        type: 'query_optimization',
        rule: issue.rule,
        message: issue.message,
        priority: issue.priority
      });
    });

    return recommendations;
  }

  updateQueryStats(queryHash, executionTime, fromCache) {
    if (!this.queryStats.has(queryHash)) {
      this.queryStats.set(queryHash, {
        executionCount: 0,
        totalExecutionTime: 0,
        avgExecutionTime: 0,
        fromCache: 0,
        lastExecuted: new Date()
      });
    }

    const stats = this.queryStats.get(queryHash);
    stats.executionCount++;
    stats.totalExecutionTime += executionTime;
    stats.avgExecutionTime = stats.totalExecutionTime / stats.executionCount;
    stats.lastExecuted = new Date();
    
    if (fromCache) {
      stats.fromCache++;
    }

    // Emit slow query warning
    if (executionTime > this.slowQueryThreshold) {
      this.emit('slowQuery', {
        queryHash,
        executionTime,
        threshold: this.slowQueryThreshold
      });
    }
  }

  getQueryStatistics() {
    const stats = {
      totalQueries: 0,
      cacheHitRate: 0,
      avgExecutionTime: 0,
      slowQueries: 0,
      topSlowQueries: [],
      indexRecommendations: Array.from(this.indexRecommendations.values())
    };

    let totalExecutionTime = 0;
    let totalCacheHits = 0;
    const slowQueries = [];

    for (const [queryHash, queryStats] of this.queryStats) {
      stats.totalQueries += queryStats.executionCount;
      totalExecutionTime += queryStats.totalExecutionTime;
      totalCacheHits += queryStats.fromCache;

      if (queryStats.avgExecutionTime > this.slowQueryThreshold) {
        stats.slowQueries++;
        slowQueries.push({
          queryHash,
          avgExecutionTime: queryStats.avgExecutionTime,
          executionCount: queryStats.executionCount
        });
      }
    }

    if (stats.totalQueries > 0) {
      stats.cacheHitRate = (totalCacheHits / stats.totalQueries) * 100;
      stats.avgExecutionTime = totalExecutionTime / stats.totalQueries;
    }

    // Sort slow queries by execution time
    stats.topSlowQueries = slowQueries
      .sort((a, b) => b.avgExecutionTime - a.avgExecutionTime)
      .slice(0, 10);

    return stats;
  }

  clearCache() {
    this.queryCache.clear();
    this.emit('cacheCleared');
  }

  getCacheSize() {
    return this.queryCache.size;
  }

  addCustomRule(name, pattern, suggestion, priority = 'medium') {
    this.optimizationRules.set(name, {
      pattern: pattern instanceof RegExp ? pattern : new RegExp(pattern, 'i'),
      suggestion,
      priority
    });
  }

  removeCustomRule(name) {
    return this.optimizationRules.delete(name);
  }

  async analyzeTableSchema(tableName, schema) {
    // This would analyze table schema and provide optimization recommendations
    const recommendations = [];

    // Check for missing indexes on foreign keys
    schema.columns.forEach(column => {
      if (column.foreignKey && !column.indexed) {
        recommendations.push({
          type: 'index',
          table: tableName,
          column: column.name,
          sql: `CREATE INDEX idx_${tableName}_${column.name} ON ${tableName}(${column.name})`,
          priority: 'high',
          reason: 'Foreign key column should be indexed for join performance'
        });
      }
    });

    // Check for large text fields that might need full-text search
    schema.columns.forEach(column => {
      if (column.type === 'TEXT' && column.length > 1000) {
        recommendations.push({
          type: 'fulltext_search',
          table: tableName,
          column: column.name,
          sql: `CREATE VIRTUAL TABLE ${tableName}_ft USING fts5(${column.name})`,
          priority: 'medium',
          reason: 'Large text field may benefit from full-text search index'
        });
      }
    });

    return recommendations;
  }
}

module.exports = QueryOptimizer;
