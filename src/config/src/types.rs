// src/types.rs
//
// Shared types, error codes, and storage keys for the
// Healthcare Insurance Distributed Configuration Management system.
//
// Design principles
// ─────────────────
// • All config values are stored as Strings for maximum flexibility.
//   Callers cast to their required type at the boundary.
// • Every mutation is versioned — a monotonically increasing `version`
//   counter is attached to every ConfigEntry.  This is the anchor for
//   rollback and audit.
// • Environments are first-class: DEV, STAGING, PROD each maintain
//   independent config namespaces so a staging change can never bleed
//   into production.
// • Feature flags are a specialised config layer: boolean values with
//   their own rollout_percentage field (0-100) for canary releases.

use soroban_sdk::{contracterror, contracttype, Address, String};

// ── Storage key namespace ────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    // Admin / access control
    Admin,
    Operator(Address),          // allowed config writers

    // Config entries: keyed by (environment, config_key)
    Config(String, String),     // (env_id, key) → ConfigEntry
    ConfigVersion(String),      // env_id → u64 global version counter

    // Feature flags: keyed by (environment, flag_name)
    Flag(String, String),       // (env_id, flag_name) → FeatureFlag

    // Audit log: keyed by (environment, version)
    AuditEntry(String, u64),    // (env_id, version) → AuditRecord

    // Rollback snapshots: keyed by (environment, snapshot_id)
    Snapshot(String, u64),      // (env_id, snapshot_id) → Vec<ConfigEntry>
    SnapshotCounter(String),    // env_id → u64

    // Environment registry
    Environment(String),        // env_id → EnvironmentMeta
    EnvironmentList,            // Vec<String> of registered env_ids

    // Security
    SecurityPolicy,             // GlobalSecurityPolicy
}

// ── Environment ──────────────────────────────────────────────────────────────

/// Predefined environment identifiers.
/// Callers use these constants to avoid typos.
pub mod env_id {
    pub const DEV:     &str = "dev";
    pub const STAGING: &str = "staging";
    pub const PROD:    &str = "prod";
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum EnvironmentTier {
    Development,
    Staging,
    Production,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EnvironmentMeta {
    pub id: String,
    pub tier: EnvironmentTier,
    pub description: String,
    pub is_active: bool,
    /// Production environments require multi-sig approval for changes.
    pub requires_approval: bool,
    pub created_at: u64,
}

// ── Config entry ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConfigEntry {
    pub key: String,
    pub value: String,
    pub version: u64,
    pub env_id: String,
    pub updated_by: Address,
    pub updated_at: u64,
    pub description: String,
    pub is_secret: bool,   // redacted in view responses when true
    pub is_locked: bool,   // locked entries cannot be overwritten without unlock
}

// ── Feature flag ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FeatureFlag {
    pub name: String,
    pub env_id: String,
    pub enabled: bool,
    /// 0–100: percentage of users/requests that see this flag as enabled.
    /// 100 = fully rolled out, 0 = fully disabled.
    pub rollout_percentage: u32,
    pub description: String,
    pub version: u64,
    pub updated_by: Address,
    pub updated_at: u64,
    /// When set, the flag auto-disables after this ledger sequence.
    pub expires_at: Option<u64>,
}

// ── Audit record ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ChangeType {
    ConfigSet,
    ConfigDelete,
    ConfigLock,
    ConfigUnlock,
    FlagSet,
    FlagToggle,
    SnapshotCreated,
    RollbackExecuted,
    EnvironmentCreated,
    EnvironmentDeactivated,
    SecurityPolicyUpdated,
    OperatorAdded,
    OperatorRemoved,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuditRecord {
    pub version: u64,
    pub env_id: String,
    pub change_type: ChangeType,
    pub key: String,          // config key or flag name affected
    pub old_value: String,    // empty string if not applicable / secret
    pub new_value: String,    // empty string if not applicable / secret
    pub actor: Address,
    pub ledger_sequence: u64,
    pub memo: String,
}

// ── Snapshot ─────────────────────────────────────────────────────────────────

/// A point-in-time snapshot of all config entries for an environment.
/// Used for rollback.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConfigSnapshot {
    pub snapshot_id: u64,
    pub env_id: String,
    pub version_at_snapshot: u64,
    pub created_by: Address,
    pub created_at: u64,
    pub description: String,
    pub entry_count: u32,
}

// ── Security policy ──────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SecurityPolicy {
    /// Minimum characters for any config key name.
    pub min_key_length: u32,
    /// Maximum characters for any config value.
    pub max_value_length: u32,
    /// If true, operators can only write to DEV/STAGING; PROD requires admin.
    pub prod_admin_only: bool,
    /// If true, secret config values are never returned in view calls.
    pub redact_secrets: bool,
    /// Maximum number of config entries per environment.
    pub max_entries_per_env: u32,
    /// Maximum number of snapshots retained per environment.
    pub max_snapshots_per_env: u32,
}

impl SecurityPolicy {
    pub fn default() -> Self {
        Self {
            min_key_length: 3,
            max_value_length: 4096,
            prod_admin_only: true,
            redact_secrets: true,
            max_entries_per_env: 500,
            max_snapshots_per_env: 20,
        }
    }
}

// ── View / report types ──────────────────────────────────────────────────────

/// Safe view of a config entry — secrets are redacted per SecurityPolicy.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConfigView {
    pub key: String,
    pub value: String,      // "[REDACTED]" when is_secret && policy.redact_secrets
    pub version: u64,
    pub env_id: String,
    pub updated_by: Address,
    pub updated_at: u64,
    pub description: String,
    pub is_secret: bool,
    pub is_locked: bool,
}

// ── Errors ───────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ConfigError {
    NotInitialised        = 1,
    AlreadyInitialised    = 2,
    Unauthorised          = 3,
    EnvironmentNotFound   = 4,
    EnvironmentInactive   = 5,
    EnvironmentExists     = 6,
    KeyNotFound           = 7,
    KeyTooShort           = 8,
    ValueTooLong          = 9,
    EntryLocked           = 10,
    FlagNotFound          = 11,
    InvalidRolloutPct     = 12,
    SnapshotNotFound      = 13,
    SnapshotLimitReached  = 14,
    EntryLimitReached     = 15,
    ProdRequiresAdmin     = 16,
    AuditNotFound         = 17,
    InvalidEnvironment    = 18,
    FlagExpired           = 19,
    OperatorAlreadyExists = 20,
    OperatorNotFound      = 21,
}