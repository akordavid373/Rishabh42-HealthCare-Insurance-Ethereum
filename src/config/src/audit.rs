// src/audit.rs
// Immutable audit log.
//
// Every config mutation, flag change, snapshot, and rollback is recorded here.
// Records are keyed by (env_id, version) so they are retrievable by version
// number and are effectively immutable once written (Soroban persistent
// storage can be extended but not replaced without a new key).
//
// Healthcare compliance note
// ──────────────────────────
// Healthcare systems typically require a 7-year audit trail.  On-chain storage
// satisfies this because ledger history is permanent.  The `actor` field
// satisfies HIPAA's "who accessed or changed what" requirement.

use soroban_sdk::{Address, Env, String};

use crate::{
    storage,
    types::{AuditRecord, ChangeType, ConfigError},
};

// ── Public API ────────────────────────────────────────────────────────────────

/// Write an audit record.  Called by every mutation function.
#[allow(clippy::too_many_arguments)]
pub fn write(
    env: &Env,
    env_id: &String,
    change_type: ChangeType,
    key: String,
    old_value: String,
    new_value: String,
    actor: &Address,
    memo: String,
) {
    // Version is the current version counter AFTER the mutation —
    // the caller must call next_version before calling audit::write.
    let version = storage::current_version(env, env_id);

    let record = AuditRecord {
        version,
        env_id: env_id.clone(),
        change_type,
        key,
        old_value,
        new_value,
        actor: actor.clone(),
        ledger_sequence: env.ledger().sequence() as u64,
        memo,
    };

    storage::write_audit(env, &record);
}

/// Retrieve a specific audit record by environment and version number.
pub fn get_record(
    env: &Env,
    env_id: String,
    version: u64,
) -> Result<AuditRecord, ConfigError> {
    storage::get_audit(env, &env_id, version)
}

/// Retrieve a range of audit records by version.
/// Returns records for versions start..=end (inclusive).
/// Skips versions that don't exist (e.g. gaps from other key changes).
pub fn get_range(
    env: &Env,
    env_id: String,
    from_version: u64,
    to_version: u64,
) -> soroban_sdk::Vec<AuditRecord> {
    let mut records = soroban_sdk::Vec::new(env);
    let to = to_version.min(storage::current_version(env, &env_id));

    for v in from_version..=to {
        if let Ok(record) = storage::get_audit(env, &env_id, v) {
            records.push_back(record);
        }
    }

    records
}

/// Returns the most recent N audit records for an environment.
pub fn get_recent(
    env: &Env,
    env_id: String,
    count: u32,
) -> soroban_sdk::Vec<AuditRecord> {
    let current = storage::current_version(env, &env_id);
    if current == 0 {
        return soroban_sdk::Vec::new(env);
    }

    let from = if current > count as u64 {
        current - count as u64 + 1
    } else {
        1
    };

    get_range(env, env_id, from, current)
}