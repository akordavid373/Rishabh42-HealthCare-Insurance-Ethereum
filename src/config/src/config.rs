// src/config.rs
//
// Configuration Management
// ════════════════════════
// Core CRUD operations on config entries with:
//   • Per-environment isolation
//   • Version tracking on every write
//   • Lock/unlock to freeze critical values
//   • Secret redaction via SecurityPolicy
//   • Full audit trail on every mutation
//
// Healthcare-specific config keys (examples stored in DEV/STAGING/PROD):
//   insurance.claim.max_amount         — maximum claimable amount per record
//   insurance.claim.auto_approve_limit — claims below this need no admin sign-off
//   insurance.roles.hospital_admin     — address of hospital admin
//   insurance.roles.lab_admin          — address of lab admin
//   insurance.signature.required_count — how many signatures needed

use soroban_sdk::{Address, Env, String};

use crate::{
    access, audit, environment, storage,
    types::{ChangeType, ConfigEntry, ConfigError, ConfigView},
};

// ── Public API ────────────────────────────────────────────────────────────────

/// Create or update a config entry.
///
/// * If the key does not exist, it is created.
/// * If it exists and is locked, `ConfigError::EntryLocked` is returned.
/// * Every write bumps the environment version counter.
pub fn set_config(
    env: &Env,
    caller: &Address,
    env_id: String,
    key: String,
    value: String,
    description: String,
    is_secret: bool,
) -> Result<ConfigEntry, ConfigError> {
    access::require_write_access(env, caller, &env_id)?;
    environment::require_active(env, &env_id)?;

    let policy = storage::get_security_policy(env);
    validate_key(&key, policy.min_key_length)?;
    validate_value(&value, policy.max_value_length)?;

    // Check lock on existing entry.
    let old_value = if storage::config_exists(env, &env_id, &key) {
        let existing = storage::get_config(env, &env_id, &key)?;
        if existing.is_locked {
            return Err(ConfigError::EntryLocked);
        }
        existing.value
    } else {
        // Check entry count limit.
        String::from_str(env, "")
    };

    let version = storage::next_version(env, &env_id);

    let entry = ConfigEntry {
        key: key.clone(),
        value: value.clone(),
        version,
        env_id: env_id.clone(),
        updated_by: caller.clone(),
        updated_at: env.ledger().sequence() as u64,
        description,
        is_secret,
        is_locked: false,
    };

    storage::set_config(env, &entry);

    // Audit — redact secret values.
    let audit_old = if is_secret {
        String::from_str(env, "[REDACTED]")
    } else {
        old_value
    };
    let audit_new = if is_secret {
        String::from_str(env, "[REDACTED]")
    } else {
        value
    };

    audit::write(
        env,
        &env_id,
        ChangeType::ConfigSet,
        key,
        audit_old,
        audit_new,
        caller,
        String::from_str(env, "config updated"),
    );

    Ok(entry)
}

/// Read a config entry.
/// Secret values are redacted based on SecurityPolicy.
/// Operators and admins see the full value regardless.
pub fn get_config(
    env: &Env,
    caller: &Address,
    env_id: String,
    key: String,
) -> Result<ConfigView, ConfigError> {
    let entry = storage::get_config(env, &env_id, &key)?;
    let policy = storage::get_security_policy(env);

    let value = if entry.is_secret
        && policy.redact_secrets
        && !access::is_privileged(env, caller)
    {
        String::from_str(env, "[REDACTED]")
    } else {
        entry.value.clone()
    };

    Ok(ConfigView {
        key: entry.key,
        value,
        version: entry.version,
        env_id: entry.env_id,
        updated_by: entry.updated_by,
        updated_at: entry.updated_at,
        description: entry.description,
        is_secret: entry.is_secret,
        is_locked: entry.is_locked,
    })
}

