const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../database/healthcare.db');

const REPORT_TYPES = ['claims', 'payments', 'patients', 'health_metrics', 'premium', 'custom'];

// Maps report_type to the base SQL table and default columns.
const DATA_SOURCE_MAP = {
  claims: {
    table: 'insurance_claims',
    defaultColumns: ['id', 'patient_id', 'claim_number', 'status', 'total_amount', 'insurance_amount', 'patient_responsibility', 'service_date', 'submission_date'],
  },
  payments: {
    table: 'premium_payments',
    defaultColumns: ['id', 'patient_id', 'payment_amount', 'payment_date', 'payment_method', 'payment_status', 'insurance_provider'],
  },
  patients: {
    table: 'patients p JOIN users u ON p.user_id = u.id',
    defaultColumns: ['p.id', 'u.first_name', 'u.last_name', 'u.email', 'p.insurance_provider', 'p.insurance_policy_number', 'p.created_at'],
  },
  health_metrics: {
    table: 'health_metrics',
    defaultColumns: ['id', 'patient_id', 'metric_type', 'metric_value', 'metric_unit', 'normalized_score', 'recorded_date'],
  },
  premium: {
    table: 'premium_plans',
    defaultColumns: ['id', 'patient_id', 'base_premium', 'current_premium', 'coverage_type', 'effective_date', 'status'],
  },
};

class AdvancedReportingService {
  getDatabase() {
    return new sqlite3.Database(DB_PATH);
  }

  // ---------------------------------------------------------------------------
  // Report Definition CRUD
  // ---------------------------------------------------------------------------

