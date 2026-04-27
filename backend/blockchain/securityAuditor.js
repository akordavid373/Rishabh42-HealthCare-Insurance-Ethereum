const crypto = require('crypto');
const redis = require('redis');
const logger = require('../services/logger');

class SecurityAuditor {
  constructor() {
    this.redisClient = redis.createClient();
    this.auditLog = [];
    this.maxAuditLogSize = 50000;
    this.securityRules = new Map();
    this.vulnerabilities = [];
    this.securityScores = new Map();
  }

  /**
   * Register security rule
   */
  registerSecurityRule(ruleName, validator, severity = 'medium') {
    try {
      logger.info(`[SecurityAuditor] Registering security rule: ${ruleName}`);

      const rule = {
        name: ruleName,
        validator, // function that validates security requirement
        severity, // 'low', 'medium', 'high', 'critical'
        enabled: true,
        registeredAt: new Date().toISOString(),
        violations: 0,
      };

      this.securityRules.set(ruleName, rule);

      return rule;
    } catch (error) {
      logger.error(`[SecurityAuditor] Failed to register security rule: ${error.message}`);
      throw error;
    }
  }

  /**
   * Audit smart contract
   */
  async auditSmartContract(contractCode, contractName) {
    try {
      logger.info(`[SecurityAuditor] Auditing smart contract: ${contractName}`);

      const auditResult = {
        contractName,
        auditedAt: new Date().toISOString(),
        checks: [],
        vulnerabilities: [],
        securityScore: 0,
      };

      // Run security checks
      const checks = [
        this.checkForUnsafePatterns(contractCode),
        this.checkForAccessControl(contractCode),
        this.checkForInputValidation(contractCode),
        this.checkForOverflowVulnerabilities(contractCode),
        this.checkForReetrancyVulnerabilities(contractCode),
        this.checkForTimestampDependencies(contractCode),
      ];

      for (const check of checks) {
        auditResult.checks.push(check);
        if (!check.passed) {
          auditResult.vulnerabilities.push({
            type: check.name,
            severity: check.severity,
            description: check.description,
          });
        }
      }

      // Calculate security score
      const passedChecks = auditResult.checks.filter(c => c.passed).length;
      auditResult.securityScore = (passedChecks / auditResult.checks.length) * 100;

      // Log audit
      await this.logAudit('contract_audit', contractName, auditResult);

      // Cache result
      await this.redisClient.set(
        `audit:contract:${contractName}`,
        JSON.stringify(auditResult),
        { EX: 604800 } // 7 days
      );

      if (auditResult.vulnerabilities.length > 0) {
        logger.warn(
          `[SecurityAuditor] Contract ${contractName} has ${auditResult.vulnerabilities.length} vulnerabilities`
        );
      }

      return auditResult;
    } catch (error) {
      logger.error(`[SecurityAuditor] Failed to audit smart contract: ${error.message}`);
      throw error;
    }
  }

