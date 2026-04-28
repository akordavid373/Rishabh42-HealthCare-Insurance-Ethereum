// src/security.rs
// Security controls: operator management and security policy updates.

use soroban_sdk::{Address, Env, String};

use crate::{
    access, audit, storage,
    types::{AuditRecord, ChangeType, ConfigError, SecurityPolicy},
};

// ── Operator management ───────────────────────────────────────────────────────

/// Grant operator privileges to an address.  Admin only.
pub fn add_operator(
    env: &Env,
    caller: &Address,
    operator: &Address,
) -> Result<(), ConfigError> {
    access::require_admin(env, caller)?;

    if storage::is_operator(env, operator) {
        return Err(ConfigError::OperatorAlreadyExists);
    }

    storage::set_operator(env, operator, true);

    // Use a synthetic env_id for global-scope audit entries.
    let global = String::from_str(env, "global");
    let version = storage::next_version(env, &global);
    let record = AuditRecord {
        version,
        env_id: global.clone(),
        change_type: ChangeType::OperatorAdded,
        key: String::from_str(env, "operator"),
        old_value: String::from_str(env, "none"),
        new_value: String::from_str(env, "granted"),
        actor: caller.clone(),
        ledger_sequence: env.ledger().sequence() as u64,
        memo: String::from_str(env, "operator added"),
    };
    storage::write_audit(env, &record);

    Ok(())
}

/// Revoke operator privileges.  Admin only.
pub fn remove_operator(
    env: &Env,
    caller: &Address,
    operator: &Address,
) -> Result<(), ConfigError> {
    access::require_admin(env, caller)?;

    if !storage::is_operator(env, operator) {
        return Err(ConfigError::OperatorNotFound);
    }

    storage::set_operator(env, operator, false);

    let global = String::from_str(env, "global");
    let version = storage::next_version(env, &global);
    let record = AuditRecord {
        version,
        env_id: global,
        change_type: ChangeType::OperatorRemoved,
        key: String::from_str(env, "operator"),
        old_value: String::from_str(env, "granted"),
        new_value: String::from_str(env, "revoked"),
        actor: caller.clone(),
        ledger_sequence: env.ledger().sequence() as u64,
        memo: String::from_str(env, "operator removed"),
    };
    storage::write_audit(env, &record);

    Ok(())
}

/// Check whether an address is a registered operator.
pub fn is_operator(env: &Env, addr: &Address) -> bool {
    storage::is_operator(env, addr)
}

// ── Security policy ───────────────────────────────────────────────────────────

/// Update the global security policy.  Admin only.
pub fn update_security_policy(
    env: &Env,
    caller: &Address,
    new_policy: SecurityPolicy,
) -> Result<SecurityPolicy, ConfigError> {
    access::require_admin(env, caller)?;

    validate_policy(&new_policy)?;

    storage::set_security_policy(env, &new_policy);

    let global = String::from_str(env, "global");
    audit::write(
        env,
        &global,
        ChangeType::SecurityPolicyUpdated,
        String::from_str(env, "security_policy"),
        String::from_str(env, ""),
        String::from_str(env, "updated"),
        caller,
        String::from_str(env, "security policy changed"),
    );

    Ok(new_policy)
}

/// Read the current security policy.
pub fn get_security_policy(env: &Env) -> SecurityPolicy {
    storage::get_security_policy(env)
}

// ── Validation ────────────────────────────────────────────────────────────────

fn validate_policy(policy: &SecurityPolicy) -> Result<(), ConfigError> {
    if policy.min_key_length == 0 || policy.min_key_length > 64 {
        return Err(ConfigError::InvalidEnvironment); // reuse error for bad policy
    }
    if policy.max_value_length == 0 || policy.max_value_length > 65_536 {
        return Err(ConfigError::ValueTooLong);
    }
    if policy.max_entries_per_env == 0 {
        return Err(ConfigError::EntryLimitReached);
    }
    if policy.max_snapshots_per_env == 0 || policy.max_snapshots_per_env > 100 {
        return Err(ConfigError::SnapshotLimitReached);
    }
    Ok(())
}