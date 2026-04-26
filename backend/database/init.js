const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { runNotificationMigration } = require('./notificationMigration');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'healthcare.db');

function initializeDatabase() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        console.error('Error opening database:', err);
        reject(err);
        return;
      }
      console.log('Connected to SQLite database');
    });

    const tables = [
      `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('patient', 'provider', 'admin')),
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        date_of_birth DATE,
        phone TEXT,
        address TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS patients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        medical_record_number TEXT UNIQUE NOT NULL,
        insurance_provider TEXT,
        insurance_policy_number TEXT,
        emergency_contact_name TEXT,
        emergency_contact_phone TEXT,
        blood_type TEXT,
        allergies TEXT,
        medications TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )`,

      `CREATE TABLE IF NOT EXISTS medical_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER NOT NULL,
        provider_id INTEGER NOT NULL,
        record_type TEXT NOT NULL CHECK (record_type IN ('diagnosis', 'treatment', 'lab_result', 'prescription', 'imaging', 'vaccination')),
        title TEXT NOT NULL,
        description TEXT,
        diagnosis_code TEXT,
        treatment_code TEXT,
        date_of_service DATE NOT NULL,
        facility_name TEXT,
        provider_name TEXT,
        notes TEXT,
        attachments TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (patient_id) REFERENCES patients (id),
        FOREIGN KEY (provider_id) REFERENCES users (id)
      )`,

      `CREATE TABLE IF NOT EXISTS insurance_claims (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER NOT NULL,
        claim_number TEXT UNIQUE NOT NULL,
        service_date DATE NOT NULL,
        provider_name TEXT NOT NULL,
        diagnosis_codes TEXT,
        procedure_codes TEXT,
        total_amount DECIMAL(10,2) NOT NULL,
        insurance_amount DECIMAL(10,2),
        patient_responsibility DECIMAL(10,2),
        status TEXT NOT NULL CHECK (status IN ('submitted', 'pending', 'approved', 'denied', 'partially_approved', 'paid')),
        submission_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        processing_date DATETIME,
        payment_date DATETIME,
        denial_reason TEXT,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (patient_id) REFERENCES patients (id)
      )`,

      `CREATE TABLE IF NOT EXISTS premium_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER NOT NULL,
        payment_amount DECIMAL(10,2) NOT NULL,
        payment_date DATE NOT NULL,
        payment_method TEXT CHECK (payment_method IN ('credit_card', 'bank_transfer', 'check', 'cash')),
        payment_status TEXT CHECK (payment_status IN ('pending', 'completed', 'failed', 'refunded')),
        transaction_id TEXT,
        insurance_provider TEXT,
        policy_number TEXT,
        coverage_period_start DATE,
        coverage_period_end DATE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (patient_id) REFERENCES patients (id)
      )`,

      `CREATE TABLE IF NOT EXISTS appointments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER NOT NULL,
        provider_id INTEGER NOT NULL,
        appointment_date DATETIME NOT NULL,
        duration_minutes INTEGER NOT NULL,
        appointment_type TEXT CHECK (appointment_type IN ('consultation', 'follow_up', 'procedure', 'lab_test', 'imaging', 'vaccination')),
        status TEXT CHECK (status IN ('scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show')),
        notes TEXT,
        virtual BOOLEAN DEFAULT FALSE,
        meeting_link TEXT,
        reminder_sent BOOLEAN DEFAULT FALSE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (patient_id) REFERENCES patients (id),
        FOREIGN KEY (provider_id) REFERENCES users (id)
      )`,

      `CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        type TEXT CHECK (type IN ('appointment', 'claim', 'payment', 'system', 'medical_record', 'premium_adjustment')),
        priority TEXT CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
        read BOOLEAN DEFAULT FALSE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )`,

      `CREATE TABLE IF NOT EXISTS ml_models (
        model_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        model_type TEXT NOT NULL,
        description TEXT,
        artifact_path TEXT,
        input_schema TEXT DEFAULT '{}',
        output_schema TEXT DEFAULT '{}',
        hyperparameters TEXT DEFAULT '{}',
        status TEXT DEFAULT 'staging' CHECK (status IN ('staging', 'production', 'deprecated', 'archived')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS ml_predictions (
        prediction_id TEXT PRIMARY KEY,
        model_id TEXT NOT NULL,
        input_data TEXT NOT NULL,
        output_data TEXT NOT NULL,
        latency_ms INTEGER,
        ab_variant TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS ml_metrics (
        metric_id TEXT PRIMARY KEY,
        model_id TEXT NOT NULL,
        metric_name TEXT NOT NULL,
        value REAL NOT NULL,
        recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS ml_experiments (
        experiment_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        variants TEXT NOT NULL,
        status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed')),
        start_date DATETIME,
        end_date DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS advanced_notifications (
        notification_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        channels TEXT DEFAULT '["in_app"]',
        priority TEXT DEFAULT 'medium',
        category TEXT DEFAULT 'general',
        metadata TEXT DEFAULT '{}',
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
        scheduled_at DATETIME,
        sent_at DATETIME,
        read_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS notification_deliveries (
        delivery_id TEXT PRIMARY KEY,
        notification_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('delivered', 'failed')),
        error TEXT,
        delivered_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS notification_preferences (
        user_id TEXT PRIMARY KEY,
        preferences TEXT DEFAULT '{}',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS search_analytics (
        search_id TEXT PRIMARY KEY,
        query TEXT NOT NULL,
        options TEXT DEFAULT '{}',
        latency_ms INTEGER,
        searched_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS collab_workspaces (
        workspace_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        owner_id TEXT NOT NULL,
        resource_type TEXT DEFAULT 'general',
        resource_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS collab_members (
        workspace_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT DEFAULT 'editor' CHECK (role IN ('owner', 'editor', 'viewer')),
        joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (workspace_id, user_id)
      )`,

      `CREATE TABLE IF NOT EXISTS collab_documents (
        doc_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT DEFAULT '',
        version INTEGER DEFAULT 1,
        created_by TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS collab_edit_history (
        edit_id TEXT PRIMARY KEY,
        doc_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        patch TEXT NOT NULL,
        version INTEGER NOT NULL,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS collab_messages (
        message_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        message TEXT NOT NULL,
        parent_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS collab_presence (
        workspace_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        status TEXT DEFAULT 'online' CHECK (status IN ('online', 'away', 'offline')),
        last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (workspace_id, user_id)
      )`,

      `CREATE TABLE IF NOT EXISTS treasuries (
        treasury_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        required_signatures INTEGER NOT NULL,
        total_signers INTEGER NOT NULL,
        balance REAL DEFAULT 0,
        currency TEXT DEFAULT 'USD',
        status TEXT DEFAULT 'active' CHECK (status IN ('active', 'frozen', 'closed')),
        created_by TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS treasury_signers (
        treasury_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT DEFAULT 'approver' CHECK (role IN ('owner', 'admin', 'approver', 'viewer')),
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (treasury_id, user_id)
      )`,

      `CREATE TABLE IF NOT EXISTS treasury_transactions (
        tx_id TEXT PRIMARY KEY,
        treasury_id TEXT NOT NULL,
        proposer_id TEXT NOT NULL,
        tx_type TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT DEFAULT 'USD',
        recipient TEXT,
        description TEXT,
        tx_hash TEXT NOT NULL,
        required_signatures INTEGER NOT NULL,
        signatures_collected INTEGER DEFAULT 0,
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'executed', 'rejected')),
        proposed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        executed_at DATETIME
      )`,

      `CREATE TABLE IF NOT EXISTS treasury_signatures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tx_id TEXT NOT NULL,
        signer_id TEXT NOT NULL,
        sig_hash TEXT NOT NULL,
        signed_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS treasury_audit_log (
        log_id TEXT PRIMARY KEY,
        treasury_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        action TEXT NOT NULL,
        details TEXT DEFAULT '{}',
        logged_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS viz_dashboards (
        dashboard_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        owner_id TEXT NOT NULL,
        layout TEXT DEFAULT '[]',
        is_public INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS viz_widgets (
        widget_id TEXT PRIMARY KEY,
        dashboard_id TEXT NOT NULL,
        title TEXT NOT NULL,
        chart_type TEXT NOT NULL,
        data_source TEXT NOT NULL,
        config TEXT DEFAULT '{}',
        position INTEGER DEFAULT 0,
        refresh_interval INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS reinsurance_pools (
        pool_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        pool_type TEXT DEFAULT 'proportional',
        total_capacity REAL NOT NULL,
        used_capacity REAL DEFAULT 0,
        min_contribution REAL DEFAULT 0,
        risk_model TEXT DEFAULT '{}',
        governance_rules TEXT DEFAULT '{}',
        status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'closed')),
        created_by TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS reinsurance_members (
        member_id TEXT PRIMARY KEY,
        pool_id TEXT NOT NULL,
        insurer_id TEXT NOT NULL,
        contribution REAL NOT NULL,
        share_percentage REAL NOT NULL,
        joined_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS reinsurance_claims (
        claim_id TEXT PRIMARY KEY,
        pool_id TEXT NOT NULL,
        submitter_id TEXT NOT NULL,
        original_claim_id TEXT,
        claimed_amount REAL NOT NULL,
        risk_distribution TEXT DEFAULT '[]',
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'settled', 'rejected')),
        submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        settled_at DATETIME
      )`,

      `CREATE TABLE IF NOT EXISTS reinsurance_settlements (
        settlement_id TEXT PRIMARY KEY,
        claim_id TEXT NOT NULL,
        pool_id TEXT NOT NULL,
        insurer_id TEXT NOT NULL,
        amount REAL NOT NULL,
        status TEXT DEFAULT 'completed',
        settled_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS reinsurance_proposals (
        proposal_id TEXT PRIMARY KEY,
        pool_id TEXT NOT NULL,
        proposer_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        proposal_type TEXT DEFAULT 'parameter_change',
        votes_for INTEGER DEFAULT 0,
        votes_against INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active' CHECK (status IN ('active', 'passed', 'rejected', 'expired')),
        voting_deadline DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS fraud_contract_analyses (
        analysis_id TEXT PRIMARY KEY,
        claim_id INTEGER NOT NULL,
        patient_hash TEXT NOT NULL,
        detected_patterns TEXT DEFAULT '[]',
        risk_score REAL DEFAULT 0,
        risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
        prevention_action TEXT NOT NULL,
        ml_confidence REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS fraud_investigations (
        investigation_id TEXT PRIMARY KEY,
        claim_id INTEGER NOT NULL,
        analysis_id TEXT NOT NULL,
        status TEXT DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
        priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
        resolution TEXT,
        opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        resolved_at DATETIME
      )`
    ];

    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_patients_user_id ON patients(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_medical_records_patient_id ON medical_records(patient_id)',
      'CREATE INDEX IF NOT EXISTS idx_medical_records_date ON medical_records(date_of_service)',
      'CREATE INDEX IF NOT EXISTS idx_claims_patient_id ON insurance_claims(patient_id)',
      'CREATE INDEX IF NOT EXISTS idx_claims_status ON insurance_claims(status)',
      'CREATE INDEX IF NOT EXISTS idx_payments_patient_id ON premium_payments(patient_id)',
      'CREATE INDEX IF NOT EXISTS idx_appointments_patient_id ON appointments(patient_id)',
      'CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(appointment_date)',
      'CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_iot_readings_patient ON iot_health_readings(patient_id)',
      'CREATE INDEX IF NOT EXISTS idx_iot_readings_device ON iot_health_readings(device_id)',
      'CREATE INDEX IF NOT EXISTS idx_iot_alerts_patient ON iot_alerts(patient_id)',
      'CREATE INDEX IF NOT EXISTS idx_iot_alerts_status ON iot_alerts(status)',
      'CREATE INDEX IF NOT EXISTS idx_adv_payments_payer ON advanced_payment_transactions(payer_id)',
      'CREATE INDEX IF NOT EXISTS idx_marketplace_type ON marketplace_policies(policy_type)',
      'CREATE INDEX IF NOT EXISTS idx_sync_logs_integration ON integration_sync_logs(integration_id)',
      'CREATE INDEX IF NOT EXISTS idx_ml_predictions_model ON ml_predictions(model_id)',
      'CREATE INDEX IF NOT EXISTS idx_ml_metrics_model ON ml_metrics(model_id)',
      'CREATE INDEX IF NOT EXISTS idx_adv_notifications_user ON advanced_notifications(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_notif_deliveries_notif ON notification_deliveries(notification_id)',
      'CREATE INDEX IF NOT EXISTS idx_search_analytics_query ON search_analytics(query)',
      'CREATE INDEX IF NOT EXISTS idx_collab_messages_workspace ON collab_messages(workspace_id)',
      'CREATE INDEX IF NOT EXISTS idx_collab_docs_workspace ON collab_documents(workspace_id)',
      'CREATE INDEX IF NOT EXISTS idx_treasury_tx_treasury ON treasury_transactions(treasury_id)',
      'CREATE INDEX IF NOT EXISTS idx_treasury_audit_treasury ON treasury_audit_log(treasury_id)',
      'CREATE INDEX IF NOT EXISTS idx_viz_widgets_dashboard ON viz_widgets(dashboard_id)',
      'CREATE INDEX IF NOT EXISTS idx_reinsurance_members_pool ON reinsurance_members(pool_id)',
      'CREATE INDEX IF NOT EXISTS idx_reinsurance_claims_pool ON reinsurance_claims(pool_id)',
      'CREATE INDEX IF NOT EXISTS idx_fraud_analyses_claim ON fraud_contract_analyses(claim_id)',
      'CREATE INDEX IF NOT EXISTS idx_fraud_investigations_status ON fraud_investigations(status)'

    ];

    let completedTables = 0;
    let completedIndexes = 0;

    tables.forEach((sql) => {
      db.run(sql, (err) => {
        if (err) {
          console.error('Error creating table:', err);
          reject(err);
          return;
        }
        completedTables++;
        if (completedTables === tables.length) {
          indexes.forEach((indexSql) => {
            db.run(indexSql, (err) => {
              if (err) {
                console.error('Error creating index:', err);
              } else {
                completedIndexes++;
              }
              if (completedIndexes === indexes.length) {
                runNotificationMigration(db)
                  .then(() => {
                    db.close((err) => {
                      if (err) {
                        console.error('Error closing database:', err);
                        reject(err);
                      } else {
                        console.log('Database initialized successfully');
                        resolve();
                      }
                    });
                  })
                  .catch((err) => {
                    console.error('Notification migration error:', err);
                    reject(err);
                  });
              }
            });
          });
        }
      });
    });
  });
}

module.exports = { initializeDatabase };