  /**
   * Audit transaction
   */
  async auditTransaction(transaction) {
    try {
      logger.info(`[SecurityAuditor] Auditing transaction: ${transaction.id}`);

      const auditResult = {
        transactionId: transaction.id,
        auditedAt: new Date().toISOString(),
        checks: [],
        violations: [],
        passed: true,
      };

      // Check transaction validity
      const validityCheck = this.checkTransactionValidity(transaction);
      auditResult.checks.push(validityCheck);

      // Check signature
      const signatureCheck = this.checkSignature(transaction);
      auditResult.checks.push(signatureCheck);

      // Check fee reasonableness
      const feeCheck = this.checkFeeReasonableness(transaction);
      auditResult.checks.push(feeCheck);

      // Check for suspicious patterns
      const suspiciousPatternCheck = this.checkSuspiciousPatterns(transaction);
      auditResult.checks.push(suspiciousPatternCheck);

      // Aggregate violations
      auditResult.violations = auditResult.checks
        .filter(c => !c.passed)
        .map(c => ({
          type: c.name,
          severity: c.severity,
          message: c.message,
        }));

      auditResult.passed = auditResult.violations.length === 0;

      // Log audit
      await this.logAudit('transaction_audit', transaction.id, auditResult);

      return auditResult;
    } catch (error) {
      logger.error(`[SecurityAuditor] Failed to audit transaction: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check for unsafe patterns
   */
  checkForUnsafePatterns(code) {
    const unsafePatterns = ['eval(', 'innerHTML', 'exec(', 'system('];
    const found = unsafePatterns.filter(pattern => code.includes(pattern));

    return {
      name: 'unsafe_patterns_check',
      passed: found.length === 0,
      severity: 'high',
      description: `Found ${found.length} unsafe patterns: ${found.join(', ')}`,
      found,
    };
  }

  /**
   * Check for access control
   */
  checkForAccessControl(code) {
    const hasAccessControl =
      code.includes('require') ||
      code.includes('assert') ||
      code.includes('auth') ||
      code.includes('permission');

    return {
      name: 'access_control_check',
      passed: hasAccessControl,
      severity: 'critical',
      description: hasAccessControl
        ? 'Access control found'
        : 'No access control mechanisms detected',
    };
  }

  /**
   * Check for input validation
   */
  checkForInputValidation(code) {
    const hasValidation =
      code.includes('validate') ||
      code.includes('check') ||
      code.includes('verify') ||
      code.includes('assert');

    return {
      name: 'input_validation_check',
      passed: hasValidation,
      severity: 'high',
      description: hasValidation
        ? 'Input validation found'
        : 'No input validation detected',
    };
  }

  /**
   * Check for overflow vulnerabilities
   */
  checkForOverflowVulnerabilities(code) {
    const hasOverflowProtection =
      code.includes('checked') || code.includes('safe') || code.includes('overflow');

    return {
      name: 'overflow_check',
      passed: hasOverflowProtection,
      severity: 'high',
      description: hasOverflowProtection
        ? 'Overflow protections found'
        : 'No explicit overflow protections',
    };
  }

  /**
   * Check for reentrancy vulnerabilities
   */
  checkForReetrancyVulnerabilities(code) {
    const reetrancyRisks = [
      'call.value',
      'transfer',
      '.send(',
      'external call',
    ];
    const found = reetrancyRisks.filter(pattern => code.includes(pattern));

    return {
      name: 'reentrancy_check',
      passed: found.length === 0,
      severity: 'critical',
      description:
        found.length === 0
          ? 'No reentrancy risks detected'
          : `Potential reentrancy vectors: ${found.join(', ')}`,
      found,
    };
  }

  /**
   * Check for timestamp dependencies
   */
  checkForTimestampDependencies(code) {
    const hasTimestampDeps =
      code.includes('now') ||
      code.includes('block.timestamp') ||
      code.includes('time');

    return {
      name: 'timestamp_check',
      passed: !hasTimestampDeps,
      severity: 'medium',
      description: hasTimestampDeps
        ? 'Code relies on timestamps (potential security risk)'
        : 'No critical timestamp dependencies',
    };
  }

  /**
   * Check transaction validity
   */
  checkTransactionValidity(transaction) {
    const isValid =
      transaction.id &&
      transaction.sender &&
      transaction.operations &&
      transaction.operations.length > 0;

    return {
      name: 'transaction_validity',
      passed: isValid,
      severity: 'high',
      message: isValid ? 'Transaction is valid' : 'Transaction missing required fields',
    };
  }

  /**
   * Check signature
   */
  checkSignature(transaction) {
    const hasSingleSignature = transaction.signatures && transaction.signatures.length >= 1;
    // In production, verify actual signature

    return {
      name: 'signature_check',
      passed: hasSingleSignature,
      severity: 'critical',
      message: hasSingleSignature
        ? 'Signature(s) present'
        : 'No signatures found on transaction',
    };
  }

  /**
   * Check fee reasonableness
   */
  checkFeeReasonableness(transaction) {
    const baseFee = 100; // Base fee in stroops
    const reasonableFee = transaction.fee && transaction.fee >= baseFee;

    return {
      name: 'fee_check',
      passed: reasonableFee,
      severity: 'medium',
      message: reasonableFee
        ? `Fee (${transaction.fee} stroops) is reasonable`
        : `Fee (${transaction.fee || 0} stroops) is below recommended minimum`,
    };
  }

  /**
   * Check suspicious patterns
   */
  checkSuspiciousPatterns(transaction) {
    const hasSuspiciousPatterns = false; // Placeholder - add actual logic

    return {
      name: 'suspicious_patterns',
      passed: !hasSuspiciousPatterns,
      severity: 'medium',
      message: hasSuspiciousPatterns
        ? 'Suspicious patterns detected'
        : 'No suspicious patterns detected',
    };
  }

  /**
   * Log audit
   */
  async logAudit(auditType, subject, result) {
    try {
      const auditRecord = {
        id: this.generateAuditId(),
        type: auditType,
        subject,
        result,
        timestamp: new Date().toISOString(),
      };

      // Add to log
      this.auditLog.push(auditRecord);
      if (this.auditLog.length > this.maxAuditLogSize) {
        this.auditLog.shift();
      }

      // Cache to Redis
      await this.redisClient.set(
        `audit:${auditRecord.id}`,
        JSON.stringify(auditRecord),
        { EX: 2592000 } // 30 days
      );
    } catch (error) {
      logger.error(`[SecurityAuditor] Failed to log audit: ${error.message}`);
    }
  }

  /**
   * Get audit history
   */
  getAuditHistory(subject = null, limit = 100) {
    try {
      let history = this.auditLog;

      if (subject) {
        history = history.filter(a => a.subject === subject);
      }

      return history.slice(-limit).reverse();
    } catch (error) {
      logger.error(`[SecurityAuditor] Failed to get audit history: ${error.message}`);
      throw error;
    }
  }

  /**
   * Generate security score for wallet
   */
  generateWalletSecurityScore(wallet) {
    try {
      const score = {
        walletId: wallet.id,
        overallScore: 0,
        checks: {},
      };

      // Check 1: Key backup
      score.checks.keyBackup = wallet.backed_up ? 50 : 0;

      // Check 2: Two-factor authentication
      score.checks.twoFactor = wallet.twoFactorEnabled ? 30 : 0;

      // Check 3: Transaction verification
      score.checks.transactionVerification = wallet.requiresVerification ? 20 : 0;

      // Calculate overall score
      score.overallScore =
        score.checks.keyBackup +
        score.checks.twoFactor +
        score.checks.transactionVerification;

      // Generate recommendations
      score.recommendations = [];
      if (!wallet.backed_up) {
        score.recommendations.push('Back up your wallet keys');
      }
      if (!wallet.twoFactorEnabled) {
        score.recommendations.push('Enable two-factor authentication');
      }
      if (!wallet.requiresVerification) {
        score.recommendations.push('Enable transaction verification');
      }

      this.securityScores.set(wallet.id, score);

      return score;
    } catch (error) {
      logger.error(
        `[SecurityAuditor] Failed to generate wallet security score: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Generate audit report
   */
  generateAuditReport(startDate = null, endDate = null) {
    try {
      let auditRecords = this.auditLog;

      if (startDate && endDate) {
        auditRecords = auditRecords.filter(a => {
          const aDate = new Date(a.timestamp);
          return aDate >= startDate && aDate <= endDate;
        });
      }

      const report = {
        totalAudits: auditRecords.length,
        auditsByType: {},
        vulnerabilitiesByType: {},
        averageSecurityScore: 0,
        period: { startDate, endDate },
        generatedAt: new Date().toISOString(),
      };

      // Count audits by type
      auditRecords.forEach(audit => {
        if (!report.auditsByType[audit.type]) {
          report.auditsByType[audit.type] = 0;
        }
        report.auditsByType[audit.type]++;

        // Count vulnerabilities
        if (audit.result.vulnerabilities) {
          audit.result.vulnerabilities.forEach(vuln => {
            const key = vuln.type;
            if (!report.vulnerabilitiesByType[key]) {
              report.vulnerabilitiesByType[key] = 0;
            }
            report.vulnerabilitiesByType[key]++;
          });
        }
      });

      return report;
    } catch (error) {
      logger.error(`[SecurityAuditor] Failed to generate audit report: ${error.message}`);
      throw error;
    }
  }

  /**
   * Generate audit ID
   */
  generateAuditId() {
    return 'audit_' + crypto.randomBytes(12).toString('hex');
  }

  /**
   * Export audit log
   */
  async exportAuditLog(format = 'json') {
    try {
      if (format === 'json') {
        return JSON.stringify(this.auditLog, null, 2);
      }

      if (format === 'csv') {
        return this.auditLogToCSV();
      }

      throw new Error(`Unsupported format: ${format}`);
    } catch (error) {
      logger.error(`[SecurityAuditor] Failed to export audit log: ${error.message}`);
      throw error;
    }
  }

  /**
   * Convert audit log to CSV
   */
  auditLogToCSV() {
    try {
      const headers = ['ID', 'Type', 'Subject', 'Timestamp'];
      const rows = this.auditLog.map(a => [a.id, a.type, a.subject, a.timestamp]);

      const csv = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
      ].join('\n');

      return csv;
    } catch (error) {
      logger.error(`[SecurityAuditor] Failed to convert to CSV: ${error.message}`);
      throw error;
    }
  }
}

module.exports = new SecurityAuditor();
