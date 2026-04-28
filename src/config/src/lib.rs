// src/lib.rs
// Healthcare Insurance — Distributed Configuration Management Contract
//
// This contract manages configuration for all on-chain and off-chain components
// of the Medical Insurance Claiming DApp built on Stellar.
//
// Feature summary
// ───────────────
// ✓ Configuration management  — per-environment key/value store, versioned
// ✓ Feature flags             — boolean flags with rollout % and expiry
// ✓ Dynamic updates           — live config changes without redeployment
// ✓ Environment management    — dev / staging / prod isolation
// ✓ Security controls         — admin/operator RBAC, prod write restrictions
// ✓ Audit logging             — every mutation recorded on-chain
// ✓ Rollback capabilities     — snapshot + restore for any environment

pub mod access;
pub mod audit;
pub mod config;
pub mod environment;
pub mod feature_flags;
pub mod rollback;
pub mod security;
pub mod storage;
pub mod types;

#[cfg(test)]
mod tests;

use soroban_sdk::{contract, contractimpl, Address, Env, String, Vec};

use types::{
    AuditRecord, ConfigEntry, ConfigError, ConfigSnapshot, ConfigView,
    EnvironmentMeta, EnvironmentTier, FeatureFlag, SecurityPolicy,
};

#[contract]
pub struct ConfigContract;

#[contractimpl]
impl ConfigContract {
    // ── Initialisation ───────────────────────────────────────────────────────

    /// Initialise the contract with an admin address.
    /// Seeds the three standard environments (dev, staging, prod).
    /// Can only be called once.
    pub fn initialise(env: Env, admin: Address) -> Result<(), ConfigError> {
        if storage::is_initialised(&env) {
            return Err(ConfigError::AlreadyInitialised);
        }

        storage::set_admin(&env, &admin);
        storage::set_security_policy(&env, &SecurityPolicy::default());
        environment::seed_standard_environments(&env, &admin);

        Ok(())
    }

    // ── Environment management ───────────────────────────────────────────────

    pub fn create_environment(
        env: Env,
        caller: Address,
        id: String,
        tier: EnvironmentTier,
        description: String,
        requires_approval: bool,
    ) -> Result<EnvironmentMeta, ConfigError> {
        environment::create_environment(&env, &caller, id, tier, description, requires_approval)
    }

    pub fn deactivate_environment(
        env: Env,
        caller: Address,
        env_id: String,
    ) -> Result<(), ConfigError> {
        environment::deactivate_environment(&env, &caller, &env_id)
    }

    pub fn get_environment(env: Env, env_id: String) -> Result<EnvironmentMeta, ConfigError> {
        environment::get_environment(&env, &env_id)
    }

    pub fn list_environments(env: Env) -> Vec<String> {
        environment::list_environments(&env)
    }

    // ── Configuration management ─────────────────────────────────────────────

    pub fn set_config(
        env: Env,
        caller: Address,
        env_id: String,
        key: String,
        value: String,
        description: String,
        is_secret: bool,
    ) -> Result<ConfigEntry, ConfigError> {
        config::set_config(&env, &caller, env_id, key, value, description, is_secret)
    }

    pub fn get_config(
        env: Env,
        caller: Address,
        env_id: String,
        key: String,
    ) -> Result<ConfigView, ConfigError> {
        config::get_config(&env, &caller, env_id, key)
    }

    pub fn delete_config(
        env: Env,
        caller: Address,
        env_id: String,
        key: String,
    ) -> Result<(), ConfigError> {
        config::delete_config(&env, &caller, env_id, key)
    }

    pub fn lock_config(
        env: Env,
        caller: Address,
        env_id: String,
        key: String,
    ) -> Result<(), ConfigError> {
        config::lock_config(&env, &caller, env_id, key)
    }

    pub fn unlock_config(
        env: Env,
        caller: Address,
        env_id: String,
        key: String,
    ) -> Result<(), ConfigError> {
        config::unlock_config(&env, &caller, env_id, key)
    }

    pub fn promote_config(
        env: Env,
        caller: Address,
        src_env_id: String,
        dst_env_id: String,
        key: String,
        memo: String,
    ) -> Result<ConfigEntry, ConfigError> {
        config::promote_config(&env, &caller, src_env_id, dst_env_id, key, memo)
    }

