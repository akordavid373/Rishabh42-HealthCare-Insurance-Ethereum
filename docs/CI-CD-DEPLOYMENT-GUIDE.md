# CI/CD Deployment Guide

## Quick Start

### Prerequisites

1. Git repository with `.github/workflows/ci-cd.yml`
2. GitHub Secrets configured per environment
3. Soroban CLI installed (for local testing)
4. Node.js 20+ for running scripts

### Required GitHub Secrets

**All Environments:**

```
STELLAR_SECRET_KEY_DEVELOPMENT
STELLAR_PUBLIC_KEY_DEVELOPMENT
STELLAR_RPC_URL_DEVELOPMENT
STELLAR_SECRET_KEY_STAGING
STELLAR_PUBLIC_KEY_STAGING
STELLAR_RPC_URL_STAGING
STELLAR_SECRET_KEY_PRODUCTION
STELLAR_PUBLIC_KEY_PRODUCTION
STELLAR_RPC_URL_PRODUCTION
CI_CD_WEBHOOK_URL  # Optional: for notifications
SLACK_WEBHOOK_URL  # Optional: for Slack integration
```

## Deployment Workflows

### Scenario 1: Automatic Deployment to Development

**Trigger:** Push to `develop` branch

**What Happens:**

1. Code is pushed to develop
2. GitHub Actions automatically triggers workflow
3. All tests run in parallel
4. If all tests pass → automatic deployment to development
5. Post-deployment health checks verify success
6. Notifications sent

**Time:** ~10-15 minutes

### Scenario 2: Staging Deployment Review

**Trigger:** Push to `main` branch with pull request

**Workflow:**

1. Create pull request to main
2. Checks run (tests, security, etc.)
3. PR requires approval
4. Merge to main triggers auto-deploy to staging
5. Requires environment approval
6. Performs smoke tests
7. Sends notification

**Time:** ~15-20 minutes (plus review time)

**Command (Manual):**

```bash
# If using manual deployment
git tag -a v1.0.0 -m "Release version 1.0.0"
git push origin v1.0.0
```

### Scenario 3: Production Deployment (Manual)

**Process:**

1. **Via GitHub Actions UI:**
   - Go to: Actions → CI CD Pipeline
   - Click "Run workflow"
   - Select inputs:
     - Action: `deploy`
     - Environment: `production`
   - Click "Run workflow"

2. **Automatic Checks:**
   - Pre-deployment security scan
   - All tests execution
   - Performance validation
   - Manual approval required

3. **Monitor:**
   - View live logs in GitHub Actions
   - Check notifications (Slack, webhooks)
   - Review deployment manifest

**Time:** ~20-30 minutes (plus approval time)

### Scenario 4: Emergency Rollback

**When:** Critical issue discovered in production

**Steps:**

1. **Via GitHub Actions:**
   - Actions → CI CD Pipeline
   - "Run workflow"
   - Select:
     - Action: `rollback`
     - Environment: `production`
     - Release version: (previous stable version tag or SHA)

2. **Automatic Process:**
   - Checkout previous version
   - Run complete test suite on target
   - Build WASM artifact
   - Deploy to production
   - Verify deployment success

3. **Post-Rollback:**
   - Review what failed in current version
   - Create incident ticket
   - Plan fix and redeployment

**Time:** ~10-15 minutes

## Configuration Management

### Checking Environment Configuration

```bash
# List all environments
node scripts/pipeline/config.js list

# View specific environment config
node scripts/pipeline/config.js config staging

# Export config to file
node scripts/pipeline/config.js export production prod-config.json

# Validate environment setup
node scripts/pipeline/config.js validate production
```

### Output Example

```
📋 Available Environments:

  development     - Development
    Branch: develop
    Network: testnet
    URL: http://localhost:3001

  staging         - Staging
    Branch: main
    Network: testnet
    URL: https://staging-api.example.com

  production      - Production
    Branch: main
    Network: mainnet
    URL: https://api.example.com
```

## Health Checks & Validation

### Post-Deployment Health Check

Automatic health checks run after deployment, or manually:

```bash
node scripts/pipeline/health-check.js \
  --base-url http://localhost:3001 \
  --max-attempts 5
```

### What Gets Checked

1. ✓ Health endpoint responding
2. ✓ API response time within threshold
3. ✓ Error rate acceptable
4. ✓ Contract state verified
5. ✓ Memory usage normal