/// Delete a config entry.
/// Locked entries cannot be deleted until unlocked.
pub fn delete_config(
    env: &Env,
    caller: &Address,
    env_id: String,
    key: String,
) -> Result<(), ConfigError> {
    access::require_write_access(env, caller, &env_id)?;

    let entry = storage::get_config(env, &env_id, &key)?;
    if entry.is_locked {
        return Err(ConfigError::EntryLocked);
    }

    storage::delete_config(env, &env_id, &key);
    storage::next_version(env, &env_id);

    audit::write(
        env,
        &env_id,
        ChangeType::ConfigDelete,
        key,
        String::from_str(env, ""),
        String::from_str(env, "deleted"),
        caller,
        String::from_str(env, "config entry removed"),
    );

    Ok(())
}

/// Lock a config entry, preventing further modification until unlocked.
/// Admin only.
pub fn lock_config(
    env: &Env,
    caller: &Address,
    env_id: String,
    key: String,
) -> Result<(), ConfigError> {
    access::require_admin(env, caller)?;

    let mut entry = storage::get_config(env, &env_id, &key)?;
    entry.is_locked = true;
    storage::set_config(env, &entry);

    audit::write(
        env,
        &env_id,
        ChangeType::ConfigLock,
        key,
        String::from_str(env, "unlocked"),
        String::from_str(env, "locked"),
        caller,
        String::from_str(env, "entry locked by admin"),
    );

    Ok(())
}

/// Unlock a config entry.  Admin only.
pub fn unlock_config(
    env: &Env,
    caller: &Address,
    env_id: String,
    key: String,
) -> Result<(), ConfigError> {
    access::require_admin(env, caller)?;

    let mut entry = storage::get_config(env, &env_id, &key)?;
    entry.is_locked = false;
    storage::set_config(env, &entry);

    audit::write(
        env,
        &env_id,
        ChangeType::ConfigUnlock,
        key,
        String::from_str(env, "locked"),
        String::from_str(env, "unlocked"),
        caller,
        String::from_str(env, "entry unlocked by admin"),
    );

    Ok(())
}

/// Promote a config key from one environment to another.
/// Useful for the DEV → STAGING → PROD promotion workflow.
/// The destination must not already have the key locked.
pub fn promote_config(
    env: &Env,
    caller: &Address,
    src_env_id: String,
    dst_env_id: String,
    key: String,
    memo: String,
) -> Result<ConfigEntry, ConfigError> {
    // Destination write access is what matters.
    access::require_write_access(env, caller, &dst_env_id)?;
    environment::require_active(env, &dst_env_id)?;

    let src_entry = storage::get_config(env, &src_env_id, &key)?;

    // Check destination lock.
    if storage::config_exists(env, &dst_env_id, &key) {
        let dst = storage::get_config(env, &dst_env_id, &key)?;
        if dst.is_locked {
            return Err(ConfigError::EntryLocked);
        }
    }

    let version = storage::next_version(env, &dst_env_id);

    let promoted = ConfigEntry {
        key: key.clone(),
        value: src_entry.value.clone(),
        version,
        env_id: dst_env_id.clone(),
        updated_by: caller.clone(),
        updated_at: env.ledger().sequence() as u64,
        description: src_entry.description.clone(),
        is_secret: src_entry.is_secret,
        is_locked: false,
    };

    storage::set_config(env, &promoted);

    audit::write(
        env,
        &dst_env_id,
        ChangeType::ConfigSet,
        key,
        String::from_str(env, ""),
        if src_entry.is_secret {
            String::from_str(env, "[REDACTED]")
        } else {
            src_entry.value
        },
        caller,
        memo,
    );

    Ok(promoted)
}

/// Returns the current version counter for an environment.
pub fn get_version(env: &Env, env_id: String) -> u64 {
    storage::current_version(env, &env_id)
}

// ── Validation ────────────────────────────────────────────────────────────────

fn validate_key(key: &String, min_len: u32) -> Result<(), ConfigError> {
    let s = key.to_string();
    if s.len() < min_len as usize {
        return Err(ConfigError::KeyTooShort);
    }
    Ok(())
}

fn validate_value(value: &String, max_len: u32) -> Result<(), ConfigError> {
    let s = value.to_string();
    if s.len() > max_len as usize {
        return Err(ConfigError::ValueTooLong);
    }
    Ok(())
}