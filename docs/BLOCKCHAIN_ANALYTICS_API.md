# Blockchain Analytics API

## Overview

The Blockchain Analytics API provides deterministic backend analytics for healthcare and insurance blockchain workflows across `stellar`, `soroban`, `ethereum`, and generic `blockchain` networks. It supports transaction monitoring, smart contract analysis, compliance reporting, performance metrics, security monitoring, chart-ready visualization data, and generated API documentation.

The implementation uses local SQLite persistence and does not require live blockchain/RPC calls in default code paths, making local development and automated tests deterministic.

## Authentication

All routes are mounted behind the existing `authenticateToken` middleware:

```text
/api/blockchain-analytics/*
Authorization: Bearer <jwt>
```

## Transaction monitoring

### POST `/api/blockchain-analytics/transactions/monitor`

Records a transaction, computes deterministic risk, creates active alerts for `high` or `critical` risk, and returns the monitoring result.

Request:

```json
{
  "network": "stellar",
  "tx_hash": "abc123",
  "from_address": "G...FROM",
  "to_address": "G...TO",
  "contract_address": "optional-contract",
  "asset_code": "XLM",
  "amount": 1250,
  "fee": 0.00001,
  "status": "confirmed",
  "tx_type": "claim_payment",
  "ledger_sequence": 12345,
  "metadata": { "claim_id": "CLM-001" }
}
```

Response `201`:

```json
{
  "success": true,
  "data": {
    "transaction": { "tx_hash": "abc123", "risk_score": 10, "risk_level": "low" },
    "risk_score": 10,
    "risk_level": "low",
    "alerts": [],
    "monitored_at": "2026-04-28T00:00:00.000Z"
  }
}
```

### POST `/api/blockchain-analytics/transactions`

Records or updates a transaction using the unique `(network, tx_hash)` key. Risk is computed and stored, but alert creation is reserved for `/transactions/monitor`.

### GET `/api/blockchain-analytics/transactions`

Filters:

- `network`
- `address` (matches `from_address` or `to_address`)
- `contract_address`
- `status`: `pending|confirmed|failed|reverted|dropped`
- `risk_level`: `low|medium|high|critical`
- `tx_type`
- `from`, `to` ISO8601 creation date range
- `limit` 1-500

### GET `/api/blockchain-analytics/transactions/:network/:txHash`

Returns one transaction or `404`.

## Smart contract analysis

### POST `/api/blockchain-analytics/contracts/analyze`

Runs local deterministic source/ABI checks and persists the result.

Request:

```json
{
  "network": "soroban",
  "contract_address": "CASOROBAN...",
  "contract_name": "ClaimsEscrow",
  "source_code": "contract ClaimsEscrow { ... }",
  "abi": [{ "type": "function", "name": "settleClaim" }],
  "metadata": { "system": "claims" }
}
```

Response includes:

- `security_score` from `0` to `100`
- `risk_level`
- `findings`: severity, category, message, evidence
- `metrics`: source lines, function count, external calls, admin controls, hardcoded addresses, finding count
- `compliance_flags`: HIPAA/GDPR/KYC/AML hints, PII detection, audit recommendation
- `recommendations`

### GET `/api/blockchain-analytics/contracts/analyses`

Filters: `network`, `contract_address`, `risk_level`, `limit`.

### GET `/api/blockchain-analytics/contracts/analyses/:analysisId`

Returns one analysis or `404`.

## Compliance reporting

### POST `/api/blockchain-analytics/compliance/reports`

Generates and persists a period report for frameworks such as HIPAA, GDPR, AML, KYC, SOX, and PCI.

Request:

```json
{
  "report_type": "monthly_blockchain_compliance",
  "framework": "HIPAA/GDPR/AML/KYC/SOX/PCI",
  "period_start": "2026-04-01T00:00:00.000Z",
  "period_end": "2026-04-30T23:59:59.999Z",
  "generated_by": "compliance-user"
}
```

Report fields:

- `summary.total_transactions`
- `summary.total_contract_analyses`
- `summary.total_alerts`
- `summary.high_risk_transactions`
- `summary.risky_contracts`
- `summary.transaction_risk_distribution`
- `summary.smart_contract_risk_distribution`
- `summary.network_distribution`
- `findings`
- `recommendations`
- `generated_at`
- `period_start`, `period_end`

### GET `/api/blockchain-analytics/compliance/reports`

Filters: `report_type`, `framework`, `from`, `to`, `limit`.

### GET `/api/blockchain-analytics/compliance/reports/:reportId`

Returns one report or `404`.

## Performance metrics

### GET `/api/blockchain-analytics/metrics/performance`

Filters: `from`, `to`, `period_start`, `period_end`.

Response includes:

