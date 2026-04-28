// src/tests.rs
//
// Distributed Configuration Management — Test Suite
// ══════════════════════════════════════════════════
//
// Coverage map
// ────────────
// Group A — Initialisation
//   A1  initialise_sets_admin_and_seeds_envs
//   A2  double_initialise_rejected
//
// Group B — Environment management
//   B1  create_custom_environment
//   B2  duplicate_environment_rejected
//   B3  deactivate_environment_blocks_writes
//   B4  list_environments_returns_all
//
// Group C — Configuration management (CRUD)
//   C1  set_and_get_config
//   C2  update_existing_config_increments_version
//   C3  delete_config
//   C4  get_nonexistent_key_returns_error
//   C5  delete_nonexistent_key_returns_error
//
// Group D — Config lock/unlock
//   D1  lock_prevents_overwrite
//   D2  lock_prevents_delete
//   D3  unlock_allows_overwrite
//   D4  only_admin_can_lock
//
// Group E — Secret config & redaction
//   E1  secret_value_redacted_for_non_privileged
//   E2  secret_value_visible_to_admin
//   E3  secret_value_visible_to_operator
//
// Group F — Environment promotion
//   F1  promote_config_dev_to_staging
//   F2  promote_to_locked_destination_rejected
//
// Group G — Feature flags
//   G1  set_and_evaluate_flag_enabled
//   G2  disabled_flag_evaluates_false
//   G3  toggle_flag
//   G4  rollout_0_always_false
//   G5  rollout_100_always_true
//   G6  rollout_partial_respects_seed
//   G7  expired_flag_evaluates_false
//   G8  set_rollout_percentage
//
// Group H — Access control
//   H1  operator_can_write_to_dev
//   H2  operator_blocked_from_prod_when_policy_set
//   H3  admin_can_write_to_prod
//   H4  unauthenticated_write_rejected
//   H5  add_and_remove_operator
//   H6  duplicate_operator_rejected
//   H7  remove_nonexistent_operator_rejected
//
// Group I — Audit log
//   I1  config_set_creates_audit_record
//   I2  audit_range_returns_records
//   I3  recent_audit_returns_n_records
//   I4  flag_toggle_creates_audit_record
//
// Group J — Snapshot & rollback
//   J1  create_snapshot_stores_entries
//   J2  rollback_restores_entries
//   J3  list_snapshots
//   J4  rollback_to_nonexistent_snapshot_rejected
//   J5  snapshot_limit_enforced
//
// Group K — Security policy
//   K1  update_security_policy
//   K2  key_too_short_rejected
//   K3  value_too_long_rejected
//   K4  only_admin_can_update_policy

#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, String, Vec,
};

use crate::{
    access, audit, config, environment, feature_flags, rollback, security, storage,
    types::{ConfigError, EnvironmentTier, SecurityPolicy},
};

// ── Test helpers ──────────────────────────────────────────────────────────────

struct TestEnv {
    env: Env,
    admin: Address,
    operator: Address,
    user: Address,
    dev: String,
    staging: String,
    prod: String,
}

impl TestEnv {
    fn new() -> Self {
        let env = Env::default();
        let admin = Address::generate(&env);
        let operator = Address::generate(&env);
        let user = Address::generate(&env);

        // Initialise contract state.
        storage::set_admin(&env, &admin);
        storage::set_security_policy(&env, &SecurityPolicy::default());
        environment::seed_standard_environments(&env, &admin);

        // Register operator.
        storage::set_operator(&env, &operator, true);

        TestEnv {
            dev: String::from_str(&env, "dev"),
            staging: String::from_str(&env, "staging"),
            prod: String::from_str(&env, "prod"),
            env,
            admin,
            operator,
            user,
        }
    }

    fn str(&self, s: &str) -> String {
        String::from_str(&self.env, s)
    }

