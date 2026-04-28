# CI/CD Pipeline Documentation

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Acceptance Criteria Implementation](#acceptance-criteria-implementation)
4. [Pipeline Stages](#pipeline-stages)
5. [Environment Management](#environment-management)
6. [Deployment Process](#deployment-process)
7. [Rollback Procedures](#rollback-procedures)
8. [Monitoring & Notifications](#monitoring--notifications)
9. [Security & Compliance](#security--compliance)
10. [Troubleshooting](#troubleshooting)

## Overview

The Healthcare Insurance Stellar CI/CD pipeline provides a comprehensive, automated system for continuous integration, testing, and deployment across multiple environments. It implements enterprise-grade practices including security scanning, performance testing, multi-environment deployments, and automated rollback capabilities.

**Key Features:**

- Automated testing integration (unit, integration, performance)
- Multi-environment deployment (development, staging, production)
- Sophisticated rollback mechanisms with validation
- Comprehensive security scanning (SAST, dependency audit, secret detection)
- Performance testing and monitoring
- Automatic documentation generation
- Multi-channel notification system

## Architecture

### Workflow Structure

```
┌─────────────────────────────────────────────────────────────────┐
│                    GitHub Actions Triggers                        │
│  (push to develop/main, pull requests, scheduled, manual)         │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    Parallel Job Execution                         │
│  ┌──────────────┬──────────────┬──────────────┬──────────────┐   │
│  │ Rust Build   │ Security     │ Lint &       │ Backend      │   │
│  │              │ Scanning     │ Format       │ Tests        │   │
│  └──────────────┴──────────────┴──────────────┴──────────────┘   │
│  ┌──────────────┬──────────────┬──────────────┬──────────────┐   │
│  │ Backend      │ Web Client   │ Documentation│ Validation   │   │
│  │ Performance  │ Build        │ Generation   │ Readiness    │   │
│  └──────────────┴──────────────┴──────────────┴──────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    Sequential Deployment                         │
│  (conditional based on branch and approval)                      │
│  Development → Staging → Production                            │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    Notifications & Reporting                      │
│  (Slack, GitHub, custom webhooks, reports archive)              │
└─────────────────────────────────────────────────────────────────┘
```

## Acceptance Criteria Implementation

### 1. Automated Testing Integration ✅

The pipeline includes comprehensive testing across all components:

- **Rust Tests**: Smart contract unit tests
  - Runs on every push
  - Tests contract logic, state transitions, and security
- **Backend Tests**: Node.js API tests
  - 800+ test cases covering all endpoints
  - Integration tests for database and services
  - Coverage reporting and artifact storage
- **Frontend Tests**: React component tests
  - Component rendering tests
  - User interaction tests
  - Accessibility compliance

**Test Artifacts:**

- Coverage reports (HTML, JSON)
- Test results (JUnit XML)
- Performance benchmarks

### 2. Multi-Environment Deployment ✅

Three target environments with distinct configurations:

**Development** (Auto-deploy on develop push)

- Network: Testnet
- Approval: Not required
- URL: http://localhost:3001

**Staging** (Auto-deploy on main push with approval)

- Network: Testnet
- Approval: Required
- URL: https://staging-api.example.com

**Production** (Manual deployment only)

- Network: Mainnet
- Approval: Required + voting
- URL: https://api.example.com

Environment configurations managed via `scripts/pipeline/config.js`

### 3. Rollback Mechanisms ✅

Sophisticated rollback system with multiple safeguards:

**Capabilities:**

- Rollback to any previous release version
- Automatic validation testing on rollback target
- Pre-rollback backup creation
- Post-rollback deployment verification
- Manifest tracking of all deployed versions

**Rollback Trigger:**

```bash
# Via GitHub Actions UI
# Workflow → workflow_dispatch →
# inputs: action=rollback, environment, release_version
```

**Validation Steps:**

1. Checkout specified release version
2. Run full test suite on target code
3. Build WASM artifact
4. Validate contract state
5. Record deployment manifest

### 4. Security Scanning ✅

Multi-layer security scanning integrated into pipeline:

**SAST Scanning:**

- CodeQL analysis (JavaScript)
- Rust clippy linting
- ESLint code quality

**Dependency Scanning:**

- npm audit (backend & frontend)
- cargo audit (Rust dependencies)
- Trivy filesystem scanning

**Secret Detection:**

- detect-secrets scanning
- Git guardian integration
- Environment variable validation

**Network Security:**

- Secure artifact transfer
- Encrypted secret management
- Firewall rules validation

**Reports Generated:**

- Trivy SARIF reports
- npm audit reports
- Cargo audit JSON
- Linting reports

### 5. Performance Testing ✅

Comprehensive performance testing and validation:

**Frontend Performance:**

- Lighthouse audits
  - Performance score monitoring
  - Core Web Vitals tracking
  - Bundle size analysis
- Page load time monitoring
- Asset delivery verification

**Backend Performance:**

- API benchmark testing
  - Request throughput (requests/sec)
  - Latency measurement (min/max/avg)
  - Error rate monitoring
- Database query performance
- Memory usage monitoring
- Response time thresholds by environment:
  - Dev: ≤2000ms
  - Staging: ≤1000ms
  - Production: ≤500ms

**Performance Artifacts:**

- Lighthouse JSON reports
- Autocannon benchmark results
- Performance trend tracking

### 6. Documentation Generation ✅

Automatic documentation generated at each pipeline run:

**Generated Documentation:**

- Rust API documentation (cargo doc)
- Backend API documentation (JSDoc)
- CI/CD execution summary
- Deployment checklist
- Pipeline results report
- Deployment manifests

**Documentation Locations:**

```
docs/generated/
  ├── cicd-summary.md           # Execution overview
  ├── deployment-checklist.md   # Pre-deployment checklist
  ├── api-backend/              # JSDoc API docs
  └── (Rust docs in target/doc/)
```

### 7. Notification System ✅

Multi-channel notification engine `scripts/pipeline/notify.js`:

**Supported Channels:**

- Slack webhooks with rich formatting
- GitHub issue creation on failures
- Custom webhook endpoints
- Email notifications (configurable)

**Notification Types:**

- Pipeline start/completion
- Deployment events
- Rollback events
- Security findings
- Performance warnings
- Test results

**Notification Content:**

- Build status summaries
- Detailed job results
- Performance metrics
- Security scan findings
- Deployment details
- Action items

## Pipeline Stages

### 1. Code Quality & Security (Parallel)

#### Rust Build

- Installs Rust toolchain
- Caches dependencies
- Runs Rust tests
- Builds WASM release artifact

#### Security Scanning

- Trivy vulnerability scan
- npm audit (backend & frontend)
- Cargo audit
- Secret detection
- CodeQL analysis

#### Lint & Format

- ESLint (backend & frontend)
- Rust clippy
- Code style validation

#### Backend Tests

- Unit tests
- Integration tests
- Coverage reporting
- Artifacts upload

#### Backend Performance

- Server startup
- API throughput testing
- Response time measurement
- Performance metrics collection

#### Web Client Build

- Build generation
- Preview server startup
- Lighthouse performance audit
- Browser performance metrics

### 2. Documentation & Validation (Sequential)

#### Documentation Generation

- API documentation
- Execution summary
- Deployment checklist
- Report archival

#### Deployment Validation

- Critical checks verification
- Pre-deployment requirements
- Deployment readiness confirmation

### 3. Deployment (Conditional)

#### Development Deployment

- Triggered on develop push
- Automatic deployment
- Health checks post-deploy
- Manifest recording

#### Staging Deployment

- Triggered on main push
- Requires approval
- Smoke tests
- Manifest recording

#### Production Deployment

- Manual trigger only
- Requires approval + voting
- Pre-deployment backup
- Post-deployment validation
- Manifest recording

#### Rollback (On Demand)

- Manual trigger via workflow_dispatch
- Validates rollback target
- Tests target version
- Records rollback manifest

### 4. Notifications & Reporting

#### Notifications

- Pipeline results summary
- Slack messages with details
- GitHub issues on failure
- Custom webhook notifications

#### Reporting

- Complete pipeline report archive
- Individual job artifacts
- Performance metrics
- Deployment manifests
- Rollback records

## Environment Management

### Configuration Files

**Location:** `scripts/pipeline/config.js`

**Environments:**

```javascript
{
  name: "Development",
  branch: "develop",
  network: "testnet",
  apiBaseUrl: "http://localhost:3001",
  autoDeployOnPush: true,
  requiresApproval: false,
  performanceThresholds: {
    responseTime: 2000,
    errorRate: 0.10
  }
}
```

### Environment Variables

Required secrets per environment:

- `STELLAR_SECRET_KEY_{ENV}`
- `STELLAR_PUBLIC_KEY_{ENV}`
- `STELLAR_RPC_URL_{ENV}`

Optional webhooks:

- `CI_CD_WEBHOOK_URL` - Main notification webhook
- `SLACK_WEBHOOK_URL` - Slack integration

### Configuration Export

Export environment configuration:

```bash
node scripts/pipeline/config.js export development config-dev.json
```

## Deployment Process

### Pre-Deployment Steps (Production)

1. Full test suite execution
2. Security audit completion
3. Performance baseline establishment
4. Database backup creation

### Deployment Execution

```bash
# Download WASM artifact
# Install toolchain
# Deploy contract via Soroban CLI
# Record deployment manifest
# Perform health checks
```

### Post-Deployment Validation

1. Contract deployment verification
2. Health endpoint checks
3. API endpoint validation
4. Error rate monitoring
5. Response time validation
6. Resource utilization checks

### Deployment Manifest

Stored at: `deployments/{environment}/current.json`

```json
{
  "environment": "staging",
  "contract_id": "CA...",
  "release_version": "sha123...",
  "deployed_at": "2024-01-01T00:00:00Z",
  "artifact_sha256": "abc123...",
  "status": "deployed"
}
```

## Rollback Procedures

### Authorized Rollback

User triggers via GitHub Actions UI:

1. Go to Workflow → CI CD Pipeline
2. Click "Run workflow"
3. Select:
   - Action: rollback
   - Environment: development|staging|production
   - Release version: git SHA or tag

### Rollback Validation

Automatic checks before deployment:

1. Source existence verification
2. Full test execution on target code
3. WASM artifact build success
4. Pre-rollback state backup

### Rollback Recording

Deployment manifest marked with:

```json
{
  "status": "rollback",
  "previous_release": "sha123...",
  "rolled_back_at": "2024-01-01T00:00:00Z"
}
```

### Manual Rollback Script

```bash
node scripts/pipeline/manage-deployment.js rollback \
  --environment staging \
  --reason "Critical bug discovered"
```

## Monitoring & Notifications

### Notification Channels

**Via notify.js:**

- Slack rich message formatting
- Custom webhooks with full payload
- GitHub issue creation on failure
- Email notifications (configurable)

### Notification Trigger Points

1. Pipeline Start
2. Test Results (success/failure)
3. Security Findings
4. Performance Issues
5. Deployment Start/Complete
6. Rollback Events
7. Pipeline Completion

### Notification Payload

```json
{
  "text": "Healthcare Drips CI/CD finished",
  "repository": "user/repo",
  "status": "success",
  "workflow": "CI CD Pipeline",
  "run_id": "12345",
  "results": {
    "rust_build": "success",
    "security_scan": "success",
    "backend_tests": "success"
  }
}
```

## Security & Compliance

### Secret Management

- All secrets stored in GitHub Secrets (per environment)
- Reference as `${{ secrets.VARIABLE_NAME }}`
- Never exposed in logs
- Rotated per environment

### Access Control

- Environments require approval for sensitive operations
- Production deployment requires explicit workflow trigger
- Role-based deployment approvals
- Audit logging of all deployments

### Compliance

- Code scanning for vulnerabilities
- Dependency audit for known CVEs
- Secret detection in codebase
- Compliance checklist generation
- Deployment records retention

## Troubleshooting

### Common Issues

**1. Workflow Fails Early**

```
Check: Parse-level errors in workflow YAML
Solution: Run `cat .github/workflows/ci-cd.yml | head -20`
Look for: Invalid syntax, unclosed braces, quote issues
```

**2. Test Failures**

```
Check: Test output and coverage
Solution: Review artifact: backend-test logs
Commands: npm test -- --verbose
```

**3. Security Scan Failures**

```
Check: Vulnerability severity level
Solution: Review trivy-results.sarif or npm-audit.txt
Action: Update dependencies or document exceptions
```

**4. Deployment Failures**

```
Check: Environment secrets configured
Solution: Verify GitHub Secrets for environment
Required: STELLAR_SECRET_KEY, STELLAR_PUBLIC_KEY, STELLAR_RPC_URL
```

**5. Performance Issues**

```
Check: Lighthouse or autocannon results
Solution: Profile application, optimize assets
Metrics: Check threshold configurations in config.js
```

### Debug Commands

```bash
# Local workflow validation
npm i -g act
act -j rust-build

# Test management commands
npm test -- --verbose
cargo test -- --nocapture

# Configuration check
node scripts/pipeline/config.js list
node scripts/pipeline/config.js validate staging

# Health check (post-deployment)
node scripts/pipeline/health-check.js --base-url http://localhost:3001

# Manual notification test
node scripts/pipeline/notify.js test

# Deployment validation
node scripts/pipeline/validate-deployment.js --environment development
```

### Support Resources

- GitHub Actions Documentation: https://docs.github.com/en/actions
- Soroban Documentation: https://developers.stellar.org/soroban
- Jest Testing: https://jestjs.io/docs/getting-started
- Lighthouse: https://developers.google.com/web/tools/lighthouse

## Status Dashboard

Current pipeline status and recent deployments can be viewed at:

- GitHub Actions: https://github.com/{owner}/{repo}/actions
- Deployment History: `deployments/` directory
- Reports: `docs/generated/` and artifacts

## References

- [CI/CD Pipeline Configuration](../../.github/workflows/ci-cd.yml)
- [Environment Configuration](../../scripts/pipeline/config.js)
- [Deployment Management](../../scripts/pipeline/manage-deployment.js)
- [Health Checks](../../scripts/pipeline/health-check.js)
- [Notifications](../../scripts/pipeline/notify.js)
- [Deployment Validation](../../scripts/pipeline/validate-deployment.js)
