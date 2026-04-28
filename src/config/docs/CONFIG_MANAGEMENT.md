# Distributed Configuration Management

**Healthcare Insurance Stellar DApp — `src/config/` module**

---

## 1. Overview

This module provides distributed, auditable configuration management for the
Medical Insurance Claiming DApp.  It runs as a Soroban smart contract on the
Stellar network and replaces hardcoded parameters with dynamic, versioned,
environment-aware configuration.

```
┌─────────────────────────────────────────────────────────────┐
│              ConfigContract (Soroban)                        │
├──────────────┬──────────────┬──────────────┬────────────────┤
│  Config      │  Feature     │  Snapshot /  │  Audit         │
│  Management  │  Flags       │  Rollback    │  Log           │
├──────────────┴──────────────┴──────────────┴────────────────┤
│                    Storage Layer                             │
├──────────────────────────────────────────────────────────────┤
│   dev namespace │ staging namespace │ prod namespace         │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Architecture

### Module layout

| Module | Responsibility |
|--------|---------------|
| `types.rs` | All shared types, storage keys, errors |
| `storage.rs` | Thin wrappers around Soroban persistent storage |
| `access.rs` | RBAC: admin/operator permission checks |
| `environment.rs` | Environment lifecycle (create, deactivate, list) |
| `config.rs` | Config CRUD, lock/unlock, promotion |
| `feature_flags.rs` | Feature flags with rollout % and expiry |
| `audit.rs` | Immutable audit log (read + write) |
| `rollback.rs` | Snapshot creation and restoration |
| `security.rs` | Operator management, security policy |
| `lib.rs` | Contract entry point — exposes all public functions |

---

## 3. Environments

Three standard environments are seeded at initialisation:

| ID | Tier | Requires admin for writes |
|----|------|--------------------------|
| `dev` | Development | No (operators allowed) |
| `staging` | Staging | No (operators allowed) |
| `prod` | Production | **Yes** (admin only) |

Custom environments can be added for feature branches or regional configs:

```rust
contract.create_environment(
    admin,
    "feature-new-claims-ui",
    EnvironmentTier::Development,
    "Feature branch environment",
    false,
)
```

---

## 4. Configuration Management

### Healthcare config keys (examples)

| Key | Description | Environment |
|-----|-------------|-------------|
| `insurance.claim.max_amount` | Maximum claimable USD amount | all |
| `insurance.claim.auto_approve_limit` | Claims below this skip manual review | prod |
| `insurance.roles.hospital_admin` | Stellar address of hospital admin | prod |
| `insurance.roles.lab_admin` | Stellar address of lab admin | prod |
| `insurance.signature.required_count` | How many signatures to finalise claim | all |
| `db.connection_string` | Backend database URL (secret) | staging, prod |
| `notifications.webhook_url` | Notification service endpoint | all |

### Set a config value

```rust
contract.set_config(
    caller,
    "prod",
    "insurance.claim.max_amount",
    "50000",
    "Maximum claimable amount in USD",
    false,   // not a secret
)
```

### Read a config value

```rust
let view = contract.get_config(caller, "prod", "insurance.claim.max_amount");
// view.value == "50000"
// view.version == 7
```

### Lock a critical config

```rust
// Lock the hospital admin address so it can't be accidentally changed.
contract.lock_config(admin, "prod", "insurance.roles.hospital_admin")
```

### Promote DEV → STAGING → PROD

```rust
// After QA passes in staging, promote to prod.
contract.promote_config(
    admin,
    "staging",          // source
    "prod",             // destination
    "insurance.claim.max_amount",
    "QA approved — promoting to prod",
)
```

---

## 5. Feature Flags

### Healthcare flag examples

| Flag | Purpose |
|------|---------|
| `enable_auto_claim_approval` | Auto-approve claims below threshold |
| `require_dual_signature` | Require both hospital and lab sign-off |
| `enable_fraud_detection_v2` | New fraud detection pipeline |
| `maintenance_mode` | Suspend new claim submissions |
| `enable_patient_portal_v2` | New patient UI (gradual rollout) |

### Create a flag with canary rollout

```rust
// Roll out fraud detection to 10% of users first.
contract.set_flag(
    admin,
    "prod",
    "enable_fraud_detection_v2",
    true,
    10,                  // 10% rollout
    "New ML fraud pipeline",
    None,                // no expiry
)
```

### Increase rollout gradually

```rust
contract.set_rollout_percentage(admin, "prod", "enable_fraud_detection_v2", 50)
// ... monitor metrics ...
contract.set_rollout_percentage(admin, "prod", "enable_fraud_detection_v2", 100)
```

### Temporary flag with auto-expiry

```rust
// Enable maintenance mode until ledger sequence 1_000_000.
contract.set_flag(
    admin, "prod", "maintenance_mode",
    true, 100, "Scheduled maintenance", Some(1_000_000),
)
```

### Evaluate a flag

```rust
// seed = hash(caller_address) % 100 for deterministic per-user evaluation.
let active = contract.is_flag_enabled("prod", "enable_fraud_detection_v2", Some(42));
```

---

## 6. Audit Logging

Every mutation produces an `AuditRecord` stored on-chain:

```
AuditRecord {
    version:          12,
    env_id:           "prod",
    change_type:      ConfigSet,
    key:              "insurance.claim.max_amount",
    old_value:        "50000",
    new_value:        "75000",
    actor:            GADMIN...,
    ledger_sequence:  4329871,
    memo:             "approved by board",
}
```

### Query the audit log

```rust
// Get a single record.
let record = contract.get_audit_record("prod", 12);