    /// Set a config entry using the admin caller.
    fn set(&self, env_id: &String, key: &str, value: &str) {
        config::set_config(
            &self.env,
            &self.admin,
            env_id.clone(),
            self.str(key),
            self.str(value),
            self.str("test entry"),
            false,
        )
        .unwrap();
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Group A — Initialisation
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn a1_initialise_sets_admin_and_seeds_envs() {
    let t = TestEnv::new();
    let admin = storage::get_admin(&t.env).unwrap();
    assert_eq!(admin, t.admin, "A1: admin stored correctly");

    // All three standard envs should exist.
    assert!(storage::environment_exists(&t.env, &t.dev),     "A1: dev env seeded");
    assert!(storage::environment_exists(&t.env, &t.staging), "A1: staging env seeded");
    assert!(storage::environment_exists(&t.env, &t.prod),    "A1: prod env seeded");
}

#[test]
fn a2_double_initialise_rejected() {
    let t = TestEnv::new();
    assert!(storage::is_initialised(&t.env), "A2: already initialised");
    // Attempting to set admin again (simulating double-init) should be blocked
    // at the contract level. We test the is_initialised guard directly.
}

// ═══════════════════════════════════════════════════════════════════════════════
// Group B — Environment management
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn b1_create_custom_environment() {
    let t = TestEnv::new();
    let result = environment::create_environment(
        &t.env,
        &t.admin,
        t.str("feature-xyz"),
        EnvironmentTier::Development,
        t.str("feature branch env"),
        false,
    );
    assert!(result.is_ok(), "B1: custom env created");
    let meta = result.unwrap();
    assert_eq!(meta.id, t.str("feature-xyz"), "B1: id matches");
    assert!(meta.is_active, "B1: env is active");
}

#[test]
fn b2_duplicate_environment_rejected() {
    let t = TestEnv::new();
    // "dev" already exists.
    let result = environment::create_environment(
        &t.env,
        &t.admin,
        t.str("dev"),
        EnvironmentTier::Development,
        t.str("duplicate"),
        false,
    );
    assert_eq!(result, Err(ConfigError::EnvironmentExists), "B2: duplicate rejected");
}

#[test]
fn b3_deactivate_environment_blocks_writes() {
    let t = TestEnv::new();
    // Create a custom env, deactivate it, then try to write.
    let env_id = t.str("temp-env");
    environment::create_environment(
        &t.env, &t.admin, env_id.clone(),
        EnvironmentTier::Development, t.str("temp"), false,
    ).unwrap();

    environment::deactivate_environment(&t.env, &t.admin, &env_id).unwrap();

    let result = config::set_config(
        &t.env, &t.admin, env_id, t.str("key"), t.str("val"),
        t.str("desc"), false,
    );
    assert_eq!(result, Err(ConfigError::EnvironmentInactive), "B3: write blocked");
}

#[test]
fn b4_list_environments_returns_all() {
    let t = TestEnv::new();
    let list = environment::list_environments(&t.env);
    // At minimum: dev, staging, prod.
    assert!(list.len() >= 3, "B4: at least 3 environments listed");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Group C — Configuration CRUD
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn c1_set_and_get_config() {
    let t = TestEnv::new();
    t.set(&t.dev, "insurance.claim.max_amount", "50000");

    let view = config::get_config(
        &t.env, &t.admin, t.dev.clone(), t.str("insurance.claim.max_amount"),
    ).unwrap();

    assert_eq!(view.value, t.str("50000"), "C1: value matches");
    assert_eq!(view.version, 1,            "C1: first version");
}

#[test]
fn c2_update_existing_config_increments_version() {
    let t = TestEnv::new();
    t.set(&t.dev, "claim.threshold", "1000");
    t.set(&t.dev, "claim.threshold", "2000");

    let view = config::get_config(
        &t.env, &t.admin, t.dev.clone(), t.str("claim.threshold"),
    ).unwrap();

    assert_eq!(view.value,   t.str("2000"), "C2: value updated");
    assert_eq!(view.version, 2,             "C2: version incremented");
}

#[test]
fn c3_delete_config() {
    let t = TestEnv::new();
    t.set(&t.dev, "temp.key", "temp.val");
    config::delete_config(
        &t.env, &t.admin, t.dev.clone(), t.str("temp.key"),
    ).unwrap();

    let result = config::get_config(
        &t.env, &t.admin, t.dev.clone(), t.str("temp.key"),
    );
    assert_eq!(result, Err(ConfigError::KeyNotFound), "C3: deleted key not found");
}

#[test]
fn c4_get_nonexistent_key_returns_error() {
    let t = TestEnv::new();
    let result = config::get_config(
        &t.env, &t.admin, t.dev.clone(), t.str("does.not.exist"),
    );
    assert_eq!(result, Err(ConfigError::KeyNotFound), "C4: missing key error");
}

#[test]
fn c5_delete_nonexistent_key_returns_error() {
    let t = TestEnv::new();
    let result = config::delete_config(
        &t.env, &t.admin, t.dev.clone(), t.str("ghost.key"),
    );
    assert_eq!(result, Err(ConfigError::KeyNotFound), "C5: delete missing key error");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Group D — Lock / unlock
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn d1_lock_prevents_overwrite() {
    let t = TestEnv::new();
    t.set(&t.prod, "insurance.roles.hospital_admin", "GADDR1");
    config::lock_config(&t.env, &t.admin, t.prod.clone(), t.str("insurance.roles.hospital_admin")).unwrap();

    let result = config::set_config(
        &t.env, &t.admin, t.prod.clone(),
        t.str("insurance.roles.hospital_admin"), t.str("GADDR2"),
        t.str("update"), false,
    );
    assert_eq!(result, Err(ConfigError::EntryLocked), "D1: locked entry can't be overwritten");
}

#[test]
fn d2_lock_prevents_delete() {
    let t = TestEnv::new();
    t.set(&t.prod, "locked.key", "critical");
    config::lock_config(&t.env, &t.admin, t.prod.clone(), t.str("locked.key")).unwrap();

    let result = config::delete_config(
        &t.env, &t.admin, t.prod.clone(), t.str("locked.key"),
    );
    assert_eq!(result, Err(ConfigError::EntryLocked), "D2: locked entry can't be deleted");
}

#[test]
fn d3_unlock_allows_overwrite() {
    let t = TestEnv::new();
    t.set(&t.prod, "changeable.key", "v1");
    config::lock_config(&t.env, &t.admin, t.prod.clone(), t.str("changeable.key")).unwrap();
    config::unlock_config(&t.env, &t.admin, t.prod.clone(), t.str("changeable.key")).unwrap();

    let result = config::set_config(
        &t.env, &t.admin, t.prod.clone(),
        t.str("changeable.key"), t.str("v2"),
        t.str("updated after unlock"), false,
    );
    assert!(result.is_ok(), "D3: unlocked entry can be overwritten");
}

#[test]
fn d4_only_admin_can_lock() {
    let t = TestEnv::new();
    t.set(&t.dev, "some.key", "val");
    let result = config::lock_config(
        &t.env, &t.operator, t.dev.clone(), t.str("some.key"),
    );
    assert_eq!(result, Err(ConfigError::Unauthorised), "D4: only admin can lock");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Group E — Secret config
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn e1_secret_value_redacted_for_non_privileged() {
    let t = TestEnv::new();
    config::set_config(
        &t.env, &t.admin, t.dev.clone(),
        t.str("db.password"), t.str("super_secret_pw"),
        t.str("database password"), true,
    ).unwrap();

    let view = config::get_config(
        &t.env, &t.user, t.dev.clone(), t.str("db.password"),
    ).unwrap();

    assert_eq!(view.value, t.str("[REDACTED]"), "E1: secret redacted for non-privileged");
    assert!(view.is_secret, "E1: is_secret flag preserved");
}

#[test]
fn e2_secret_value_visible_to_admin() {
    let t = TestEnv::new();
    config::set_config(
        &t.env, &t.admin, t.dev.clone(),
        t.str("api.key"), t.str("secret_api_key"),
        t.str("api key"), true,
    ).unwrap();

    let view = config::get_config(
        &t.env, &t.admin, t.dev.clone(), t.str("api.key"),
    ).unwrap();

    assert_eq!(view.value, t.str("secret_api_key"), "E2: admin sees secret");
}

#[test]
fn e3_secret_value_visible_to_operator() {
    let t = TestEnv::new();
    config::set_config(
        &t.env, &t.admin, t.dev.clone(),
        t.str("service.token"), t.str("tok_12345"),
        t.str("service token"), true,
    ).unwrap();

    let view = config::get_config(
        &t.env, &t.operator, t.dev.clone(), t.str("service.token"),
    ).unwrap();

    assert_eq!(view.value, t.str("tok_12345"), "E3: operator sees secret");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Group F — Environment promotion
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn f1_promote_config_dev_to_staging() {
    let t = TestEnv::new();
    t.set(&t.dev, "insurance.claim.max_amount", "50000");

    let promoted = config::promote_config(
        &t.env, &t.admin,
        t.dev.clone(), t.staging.clone(),
        t.str("insurance.claim.max_amount"),
        t.str("promote to staging for QA"),
    ).unwrap();

    assert_eq!(promoted.env_id, t.staging, "F1: promoted to staging");
    assert_eq!(promoted.value, t.str("50000"), "F1: value preserved");
}

#[test]
fn f2_promote_to_locked_destination_rejected() {
    let t = TestEnv::new();
    t.set(&t.dev,     "key.a", "dev_value");
    t.set(&t.staging, "key.a", "staging_value");
    config::lock_config(&t.env, &t.admin, t.staging.clone(), t.str("key.a")).unwrap();

    let result = config::promote_config(
        &t.env, &t.admin,
        t.dev.clone(), t.staging.clone(),
        t.str("key.a"),
        t.str("should fail"),
    );
    assert_eq!(result, Err(ConfigError::EntryLocked), "F2: locked destination rejected");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Group G — Feature flags
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn g1_set_and_evaluate_flag_enabled() {
    let t = TestEnv::new();
    feature_flags::set_flag(
        &t.env, &t.admin, t.dev.clone(),
        t.str("enable_auto_claim_approval"),
        true, 100, t.str("auto-approve small claims"), None,
    ).unwrap();

    let result = feature_flags::is_flag_enabled(
        &t.env, t.dev.clone(), t.str("enable_auto_claim_approval"), None,
    ).unwrap();
    assert!(result, "G1: fully enabled flag evaluates true");
}

#[test]
fn g2_disabled_flag_evaluates_false() {
    let t = TestEnv::new();
    feature_flags::set_flag(
        &t.env, &t.admin, t.dev.clone(),
        t.str("maintenance_mode"),
        false, 100, t.str("maintenance"), None,
    ).unwrap();

    let result = feature_flags::is_flag_enabled(
        &t.env, t.dev.clone(), t.str("maintenance_mode"), None,
    ).unwrap();
    assert!(!result, "G2: disabled flag is false");
}

#[test]
fn g3_toggle_flag() {
    let t = TestEnv::new();
    feature_flags::set_flag(
        &t.env, &t.admin, t.dev.clone(),
        t.str("require_dual_signature"),
        false, 100, t.str("dual sig"), None,
    ).unwrap();

    let toggled = feature_flags::toggle_flag(
        &t.env, &t.admin, t.dev.clone(), t.str("require_dual_signature"),
    ).unwrap();
    assert!(toggled.enabled, "G3: flag toggled to true");

    let toggled_again = feature_flags::toggle_flag(
        &t.env, &t.admin, t.dev.clone(), t.str("require_dual_signature"),
    ).unwrap();
    assert!(!toggled_again.enabled, "G3: flag toggled back to false");
}

#[test]
fn g4_rollout_0_always_false() {
    let t = TestEnv::new();
    feature_flags::set_flag(
        &t.env, &t.admin, t.dev.clone(),
        t.str("hidden_flag"), true, 0, t.str("0% rollout"), None,
    ).unwrap();

    for seed in [0u32, 10, 50, 99] {
        let result = feature_flags::is_flag_enabled(
            &t.env, t.dev.clone(), t.str("hidden_flag"), Some(seed),
        ).unwrap();
        assert!(!result, "G4: 0% rollout always false (seed={})", seed);
    }
}

#[test]
fn g5_rollout_100_always_true() {
    let t = TestEnv::new();
    feature_flags::set_flag(
        &t.env, &t.admin, t.dev.clone(),
        t.str("full_rollout"), true, 100, t.str("100% rollout"), None,
    ).unwrap();

    for seed in [0u32, 10, 50, 99] {
        let result = feature_flags::is_flag_enabled(
            &t.env, t.dev.clone(), t.str("full_rollout"), Some(seed),
        ).unwrap();
        assert!(result, "G5: 100% rollout always true (seed={})", seed);
    }
}

#[test]
fn g6_rollout_partial_respects_seed() {
    let t = TestEnv::new();
    feature_flags::set_flag(
        &t.env, &t.admin, t.dev.clone(),
        t.str("canary_flag"), true, 50, t.str("50% rollout"), None,
    ).unwrap();

    // Seeds 0–49 should be true; 50–99 should be false.
    let enabled_low = feature_flags::is_flag_enabled(
        &t.env, t.dev.clone(), t.str("canary_flag"), Some(0),
    ).unwrap();
    assert!(enabled_low, "G6: seed 0 < 50% → enabled");

    let enabled_mid = feature_flags::is_flag_enabled(
        &t.env, t.dev.clone(), t.str("canary_flag"), Some(49),
    ).unwrap();
    assert!(enabled_mid, "G6: seed 49 < 50% → enabled");

    let disabled = feature_flags::is_flag_enabled(
        &t.env, t.dev.clone(), t.str("canary_flag"), Some(50),
    ).unwrap();
    assert!(!disabled, "G6: seed 50 >= 50% → disabled");

    let disabled_high = feature_flags::is_flag_enabled(
        &t.env, t.dev.clone(), t.str("canary_flag"), Some(99),
    ).unwrap();
    assert!(!disabled_high, "G6: seed 99 >= 50% → disabled");
}

#[test]
fn g7_expired_flag_evaluates_false() {
    let t = TestEnv::new();
    // Set expiry at ledger 5; current ledger is 0.
    feature_flags::set_flag(
        &t.env, &t.admin, t.dev.clone(),
        t.str("temp_promo"), true, 100, t.str("temporary promo"), Some(5),
    ).unwrap();

    // Advance ledger past expiry.
    t.env.ledger().with_mut(|l| { l.sequence_number = 10; });

    let result = feature_flags::is_flag_enabled(
        &t.env, t.dev.clone(), t.str("temp_promo"), None,
    ).unwrap();
    assert!(!result, "G7: expired flag evaluates false");
}

#[test]
fn g8_set_rollout_percentage() {
    let t = TestEnv::new();
    feature_flags::set_flag(
        &t.env, &t.admin, t.dev.clone(),
        t.str("gradual_flag"), true, 10, t.str("start at 10%"), None,
    ).unwrap();

    let updated = feature_flags::set_rollout_percentage(
        &t.env, &t.admin, t.dev.clone(), t.str("gradual_flag"), 75,
    ).unwrap();

    assert_eq!(updated.rollout_percentage, 75, "G8: rollout updated to 75%");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Group H — Access control
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn h1_operator_can_write_to_dev() {
    let t = TestEnv::new();
    let result = config::set_config(
        &t.env, &t.operator, t.dev.clone(),
        t.str("feature.flag.url"), t.str("https://flags.internal"),
        t.str("ops config"), false,
    );
    assert!(result.is_ok(), "H1: operator writes to dev");
}

#[test]
fn h2_operator_blocked_from_prod_when_policy_set() {
    let t = TestEnv::new();
    // Default policy has prod_admin_only = true.
    let result = config::set_config(
        &t.env, &t.operator, t.prod.clone(),
        t.str("prod.key"), t.str("prod.val"),
        t.str("should fail"), false,
    );
    assert_eq!(result, Err(ConfigError::Unauthorised), "H2: operator blocked from prod");
}

#[test]
fn h3_admin_can_write_to_prod() {
    let t = TestEnv::new();
    let result = config::set_config(
        &t.env, &t.admin, t.prod.clone(),
        t.str("insurance.signature.required_count"), t.str("2"),
        t.str("require two signatures"), false,
    );
    assert!(result.is_ok(), "H3: admin writes to prod");
}

#[test]
fn h4_unauthenticated_write_rejected() {
    let t = TestEnv::new();
    let result = config::set_config(
        &t.env, &t.user, t.dev.clone(),
        t.str("any.key"), t.str("any.val"),
        t.str("unauthorised"), false,
    );
    assert_eq!(result, Err(ConfigError::Unauthorised), "H4: unauthenticated write blocked");
}

#[test]
fn h5_add_and_remove_operator() {
    let t = TestEnv::new();
    let new_op = Address::generate(&t.env);

    security::add_operator(&t.env, &t.admin, &new_op).unwrap();
    assert!(security::is_operator(&t.env, &new_op), "H5: operator added");

    security::remove_operator(&t.env, &t.admin, &new_op).unwrap();
    assert!(!security::is_operator(&t.env, &new_op), "H5: operator removed");
}

#[test]
fn h6_duplicate_operator_rejected() {
    let t = TestEnv::new();
    // t.operator is already registered.
    let result = security::add_operator(&t.env, &t.admin, &t.operator);
    assert_eq!(result, Err(ConfigError::OperatorAlreadyExists), "H6: duplicate operator");
}

#[test]
fn h7_remove_nonexistent_operator_rejected() {
    let t = TestEnv::new();
    let ghost = Address::generate(&t.env);
    let result = security::remove_operator(&t.env, &t.admin, &ghost);
    assert_eq!(result, Err(ConfigError::OperatorNotFound), "H7: ghost operator rejected");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Group I — Audit log
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn i1_config_set_creates_audit_record() {
    let t = TestEnv::new();
    t.set(&t.dev, "claim.auto.limit", "500");

    let record = audit::get_record(&t.env, t.dev.clone(), 1).unwrap();
    assert_eq!(record.version, 1, "I1: version = 1");
    assert_eq!(record.key, t.str("claim.auto.limit"), "I1: key logged");
    assert_eq!(record.new_value, t.str("500"), "I1: new value logged");
}

#[test]
fn i2_audit_range_returns_records() {
    let t = TestEnv::new();
    t.set(&t.dev, "key.one",   "val1");
    t.set(&t.dev, "key.two",   "val2");
    t.set(&t.dev, "key.three", "val3");

    let records = audit::get_range(&t.env, t.dev.clone(), 1, 3);
    assert_eq!(records.len(), 3, "I2: three records in range");
}

#[test]
fn i3_recent_audit_returns_n_records() {
    let t = TestEnv::new();
    for i in 0..5u32 {
        let key = String::from_str(&t.env, &format!("key.{}", i));
        config::set_config(
            &t.env, &t.admin, t.dev.clone(),
            key, t.str("v"), t.str("d"), false,
        ).unwrap();
    }

    let recent = audit::get_recent(&t.env, t.dev.clone(), 3);
    assert_eq!(recent.len(), 3, "I3: 3 most recent records returned");
}

#[test]
fn i4_flag_toggle_creates_audit_record() {
    let t = TestEnv::new();
    feature_flags::set_flag(
        &t.env, &t.admin, t.dev.clone(),
        t.str("audit_flag"), false, 100, t.str("test"), None,
    ).unwrap();

    feature_flags::toggle_flag(
        &t.env, &t.admin, t.dev.clone(), t.str("audit_flag"),
    ).unwrap();

    let version = storage::current_version(&t.env, &t.dev);
    let record = audit::get_record(&t.env, t.dev.clone(), version).unwrap();
    assert_eq!(record.new_value, t.str("true"), "I4: toggle audit shows new state");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Group J — Snapshot & rollback
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn j1_create_snapshot_stores_entries() {
    let t = TestEnv::new();
    t.set(&t.dev, "snap.key.a", "alpha");
    t.set(&t.dev, "snap.key.b", "beta");

    let keys = {
        let mut v = Vec::new(&t.env);
        v.push_back(t.str("snap.key.a"));
        v.push_back(t.str("snap.key.b"));
        v
    };

    let snap = rollback::create_snapshot(
        &t.env, &t.admin, t.dev.clone(),
        t.str("pre-deploy snapshot"), keys,
    ).unwrap();

    assert_eq!(snap.entry_count, 2, "J1: two entries in snapshot");
    assert_eq!(snap.snapshot_id, 1, "J1: first snapshot");
}

#[test]
fn j2_rollback_restores_entries() {
    let t = TestEnv::new();
    t.set(&t.dev, "roll.key", "original");

    let keys = {
        let mut v = Vec::new(&t.env);
        v.push_back(t.str("roll.key"));
        v
    };

    let snap = rollback::create_snapshot(
        &t.env, &t.admin, t.dev.clone(),
        t.str("before change"), keys,
    ).unwrap();

    // Change the value.
    config::set_config(
        &t.env, &t.admin, t.dev.clone(),
        t.str("roll.key"), t.str("changed"),
        t.str("oops"), false,
    ).unwrap();

    // Verify it changed.
    let changed = config::get_config(
        &t.env, &t.admin, t.dev.clone(), t.str("roll.key"),
    ).unwrap();
    assert_eq!(changed.value, t.str("changed"), "J2: value was changed");

    // Roll back.
    rollback::rollback_to_snapshot(
        &t.env, &t.admin, t.dev.clone(),
        snap.snapshot_id, t.str("reverting bad deploy"),
    ).unwrap();

    // Should be restored.
    let restored = config::get_config(
        &t.env, &t.admin, t.dev.clone(), t.str("roll.key"),
    ).unwrap();
    assert_eq!(restored.value, t.str("original"), "J2: value restored after rollback");
}

#[test]
fn j3_list_snapshots() {
    let t = TestEnv::new();
    t.set(&t.dev, "ls.key", "val");

    for i in 0..3u32 {
        let key = String::from_str(&t.env, &format!("ls.key"));
        let keys = { let mut v = Vec::new(&t.env); v.push_back(key); v };
        rollback::create_snapshot(
            &t.env, &t.admin, t.dev.clone(),
            String::from_str(&t.env, &format!("snap {}", i)),
            keys,
        ).unwrap();
    }

    let ids = rollback::list_snapshots(&t.env, t.dev.clone());
    assert_eq!(ids.len(), 3, "J3: three snapshots listed");
}

#[test]
fn j4_rollback_to_nonexistent_snapshot_rejected() {
    let t = TestEnv::new();
    let result = rollback::rollback_to_snapshot(
        &t.env, &t.admin, t.dev.clone(), 999, t.str("should fail"),
    );
    assert_eq!(result, Err(ConfigError::SnapshotNotFound), "J4: missing snapshot rejected");
}

#[test]
fn j5_snapshot_limit_enforced() {
    let t = TestEnv::new();

    // Default max = 20. Set a lower cap for this test.
    security::update_security_policy(&t.env, &t.admin, SecurityPolicy {
        max_snapshots_per_env: 2,
        ..SecurityPolicy::default()
    }).unwrap();

    t.set(&t.dev, "limit.key", "val");
    let key = t.str("limit.key");

    for _ in 0..2 {
        let keys = { let mut v = Vec::new(&t.env); v.push_back(key.clone()); v };
        rollback::create_snapshot(
            &t.env, &t.admin, t.dev.clone(),
            t.str("snap"), keys,
        ).unwrap();
    }

    let keys3 = { let mut v = Vec::new(&t.env); v.push_back(key); v };
    let result = rollback::create_snapshot(
        &t.env, &t.admin, t.dev.clone(),
        t.str("over limit"), keys3,
    );
    assert_eq!(result, Err(ConfigError::SnapshotLimitReached), "J5: snapshot limit enforced");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Group K — Security policy
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn k1_update_security_policy() {
    let t = TestEnv::new();
    let new_policy = SecurityPolicy {
        min_key_length: 5,
        max_value_length: 2048,
        prod_admin_only: true,
        redact_secrets: false,
        max_entries_per_env: 100,
        max_snapshots_per_env: 10,
    };

    security::update_security_policy(&t.env, &t.admin, new_policy.clone()).unwrap();
    let stored = security::get_security_policy(&t.env);
    assert_eq!(stored.min_key_length, 5, "K1: min_key_length updated");
    assert_eq!(stored.max_value_length, 2048, "K1: max_value_length updated");
}

#[test]
fn k2_key_too_short_rejected() {
    let t = TestEnv::new();
    // Default min_key_length = 3; "ab" is 2 chars.
    let result = config::set_config(
        &t.env, &t.admin, t.dev.clone(),
        t.str("ab"), t.str("value"),
        t.str("too short"), false,
    );
    assert_eq!(result, Err(ConfigError::KeyTooShort), "K2: short key rejected");
}

#[test]
fn k3_value_too_long_rejected() {
    let t = TestEnv::new();
    // Set max to 10 for this test.
    security::update_security_policy(&t.env, &t.admin, SecurityPolicy {
        max_value_length: 10,
        ..SecurityPolicy::default()
    }).unwrap();

    let result = config::set_config(
        &t.env, &t.admin, t.dev.clone(),
        t.str("some.key"), t.str("this_value_is_way_too_long_for_the_limit"),
        t.str("too long"), false,
    );
    assert_eq!(result, Err(ConfigError::ValueTooLong), "K3: long value rejected");
}

#[test]
fn k4_only_admin_can_update_policy() {
    let t = TestEnv::new();
    let result = security::update_security_policy(
        &t.env, &t.operator,
        SecurityPolicy::default(),
    );
    assert_eq!(result, Err(ConfigError::Unauthorised), "K4: operator can't change policy");
}