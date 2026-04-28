// src/rollback.rs
//
// Snapshot & Rollback
// ═══════════════════
// Creates point-in-time snapshots of config state and restores them.
//
// Snapshot model
// ──────────────
// A snapshot stores a Vec<ConfigEntry> — the complete set of entries for
// one environment at the time of creation.  Because Soroban storage is
// key-value, we store each entry individually under a composite key
// (env_id, snapshot_id, entry_index) so large snapshots don't hit the
// value-size limit.
//
// Rollback flow
// ─────────────
// 1. Admin calls create_snapshot() before a risky deployment.
// 2. Deployment proceeds; config changes are made normally.
// 3. If something goes wrong, admin calls rollback_to_snapshot(snapshot_id).
// 4. All current config entries are overwritten with snapshot values.
// 5. A new version is issued and an audit record is written.
//
// Retention policy
// ─────────────────
// SecurityPolicy::max_snapshots_per_env caps stored snapshots.
// Oldest snapshots are overwritten when the limit is reached.

use soroban_sdk::{contracttype, Address, Env, String, Vec};

use crate::{
    access, audit, storage,
    types::{ChangeType, ConfigEntry, ConfigError, ConfigSnapshot},
};

// We store individual config entries within a snapshot under this key type.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
enum SnapKey {
    Entry(String, u64, u32), // (env_id, snapshot_id, index)
    Count(String, u64),      // (env_id, snapshot_id) → entry count
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Create a snapshot of the current config state for an environment.
///
/// `keys` — the list of config keys to include in the snapshot.
/// Pass all active keys for a full snapshot, or a subset for targeted rollbacks.
pub fn create_snapshot(
    env: &Env,
    caller: &Address,
    env_id: String,
    description: String,
    keys: Vec<String>,
) -> Result<ConfigSnapshot, ConfigError> {
    access::require_admin(env, caller)?;

    let policy = storage::get_security_policy(env);
    let current_count = storage::current_snapshot_count(env, &env_id);

    if current_count >= policy.max_snapshots_per_env as u64 {
        return Err(ConfigError::SnapshotLimitReached);
    }

    let snapshot_id = storage::next_snapshot_id(env, &env_id);
    let version_at = storage::current_version(env, &env_id);

    // Store each entry individually.
    let mut stored: u32 = 0;
    for key in keys.iter() {
        if let Ok(entry) = storage::get_config(env, &env_id, &key) {
            env.storage().persistent().set(
                &SnapKey::Entry(env_id.clone(), snapshot_id, stored),
                &entry,
            );
            stored += 1;
        }
    }

    env.storage().persistent().set(
        &SnapKey::Count(env_id.clone(), snapshot_id),
        &stored,
    );

    let snapshot = ConfigSnapshot {
        snapshot_id,
        env_id: env_id.clone(),
        version_at_snapshot: version_at,
        created_by: caller.clone(),
        created_at: env.ledger().sequence() as u64,
        description,
        entry_count: stored,
    };

    storage::set_snapshot(env, &snapshot);

    // Bump version and audit.
    storage::next_version(env, &env_id);
    audit::write(
        env,
        &env_id,
        ChangeType::SnapshotCreated,
        String::from_str(env, &snapshot_id.to_string()),
        String::from_str(env, ""),
        String::from_str(env, &stored.to_string()),
        caller,
        String::from_str(env, "snapshot created"),
    );

    Ok(snapshot)
}

/// Restore all config entries from a snapshot.
/// Current values are overwritten; a new version is issued.
pub fn rollback_to_snapshot(
    env: &Env,
    caller: &Address,
    env_id: String,
    snapshot_id: u64,
    memo: String,
) -> Result<ConfigSnapshot, ConfigError> {
    access::require_admin(env, caller)?;

    let snapshot = storage::get_snapshot(env, &env_id, snapshot_id)?;

    let entry_count: u32 = env
        .storage()
        .persistent()
        .get::<SnapKey, u32>(&SnapKey::Count(env_id.clone(), snapshot_id))
        .unwrap_or(0);

    // Restore entries.
    for i in 0..entry_count {
        let entry: Option<ConfigEntry> = env
            .storage()
            .persistent()
            .get(&SnapKey::Entry(env_id.clone(), snapshot_id, i));

        if let Some(mut e) = entry {
            // Update metadata to reflect the rollback.
            e.updated_by = caller.clone();
            e.updated_at = env.ledger().sequence() as u64;
            e.version = storage::next_version(env, &env_id);
            e.is_locked = false; // Rollback clears locks.
            storage::set_config(env, &e);
        }
    }

    // Final audit entry.
    storage::next_version(env, &env_id);
    audit::write(
        env,
        &env_id,
        ChangeType::RollbackExecuted,
        String::from_str(env, &snapshot_id.to_string()),
        String::from_str(env, "current"),
        String::from_str(env, &snapshot.version_at_snapshot.to_string()),
        caller,
        memo,
    );

    Ok(snapshot)
}

/// Get snapshot metadata (does not load individual entries).
pub fn get_snapshot_info(
    env: &Env,
    env_id: String,
    snapshot_id: u64,
) -> Result<ConfigSnapshot, ConfigError> {
    storage::get_snapshot(env, &env_id, snapshot_id)
}

/// List snapshot IDs for an environment (returns up to the current count).
pub fn list_snapshots(env: &Env, env_id: String) -> Vec<u64> {
    let count = storage::current_snapshot_count(env, &env_id);
    let mut ids = Vec::new(env);
    for i in 1..=count {
        if storage::get_snapshot(env, &env_id, i).is_ok() {
            ids.push_back(i);
        }
    }
    ids
}