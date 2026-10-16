import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const TARGET = 'hhr-pruebas';
const SOURCE = 'hhr-serviciohospitalizados';
const RELEASE = `projects/${TARGET}/releases/cloud.firestore`;
const API = 'https://firebaserules.googleapis.com/v1/';
const expectedProjects = { [TARGET]: '339724354374', [SOURCE]: '179072085914' };
const sourceFunctionResource = new RegExp(
  `^projects/${SOURCE}/locations/[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?/functions/[A-Za-z](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9])?$`
);
const hash = value => createHash('sha256').update(value).digest('hex');
/**
 * @param {string[]} args
 * @param {(command: string, args: string[], options: object) => {status: number|null, stdout: string|Buffer, stderr?: string|Buffer, error?: Error}} execute
 */
export const runMigrationGcloud = (args, execute = spawnSync) => {
  const result = execute(process.env.GCLOUD_BIN || 'gcloud', [...args, '--verbosity=warning'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30000,
  });
  // A successful list may still omit unreachable regions and warn on stderr.
  // Without a complete inventory, absence is not evidence of deletion.
  if (result.error || result.status !== 0 || String(result.stderr || '').trim())
    throw new Error('migration_gcloud_verification_incomplete');
  return String(result.stdout).trim();
};

/** Only the fixed rules release and its same-project ruleset may be read. */
export const makeRulesReader = (token, fetchImpl = fetch) => {
  if (typeof token !== 'string' || !token || /\s/.test(token))
    throw new Error('rules_credentials_unavailable');
  return async resource => {
    if (resource !== RELEASE && !/^projects\/hhr-pruebas\/rulesets\/[A-Za-z0-9_-]+$/.test(resource))
      throw new Error('rules_endpoint_not_allowed');
    const response = await fetchImpl(API + resource, {
      method: 'GET',
      redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, 'x-goog-user-project': TARGET },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error('rules_read_failed');
    return response.json();
  };
};

/** Reports deployment drift; neither local files nor cloud resources are modified. */
export const collectBackendReadiness = async ({
  expectedRules = '',
  runGcloud = runMigrationGcloud,
  fetchImpl = fetch,
  observedAt = new Date().toISOString(),
} = {}) => {
  if (typeof expectedRules !== 'string' || !expectedRules.trim())
    throw new Error('expected_rules_missing');
  for (const [project, number] of Object.entries(expectedProjects)) {
    const metadata = JSON.parse(
      runGcloud([
        'projects',
        'describe',
        project,
        '--format=json(projectId,projectNumber,lifecycleState)',
      ])
    );
    if (
      metadata.projectId !== project ||
      String(metadata.projectNumber) !== number ||
      metadata.lifecycleState !== 'ACTIVE'
    )
      throw new Error('migration_project_identity_mismatch');
  }
  const read = makeRulesReader(runGcloud(['auth', 'print-access-token']), fetchImpl);
  const before = await read(RELEASE);
  if (before.name !== RELEASE || typeof before.rulesetName !== 'string' || !before.updateTime)
    throw new Error('invalid_rules_release');
  const ruleset = await read(before.rulesetName);
  const files = ruleset.source?.files;
  if (
    ruleset.name !== before.rulesetName ||
    !Array.isArray(files) ||
    files.length !== 1 ||
    files[0].name !== 'firestore.rules' ||
    typeof files[0].content !== 'string' ||
    !files[0].content.trim()
  )
    throw new Error('invalid_rules_source');
  const inventory = JSON.parse(
    runGcloud([
      'functions',
      'list',
      `--project=${SOURCE}`,
      '--regions=-',
      '--format=json(name,state,status)',
    ])
  );
  if (
    !Array.isArray(inventory) ||
    inventory.some(
      item =>
        typeof item?.name !== 'string' ||
        item.name !== item.name.trim() ||
        !sourceFunctionResource.test(item.name)
    ) ||
    new Set(inventory.map(item => item.name)).size !== inventory.length
  )
    throw new Error('invalid_mirror_inventory');
  // Inspect the complete list: removing the census mirror alone leaves other writers alive.
  const remainingFunctions = inventory
    .filter(item => /^mirror/i.test(item.name.split('/').at(-1)))
    .map(item => item.name)
    .sort();
  const after = await read(RELEASE);
  const stable =
    before.name === after.name &&
    before.rulesetName === after.rulesetName &&
    before.updateTime === after.updateTime;
  const expectedHash = hash(expectedRules);
  const deployedHash = hash(files[0].content);
  return {
    schemaVersion: 2,
    observedAt,
    rules: {
      project: TARGET,
      expectedHash,
      deployedHash,
      releaseUpdatedAt: before.updateTime,
      readWindowStable: stable,
      matchesExpected: stable && expectedHash === deployedHash,
    },
    mirror: {
      project: SOURCE,
      function: 'mirror*',
      scope: 'all-regions-all-mirror-functions',
      remainingFunctions,
      state: remainingFunctions.length === 0 ? 'deleted' : 'present',
    },
    cloudWrites: 0,
    authorizesDeployment: false,
  };
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 2) throw new Error('no_mutation_mode');
    const report = await collectBackendReadiness({
      expectedRules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'),
    });
    console.log(JSON.stringify(report));
    process.exitCode = report.rules.matchesExpected && report.mirror.state === 'deleted' ? 0 : 2;
  } catch {
    console.error('No se pudo verificar el backend. No se modificaron reglas, funciones ni datos.');
    process.exitCode = 1;
  }
}