    pub fn get_version(env: Env, env_id: String) -> u64 {
        config::get_version(&env, env_id)
    }

    // ── Feature flags ────────────────────────────────────────────────────────

    pub fn set_flag(
        env: Env,
        caller: Address,
        env_id: String,
        name: String,
        enabled: bool,
        rollout_percentage: u32,
        description: String,
        expires_at: Option<u64>,
    ) -> Result<FeatureFlag, ConfigError> {
        feature_flags::set_flag(
            &env,
            &caller,
            env_id,
            name,
            enabled,
            rollout_percentage,
            description,
            expires_at,
        )
    }

    pub fn toggle_flag(
        env: Env,
        caller: Address,
        env_id: String,
        name: String,
    ) -> Result<FeatureFlag, ConfigError> {
        feature_flags::toggle_flag(&env, &caller, env_id, name)
    }

    pub fn is_flag_enabled(
        env: Env,
        env_id: String,
        name: String,
        caller_seed: Option<u32>,
    ) -> Result<bool, ConfigError> {
        feature_flags::is_flag_enabled(&env, env_id, name, caller_seed)
    }

    pub fn get_flag(env: Env, env_id: String, name: String) -> Result<FeatureFlag, ConfigError> {
        feature_flags::get_flag(&env, env_id, name)
    }

    pub fn set_rollout_percentage(
        env: Env,
        caller: Address,
        env_id: String,
        name: String,
        percentage: u32,
    ) -> Result<FeatureFlag, ConfigError> {
        feature_flags::set_rollout_percentage(&env, &caller, env_id, name, percentage)
    }

    // ── Audit ────────────────────────────────────────────────────────────────

    pub fn get_audit_record(
        env: Env,
        env_id: String,
        version: u64,
    ) -> Result<AuditRecord, ConfigError> {
        audit::get_record(&env, env_id, version)
    }

    pub fn get_audit_range(
        env: Env,
        env_id: String,
        from_version: u64,
        to_version: u64,
    ) -> Vec<AuditRecord> {
        audit::get_range(&env, env_id, from_version, to_version)
    }

    pub fn get_recent_audit(env: Env, env_id: String, count: u32) -> Vec<AuditRecord> {
        audit::get_recent(&env, env_id, count)
    }

    // ── Snapshot & rollback ──────────────────────────────────────────────────

    pub fn create_snapshot(
        env: Env,
        caller: Address,
        env_id: String,
        description: String,
        keys: Vec<String>,
    ) -> Result<ConfigSnapshot, ConfigError> {
        rollback::create_snapshot(&env, &caller, env_id, description, keys)
    }

    pub fn rollback_to_snapshot(
        env: Env,
        caller: Address,
        env_id: String,
        snapshot_id: u64,
        memo: String,
    ) -> Result<ConfigSnapshot, ConfigError> {
        rollback::rollback_to_snapshot(&env, &caller, env_id, snapshot_id, memo)
    }

    pub fn get_snapshot_info(
        env: Env,
        env_id: String,
        snapshot_id: u64,
    ) -> Result<ConfigSnapshot, ConfigError> {
        rollback::get_snapshot_info(&env, env_id, snapshot_id)
    }

    pub fn list_snapshots(env: Env, env_id: String) -> Vec<u64> {
        rollback::list_snapshots(&env, env_id)
    }

    // ── Security controls ────────────────────────────────────────────────────

    pub fn add_operator(
        env: Env,
        caller: Address,
        operator: Address,
    ) -> Result<(), ConfigError> {
        security::add_operator(&env, &caller, &operator)
    }

    pub fn remove_operator(
        env: Env,
        caller: Address,
        operator: Address,
    ) -> Result<(), ConfigError> {
        security::remove_operator(&env, &caller, &operator)
    }

    pub fn is_operator(env: Env, addr: Address) -> bool {
        security::is_operator(&env, &addr)
    }

    pub fn update_security_policy(
        env: Env,
        caller: Address,
        policy: SecurityPolicy,
    ) -> Result<SecurityPolicy, ConfigError> {
        security::update_security_policy(&env, &caller, policy)
    }

    pub fn get_security_policy(env: Env) -> SecurityPolicy {
        security::get_security_policy(&env)
    }
}