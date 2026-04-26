const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const TEST_DB_PATH = path.join(__dirname, '../test_reporting.db');
process.env.DB_PATH = TEST_DB_PATH;

const reportingService = require('../services/advancedReportingService');

function createTables() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(TEST_DB_PATH);
    db.serialize(() => {
      db.run(`CREATE TABLE IF NOT EXISTS report_definitions (
        report_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        report_type TEXT NOT NULL,
        data_sources TEXT NOT NULL DEFAULT '[]',
        columns TEXT NOT NULL DEFAULT '[]',
        filters TEXT NOT NULL DEFAULT '{}',
        grouping TEXT DEFAULT '[]',
        sorting TEXT DEFAULT '[]',
        visualization TEXT DEFAULT '{}',
        created_by TEXT NOT NULL,
        is_public INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS report_schedules (
        schedule_id TEXT PRIMARY KEY,
        report_id TEXT NOT NULL,
        cron_expression TEXT NOT NULL,
        timezone TEXT DEFAULT 'UTC',
        output_format TEXT NOT NULL DEFAULT 'json',
        distribution TEXT NOT NULL DEFAULT '[]',
        is_active INTEGER DEFAULT 1,
        last_run_at DATETIME,
        next_run_at DATETIME,
        created_by TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS report_executions (
        execution_id TEXT PRIMARY KEY,
        report_id TEXT NOT NULL,
        schedule_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        output_format TEXT NOT NULL DEFAULT 'json',
        result_data TEXT,
        row_count INTEGER DEFAULT 0,
        execution_time_ms INTEGER,
        error_message TEXT,
        executed_by TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME
      )`);

      // Seed a minimal insurance_claims table for report execution tests
      db.run(`CREATE TABLE IF NOT EXISTS insurance_claims (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER,
        claim_number TEXT,
        status TEXT,
        service_date DATE,
        provider_name TEXT,
        total_amount DECIMAL(10,2),
        insurance_amount DECIMAL(10,2),
        patient_responsibility DECIMAL(10,2),
        submission_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      db.run(`INSERT INTO insurance_claims (patient_id, claim_number, status, service_date, provider_name, total_amount, insurance_amount, patient_responsibility)
              VALUES (1, 'CLM001', 'approved', date('now', '-10 days'), 'Dr. Smith', 500.00, 400.00, 100.00)`);
      db.run(`INSERT INTO insurance_claims (patient_id, claim_number, status, service_date, provider_name, total_amount, insurance_amount, patient_responsibility)
              VALUES (1, 'CLM002', 'denied', date('now', '-5 days'), 'Dr. Jones', 300.00, 0, 300.00)`, (err) => {
        db.close();
        if (err) reject(err); else resolve();
      });
    });
  });
}

describe('AdvancedReportingService', () => {
  let reportId;
  let scheduleId;

  beforeAll(async () => {
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
    await createTables();
  });

  afterAll(() => {
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  });

  // ── Report Definitions ────────────────────────────────────────────────────

  describe('createReport()', () => {
    it('should create a claims report definition', async () => {
      const report = await reportingService.createReport({
        name: 'Monthly Claims Summary',
        description: 'Claims overview for the current month',
        report_type: 'claims',
        columns: ['claim_number', 'status', 'total_amount', 'service_date'],
        filters: { status: 'approved' },
        sorting: [{ column: 'total_amount', direction: 'DESC' }],
        created_by: 'user-1',
      });
      reportId = report.report_id;
      expect(report.name).toBe('Monthly Claims Summary');
      expect(report.report_type).toBe('claims');
      expect(report.columns).toEqual(['claim_number', 'status', 'total_amount', 'service_date']);
      expect(report.created_by).toBe('user-1');
    });
  });

  describe('getReport()', () => {
    it('should retrieve the created report', async () => {
      const report = await reportingService.getReport(reportId);
      expect(report.report_id).toBe(reportId);
      expect(report.name).toBe('Monthly Claims Summary');
    });

    it('should throw for non-existent report', async () => {
      await expect(reportingService.getReport('00000000-0000-0000-0000-000000000000'))
        .rejects.toThrow('Report not found');
    });
  });

  describe('listReports()', () => {
    it('should list all reports', async () => {
      const reports = await reportingService.listReports();
      expect(reports.length).toBeGreaterThanOrEqual(1);
    });

    it('should filter by report_type', async () => {
      const reports = await reportingService.listReports({ report_type: 'claims' });
      reports.forEach(r => expect(r.report_type).toBe('claims'));
    });
  });

  describe('updateReport()', () => {
    it('should update report name', async () => {
      const updated = await reportingService.updateReport(reportId, { name: 'Updated Claims Report' });
      expect(updated.name).toBe('Updated Claims Report');
    });

    it('should throw for non-existent report', async () => {
      await expect(reportingService.updateReport('00000000-0000-0000-0000-000000000000', { name: 'x' }))
        .rejects.toThrow('Report not found');
    });
  });

  // ── Report Execution ──────────────────────────────────────────────────────

  describe('executeReport()', () => {
    it('should execute a claims report and return results', async () => {
      // Remove the status filter so we get all claims
      await reportingService.updateReport(reportId, { filters: {} });
      const result = await reportingService.executeReport(reportId, 'user-1', 'json');
      expect(result.status).toBe('completed');
      expect(result.row_count).toBeGreaterThanOrEqual(1);
      expect(result.execution_time_ms).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(result.data)).toBe(true);
    });

    it('should export as CSV', async () => {
      const result = await reportingService.executeReport(reportId, 'user-1', 'csv');
      expect(result.status).toBe('completed');
      expect(typeof result.data).toBe('string');
      expect(result.data).toContain('claim_number');
    });
  });

  describe('getExecution()', () => {
    it('should retrieve an execution', async () => {
      const result = await reportingService.executeReport(reportId, 'user-1');
      const execution = await reportingService.getExecution(result.execution_id);
      expect(execution.execution_id).toBe(result.execution_id);
      expect(execution.status).toBe('completed');
    });
  });

  describe('listExecutions()', () => {
    it('should list executions for a report', async () => {
      const executions = await reportingService.listExecutions(reportId);
      expect(executions.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Scheduling ────────────────────────────────────────────────────────────

  describe('createSchedule()', () => {
    it('should create a daily schedule', async () => {
      const schedule = await reportingService.createSchedule({
        report_id: reportId,
        cron_expression: '@daily',
        output_format: 'json',
        distribution: [{ type: 'email', to: 'admin@example.com' }],
        created_by: 'user-1',
      });
      scheduleId = schedule.schedule_id;
      expect(schedule.cron_expression).toBe('@daily');
      expect(schedule.is_active).toBe(true);
      expect(schedule.next_run_at).toBeDefined();
      expect(schedule.distribution).toEqual([{ type: 'email', to: 'admin@example.com' }]);
    });
  });

  describe('listSchedules()', () => {
    it('should list all schedules', async () => {
      const schedules = await reportingService.listSchedules();
      expect(schedules.length).toBeGreaterThanOrEqual(1);
    });

    it('should filter by report_id', async () => {
      const schedules = await reportingService.listSchedules({ report_id: reportId });
      schedules.forEach(s => expect(s.report_id).toBe(reportId));
    });
  });

  describe('updateSchedule()', () => {
    it('should deactivate a schedule', async () => {
      const updated = await reportingService.updateSchedule(scheduleId, { is_active: false });
      expect(updated.is_active).toBe(false);
    });
  });

  describe('deleteSchedule()', () => {
    it('should delete a schedule', async () => {
      await reportingService.deleteSchedule(scheduleId);
      await expect(reportingService.getSchedule(scheduleId))
        .rejects.toThrow('Schedule not found');
    });
  });

  // ── Delete Report ─────────────────────────────────────────────────────────

  describe('deleteReport()', () => {
    it('should delete a report', async () => {
      await reportingService.deleteReport(reportId);
      await expect(reportingService.getReport(reportId))
        .rejects.toThrow('Report not found');
    });
  });
});
