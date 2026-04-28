// src/feature_flags.rs
//
// Feature Flags
// ═════════════
// Boolean flags with optional canary rollout percentage and auto-expiry.
//
// Healthcare use cases
// ────────────────────
//  "enable_auto_claim_approval"  — auto-approve claims below threshold
//  "require_dual_signature"      — require both hospital and lab sign-off
//  "enable_fraud_detection_v2"   — new ML fraud detection pipeline
//  "maintenance_mode"            — suspend new claim submissions
//  "enable_patient_portal_v2"    — new patient UI (gradual rollout)
//
// Rollout percentage
// ──────────────────
// rollout_percentage = 0   → flag is OFF for everyone
// rollout_percentage = 50  → flag is ON for ~50% of evaluations
//                            (deterministic per caller address hash)
// rollout_percentage = 100 → flag is ON for everyone
//
// Expiry
// ──────
// Setting expires_at causes the flag to evaluate as disabled after that
// ledger sequence, even if `enabled = true`.  Expired flags must be
// explicitly re-enabled or cleaned up.

use soroban_sdk::{Address, Env, String};

use crate::{
    access, audit, environment, storage,
    types::{ChangeType, ConfigError, FeatureFlag},
};

// ── Public API ────────────────────────────────────────────────────────────────

/// Create or update a feature flag.
pub fn set_flag(
    env: &Env,
    caller: &Address,
    env_id: String,
    name: String,
    enabled: bool,
    rollout_percentage: u32,
    description: String,
    expires_at: Option<u64>,
) -> Result<FeatureFlag, ConfigError> {
    access::require_write_access(env, caller, &env_id)?;
    environment::require_active(env, &env_id)?;

    if rollout_percentage > 100 {
        return Err(ConfigError::InvalidRolloutPct);
    }

    let version = storage::next_version(env, &env_id);

    let old_state = if storage::flag_exists(env, &env_id, &name) {
        let f = storage::get_flag(env, &env_id, &name)?;
        if f.enabled { "true" } else { "false" }
    } else {
        "none"
    };

    let flag = FeatureFlag {
        name: name.clone(),
        env_id: env_id.clone(),
        enabled,
        rollout_percentage,
        description,
        version,
        updated_by: caller.clone(),
        updated_at: env.ledger().sequence() as u64,
        expires_at,
    };

    storage::set_flag(env, &flag);

    audit::write(
        env,
        &env_id,
        ChangeType::FlagSet,
        name,
        String::from_str(env, old_state),
        String::from_str(env, if enabled { "true" } else { "false" }),
        caller,
        String::from_str(env, "feature flag updated"),
    );

    Ok(flag)
}

/// Toggle a feature flag on or off without changing other fields.
pub fn toggle_flag(
    env: &Env,
    caller: &Address,
    env_id: String,
    name: String,
) -> Result<FeatureFlag, ConfigError> {
    access::require_write_access(env, caller, &env_id)?;

    let mut flag = storage::get_flag(env, &env_id, &name)?;
    let old_state = flag.enabled;
    flag.enabled = !flag.enabled;
    flag.version = storage::next_version(env, &env_id);
    flag.updated_by = caller.clone();
    flag.updated_at = env.ledger().sequence() as u64;

    storage::set_flag(env, &flag);

    audit::write(
        env,
        &env_id,
        ChangeType::FlagToggle,
        name,
        String::from_str(env, if old_state { "true" } else { "false" }),
        String::from_str(env, if flag.enabled { "true" } else { "false" }),
        caller,
        String::from_str(env, "flag toggled"),
    );

    Ok(flag)
}

/// Evaluate whether a feature flag is active.
///
/// Returns `true` if:
///   1. The flag exists and `enabled == true`
///   2. The flag has not expired (ledger sequence < expires_at)
///   3. The rollout_percentage check passes
///
/// `caller_seed` is an optional 0–99 value used for rollout evaluation.
/// Pass `None` to use a default seed of 0 (safest for server-side checks).
pub fn is_flag_enabled(
    env: &Env,
    env_id: String,
    name: String,
    caller_seed: Option<u32>,
) -> Result<bool, ConfigError> {
    let flag = storage::get_flag(env, &env_id, &name)?;

    // Expiry check.
    if let Some(expires) = flag.expires_at {
        if env.ledger().sequence() as u64 >= expires {
            return Ok(false);
        }
    }

    if !flag.enabled {
        return Ok(false);
    }

    // Rollout percentage.
    if flag.rollout_percentage == 0 {
        return Ok(false);
    }
    if flag.rollout_percentage >= 100 {
        return Ok(true);
    }

    let seed = caller_seed.unwrap_or(0) % 100;
    Ok(seed < flag.rollout_percentage)
}

/// Get the raw feature flag record.
pub fn get_flag(
    env: &Env,
    env_id: String,
    name: String,
) -> Result<FeatureFlag, ConfigError> {
    storage::get_flag(env, &env_id, &name)
}

/// Update the rollout percentage for an existing flag.
/// Useful for gradually expanding a canary release.
pub fn set_rollout_percentage(
    env: &Env,
    caller: &Address,
    env_id: String,
    name: String,
    percentage: u32,
) -> Result<FeatureFlag, ConfigError> {
    access::require_write_access(env, caller, &env_id)?;

    if percentage > 100 {
        return Err(ConfigError::InvalidRolloutPct);
    }

    let mut flag = storage::get_flag(env, &env_id, &name)?;
    let old_pct = flag.rollout_percentage;
    flag.rollout_percentage = percentage;
    flag.version = storage::next_version(env, &env_id);
    flag.updated_by = caller.clone();
    flag.updated_at = env.ledger().sequence() as u64;

    storage::set_flag(env, &flag);

    audit::write(
        env,
        &env_id,
        ChangeType::FlagSet,
        name,
        String::from_str(env, &old_pct.to_string()),
        String::from_str(env, &percentage.to_string()),
        caller,
        String::from_str(env, "rollout percentage updated"),
    );

    Ok(flag)
}