```json
{
  "transaction_count": 42,
  "throughput_per_day": 1.4,
  "success_rate": 0.95,
  "failure_rate": 0.03,
  "pending_rate": 0.02,
  "average_fee": 0.0000123,
  "average_confirmation_time_ms": 1200,
  "latency_buckets": {
    "under_1s": 10,
    "one_to_5s": 20,
    "five_to_30s": 8,
    "over_30s": 1,
    "unknown": 3
  },
  "per_network_counts": { "stellar": 30, "ethereum": 12 },
  "block_or_ledger_coverage": { "with_block_number": 12, "with_ledger_sequence": 30 }
}
```

## Security monitoring

### GET `/api/blockchain-analytics/security/monitoring`

Returns:

- `active_alerts`
- transaction `risk_distribution`
- `suspicious_addresses`
- `high_risk_transactions`
- `risky_contracts`
- security `recommendations`

### GET `/api/blockchain-analytics/security/alerts`

Returns active alerts, optionally filtered by `severity` and limited with `limit`.

## Data visualization

### GET `/api/blockchain-analytics/visualization/dashboard/summary`

Returns a dashboard object containing summary counts, performance metrics, security summary, latest reports, and latest analyses.

### GET `/api/blockchain-analytics/visualization/:dataSource`

Supported sources:

- `transactions_over_time`
- `risk_distribution`
- `network_activity`
- `contract_scores`
- `compliance_status`
- `dashboard_summary`

Chart response shape:

```json
{
  "data_source": "risk_distribution",
  "period_start": "2026-03-29T00:00:00.000Z",
  "period_end": "2026-04-28T00:00:00.000Z",
  "labels": ["low", "medium", "high", "critical"],
  "values": [20, 7, 3, 1],
  "series": [],
  "raw": [{ "label": "low", "value": 20 }]
}
```

Invalid sources return `400`.

## Documentation generation

### POST `/api/blockchain-analytics/documentation/generate`

Generates and persists API documentation metadata.

Request:

```json
{
  "format": "json",
  "doc_type": "api_reference",
  "generated_by": "developer"
}
```

`format` may be `json`, `markdown`, or `openapi`.

### GET `/api/blockchain-analytics/documentation/latest`

Returns the latest generated documentation record. Optional filter: `format`.

## Schemas

### `blockchain_transactions`

Key fields: `id`, `network`, `tx_hash`, `from_address`, `to_address`, `contract_address`, `asset_code`, `amount`, `fee`, `status`, `tx_type`, `block_number`, `ledger_sequence`, `confirmation_time_ms`, `risk_score`, `risk_level`, `metadata`, `monitored_at`, `created_at`, `updated_at`.

`network + tx_hash` is unique.

### `blockchain_contract_analyses`

Key fields: `analysis_id`, `network`, `contract_address`, `contract_name`, `security_score`, `risk_level`, `findings`, `metrics`, `compliance_flags`, `recommendations`, `metadata`, `analyzed_at`.

### `blockchain_compliance_reports`

Key fields: `report_id`, `report_type`, `framework`, `period_start`, `period_end`, `summary`, `findings`, `recommendations`, `generated_by`, `generated_at`.

### `blockchain_security_alerts`

Key fields: `alert_id`, `alert_type`, `severity`, `network`, `tx_hash`, `contract_address`, `address`, `message`, `evidence`, `status`, `created_at`, `resolved_at`.

### `blockchain_documentation`

Key fields: `doc_id`, `doc_type`, `format`, `content`, `generated_at`, `generated_by`.

## Risk scoring

Transaction risk is deterministic and explainable. Signals include:

- failed, reverted, or dropped status
- unusually large amount
- missing or unknown recipient
- known suspicious address records
- smart contract interaction
- high transaction fee
- repeated transaction volume from the same sender
- interaction with previously analyzed risky contracts

Risk levels:

- `low`: `0-34`
- `medium`: `35-64`
- `high`: `65-84`
- `critical`: `85-100`

Smart contract security scoring starts at `100` and subtracts deterministic penalties for red flags such as `selfdestruct`, `delegatecall`, low-level external calls, proxy/upgrade patterns, privileged owner/admin controls, hardcoded addresses, missing access-control patterns, pause/blacklist capability, missing healthcare/compliance metadata, and PII/PHI references.

## Operational and security notes

- Default paths are local and deterministic; no live RPC calls are made by core endpoints.
- JSON fields are parsed safely and tolerate null or malformed stored values.
- SQL access uses parameterized statements.
- Do not store PHI/PII directly on-chain. Store hashes, encrypted references, or off-chain pointers with access controls.
- Review high and critical alerts before claim settlement, reinsurance settlement, or automated payment release.
- Schedule recurring smart contract analysis after source changes, contract upgrades, or integration of new Stellar/Soroban/Ethereum contracts.
