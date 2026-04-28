// src/access.rs
// Access control helpers.
//
// Permission model
// ────────────────
//  Admin     — full access to all environments, security policy, operators
//  Operator  — can read/write DEV and STAGING; blocked from PROD when
//              SecurityPolicy::prod_admin_only is true
//  Anyone    — can read non-secret config values and feature flags

use soroban_sdk::{Address, Env, String};

use crate::{
    storage,
    types::{ConfigError, EnvironmentTier},
};

/// Asserts the caller is the admin.
pub fn require_admin(env: &Env, caller: &Address) -> Result<(), ConfigError> {
    let admin = storage::get_admin(env)?;
    if *caller != admin {
        return Err(ConfigError::Unauthorised);
    }
    Ok(())
}

/// Asserts the caller is the admin or a registered operator.
pub fn require_operator_or_admin(env: &Env, caller: &Address) -> Result<(), ConfigError> {
    let admin = storage::get_admin(env)?;
    if *caller == admin {
        return Ok(());
    }
    if storage::is_operator(env, caller) {
        return Ok(());
    }
    Err(ConfigError::Unauthorised)
}

/// Asserts the caller can write to the given environment.
/// Production environments additionally require admin when
/// SecurityPolicy::prod_admin_only is true.
pub fn require_write_access(
    env: &Env,
    caller: &Address,
    env_id: &String,
) -> Result<(), ConfigError> {
    // Must be at least operator.
    require_operator_or_admin(env, caller)?;

    // Check if the target environment is production and policy restricts it.
    let policy = storage::get_security_policy(env);
    if policy.prod_admin_only {
        let meta = storage::get_environment(env, env_id)?;
        if matches!(meta.tier, EnvironmentTier::Production) {
            // Only admin may write to production.
            require_admin(env, caller)?;
        }
    }

    Ok(())
}

/// Returns true if caller is admin or operator.
pub fn is_privileged(env: &Env, caller: &Address) -> bool {
    let admin = storage::get_admin(env).ok();
    if admin.as_ref() == Some(caller) {
        return true;
    }
    storage::is_operator(env, caller)
}