// src/environment.rs
// Environment lifecycle management.
//
// Each environment is an isolated namespace for config and feature flags.
// Standard environments: dev, staging, prod.
// Custom environments can be added for feature branches or regional configs.

use soroban_sdk::{Address, Env, String, Vec};

use crate::{
    access, audit, storage,
    types::{ChangeType, ConfigError, EnvironmentMeta, EnvironmentTier},
};

// ── Public API ────────────────────────────────────────────────────────────────

/// Register a new environment.  Admin only.
pub fn create_environment(
    env: &Env,
    caller: &Address,
    id: String,
    tier: EnvironmentTier,
    description: String,
    requires_approval: bool,
) -> Result<EnvironmentMeta, ConfigError> {
    access::require_admin(env, caller)?;

    if storage::environment_exists(env, &id) {
        return Err(ConfigError::EnvironmentExists);
    }

    validate_env_id(&id)?;

    let meta = EnvironmentMeta {
        id: id.clone(),
        tier,
        description,
        is_active: true,
        requires_approval,
        created_at: env.ledger().sequence() as u64,
    };

    storage::set_environment(env, &meta);

    // Add to environment list.
    let mut list = storage::get_environment_list(env);
    list.push_back(id.clone());
    storage::set_environment_list(env, &list);

    // Audit.
    audit::write(
        env,
        &id,
        ChangeType::EnvironmentCreated,
        id.clone(),
        String::from_str(env, ""),
        String::from_str(env, "created"),
        caller,
        String::from_str(env, "environment registered"),
    );

    Ok(meta)
}

/// Deactivate an environment.  Admin only.
/// Deactivated environments reject new config writes.
pub fn deactivate_environment(
    env: &Env,
    caller: &Address,
    env_id: &String,
) -> Result<(), ConfigError> {
    access::require_admin(env, caller)?;

    let mut meta = storage::get_environment(env, env_id)?;
    meta.is_active = false;
    storage::set_environment(env, &meta);

    audit::write(
        env,
        env_id,
        ChangeType::EnvironmentDeactivated,
        env_id.clone(),
        String::from_str(env, "active"),
        String::from_str(env, "inactive"),
        caller,
        String::from_str(env, "environment deactivated"),
    );

    Ok(())
}

/// Get metadata for a single environment.
pub fn get_environment(env: &Env, env_id: &String) -> Result<EnvironmentMeta, ConfigError> {
    storage::get_environment(env, env_id)
}

/// List all registered environments.
pub fn list_environments(env: &Env) -> Vec<String> {
    storage::get_environment_list(env)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Validates that the environment is active before any mutation.
pub fn require_active(env: &Env, env_id: &String) -> Result<(), ConfigError> {
    let meta = storage::get_environment(env, env_id)?;
    if !meta.is_active {
        return Err(ConfigError::EnvironmentInactive);
    }
    Ok(())
}

/// Environment IDs must be lowercase alphanumeric + hyphens, 2–32 chars.
fn validate_env_id(id: &String) -> Result<(), ConfigError> {
    let s = id.to_string();
    if s.len() < 2 || s.len() > 32 {
        return Err(ConfigError::InvalidEnvironment);
    }
    for ch in s.chars() {
        if !ch.is_ascii_alphanumeric() && ch != '-' {
            return Err(ConfigError::InvalidEnvironment);
        }
    }
    Ok(())
}

/// Seed the three standard environments.  Called once at initialisation.
pub fn seed_standard_environments(env: &Env, admin: &Address) {
    let envs = [
        (
            crate::types::env_id::DEV,
            EnvironmentTier::Development,
            "Development environment",
            false,
        ),
        (
            crate::types::env_id::STAGING,
            EnvironmentTier::Staging,
            "Staging / QA environment",
            false,
        ),
        (
            crate::types::env_id::PROD,
            EnvironmentTier::Production,
            "Production environment",
            true,
        ),
    ];

    for (id, tier, desc, requires_approval) in envs {
        let id_str = String::from_str(env, id);
        if !storage::environment_exists(env, &id_str) {
            // Bypass access check during init — admin is the caller.
            let meta = EnvironmentMeta {
                id: id_str.clone(),
                tier,
                description: String::from_str(env, desc),
                is_active: true,
                requires_approval,
                created_at: env.ledger().sequence() as u64,
            };
            storage::set_environment(env, &meta);

            let mut list = storage::get_environment_list(env);
            list.push_back(id_str.clone());
            storage::set_environment_list(env, &list);

            audit::write(
                env,
                &id_str,
                ChangeType::EnvironmentCreated,
                id_str.clone(),
                String::from_str(env, ""),
                String::from_str(env, "created"),
                admin,
                String::from_str(env, "standard env seeded at init"),
            );
        }
    }
}