// Get a range.
let records = contract.get_audit_range("prod", 1, 20);

// Get the 5 most recent.
let recent = contract.get_recent_audit("prod", 5);
```

**Compliance note:** Records are keyed by version number and cannot be
overwritten.  This provides an immutable, on-chain audit trail suitable for
HIPAA audit requirements.

---

## 7. Snapshot & Rollback

### Create a snapshot before a risky deployment

```rust
let keys = vec![
    "insurance.claim.max_amount",
    "insurance.claim.auto_approve_limit",
    "insurance.signature.required_count",
];

let snapshot = contract.create_snapshot(
    admin,
    "prod",
    "Pre-deploy snapshot v2.3.0",
    keys,
)
// snapshot.snapshot_id == 5
```

### Roll back if something goes wrong

```rust
contract.rollback_to_snapshot(
    admin,
    "prod",
    5,                              // snapshot_id
    "Reverting bad v2.3.0 deploy",
)
```

### List available snapshots

```rust
let ids = contract.list_snapshots("prod");
// [1, 2, 3, 4, 5]
```

**Retention:** The default policy retains 20 snapshots per environment.
Older snapshots must be manually cleaned up (future governance action).

---

## 8. Security Controls

### Permission model

| Role | Create env | Write dev/staging | Write prod | Lock | Policy |
|------|-----------|------------------|-----------|------|--------|
| Admin | ✅ | ✅ | ✅ | ✅ | ✅ |
| Operator | ❌ | ✅ | ❌ | ❌ | ❌ |
| Anyone | ❌ | ❌ | ❌ | ❌ | ❌ |

> Production write access can be relaxed by setting `prod_admin_only = false`
> in the SecurityPolicy if operators need to manage production config.

### Manage operators

```rust
contract.add_operator(admin, devops_address)
contract.remove_operator(admin, departing_employee_address)
```

### Update security policy

```rust
contract.update_security_policy(admin, SecurityPolicy {
    min_key_length: 5,
    max_value_length: 4096,
    prod_admin_only: true,
    redact_secrets: true,
    max_entries_per_env: 500,
    max_snapshots_per_env: 20,
})
```

---

## 9. Test Coverage

```
Group A  Initialisation                    2 tests
Group B  Environment management            4 tests
Group C  Config CRUD                       5 tests
Group D  Lock / unlock                     4 tests
Group E  Secret config & redaction         3 tests
Group F  Environment promotion             2 tests
Group G  Feature flags                     8 tests
Group H  Access control                    7 tests
Group I  Audit log                         4 tests
Group J  Snapshot & rollback               5 tests
Group K  Security policy                   4 tests
──────────────────────────────────────────────────
Total                                     48 tests
```

---

## 10. Deployment Workflow

```bash
# 1. Build
cargo build --release --target wasm32-unknown-unknown

# 2. Deploy
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/healthcare_config.wasm \
  --source admin_keypair \
  --network testnet

# 3. Initialise
soroban contract invoke \
  --id CONTRACT_ID \
  --source admin_keypair \
  -- initialise --admin GADMIN_ADDRESS

# 4. Set a config value in prod
soroban contract invoke \
  --id CONTRACT_ID \
  --source admin_keypair \
  -- set_config \
     --caller GADMIN_ADDRESS \
     --env_id prod \
     --key insurance.claim.max_amount \
     --value 50000 \
     --description "Max claimable USD" \
     --is_secret false
```