// src/storage.rs
// Centralised storage access — every read/write goes through here.

use soroban_sdk::{Address, Env, String, Vec};

use crate::types::{
    AuditRecord, ConfigEntry, ConfigError, ConfigSnapshot, DataKey,
    EnvironmentMeta, FeatureFlag, SecurityPolicy,
};

// ── Admin ────────────────────────────────────────────────────────────────────

pub fn get_admin(env: &Env) -> Result<Address, ConfigError> {
    env.storage()
        .instance()
        .get::<DataKey, Address>(&DataKey::Admin)
        .ok_or(ConfigError::NotInitialised)
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

pub fn is_initialised(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Admin)
}

// ── Operators ────────────────────────────────────────────────────────────────

pub fn is_operator(env: &Env, addr: &Address) -> bool {
    env.storage()
        .persistent()
        .get::<DataKey, bool>(&DataKey::Operator(addr.clone()))
        .unwrap_or(false)
}

pub fn set_operator(env: &Env, addr: &Address, active: bool) {
    env.storage()
        .persistent()
        .set(&DataKey::Operator(addr.clone()), &active);
}

// ── Security policy ──────────────────────────────────────────────────────────

pub fn get_security_policy(env: &Env) -> SecurityPolicy {
    env.storage()
        .instance()
        .get::<DataKey, SecurityPolicy>(&DataKey::SecurityPolicy)
        .unwrap_or_else(SecurityPolicy::default)
}

pub fn set_security_policy(env: &Env, policy: &SecurityPolicy) {
    env.storage().instance().set(&DataKey::SecurityPolicy, policy);
}

// ── Environment registry ─────────────────────────────────────────────────────

pub fn get_environment(env: &Env, env_id: &String) -> Result<EnvironmentMeta, ConfigError> {
    env.storage()
        .persistent()
        .get::<DataKey, EnvironmentMeta>(&DataKey::Environment(env_id.clone()))
        .ok_or(ConfigError::EnvironmentNotFound)
}

pub fn set_environment(env: &Env, meta: &EnvironmentMeta) {
    env.storage()
        .persistent()
        .set(&DataKey::Environment(meta.id.clone()), meta);
}

pub fn environment_exists(env: &Env, env_id: &String) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Environment(env_id.clone()))
}

pub fn get_environment_list(env: &Env) -> Vec<String> {
    env.storage()
        .instance()
        .get::<DataKey, Vec<String>>(&DataKey::EnvironmentList)
        .unwrap_or_else(|| Vec::new(env))
}

pub fn set_environment_list(env: &Env, list: &Vec<String>) {
    env.storage().instance().set(&DataKey::EnvironmentList, list);
}

// ── Config entries ────────────────────────────────────────────────────────────

pub fn get_config(
    env: &Env,
    env_id: &String,
    key: &String,
) -> Result<ConfigEntry, ConfigError> {
    env.storage()
        .persistent()
        .get::<DataKey, ConfigEntry>(&DataKey::Config(env_id.clone(), key.clone()))
        .ok_or(ConfigError::KeyNotFound)
}

pub fn set_config(env: &Env, entry: &ConfigEntry) {
    env.storage().persistent().set(
        &DataKey::Config(entry.env_id.clone(), entry.key.clone()),
        entry,
    );
}

pub fn delete_config(env: &Env, env_id: &String, key: &String) {
    env.storage()
        .persistent()
        .remove(&DataKey::Config(env_id.clone(), key.clone()));
}

pub fn config_exists(env: &Env, env_id: &String, key: &String) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Config(env_id.clone(), key.clone()))
}

// ── Version counters ──────────────────────────────────────────────────────────

pub fn next_version(env: &Env, env_id: &String) -> u64 {
    let key = DataKey::ConfigVersion(env_id.clone());
    let current: u64 = env.storage().persistent().get(&key).unwrap_or(0);
    let next = current + 1;
    env.storage().persistent().set(&key, &next);
    next
}

pub fn current_version(env: &Env, env_id: &String) -> u64 {
    env.storage()
        .persistent()
        .get::<DataKey, u64>(&DataKey::ConfigVersion(env_id.clone()))
        .unwrap_or(0)
}

// ── Feature flags ─────────────────────────────────────────────────────────────

pub fn get_flag(
    env: &Env,
    env_id: &String,
    name: &String,
) -> Result<FeatureFlag, ConfigError> {
    env.storage()
        .persistent()
        .get::<DataKey, FeatureFlag>(&DataKey::Flag(env_id.clone(), name.clone()))
        .ok_or(ConfigError::FlagNotFound)
}

pub fn set_flag(env: &Env, flag: &FeatureFlag) {
    env.storage().persistent().set(
        &DataKey::Flag(flag.env_id.clone(), flag.name.clone()),
        flag,
    );
}

pub fn flag_exists(env: &Env, env_id: &String, name: &String) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Flag(env_id.clone(), name.clone()))
}

// ── Audit log ────────────────────────────────────────────────────────────────

pub fn write_audit(env: &Env, record: &AuditRecord) {
    env.storage().persistent().set(
        &DataKey::AuditEntry(record.env_id.clone(), record.version),
        record,
    );
}

pub fn get_audit(
    env: &Env,
    env_id: &String,
    version: u64,
) -> Result<AuditRecord, ConfigError> {
    env.storage()
        .persistent()
        .get::<DataKey, AuditRecord>(&DataKey::AuditEntry(env_id.clone(), version))
        .ok_or(ConfigError::AuditNotFound)
}

// ── Snapshots ─────────────────────────────────────────────────────────────────

pub fn next_snapshot_id(env: &Env, env_id: &String) -> u64 {
    let key = DataKey::SnapshotCounter(env_id.clone());
    let current: u64 = env.storage().persistent().get(&key).unwrap_or(0);
    let next = current + 1;
    env.storage().persistent().set(&key, &next);
    next
}

pub fn current_snapshot_count(env: &Env, env_id: &String) -> u64 {
    env.storage()
        .persistent()
        .get::<DataKey, u64>(&DataKey::SnapshotCounter(env_id.clone()))
        .unwrap_or(0)
}

pub fn set_snapshot(env: &Env, snapshot: &ConfigSnapshot) {
    env.storage().persistent().set(
        &DataKey::Snapshot(snapshot.env_id.clone(), snapshot.snapshot_id),
        snapshot,
    );
}

pub fn get_snapshot(
    env: &Env,
    env_id: &String,
    snapshot_id: u64,
) -> Result<ConfigSnapshot, ConfigError> {
    env.storage()
        .persistent()
        .get::<DataKey, ConfigSnapshot>(&DataKey::Snapshot(env_id.clone(), snapshot_id))
        .ok_or(ConfigError::SnapshotNotFound)
}