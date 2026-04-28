const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../database/healthcare.db');

class BlockchainAnalyticsService {
  constructor() {
    this.db = new sqlite3.Database(DB_PATH);
  }

  _run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function runCallback(err) {
        if (err) reject(err);
        else resolve({ id: this.lastID, changes: this.changes });
      });
    });
  }

  _get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  _all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  _stringify(value) {
    if (value === undefined || value === null) return null;
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
  }

  _parse(value, fallback = null) {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value);
    } catch (err) {
      return fallback;
    }
  }

  _number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  _riskLevel(score) {
    if (score >= 85) return 'critical';
    if (score >= 65) return 'high';
    if (score >= 35) return 'medium';
    return 'low';
  }

  _period(options = {}) {
    const now = new Date();
    const end = options.period_end || options.to || now.toISOString();
    const startDate = new Date(end);
    startDate.setDate(startDate.getDate() - 30);
    const start = options.period_start || options.from || startDate.toISOString();
    return { start, end };
  }

  async initializeTables() {
    await this._run(`CREATE TABLE IF NOT EXISTS blockchain_transactions (
      id TEXT PRIMARY KEY,
      network TEXT NOT NULL,
      tx_hash TEXT NOT NULL,
      from_address TEXT,
      to_address TEXT,
      contract_address TEXT,
      asset_code TEXT,
      amount REAL DEFAULT 0,
      fee REAL DEFAULT 0,
      status TEXT DEFAULT 'pending',
      tx_type TEXT DEFAULT 'transfer',
      block_number INTEGER,
      ledger_sequence INTEGER,
      confirmation_time_ms INTEGER,
      risk_score INTEGER DEFAULT 0,
      risk_level TEXT DEFAULT 'low',
      metadata TEXT,
      monitored_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(network, tx_hash)
    )`);

    await this._run(`CREATE TABLE IF NOT EXISTS blockchain_contract_analyses (
      analysis_id TEXT PRIMARY KEY,
      network TEXT NOT NULL,
      contract_address TEXT NOT NULL,
      contract_name TEXT,
      security_score INTEGER NOT NULL,
      risk_level TEXT NOT NULL,
      findings TEXT,
      metrics TEXT,
      compliance_flags TEXT,
      recommendations TEXT,
      metadata TEXT,
      analyzed_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    await this._run(`CREATE TABLE IF NOT EXISTS blockchain_compliance_reports (
      report_id TEXT PRIMARY KEY,
      report_type TEXT NOT NULL,
      framework TEXT,
      period_start TEXT,
      period_end TEXT,
      summary TEXT,
      findings TEXT,
      recommendations TEXT,
      generated_by TEXT,
      generated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    await this._run(`CREATE TABLE IF NOT EXISTS blockchain_security_alerts (
      alert_id TEXT PRIMARY KEY,
      alert_type TEXT NOT NULL,
      severity TEXT NOT NULL,
      network TEXT,
      tx_hash TEXT,
      contract_address TEXT,
      address TEXT,
      message TEXT NOT NULL,
      evidence TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      resolved_at TEXT
    )`);

    await this._run(`CREATE TABLE IF NOT EXISTS blockchain_documentation (
      doc_id TEXT PRIMARY KEY,
      doc_type TEXT NOT NULL,
      format TEXT NOT NULL,
      content TEXT,
      generated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      generated_by TEXT
    )`);

    await this._run(`CREATE TABLE IF NOT EXISTS blockchain_suspicious_addresses (
      address TEXT PRIMARY KEY,
      network TEXT,
      reason TEXT,
      severity TEXT DEFAULT 'high',
      metadata TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_blockchain_tx_network_hash ON blockchain_transactions(network, tx_hash)',
      'CREATE INDEX IF NOT EXISTS idx_blockchain_tx_from ON blockchain_transactions(from_address)',
      'CREATE INDEX IF NOT EXISTS idx_blockchain_tx_to ON blockchain_transactions(to_address)',
      'CREATE INDEX IF NOT EXISTS idx_blockchain_tx_contract ON blockchain_transactions(contract_address)',
      'CREATE INDEX IF NOT EXISTS idx_blockchain_tx_risk ON blockchain_transactions(risk_level)',
      'CREATE INDEX IF NOT EXISTS idx_blockchain_tx_status ON blockchain_transactions(status)',
      'CREATE INDEX IF NOT EXISTS idx_blockchain_tx_created ON blockchain_transactions(created_at)',
      'CREATE INDEX IF NOT EXISTS idx_blockchain_contract_address ON blockchain_contract_analyses(network, contract_address)',
      'CREATE INDEX IF NOT EXISTS idx_blockchain_contract_risk ON blockchain_contract_analyses(risk_level)',
      'CREATE INDEX IF NOT EXISTS idx_blockchain_reports_generated ON blockchain_compliance_reports(generated_at)',
      'CREATE INDEX IF NOT EXISTS idx_blockchain_alerts_status_severity ON blockchain_security_alerts(status, severity)',
      'CREATE INDEX IF NOT EXISTS idx_blockchain_alerts_network ON blockchain_security_alerts(network)'
    ];

    for (const indexSql of indexes) {
      await this._run(indexSql);
    }
  }

  _mapTransaction(row) {
    if (!row) return null;
    return {
      ...row,
      metadata: this._parse(row.metadata, {}),
      amount: this._number(row.amount),
      fee: this._number(row.fee),
      risk_score: Number(row.risk_score || 0)
    };
  }

  _mapAnalysis(row) {
    if (!row) return null;
    return {
      ...row,
      findings: this._parse(row.findings, []),
      metrics: this._parse(row.metrics, {}),
      compliance_flags: this._parse(row.compliance_flags, {}),
      recommendations: this._parse(row.recommendations, []),
      metadata: this._parse(row.metadata, {})
    };
  }

  _mapReport(row) {
    if (!row) return null;
    return {
      ...row,
      summary: this._parse(row.summary, {}),
      findings: this._parse(row.findings, []),
      recommendations: this._parse(row.recommendations, [])
    };
  }

  _mapAlert(row) {
    if (!row) return null;
    return { ...row, evidence: this._parse(row.evidence, {}) };
  }

  async _computeTransactionRisk(data) {
    let score = 0;
    const signals = [];
    const status = String(data.status || 'pending').toLowerCase();
    const amount = this._number(data.amount);
    const fee = this._number(data.fee);
    const from = data.from_address || data.from;
    const to = data.to_address || data.to;
    const network = data.network || 'blockchain';

    if (status === 'failed') {
      score += 25;
      signals.push('failed transaction status');
    } else if (['reverted', 'dropped'].includes(status)) {
      score += 30;
      signals.push(`${status} transaction status`);
    } else if (status === 'pending') {
      score += 5;
      signals.push('pending confirmation');
    }

    if (amount >= 100000) {
      score += 35;
      signals.push('unusually large amount');
    } else if (amount >= 10000) {
      score += 22;
      signals.push('large amount');
    } else if (amount >= 1000) {
      score += 10;
      signals.push('elevated amount');
    }

    if (!to || String(to).trim() === '' || String(to).toLowerCase() === 'unknown') {
      score += 20;
      signals.push('missing or unknown recipient');
    }

    if (data.contract_address) {
      score += 10;
      signals.push('smart contract interaction');
    }

    if (fee >= 100) {
      score += 15;
      signals.push('very high transaction fee');
    } else if (fee >= 10) {
      score += 8;
      signals.push('high transaction fee');
    }

    const suspiciousParams = [from, to].filter(Boolean);
    for (const address of suspiciousParams) {
      const suspicious = await this._get(
        'SELECT * FROM blockchain_suspicious_addresses WHERE lower(address) = lower(?) AND (network = ? OR network IS NULL OR network = "")',
        [address, network]
      );
      if (suspicious) {
        const bump = suspicious.severity === 'critical' ? 40 : suspicious.severity === 'medium' ? 20 : 30;
        score += bump;
        signals.push(`known suspicious address: ${address}`);
      }
    }

    if (from) {
      const repeat = await this._get(
        `SELECT COUNT(*) as count FROM blockchain_transactions
         WHERE lower(from_address) = lower(?) AND network = ? AND datetime(created_at) >= datetime('now', '-1 day')`,
        [from, network]
      );
      if (repeat && repeat.count >= 25) {
        score += 20;
        signals.push('high repeated transaction volume');
      } else if (repeat && repeat.count >= 10) {
        score += 10;
        signals.push('repeated transaction volume');
      }
    }

    if (data.contract_address) {
      const riskyContract = await this._get(
        `SELECT risk_level FROM blockchain_contract_analyses
         WHERE network = ? AND lower(contract_address) = lower(?)
         ORDER BY datetime(analyzed_at) DESC LIMIT 1`,
        [network, data.contract_address]
      );
      if (riskyContract) {
        const levels = { medium: 10, high: 25, critical: 40 };
        const bump = levels[riskyContract.risk_level] || 0;
        if (bump) {
          score += bump;
          signals.push(`interaction with ${riskyContract.risk_level}-risk contract`);
        }
      }
    }

    score = Math.max(0, Math.min(100, Math.round(score)));
    return { risk_score: score, risk_level: this._riskLevel(score), signals };
  }

  async recordTransaction(data) {
    await this.initializeTables();
    if (!data || !data.network || !data.tx_hash) {
      throw new Error('network and tx_hash are required');
    }

    const risk = data.risk_score !== undefined
      ? { risk_score: Number(data.risk_score), risk_level: data.risk_level || this._riskLevel(Number(data.risk_score)), signals: [] }
      : await this._computeTransactionRisk(data);

    const id = data.id || uuidv4();
    const now = new Date().toISOString();
    await this._run(
      `INSERT INTO blockchain_transactions (
        id, network, tx_hash, from_address, to_address, contract_address, asset_code,
        amount, fee, status, tx_type, block_number, ledger_sequence, confirmation_time_ms,
        risk_score, risk_level, metadata, monitored_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(network, tx_hash) DO UPDATE SET
        from_address = excluded.from_address,
        to_address = excluded.to_address,
        contract_address = excluded.contract_address,
        asset_code = excluded.asset_code,
        amount = excluded.amount,
        fee = excluded.fee,
        status = excluded.status,
        tx_type = excluded.tx_type,
        block_number = excluded.block_number,
        ledger_sequence = excluded.ledger_sequence,
        confirmation_time_ms = excluded.confirmation_time_ms,
        risk_score = excluded.risk_score,
        risk_level = excluded.risk_level,
        metadata = excluded.metadata,
        monitored_at = COALESCE(excluded.monitored_at, blockchain_transactions.monitored_at),
        updated_at = excluded.updated_at`,
      [
        id,
        data.network,
        data.tx_hash,
        data.from_address || data.from || null,
        data.to_address || data.to || null,
        data.contract_address || null,
        data.asset_code || null,
        this._number(data.amount),
        this._number(data.fee),
        data.status || 'pending',
        data.tx_type || 'transfer',
        data.block_number || null,
        data.ledger_sequence || null,
        data.confirmation_time_ms || null,
        risk.risk_score,
        risk.risk_level,
        this._stringify({ ...(data.metadata || {}), risk_signals: risk.signals }),
        data.monitored_at || null,
        data.created_at || now,
        now
      ]
    );
    return this.getTransaction(data.tx_hash, data.network);
  }

  async getTransactions(filters = {}) {
    await this.initializeTables();
    const where = [];
    const params = [];
    if (filters.network) {
      where.push('network = ?');
      params.push(filters.network);
    }
    if (filters.address) {
      where.push('(lower(from_address) = lower(?) OR lower(to_address) = lower(?))');
      params.push(filters.address, filters.address);
    }
    if (filters.contract_address) {
      where.push('lower(contract_address) = lower(?)');
      params.push(filters.contract_address);
    }
    if (filters.status) {
      where.push('status = ?');
      params.push(filters.status);
    }
    if (filters.risk_level) {
      where.push('risk_level = ?');
      params.push(filters.risk_level);
    }
    if (filters.tx_type) {
      where.push('tx_type = ?');
      params.push(filters.tx_type);
    }
    if (filters.from) {
      where.push('datetime(created_at) >= datetime(?)');
      params.push(filters.from);
    }
    if (filters.to) {
      where.push('datetime(created_at) <= datetime(?)');
      params.push(filters.to);
    }
    const limit = Math.min(Math.max(parseInt(filters.limit, 10) || 100, 1), 500);
    params.push(limit);
    const rows = await this._all(
      `SELECT * FROM blockchain_transactions ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY datetime(created_at) DESC LIMIT ?`,
      params
    );
    return rows.map((row) => this._mapTransaction(row));
  }

  async getTransaction(txHash, network) {
    await this.initializeTables();
    const row = await this._get(
      'SELECT * FROM blockchain_transactions WHERE tx_hash = ? AND network = ?',
      [txHash, network]
    );
    return this._mapTransaction(row);
  }

  async _createAlert(alert) {
    const alertId = alert.alert_id || uuidv4();
    await this._run(
      `INSERT INTO blockchain_security_alerts
       (alert_id, alert_type, severity, network, tx_hash, contract_address, address, message, evidence, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        alertId,
        alert.alert_type,
        alert.severity,
        alert.network || null,
        alert.tx_hash || null,
        alert.contract_address || null,
        alert.address || null,
        alert.message,
        this._stringify(alert.evidence || {}),
        alert.status || 'active',
        alert.created_at || new Date().toISOString()
      ]
    );
    return this._mapAlert(await this._get('SELECT * FROM blockchain_security_alerts WHERE alert_id = ?', [alertId]));
  }

  async monitorTransaction(data) {
    await this.initializeTables();
    const monitoredAt = new Date().toISOString();
    const transaction = await this.recordTransaction({ ...data, monitored_at: monitoredAt });
    const alerts = [];
    if (['high', 'critical'].includes(transaction.risk_level)) {
      alerts.push(await this._createAlert({
        alert_type: 'transaction_risk',
        severity: transaction.risk_level,
        network: transaction.network,
        tx_hash: transaction.tx_hash,
        contract_address: transaction.contract_address,
        address: transaction.from_address || transaction.to_address,
        message: `High-risk blockchain transaction detected (${transaction.risk_score}/100)`,
        evidence: {
          risk_score: transaction.risk_score,
          risk_level: transaction.risk_level,
          signals: transaction.metadata.risk_signals || []
        }
      }));
    }
    return {
      transaction,
      risk_score: transaction.risk_score,
      risk_level: transaction.risk_level,
      alerts,
      monitored_at: monitoredAt
    };
  }

  _analyzeContractLocally(data) {
    const source = String(data.source_code || '');
    const abi = typeof data.abi === 'string' ? data.abi : this._stringify(data.abi) || '';
    const combined = `${source}\n${abi}`;
    const lower = combined.toLowerCase();
    const findings = [];
    const recommendations = [];
    const addFinding = (severity, category, message, evidence) => {
      findings.push({ severity, category, message, evidence });
    };

    const patterns = [
      { token: 'selfdestruct', severity: 'critical', category: 'destructive_control', message: 'Contract contains selfdestruct capability' },
      { token: 'delegatecall', severity: 'high', category: 'external_execution', message: 'Contract uses delegatecall external execution' },
      { token: 'call.value', severity: 'high', category: 'external_call', message: 'Contract uses low-level value transfer' },
      { token: '.call(', severity: 'medium', category: 'external_call', message: 'Contract uses low-level external calls' },
      { token: 'proxy', severity: 'medium', category: 'upgradeability', message: 'Proxy or upgradeable pattern detected' },
      { token: 'upgrade', severity: 'medium', category: 'upgradeability', message: 'Upgradeable control surface detected' },
      { token: 'blacklist', severity: 'medium', category: 'centralized_control', message: 'Blacklist capability detected' },
      { token: 'pause', severity: 'medium', category: 'centralized_control', message: 'Pause capability detected' }
    ];
    for (const pattern of patterns) {
      if (lower.includes(pattern.token)) addFinding(pattern.severity, pattern.category, pattern.message, pattern.token);
    }

    const adminMatches = combined.match(/onlyOwner|admin|owner\(|DEFAULT_ADMIN_ROLE|AccessControl/g) || [];
    if (adminMatches.length) {
      addFinding('medium', 'privileged_access', 'Owner/admin-only controls detected', adminMatches.slice(0, 5));
    }

    const hardcodedAddresses = combined.match(/0x[a-fA-F0-9]{40}/g) || [];
    if (hardcodedAddresses.length) {
      addFinding('medium', 'hardcoded_address', 'Hardcoded blockchain addresses detected', [...new Set(hardcodedAddresses)].slice(0, 10));
    }

    if (!/modifier\s+\w+|onlyOwner|AccessControl|require\s*\(/.test(combined) && source.trim()) {
      addFinding('high', 'access_control', 'No obvious access control or require checks detected', 'missing access-control patterns');
    }

    const healthcareTerms = /hipaa|patient|claim|insurance|health|phi|pii|gdpr/i.test(combined);
    if (!healthcareTerms) {
      addFinding('medium', 'compliance_metadata', 'Healthcare/compliance metadata is missing or incomplete', 'missing HIPAA/PHI/GDPR terms');
    }

    const piiDetected = /patientName|ssn|social security|dateOfBirth|dob|diagnosis/i.test(combined);
    if (piiDetected) {
      addFinding('high', 'privacy', 'Potential direct PII/PHI field references detected on-chain', 'PII/PHI keywords');
    }

    const severityWeights = { low: 5, medium: 12, high: 22, critical: 35 };
    const penalty = findings.reduce((sum, finding) => sum + (severityWeights[finding.severity] || 0), 0);
    const securityScore = Math.max(0, Math.min(100, 100 - penalty));
    const riskLevel = this._riskLevel(100 - securityScore);

    if (findings.some((finding) => finding.category === 'external_execution')) recommendations.push('Review delegatecall targets and restrict upgrade authority with multisig controls.');
    if (findings.some((finding) => finding.category === 'destructive_control')) recommendations.push('Remove selfdestruct or place it behind audited emergency governance.');
    if (findings.some((finding) => finding.category === 'privacy')) recommendations.push('Avoid writing PHI/PII on-chain; store hashes or encrypted references only.');
    if (findings.some((finding) => finding.category === 'compliance_metadata')) recommendations.push('Document HIPAA/GDPR handling, data retention, and consent metadata.');
    if (findings.some((finding) => finding.category === 'privileged_access')) recommendations.push('Document privileged roles and enforce least-privilege access controls.');
    if (!recommendations.length) recommendations.push('Continue periodic security reviews and monitor contract interactions for anomalous behavior.');

    const metrics = {
      source_lines: source ? source.split('\n').length : 0,
      abi_entries: this._parse(abi, []).length || 0,
      function_count: (combined.match(/function\s+\w+|"type"\s*:\s*"function"/g) || []).length,
      external_calls: (lower.match(/\.call\(|delegatecall|staticcall|call\.value/g) || []).length,
      admin_controls: adminMatches.length,
      hardcoded_addresses: [...new Set(hardcodedAddresses)].length,
      finding_count: findings.length
    };

    const complianceFlags = {
      hipaa_metadata_present: /hipaa|phi|patient|health/i.test(combined),
      gdpr_metadata_present: /gdpr|consent|right to erasure|retention/i.test(combined),
      kyc_aml_considerations: /kyc|aml|sanction|blacklist/i.test(combined),
      pii_detected: piiDetected,
      audit_recommended: findings.some((finding) => ['high', 'critical'].includes(finding.severity))
    };

    return { securityScore, riskLevel, findings, metrics, complianceFlags, recommendations };
  }

  async analyzeSmartContract(data) {
    await this.initializeTables();
    if (!data || !data.network || !data.contract_address) {
      throw new Error('network and contract_address are required');
    }
    const analysis = this._analyzeContractLocally(data);
    const analysisId = uuidv4();
    await this._run(
      `INSERT INTO blockchain_contract_analyses
       (analysis_id, network, contract_address, contract_name, security_score, risk_level, findings, metrics, compliance_flags, recommendations, metadata, analyzed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        analysisId,
        data.network,
        data.contract_address,
        data.contract_name || null,
        analysis.securityScore,
        analysis.riskLevel,
        this._stringify(analysis.findings),
        this._stringify(analysis.metrics),
        this._stringify(analysis.complianceFlags),
        this._stringify(analysis.recommendations),
        this._stringify(data.metadata || {}),
        new Date().toISOString()
      ]
    );
    return this.getContractAnalysis(analysisId);
  }

  async getContractAnalysis(analysisId) {
    await this.initializeTables();
    const row = await this._get('SELECT * FROM blockchain_contract_analyses WHERE analysis_id = ?', [analysisId]);
    return this._mapAnalysis(row);
  }

  async getContractAnalyses(filters = {}) {
    await this.initializeTables();
    const where = [];
    const params = [];
    if (filters.network) {
      where.push('network = ?');
      params.push(filters.network);
    }
    if (filters.contract_address) {
      where.push('lower(contract_address) = lower(?)');
      params.push(filters.contract_address);
    }
    if (filters.risk_level) {
      where.push('risk_level = ?');
      params.push(filters.risk_level);
    }
    const limit = Math.min(Math.max(parseInt(filters.limit, 10) || 100, 1), 500);
    params.push(limit);
    const rows = await this._all(
      `SELECT * FROM blockchain_contract_analyses ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY datetime(analyzed_at) DESC LIMIT ?`,
      params
    );
    return rows.map((row) => this._mapAnalysis(row));
  }

  async generateComplianceReport(options = {}) {
    await this.initializeTables();
    const { start, end } = this._period(options);
    const reportType = options.report_type || 'compliance_summary';
    const framework = options.framework || 'HIPAA/GDPR/AML/KYC/SOX/PCI';
    const txRows = await this._all(
      `SELECT * FROM blockchain_transactions WHERE datetime(created_at) BETWEEN datetime(?) AND datetime(?)`,
      [start, end]
    );
    const contractRows = await this._all(
      `SELECT * FROM blockchain_contract_analyses WHERE datetime(analyzed_at) BETWEEN datetime(?) AND datetime(?)`,
      [start, end]
    );
    const alertRows = await this._all(
      `SELECT * FROM blockchain_security_alerts WHERE datetime(created_at) BETWEEN datetime(?) AND datetime(?)`,
      [start, end]
    );

    const countBy = (rows, key) => rows.reduce((acc, row) => {
      const value = row[key] || 'unknown';
      acc[value] = (acc[value] || 0) + 1;
      return acc;
    }, {});
    const highRiskTx = txRows.filter((row) => ['high', 'critical'].includes(row.risk_level));
    const riskyContracts = contractRows.filter((row) => ['high', 'critical'].includes(row.risk_level));
    const parsedContracts = contractRows.map((row) => this._mapAnalysis(row));
    const privacyFindings = parsedContracts.flatMap((row) => row.findings.filter((finding) => ['privacy', 'compliance_metadata'].includes(finding.category)));

    const summary = {
      total_transactions: txRows.length,
      total_contract_analyses: contractRows.length,
      total_alerts: alertRows.length,
      high_risk_transactions: highRiskTx.length,
      risky_contracts: riskyContracts.length,
      transaction_risk_distribution: countBy(txRows, 'risk_level'),
      smart_contract_risk_distribution: countBy(contractRows, 'risk_level'),
      network_distribution: countBy(txRows, 'network'),
      compliance_framework: framework
    };

    const findings = [
      ...highRiskTx.map((tx) => ({ type: 'transaction_risk', severity: tx.risk_level, tx_hash: tx.tx_hash, network: tx.network, message: `Transaction risk score ${tx.risk_score}` })),
      ...riskyContracts.map((contract) => ({ type: 'contract_risk', severity: contract.risk_level, contract_address: contract.contract_address, network: contract.network, message: `Contract security score ${contract.security_score}` })),
      ...privacyFindings.map((finding) => ({ type: 'privacy_or_compliance', severity: finding.severity, category: finding.category, message: finding.message }))
    ];

    const recommendations = [
      highRiskTx.length ? 'Review and disposition all high/critical-risk transactions before claim settlement.' : 'Maintain current transaction monitoring thresholds.',
      riskyContracts.length ? 'Prioritize remediation or compensating controls for risky smart contracts.' : 'Continue scheduled smart contract analysis.',
      privacyFindings.length ? 'Verify PHI/PII is not stored directly on-chain and update HIPAA/GDPR evidence.' : 'Retain compliance evidence for audited blockchain workflows.',
      alertRows.length ? 'Resolve active security alerts and document investigation outcomes.' : 'No security alerts were generated during this period.'
    ];

    const reportId = uuidv4();
    await this._run(
      `INSERT INTO blockchain_compliance_reports
       (report_id, report_type, framework, period_start, period_end, summary, findings, recommendations, generated_by, generated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [reportId, reportType, framework, start, end, this._stringify(summary), this._stringify(findings), this._stringify(recommendations), options.generated_by || null, new Date().toISOString()]
    );
    return this.getComplianceReport(reportId);
  }

  async getComplianceReports(filters = {}) {
    await this.initializeTables();
    const where = [];
    const params = [];
    if (filters.report_type) {
      where.push('report_type = ?');
      params.push(filters.report_type);
    }
    if (filters.framework) {
      where.push('framework LIKE ?');
      params.push(`%${filters.framework}%`);
    }
    if (filters.from) {
      where.push('datetime(generated_at) >= datetime(?)');
      params.push(filters.from);
    }
    if (filters.to) {
      where.push('datetime(generated_at) <= datetime(?)');
      params.push(filters.to);
    }
    const limit = Math.min(Math.max(parseInt(filters.limit, 10) || 100, 1), 500);
    params.push(limit);
    const rows = await this._all(
      `SELECT * FROM blockchain_compliance_reports ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY datetime(generated_at) DESC LIMIT ?`,
      params
    );
    return rows.map((row) => this._mapReport(row));
  }

  async getComplianceReport(reportId) {
    await this.initializeTables();
    const row = await this._get('SELECT * FROM blockchain_compliance_reports WHERE report_id = ?', [reportId]);
    return this._mapReport(row);
  }

  async getPerformanceMetrics(options = {}) {
    await this.initializeTables();
    const { start, end } = this._period(options);
    const txRows = await this._all(
      `SELECT * FROM blockchain_transactions WHERE datetime(created_at) BETWEEN datetime(?) AND datetime(?)`,
      [start, end]
    );
    const total = txRows.length;
    const succeeded = txRows.filter((row) => ['confirmed', 'success'].includes(row.status)).length;
    const failed = txRows.filter((row) => ['failed', 'reverted', 'dropped'].includes(row.status)).length;
    const pending = txRows.filter((row) => row.status === 'pending').length;
    const fees = txRows.map((row) => this._number(row.fee)).filter((fee) => fee >= 0);
    const confirmations = txRows.map((row) => this._number(row.confirmation_time_ms, NaN)).filter(Number.isFinite);
    const days = Math.max(1, (new Date(end) - new Date(start)) / 86400000);
    const countBy = (rows, key) => rows.reduce((acc, row) => {
      const value = row[key] || 'unknown';
      acc[value] = (acc[value] || 0) + 1;
      return acc;
    }, {});
    const latencyBuckets = { under_1s: 0, one_to_5s: 0, five_to_30s: 0, over_30s: 0, unknown: 0 };
    for (const row of txRows) {
      const ms = this._number(row.confirmation_time_ms, NaN);
      if (!Number.isFinite(ms) || ms <= 0) latencyBuckets.unknown += 1;
      else if (ms < 1000) latencyBuckets.under_1s += 1;
      else if (ms < 5000) latencyBuckets.one_to_5s += 1;
      else if (ms < 30000) latencyBuckets.five_to_30s += 1;
      else latencyBuckets.over_30s += 1;
    }
    const avg = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

    return {
      period_start: start,
      period_end: end,
      transaction_count: total,
      throughput_per_day: Number((total / days).toFixed(4)),
      success_rate: total ? Number((succeeded / total).toFixed(4)) : 0,
      failure_rate: total ? Number((failed / total).toFixed(4)) : 0,
      pending_rate: total ? Number((pending / total).toFixed(4)) : 0,
      average_fee: Number(avg(fees).toFixed(8)),
      average_confirmation_time_ms: Number(avg(confirmations).toFixed(2)),
      latency_buckets: latencyBuckets,
      per_network_counts: countBy(txRows, 'network'),
      per_status_counts: countBy(txRows, 'status'),
      block_or_ledger_coverage: {
        with_block_number: txRows.filter((row) => row.block_number !== null && row.block_number !== undefined).length,
        with_ledger_sequence: txRows.filter((row) => row.ledger_sequence !== null && row.ledger_sequence !== undefined).length
      }
    };
  }

  async getSecurityMonitoring(options = {}) {
    await this.initializeTables();
    const { start, end } = this._period(options);
    const alerts = (await this._all(
      `SELECT * FROM blockchain_security_alerts WHERE status = 'active' ORDER BY datetime(created_at) DESC LIMIT ?`,
      [Math.min(Math.max(parseInt(options.limit, 10) || 100, 1), 500)]
    )).map((row) => this._mapAlert(row));
    const riskRows = await this._all(
      `SELECT risk_level, COUNT(*) as count FROM blockchain_transactions
       WHERE datetime(created_at) BETWEEN datetime(?) AND datetime(?) GROUP BY risk_level`,
      [start, end]
    );
    const highRiskTransactions = await this.getTransactions({ risk_level: 'high', from: start, to: end, limit: options.limit || 50 });
    const criticalRiskTransactions = await this.getTransactions({ risk_level: 'critical', from: start, to: end, limit: options.limit || 50 });
    const riskyContracts = await this.getContractAnalyses({ risk_level: 'high', limit: options.limit || 50 });
    const criticalContracts = await this.getContractAnalyses({ risk_level: 'critical', limit: options.limit || 50 });
    const suspiciousAddresses = await this._all('SELECT * FROM blockchain_suspicious_addresses ORDER BY datetime(created_at) DESC LIMIT ?', [50]);
    const riskDistribution = riskRows.reduce((acc, row) => {
      acc[row.risk_level || 'unknown'] = row.count;
      return acc;
    }, { low: 0, medium: 0, high: 0, critical: 0 });

    return {
      period_start: start,
      period_end: end,
      active_alerts: alerts,
      risk_distribution: riskDistribution,
      suspicious_addresses: suspiciousAddresses.map((row) => ({ ...row, metadata: this._parse(row.metadata, {}) })),
      high_risk_transactions: [...criticalRiskTransactions, ...highRiskTransactions],
      risky_contracts: [...criticalContracts, ...riskyContracts],
      recommendations: [
        alerts.length ? 'Investigate active alerts and update their status after disposition.' : 'No active alerts require immediate action.',
        criticalRiskTransactions.length ? 'Escalate critical blockchain transactions to compliance and security owners.' : 'Continue monitoring transaction risk signals.',
        criticalContracts.length ? 'Pause integrations with critical-risk contracts until remediation is complete.' : 'Maintain recurring smart contract scans.'
      ]
    };
  }

  async getVisualizationData(options = {}) {
    await this.initializeTables();
    const dataSource = options.dataSource || options.data_source;
    const { start, end } = this._period(options);
    const makeChart = (labels, values, raw = [], series = []) => ({ data_source: dataSource, period_start: start, period_end: end, labels, values, series, raw });

    if (dataSource === 'transactions_over_time') {
      const rows = await this._all(
        `SELECT date(created_at) as label, COUNT(*) as value FROM blockchain_transactions
         WHERE datetime(created_at) BETWEEN datetime(?) AND datetime(?) GROUP BY date(created_at) ORDER BY label`,
        [start, end]
      );
      return makeChart(rows.map((row) => row.label), rows.map((row) => row.value), rows);
    }
    if (dataSource === 'risk_distribution') {
      const rows = await this._all(
        `SELECT risk_level as label, COUNT(*) as value FROM blockchain_transactions
         WHERE datetime(created_at) BETWEEN datetime(?) AND datetime(?) GROUP BY risk_level ORDER BY value DESC`,
        [start, end]
      );
      return makeChart(rows.map((row) => row.label || 'unknown'), rows.map((row) => row.value), rows);
    }
    if (dataSource === 'network_activity') {
      const rows = await this._all(
        `SELECT network as label, COUNT(*) as value FROM blockchain_transactions
         WHERE datetime(created_at) BETWEEN datetime(?) AND datetime(?) GROUP BY network ORDER BY value DESC`,
        [start, end]
      );
      return makeChart(rows.map((row) => row.label), rows.map((row) => row.value), rows);
    }
    if (dataSource === 'contract_scores') {
      const rows = await this._all(
        `SELECT contract_address as label, security_score as value, network, risk_level FROM blockchain_contract_analyses
         WHERE datetime(analyzed_at) BETWEEN datetime(?) AND datetime(?) ORDER BY datetime(analyzed_at) DESC LIMIT 50`,
        [start, end]
      );
      return makeChart(rows.map((row) => row.label), rows.map((row) => row.value), rows);
    }
    if (dataSource === 'compliance_status') {
      const latest = await this._get('SELECT * FROM blockchain_compliance_reports ORDER BY datetime(generated_at) DESC LIMIT 1');
      const report = this._mapReport(latest);
      const summary = report ? report.summary : {};
      const labels = ['transactions', 'contract_analyses', 'alerts', 'findings'];
      const values = [summary.total_transactions || 0, summary.total_contract_analyses || 0, summary.total_alerts || 0, report ? report.findings.length : 0];
      return makeChart(labels, values, report ? [report] : []);
    }
    if (dataSource === 'dashboard_summary') {
      return this.getDashboardSummary(options);
    }
    throw new Error('Invalid data source');
  }

  async getDashboardSummary(options = {}) {
    const { start, end } = this._period(options);
    const performance = await this.getPerformanceMetrics(options);
    const security = await this.getSecurityMonitoring({ ...options, limit: 25 });
    const latestReports = await this.getComplianceReports({ limit: 5 });
    const latestAnalyses = await this.getContractAnalyses({ limit: 5 });
    return {
      data_source: 'dashboard_summary',
      period_start: start,
      period_end: end,
      summary: {
        transaction_count: performance.transaction_count,
        success_rate: performance.success_rate,
        failure_rate: performance.failure_rate,
        average_fee: performance.average_fee,
        active_alert_count: security.active_alerts.length,
        high_risk_transaction_count: security.high_risk_transactions.length,
        risky_contract_count: security.risky_contracts.length
      },
      performance,
      security: {
        risk_distribution: security.risk_distribution,
        active_alerts: security.active_alerts.slice(0, 10),
        recommendations: security.recommendations
      },
      latest_reports: latestReports,
      latest_contract_analyses: latestAnalyses
    };
  }

  _documentationContent(format = 'json') {
    const endpoints = [
      { method: 'POST', path: '/api/blockchain-analytics/transactions/monitor', description: 'Ingest and risk-monitor a blockchain transaction.' },
      { method: 'POST', path: '/api/blockchain-analytics/transactions', description: 'Record a transaction without forcing alert workflow.' },
      { method: 'GET', path: '/api/blockchain-analytics/transactions', description: 'List transactions with filters.' },
      { method: 'GET', path: '/api/blockchain-analytics/transactions/:network/:txHash', description: 'Retrieve one transaction.' },
      { method: 'POST', path: '/api/blockchain-analytics/contracts/analyze', description: 'Analyze smart contract source/ABI for deterministic red flags.' },
      { method: 'GET', path: '/api/blockchain-analytics/contracts/analyses', description: 'List contract analyses.' },
      { method: 'GET', path: '/api/blockchain-analytics/contracts/analyses/:analysisId', description: 'Retrieve one contract analysis.' },
      { method: 'POST', path: '/api/blockchain-analytics/compliance/reports', description: 'Generate a persisted compliance report.' },
      { method: 'GET', path: '/api/blockchain-analytics/metrics/performance', description: 'Return throughput, success/failure, fee, latency, and network metrics.' },
      { method: 'GET', path: '/api/blockchain-analytics/security/monitoring', description: 'Return alerts, suspicious addresses, risky transactions/contracts.' },
      { method: 'GET', path: '/api/blockchain-analytics/visualization/:dataSource', description: 'Return chart-ready visualization data.' },
      { method: 'POST', path: '/api/blockchain-analytics/documentation/generate', description: 'Generate and persist API documentation metadata.' }
    ];
    const models = {
      transaction: ['network', 'tx_hash', 'from_address', 'to_address', 'contract_address', 'asset_code', 'amount', 'fee', 'status', 'tx_type', 'block_number', 'ledger_sequence', 'risk_score', 'risk_level', 'metadata'],
      contract_analysis: ['analysis_id', 'network', 'contract_address', 'security_score', 'risk_level', 'findings', 'metrics', 'compliance_flags', 'recommendations'],
      compliance_report: ['report_id', 'report_type', 'framework', 'period_start', 'period_end', 'summary', 'findings', 'recommendations'],
      security_alert: ['alert_id', 'alert_type', 'severity', 'network', 'tx_hash', 'contract_address', 'message', 'evidence', 'status']
    };
    const examples = {
      monitor_request: { network: 'stellar', tx_hash: 'abc123', from_address: 'G...', to_address: 'G...', amount: 1250, fee: 0.00001, status: 'confirmed', tx_type: 'claim_payment' },
      monitor_response: { risk_score: 10, risk_level: 'low', alerts: [] },
      visualization_sources: ['transactions_over_time', 'risk_distribution', 'network_activity', 'contract_scores', 'compliance_status', 'dashboard_summary']
    };
    const content = {
      title: 'Blockchain Analytics API',
      generated_at: new Date().toISOString(),
      authentication: 'All endpoints are mounted behind authenticateToken at /api/blockchain-analytics.',
      endpoints,
      data_models: models,
      request_response_examples: examples,
      compliance_notes: ['HIPAA/GDPR/AML/KYC/SOX/PCI reporting is deterministic and based on locally persisted transactions, contract analyses, and alerts.', 'Do not store PHI/PII directly on-chain; use hashes, encrypted references, and off-chain consent records.'],
      risk_scoring: ['failed/reverted status', 'large amount', 'missing recipient', 'known suspicious addresses', 'contract interaction', 'high fee', 'repeated transaction volume', 'risky contract findings']
    };
    if (format === 'markdown') {
      return `# Blockchain Analytics API\n\nGenerated: ${content.generated_at}\n\n## Endpoints\n${endpoints.map((endpoint) => `- ${endpoint.method} ${endpoint.path}: ${endpoint.description}`).join('\n')}\n\n## Risk Scoring\n${content.risk_scoring.map((item) => `- ${item}`).join('\n')}\n`;
    }
    if (format === 'openapi') {
      return { openapi: '3.0.0', info: { title: content.title, version: '1.0.0' }, paths: endpoints.reduce((acc, endpoint) => { acc[endpoint.path] = { [endpoint.method.toLowerCase()]: { summary: endpoint.description, responses: { 200: { description: 'OK' } } } }; return acc; }, {}) };
    }
    return content;
  }

  async generateDocumentation(options = {}) {
    await this.initializeTables();
    const format = options.format || 'json';
    const content = this._documentationContent(format);
    const docId = uuidv4();
    await this._run(
      `INSERT INTO blockchain_documentation (doc_id, doc_type, format, content, generated_at, generated_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [docId, options.doc_type || 'api_reference', format, typeof content === 'string' ? content : this._stringify(content), new Date().toISOString(), options.generated_by || null]
    );
    const row = await this._get('SELECT * FROM blockchain_documentation WHERE doc_id = ?', [docId]);
    return { ...row, content: format === 'markdown' ? row.content : this._parse(row.content, row.content) };
  }

  async getLatestDocumentation(format) {
    await this.initializeTables();
    const params = [];
    let where = '';
    if (format) {
      where = 'WHERE format = ?';
      params.push(format);
    }
    const row = await this._get(`SELECT * FROM blockchain_documentation ${where} ORDER BY datetime(generated_at) DESC LIMIT 1`, params);
    if (!row) return null;
    return { ...row, content: row.format === 'markdown' ? row.content : this._parse(row.content, row.content) };
  }
}

module.exports = new BlockchainAnalyticsService();
