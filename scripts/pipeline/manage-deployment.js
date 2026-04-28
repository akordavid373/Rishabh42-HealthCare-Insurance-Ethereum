#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function parseArgs(argv) {
  const parsed = { _: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith('--')) {
      parsed._.push(token);
      continue;
    }

    const withoutPrefix = token.slice(2);
    const equalsIndex = withoutPrefix.indexOf('=');

    if (equalsIndex >= 0) {
      const key = withoutPrefix.slice(0, equalsIndex);
      const value = withoutPrefix.slice(equalsIndex + 1);
      parsed[key] = value === '' ? true : value;
      continue;
    }

    const nextValue = argv[index + 1];
    if (nextValue && !nextValue.startsWith('--')) {
      parsed[withoutPrefix] = nextValue;
      index += 1;
    } else {
      parsed[withoutPrefix] = true;
    }
  }

  return parsed;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function sha256(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function isoNow() {
  return new Date().toISOString();
}

function resolveManifestRoot(rootDir) {
  return path.resolve(rootDir || process.cwd());
}

function buildManifest(options) {
  const rootDir = resolveManifestRoot(options.rootDir);
  const artifactPath = options.artifactPath
    ? path.resolve(rootDir, options.artifactPath)
    : path.resolve(rootDir, 'target/wasm32v1-none/release/healthcare_drips.wasm');

  const releaseVersion = options.releaseVersion || process.env.GITHUB_SHA || 'local';
  const environment = options.environment || 'development';
  const commitSha = options.commitSha || process.env.GITHUB_SHA || null;

  return {
    schema_version: 1,
    environment,
    network: options.network || process.env.STELLAR_NETWORK || 'testnet',
    rpc_url: options.rpcUrl || process.env.STELLAR_RPC_URL || null,
    release_version: releaseVersion,
    commit_sha: commitSha,
    ref_name: options.refName || process.env.GITHUB_REF_NAME || null,
    workflow: process.env.GITHUB_WORKFLOW || null,
    run_id: process.env.GITHUB_RUN_ID || null,
    run_number: process.env.GITHUB_RUN_NUMBER || null,
    deployed_at: isoNow(),
    status: options.status || 'deployed',
    contract_id: options.contractId || null,
    admin_address: options.adminAddress || null,
    artifact_path: path.relative(rootDir, artifactPath),
    artifact_sha256: sha256(artifactPath),
    notes: options.notes || null,
  };
}

function recordDeployment(options) {
  const rootDir = resolveManifestRoot(options.rootDir);
  const manifest = buildManifest(options);
  const environmentDir = path.join(rootDir, 'deployments', manifest.environment);
  const currentPath = path.join(environmentDir, 'current.json');
  const previousPath = path.join(environmentDir, 'previous.json');
  const releasePath = path.join(environmentDir, 'releases', `${manifest.release_version}.json`);

  ensureDir(path.dirname(currentPath));
  ensureDir(path.dirname(releasePath));

  if (fs.existsSync(currentPath)) {
    fs.copyFileSync(currentPath, previousPath);
  }

  writeJson(currentPath, manifest);
  writeJson(releasePath, manifest);
  writeJson(path.join(rootDir, 'deployment.json'), manifest);

  return {
    currentPath,
    previousPath: fs.existsSync(previousPath) ? previousPath : null,
    releasePath,
    manifest,
  };
}

function rollbackDeployment(options) {
  const rootDir = resolveManifestRoot(options.rootDir);
  const environment = options.environment || 'development';
  const environmentDir = path.join(rootDir, 'deployments', environment);
  const currentPath = path.join(environmentDir, 'current.json');
  const previousPath = path.join(environmentDir, 'previous.json');
  const rollbackPath = path.join(environmentDir, 'rollback.json');

  const previousManifest = readJson(previousPath);
  if (!previousManifest) {
    throw new Error(`No rollback manifest found for ${environment}. Deploy a release first.`);
  }

  const rollbackManifest = {
    ...previousManifest,
    status: 'rollback_target',
    rolled_back_at: isoNow(),
    rollback_reason: options.reason || 'manual rollback',
    superseded_release_version: options.supersededReleaseVersion || null,
  };

  ensureDir(environmentDir);
  writeJson(currentPath, rollbackManifest);
  writeJson(rollbackPath, rollbackManifest);
  writeJson(path.join(rootDir, 'deployment.json'), rollbackManifest);

  return {
    currentPath,
    rollbackPath,
    manifest: rollbackManifest,
  };
}

function printUsage() {
  process.stderr.write([
    'Usage:',
    '  node scripts/pipeline/manage-deployment.js record --environment staging --release-version <sha> --contract-id <id> --artifact-path <path>',
    '  node scripts/pipeline/manage-deployment.js rollback --environment staging --reason "previous release"',
  ].join('\n') + '\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];

  try {
    if (command === 'record') {
      const result = recordDeployment({
        rootDir: args.rootDir || process.cwd(),
        environment: args.environment,
        network: args.network,
        rpcUrl: args.rpcUrl,
        releaseVersion: args.releaseVersion,
        commitSha: args.commitSha,
        refName: args.refName,
        contractId: args.contractId,
        adminAddress: args.adminAddress,
        artifactPath: args.artifactPath,
        status: args.status,
        notes: args.notes,
      });

      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }

    if (command === 'rollback') {
      const result = rollbackDeployment({
        rootDir: args.rootDir || process.cwd(),
        environment: args.environment,
        reason: args.reason,
        supersededReleaseVersion: args.supersededReleaseVersion,
      });

      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }

    printUsage();
    process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

main();