### Health Check Output

```
✓ Health endpoint response: 200 (45ms)
✓ basic_health: Health endpoint: 200
✓ api_response_time: Avg response time: 65.43ms (threshold: 1000ms)
✓ error_rate: Error rate: 0.00% (threshold: 5.00%)
✓ contract_state: Contract state verified
✓ memory_usage: Memory: 45.32% (threshold: 80.00%)

✅ All health checks passed on attempt 1
```

### Deployment Validation

```bash
node scripts/pipeline/validate-deployment.js \
  --environment staging \
  --health-check-url https://staging-api.example.com/api/health \
  --api-base-url https://staging-api.example.com
```

## Monitoring & Notifications

### Slack Integration

Set up Slack webhook and configure in GitHub Secrets:

```
SLACK_WEBHOOK_URL: https://hooks.slack.com/services/T.../B.../X...
```

**Notification Example:**

```
✅ Pipeline Completed
Repository: Rishabh42/HealthCare-Insurance-Stellar
Branch: main
Status Details:
  • Build: Passed
  • Tests: Passed
  • Deploy: Successful
[View Details](link)
```

### Custom Webhooks

Send notifications to any endpoint:

```bash
# In GitHub Secrets
CUSTOM_WEBHOOKS: '[{"url": "https://monitor.example.com/pipeline", "headers": {"Authorization": "Bearer token"}}]'
```

### Test Notification

```bash
# Test Slack integration
node scripts/pipeline/notify.js test
```

## Artifact Management

### Artifact Locations

Artifacts automatically uploaded and available for download:

**Pipeline Artifacts:**

- `healthcare-wasm` - Compiled WASM contract
- `backend-coverage` - Test coverage reports
- `web-client-lighthouse-report` - Performance metrics
- `security-findings` - Security scan results
- `linting-reports` - Code quality reports
- `pipeline-docs` - Generated documentation
- `deployment-manifest-*` - Deployment records

### Accessing Artifacts

1. Go to Actions → Run
2. Scroll to Artifacts section
3. Download desired artifact

### Retention Policy

| Environment | Artifacts | Deployments | Logs    |
| ----------- | --------- | ----------- | ------- |
| Development | 30 days   | 30 days     | 7 days  |
| Staging     | 60 days   | 60 days     | 30 days |
| Production  | 365 days  | 365 days    | 90 days |

## Deployment Manifests

### Location

```
deployments/
├── development/
│   ├── current.json        # Latest deployment
│   ├── previous.json       # Previous deployment
│   └── releases/
│       ├── sha1.json
│       ├── sha2.json
│       └── ...
├── staging/
│   ├── current.json
│   ├── previous.json
│   └── releases/
└── production/
    ├── current.json
    ├── previous.json
    └── releases/
```

### Manifest Contents

```json
{
  "schema_version": 1,
  "environment": "staging",
  "network": "testnet",
  "release_version": "abc123def456...",
  "commit_sha": "abc123def456...",
  "deployed_at": "2024-01-15T10:30:00Z",
  "status": "deployed",
  "contract_id": "CA7QYNF7PEFK4Z5L...",
  "admin_address": "GBU7VTAX3...",
  "artifact_sha256": "def456ghi789...",
  "artifact_path": "target/wasm32v1-none/release/healthcare_drips.wasm"
}
```

## Performance Monitoring

### Performance Thresholds

Set per environment in `scripts/pipeline/config.js`:

```javascript
performanceThresholds: {
  responseTime: 1000,  // milliseconds
  errorRate: 0.05,     // 5%
}
```

### Performance Reports

Generated after each run:

**Backend Performance:**

- `backend-performance-metrics.json` - Autocannon results
- `eslint-backend.json` - Code quality issues

**Frontend Performance:**

- `web-client-lighthouse.json` - Lighthouse scores
- Metrics: First Contentful Paint, Largest Contentful Paint, Cumulative Layout Shift

### Trend Analysis

Compare performance between deployments:

```bash
# Download performance artifacts
# Compare JSON files: older vs newer
# Track metrics over time
# Alert on regressions
```

## Troubleshooting

### Pipeline Won't Start

**Check:**

1. Branch name is correct (develop for dev, main for staging/prod)
2. Commit pushed (not just local)
3. `.github/workflows/ci-cd.yml` exists
4. No YAML syntax errors

