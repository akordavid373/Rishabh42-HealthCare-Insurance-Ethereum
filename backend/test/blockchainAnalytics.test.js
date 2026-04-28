const path = require('path');
const fs = require('fs');

const TEST_DB_PATH = path.join(__dirname, '../test_blockchain_analytics.db');
process.env.DB_PATH = TEST_DB_PATH;
if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);

const blockchainAnalyticsService = require('../services/blockchainAnalyticsService');

describe('BlockchainAnalyticsService', () => {
  let highRiskTx;
  let lowRiskTx;
  let analysis;
  let report;
  let documentation;

  beforeAll(async () => {
    await blockchainAnalyticsService.initializeTables();
  });

  afterAll((done) => {
    blockchainAnalyticsService.db.close(() => {
      if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
      done();
    });
  });

  it('records and monitors transactions with deterministic risk and alerts', async () => {
    lowRiskTx = await blockchainAnalyticsService.recordTransaction({
      network: 'stellar',
      tx_hash: 'stellar-low-001',
      from_address: 'GLOWFROM',
      to_address: 'GLOWTO',
      amount: 25,
      fee: 0.00001,
      status: 'confirmed',
      tx_type: 'claim_payment',
      ledger_sequence: 12345,
      confirmation_time_ms: 900,
      metadata: { claim_id: 'CLM-1' }
    });

    const monitored = await blockchainAnalyticsService.monitorTransaction({
      network: 'ethereum',
      tx_hash: 'eth-high-001',
      from_address: '0x1111111111111111111111111111111111111111',
      to_address: 'unknown',
      contract_address: '0x2222222222222222222222222222222222222222',
      amount: 250000,
      fee: 125,
      status: 'reverted',
      tx_type: 'contract_call',
      block_number: 999,
      confirmation_time_ms: 45000,
      metadata: { workflow: 'policy_settlement' }
    });

    highRiskTx = monitored.transaction;
    expect(lowRiskTx.risk_level).toBe('low');
    expect(highRiskTx.risk_score).toBeGreaterThanOrEqual(85);
    expect(highRiskTx.risk_level).toBe('critical');
    expect(monitored.alerts).toHaveLength(1);
    expect(monitored.alerts[0].severity).toBe('critical');
  });

  it('filters and retrieves transactions', async () => {
    const ethereumTransactions = await blockchainAnalyticsService.getTransactions({ network: 'ethereum' });
    const criticalTransactions = await blockchainAnalyticsService.getTransactions({ risk_level: 'critical' });
    const byAddress = await blockchainAnalyticsService.getTransactions({ address: 'GLOWFROM' });
    const retrieved = await blockchainAnalyticsService.getTransaction('eth-high-001', 'ethereum');

    expect(ethereumTransactions.map((tx) => tx.tx_hash)).toContain(highRiskTx.tx_hash);
    expect(criticalTransactions.map((tx) => tx.tx_hash)).toContain(highRiskTx.tx_hash);
    expect(byAddress.map((tx) => tx.tx_hash)).toContain(lowRiskTx.tx_hash);
    expect(retrieved.tx_hash).toBe(highRiskTx.tx_hash);
    expect(retrieved.metadata.risk_signals.length).toBeGreaterThan(0);
  });

  it('analyzes smart contracts and produces findings and recommendations', async () => {
    analysis = await blockchainAnalyticsService.analyzeSmartContract({
      network: 'soroban',
      contract_address: 'CASOROBANRISKY',
      contract_name: 'UpgradeableClaimsEscrow',
      source_code: `
        contract UpgradeableClaimsEscrow {
          address public owner = 0x3333333333333333333333333333333333333333;
          function upgrade(address impl) public onlyOwner {}
          function emergencyDestroy() public onlyOwner { selfdestruct(payable(owner)); }
          function pay(address target) public { target.call(""); }
          string patientName;
        }
      `,
      abi: [{ type: 'function', name: 'upgrade' }],
      metadata: { system: 'claims' }
    });

    expect(analysis.contract_address).toBe('CASOROBANRISKY');
    expect(analysis.security_score).toBeLessThan(80);
    expect(['high', 'critical']).toContain(analysis.risk_level);
    expect(analysis.findings.length).toBeGreaterThan(0);
    expect(analysis.metrics.function_count).toBeGreaterThan(0);
    expect(analysis.compliance_flags.pii_detected).toBe(true);
    expect(analysis.recommendations.length).toBeGreaterThan(0);

    const retrieved = await blockchainAnalyticsService.getContractAnalysis(analysis.analysis_id);
    const analyses = await blockchainAnalyticsService.getContractAnalyses({ network: 'soroban' });
    expect(retrieved.analysis_id).toBe(analysis.analysis_id);
    expect(analyses.map((item) => item.analysis_id)).toContain(analysis.analysis_id);
  });

  it('generates and retrieves compliance reports', async () => {
    report = await blockchainAnalyticsService.generateComplianceReport({
      report_type: 'monthly_blockchain_compliance',
      framework: 'HIPAA/GDPR/AML/KYC/SOX/PCI',
      generated_by: 'jest'
    });

    expect(report.report_id).toBeTruthy();
    expect(report.summary.total_transactions).toBeGreaterThanOrEqual(2);
    expect(report.summary.high_risk_transactions).toBeGreaterThanOrEqual(1);
    expect(report.findings.length).toBeGreaterThanOrEqual(1);
    expect(report.recommendations.length).toBeGreaterThanOrEqual(1);

    const retrieved = await blockchainAnalyticsService.getComplianceReport(report.report_id);
    const reports = await blockchainAnalyticsService.getComplianceReports({ report_type: 'monthly_blockchain_compliance' });
    expect(retrieved.report_id).toBe(report.report_id);
    expect(reports.map((item) => item.report_id)).toContain(report.report_id);
  });

  it('returns performance metrics', async () => {
    const metrics = await blockchainAnalyticsService.getPerformanceMetrics();

    expect(metrics.transaction_count).toBeGreaterThanOrEqual(2);
    expect(metrics.throughput_per_day).toBeGreaterThan(0);
    expect(metrics.failure_rate).toBeGreaterThan(0);
    expect(metrics.average_fee).toBeGreaterThan(0);
    expect(metrics.per_network_counts.stellar).toBeGreaterThanOrEqual(1);
    expect(metrics.per_network_counts.ethereum).toBeGreaterThanOrEqual(1);
    expect(metrics.latency_buckets.over_30s).toBeGreaterThanOrEqual(1);
  });

  it('returns security monitoring data with high-risk alerts', async () => {
    const monitoring = await blockchainAnalyticsService.getSecurityMonitoring();

    expect(monitoring.active_alerts.length).toBeGreaterThanOrEqual(1);
    expect(monitoring.active_alerts[0].alert_type).toBe('transaction_risk');
    expect(monitoring.high_risk_transactions.map((tx) => tx.tx_hash)).toContain(highRiskTx.tx_hash);
    expect(monitoring.risky_contracts.map((contract) => contract.analysis_id)).toContain(analysis.analysis_id);
    expect(monitoring.recommendations.length).toBeGreaterThan(0);
  });

  it('returns chart-ready visualization data and dashboard summary', async () => {
    const overTime = await blockchainAnalyticsService.getVisualizationData({ dataSource: 'transactions_over_time' });
    const riskDistribution = await blockchainAnalyticsService.getVisualizationData({ dataSource: 'risk_distribution' });
    const dashboard = await blockchainAnalyticsService.getDashboardSummary();

    expect(overTime.labels.length).toBeGreaterThanOrEqual(1);
    expect(overTime.values.reduce((sum, value) => sum + value, 0)).toBeGreaterThanOrEqual(2);
    expect(riskDistribution.labels).toContain('critical');
    expect(dashboard.data_source).toBe('dashboard_summary');
    expect(dashboard.summary.transaction_count).toBeGreaterThanOrEqual(2);
  });

  it('generates API documentation records', async () => {
    documentation = await blockchainAnalyticsService.generateDocumentation({ format: 'json', generated_by: 'jest' });
    const latest = await blockchainAnalyticsService.getLatestDocumentation('json');

    expect(documentation.doc_id).toBeTruthy();
    expect(documentation.content.endpoints.length).toBeGreaterThan(5);
    expect(documentation.content.data_models.transaction).toContain('tx_hash');
    expect(latest.doc_id).toBe(documentation.doc_id);
  });
});