  async createReport(data) {
    const db = this.getDatabase();
    const reportId = uuidv4();
    try {
      await this._run(db,
        `INSERT INTO report_definitions
          (report_id, name, description, report_type, data_sources, columns, filters, grouping, sorting, visualization, created_by, is_public)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [reportId, data.name, data.description || null, data.report_type,
         JSON.stringify(data.data_sources || []),
         JSON.stringify(data.columns || []),
         JSON.stringify(data.filters || {}),
         JSON.stringify(data.grouping || []),
         JSON.stringify(data.sorting || []),
         JSON.stringify(data.visualization || {}),
         data.created_by, data.is_public ? 1 : 0]
      );
      return this.getReport(reportId);
    } finally { db.close(); }
  }

  async getReport(reportId) {
    const db = this.getDatabase();
    try {
      const row = await this._get(db, 'SELECT * FROM report_definitions WHERE report_id = ?', [reportId]);
      if (!row) throw new Error('Report not found');
      return this._formatReport(row);
    } finally { db.close(); }
  }

  async listReports(filters = {}) {
    const db = this.getDatabase();
    try {
      let query = 'SELECT * FROM report_definitions WHERE 1=1';
      const params = [];
      if (filters.created_by) { query += ' AND created_by = ?'; params.push(filters.created_by); }
      if (filters.report_type) { query += ' AND report_type = ?'; params.push(filters.report_type); }
      if (filters.is_public !== undefined) { query += ' AND is_public = ?'; params.push(filters.is_public ? 1 : 0); }
      query += ' ORDER BY updated_at DESC';
      if (filters.limit) { query += ' LIMIT ?'; params.push(parseInt(filters.limit)); }
      if (filters.offset) { query += ' OFFSET ?'; params.push(parseInt(filters.offset)); }

      const rows = await this._all(db, query, params);
      return rows.map(r => this._formatReport(r));
    } finally { db.close(); }
  }

  async updateReport(reportId, data) {
    const db = this.getDatabase();
    try {
      const sets = [];
      const params = [];
      for (const key of ['name', 'description', 'report_type', 'is_public']) {
        if (data[key] !== undefined) {
          sets.push(`${key} = ?`);
          params.push(key === 'is_public' ? (data[key] ? 1 : 0) : data[key]);
        }
      }
      for (const key of ['data_sources', 'columns', 'filters', 'grouping', 'sorting', 'visualization']) {
        if (data[key] !== undefined) {
          sets.push(`${key} = ?`);
          params.push(JSON.stringify(data[key]));
        }
      }
      if (sets.length === 0) throw new Error('No fields to update');
      sets.push('updated_at = CURRENT_TIMESTAMP');
      params.push(reportId);
      const changes = await this._run(db, `UPDATE report_definitions SET ${sets.join(', ')} WHERE report_id = ?`, params);
      if (changes === 0) throw new Error('Report not found');
      return this.getReport(reportId);
    } finally { db.close(); }
  }

  async deleteReport(reportId) {
    const db = this.getDatabase();
    try {
      const changes = await this._run(db, 'DELETE FROM report_definitions WHERE report_id = ?', [reportId]);
      if (changes === 0) throw new Error('Report not found');
    } finally { db.close(); }
  }

  // ---------------------------------------------------------------------------
  // Report Execution
  // ---------------------------------------------------------------------------

  async executeReport(reportId, executedBy, outputFormat = 'json') {
    const startTime = Date.now();
    const executionId = uuidv4();
    const db = this.getDatabase();
    try {
      const report = await this.getReport(reportId);

      // Mark execution as running
      await this._run(db,
        `INSERT INTO report_executions (execution_id, report_id, status, output_format, executed_by)
         VALUES (?, ?, 'running', ?, ?)`,
        [executionId, reportId, outputFormat, executedBy]
      );

      // Build and execute the query
      const { sql, params } = this._buildQuery(report);
      const rows = await this._all(db, sql, params);

      const resultData = outputFormat === 'csv'
        ? this._toCsv(rows)
        : JSON.stringify(rows);

      const executionTimeMs = Date.now() - startTime;

      await this._run(db,
        `UPDATE report_executions
         SET status = 'completed', result_data = ?, row_count = ?,
             execution_time_ms = ?, completed_at = CURRENT_TIMESTAMP
         WHERE execution_id = ?`,
        [resultData, rows.length, executionTimeMs, executionId]
      );

      return {
        execution_id: executionId,
        report_id: reportId,
        status: 'completed',
        output_format: outputFormat,
        row_count: rows.length,
        execution_time_ms: executionTimeMs,
        data: outputFormat === 'csv' ? resultData : rows,
      };
    } catch (err) {
      // Mark execution as failed
      await this._run(db,
        `UPDATE report_executions SET status = 'failed', error_message = ?, completed_at = CURRENT_TIMESTAMP WHERE execution_id = ?`,
        [err.message, executionId]
      ).catch(() => {});
      throw err;
    } finally { db.close(); }
  }

  async getExecution(executionId) {
    const db = this.getDatabase();
    try {
      const row = await this._get(db, 'SELECT * FROM report_executions WHERE execution_id = ?', [executionId]);
      if (!row) throw new Error('Execution not found');
      return this._formatExecution(row);
    } finally { db.close(); }
  }

  async listExecutions(reportId, options = {}) {
    const db = this.getDatabase();
    const { limit = 20, offset = 0 } = options;
    try {
      const rows = await this._all(db,
        'SELECT * FROM report_executions WHERE report_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
        [reportId, parseInt(limit), parseInt(offset)]
      );
      return rows.map(r => this._formatExecution(r));
    } finally { db.close(); }
  }

  // ---------------------------------------------------------------------------
  // Scheduling
  // ---------------------------------------------------------------------------

  async createSchedule(data) {
    const db = this.getDatabase();
    const scheduleId = uuidv4();
    try {
      // Verify report exists
      await this.getReport(data.report_id);

      const nextRun = this._computeNextRun(data.cron_expression);
      await this._run(db,
        `INSERT INTO report_schedules
          (schedule_id, report_id, cron_expression, timezone, output_format, distribution, is_active, next_run_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [scheduleId, data.report_id, data.cron_expression,
         data.timezone || 'UTC', data.output_format || 'json',
         JSON.stringify(data.distribution || []), nextRun, data.created_by]
      );
      return this.getSchedule(scheduleId);
    } finally { db.close(); }
  }

  async getSchedule(scheduleId) {
    const db = this.getDatabase();
    try {
      const row = await this._get(db, 'SELECT * FROM report_schedules WHERE schedule_id = ?', [scheduleId]);
      if (!row) throw new Error('Schedule not found');
      return this._formatSchedule(row);
    } finally { db.close(); }
  }

  async listSchedules(filters = {}) {
    const db = this.getDatabase();
    try {
      let query = 'SELECT * FROM report_schedules WHERE 1=1';
      const params = [];
      if (filters.report_id) { query += ' AND report_id = ?'; params.push(filters.report_id); }
      if (filters.is_active !== undefined) { query += ' AND is_active = ?'; params.push(filters.is_active ? 1 : 0); }
      query += ' ORDER BY next_run_at ASC';
      const rows = await this._all(db, query, params);
      return rows.map(r => this._formatSchedule(r));
    } finally { db.close(); }
  }

  async updateSchedule(scheduleId, data) {
    const db = this.getDatabase();
    try {
      const sets = [];
      const params = [];
      for (const key of ['cron_expression', 'timezone', 'output_format']) {
        if (data[key] !== undefined) { sets.push(`${key} = ?`); params.push(data[key]); }
      }
      if (data.distribution !== undefined) { sets.push('distribution = ?'); params.push(JSON.stringify(data.distribution)); }
      if (data.is_active !== undefined) { sets.push('is_active = ?'); params.push(data.is_active ? 1 : 0); }
      if (data.cron_expression) {
        sets.push('next_run_at = ?');
        params.push(this._computeNextRun(data.cron_expression));
      }
      if (sets.length === 0) throw new Error('No fields to update');
      sets.push('updated_at = CURRENT_TIMESTAMP');
      params.push(scheduleId);
      const changes = await this._run(db, `UPDATE report_schedules SET ${sets.join(', ')} WHERE schedule_id = ?`, params);
      if (changes === 0) throw new Error('Schedule not found');
      return this.getSchedule(scheduleId);
    } finally { db.close(); }
  }

  async deleteSchedule(scheduleId) {
    const db = this.getDatabase();
    try {
      const changes = await this._run(db, 'DELETE FROM report_schedules WHERE schedule_id = ?', [scheduleId]);
      if (changes === 0) throw new Error('Schedule not found');
    } finally { db.close(); }
  }

  // ---------------------------------------------------------------------------
  // Query Builder (internal)
  // ---------------------------------------------------------------------------

  _buildQuery(report) {
    const source = DATA_SOURCE_MAP[report.report_type];
    if (!source && report.report_type !== 'custom') {
      throw new Error(`Unsupported report type: ${report.report_type}`);
    }

    if (report.report_type === 'custom') {
      // Custom reports use data_sources[0] as the table name
      const table = (report.data_sources && report.data_sources[0]) || 'insurance_claims';
      return this._buildSelectQuery(table, report);
    }

    return this._buildSelectQuery(source.table, report, source.defaultColumns);
  }

  _buildSelectQuery(table, report, defaultColumns) {
    const columns = (report.columns && report.columns.length > 0) ? report.columns : (defaultColumns || ['*']);
    const params = [];

    let sql = `SELECT ${columns.join(', ')} FROM ${table}`;

    // Filters
    const filters = report.filters || {};
    const whereClauses = [];
    if (filters.date_from) { whereClauses.push('created_at >= ?'); params.push(filters.date_from); }
    if (filters.date_to) { whereClauses.push('created_at <= ?'); params.push(filters.date_to); }
    if (filters.status) { whereClauses.push('status = ?'); params.push(filters.status); }
    if (filters.patient_id) { whereClauses.push('patient_id = ?'); params.push(filters.patient_id); }

    if (whereClauses.length > 0) sql += ` WHERE ${whereClauses.join(' AND ')}`;

    // Grouping
    const grouping = report.grouping || [];
    if (grouping.length > 0) sql += ` GROUP BY ${grouping.join(', ')}`;

    // Sorting
    const sorting = report.sorting || [];
    if (sorting.length > 0) {
      const orderParts = sorting.map(s => {
        if (typeof s === 'string') return s;
        return `${s.column} ${s.direction || 'ASC'}`;
      });
      sql += ` ORDER BY ${orderParts.join(', ')}`;
    }

    // Default limit to prevent runaway queries
    sql += ' LIMIT 10000';

    return { sql, params };
  }

  // ---------------------------------------------------------------------------
  // CSV export helper
  // ---------------------------------------------------------------------------

  _toCsv(rows) {
    if (!rows || rows.length === 0) return '';
    const headers = Object.keys(rows[0]);
    const lines = [headers.join(',')];
    for (const row of rows) {
      const values = headers.map(h => {
        const v = row[h];
        if (v == null) return '';
        const s = String(v);
        return s.includes(',') || s.includes('"') || s.includes('\n')
          ? `"${s.replace(/"/g, '""')}"`
          : s;
      });
      lines.push(values.join(','));
    }
    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Scheduling helper — simple next-run calculation
  // ---------------------------------------------------------------------------

  _computeNextRun(cronExpression) {
    // Simplified: interpret common presets. A production system would use a cron parser.
    const presets = {
      '@hourly':  60 * 60 * 1000,
      '@daily':   24 * 60 * 60 * 1000,
      '@weekly':  7 * 24 * 60 * 60 * 1000,
      '@monthly': 30 * 24 * 60 * 60 * 1000,
    };
    const ms = presets[cronExpression] || 24 * 60 * 60 * 1000;
    return new Date(Date.now() + ms).toISOString();
  }

  // ---------------------------------------------------------------------------
  // Formatters
  // ---------------------------------------------------------------------------

  _formatReport(row) {
    return {
      report_id: row.report_id,
      name: row.name,
      description: row.description,
      report_type: row.report_type,
      data_sources: JSON.parse(row.data_sources || '[]'),
      columns: JSON.parse(row.columns || '[]'),
      filters: JSON.parse(row.filters || '{}'),
      grouping: JSON.parse(row.grouping || '[]'),
      sorting: JSON.parse(row.sorting || '[]'),
      visualization: JSON.parse(row.visualization || '{}'),
      created_by: row.created_by,
      is_public: !!row.is_public,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  _formatSchedule(row) {
    return {
      schedule_id: row.schedule_id,
      report_id: row.report_id,
      cron_expression: row.cron_expression,
      timezone: row.timezone,
      output_format: row.output_format,
      distribution: JSON.parse(row.distribution || '[]'),
      is_active: !!row.is_active,
      last_run_at: row.last_run_at,
      next_run_at: row.next_run_at,
      created_by: row.created_by,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  _formatExecution(row) {
    let data = row.result_data;
    if (row.output_format === 'json' && data) {
      try { data = JSON.parse(data); } catch (_) { /* keep as string */ }
    }
    return {
      execution_id: row.execution_id,
      report_id: row.report_id,
      schedule_id: row.schedule_id,
      status: row.status,
      output_format: row.output_format,
      row_count: row.row_count,
      execution_time_ms: row.execution_time_ms,
      error_message: row.error_message,
      data,
      executed_by: row.executed_by,
      created_at: row.created_at,
      completed_at: row.completed_at,
    };
  }

  // ---------------------------------------------------------------------------
  // DB helpers
  // ---------------------------------------------------------------------------

  _run(db, sql, params = []) {
    return new Promise((resolve, reject) => {
      db.run(sql, params, function (err) {
        if (err) reject(err); else resolve(this.changes);
      });
    });
  }

  _get(db, sql, params = []) {
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => { if (err) reject(err); else resolve(row); });
    });
  }

  _all(db, sql, params = []) {
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => { if (err) reject(err); else resolve(rows || []); });
    });
  }
}

module.exports = new AdvancedReportingService();