**Solution:**

```bash
# Validate YAML
npm install -g yaml-validator
yaml-validator .github/workflows/ci-cd.yml
```

### Tests Failing

**Steps:**

1. Check test output in GitHub Actions logs
2. Download test artifacts for detailed analysis
3. Run tests locally:
   ```bash
   npm test -- --verbose
   cargo test -- --nocapture
   ```
4. Fix and push changes

### Security Scan Failures

**Common Issues:**

1. Known vulnerabilities in dependencies
   - Update packages: `npm update`
   - Review npm audit report
2. Secrets detected
   - Remove from code
   - Add to `.gitignore`
   - Rotate secret values

3. Code quality issues
   - Fix linting errors: `npm run lint -- --fix`
   - Address clippy warnings: `cargo clippy --fix`

### Deployment Validation Failures

```bash
# Run validation locally
node scripts/pipeline/validate-deployment.js \
  --environment staging \
  --health-check-url https://staging-api.example.com/api/health

# Check deployment manifest
cat deployments/staging/current.json

# Manual health check
curl https://staging-api.example.com/api/health
```

### Rollback Failed

1. Check rollback logs in GitHub Actions
2. Verify target version exists in releases/
3. Ensure rollback target passes tests locally
4. Try specific commit SHA instead of tag

## Advanced Usage

### Local Workflow Testing

```bash
# Install act (GitHub Actions locally)
npm install -g act

# Run specific job
act -j rust-build

# Run with specific branch
act -b develop

# Debug mode
act -j rust-build -v
```

### Manual Deployment Command

```bash
# Deploy without GitHub Actions
bash scripts/deploy.sh

# Requires: STELLAR_SECRET_KEY, STELLAR_PUBLIC_KEY, STELLAR_RPC_URL env vars
```

### Generate Documentation

```bash
# Generate Rust docs
cargo doc --no-deps

# Generate backend docs
npx jsdoc -c jsdoc.json -d docs/api-backend

# Create CI/CD report
node scripts/pipeline/config.js export production config.json
```

### Custom Notification

```bash
# Send custom webhook notification
node scripts/pipeline/notify.js pipeline success

# Environment variables:
# SLACK_WEBHOOK_URL
# CUSTOM_WEBHOOKS (JSON array)
# GITHUB_REPOSITORY
# GITHUB_ACTOR
```

## Best Practices

1. **Branch Strategy**
   - `develop` → Testing environment
   - `main` → Staging environment
   - Tags → Production releases

2. **Commit Messages**
   - Use conventional commits: `feat:`, `fix:`, `docs:`, `chore:`
   - Helps with changelog generation

3. **Code Review**
   - Require PR reviews before merge
   - Let CI/CD pass before review request
   - Use branch protection rules

4. **Deployment Safety**
   - Always deploy to staging first
   - Observe monitoring for issues
   - Use canary deployments when possible
   - Have rollback plan ready

5. **Security**
   - Rotate secrets regularly
   - Review security scan findings
   - Update dependencies frequently
   - Limit deployment access to team

6. **Monitoring**
   - Set up alerts for failed deployments
   - Track performance trends
   - Review error logs regularly
   - Maintain deployment history

## Getting Help

- **GitHub Actions Documentation**: https://docs.github.com/en/actions
- **Workflow Logs**: Actions → Run → Job output
- **Artifact Inspection**: Actions → Run → Artifacts
- **Team Slack**: `#cicd-pipeline` channel

## Checklists

### Pre-Production Deployment

- [ ] All tests passing
- [ ] Security scan clean
- [ ] Performance metrics acceptable
- [ ] No critical issues in staging
- [ ] Stakeholder approval obtained
- [ ] Rollback plan prepared
- [ ] Team notified
- [ ] Monitoring alerts configured

### Post-Deployment

- [ ] Health checks passing
- [ ] Error rates normal
- [ ] Performance stable
- [ ] User-facing tests passing
- [ ] Deployment manifest recorded
- [ ] Team notified
- [ ] Documentation updated

### Incident Response

- [ ] Issue identified and isolated
- [ ] Root cause analyzed
- [ ] Fix implemented and tested
- [ ] Rollback considered/executed if needed
- [ ] Post-incident review scheduled
- [ ] Preventive measures implemented
