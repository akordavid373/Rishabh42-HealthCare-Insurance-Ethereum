# CI/CD Pipeline

This repository now includes a full CI/CD pipeline in [.github/workflows/ci-cd.yml](../.github/workflows/ci-cd.yml) and a CodeQL security workflow in [.github/workflows/codeql.yml](../.github/workflows/codeql.yml).

## What Runs

- Rust contract tests and WASM builds
- Backend API tests and coverage generation
- Web client test/build/performance checks with Lighthouse
- API documentation generation with `cargo doc`
- Deployment manifest generation for each promoted release
- Webhook notifications for pipeline results

## Deployment Targets

- `development` deploys to Stellar testnet
- `staging` deploys to Stellar testnet
- `production` deploys to Stellar mainnet

## Required Secrets

- `STELLAR_SECRET_KEY_DEVELOPMENT`, `STELLAR_PUBLIC_KEY_DEVELOPMENT`, `STELLAR_RPC_URL_DEVELOPMENT`
- `STELLAR_SECRET_KEY_STAGING`, `STELLAR_PUBLIC_KEY_STAGING`, `STELLAR_RPC_URL_STAGING`
- `STELLAR_SECRET_KEY_PRODUCTION`, `STELLAR_PUBLIC_KEY_PRODUCTION`, `STELLAR_RPC_URL_PRODUCTION`
- `CI_CD_WEBHOOK_URL` for Slack, Discord, or another JSON webhook endpoint

## Rollback Flow

Rollback is handled by rerunning the deployment workflow with `action=rollback` and a known-good `release_version` ref. The workflow checks out that ref, rebuilds the contract, deploys it again, and records the rollback manifest in [scripts/pipeline/manage-deployment.js](../scripts/pipeline/manage-deployment.js).

## Generated Artifacts

- `deployment.json` at the repository root for the active deployment
- `deployments/<environment>/current.json` for the latest environment-specific manifest
- `deployments/<environment>/releases/<sha>.json` for historical release tracking
- `docs/generated/cicd-summary.md` from the documentation job
