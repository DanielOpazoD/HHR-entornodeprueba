#!/usr/bin/env node
// Operator-only metadata change. No document reads/writes, rules or IAM changes.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const project = args.find(arg => arg.startsWith('--project='))?.split('=')[1];
const apply = args.includes('--apply');
const allowedProjects = new Set(['hhr-pruebas', 'hhr-serviciohospitalizados']);
if (
  !allowedProjects.has(project) ||
  args.some(arg => arg !== '--apply' && arg !== `--project=${project}`)
) {
  throw new Error(
    'Usage: node scripts/apply-firestore-storage-policy.mjs --project=<hhr-pruebas|hhr-serviciohospitalizados> [--apply]'
  );
}
const payloadFields = ['beds', 'discharges', 'transfers', 'cma', 'rayenSyncHistory'];
const allowed = new Set([
  ...['dailyRecords', 'history', 'deletedRecords'].flatMap(group =>
    payloadFields.map(field => `${group}/${field}`)
  ),
  'conflictSnapshots/record',
  'conflictSnapshots/expireAt',
  'auditLogs/details',
  'cudyrSupplementFiles/base64',
  'cudyrContextEvidence/base64',
  'specialtyAiRequests/expireAt',
]);
const config = JSON.parse(fs.readFileSync('firestore.indexes.json', 'utf8'));
const policies = config.fieldOverrides;
if (
  !Array.isArray(policies) ||
  policies.length !== allowed.size ||
  new Set(policies.map(p => `${p.collectionGroup}/${p.fieldPath}`)).size !== allowed.size ||
  policies.some(
    p =>
      !allowed.has(`${p.collectionGroup}/${p.fieldPath}`) ||
      !Array.isArray(p.indexes) ||
      p.indexes.length !== 0 ||
      (p.fieldPath === 'expireAt' ? p.ttl !== true : p.ttl !== undefined)
  )
) {
  throw new Error('Unexpected storage policy; review the allowlist before running.');
}
// Let the official CLI own credentials and API pagination; never handle credentials here.
const cli = command => {
  const output = execFileSync(
    'gcloud',
    [...command, `--project=${project}`, '--format=json', '--quiet'],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 90_000,
    }
  );
  return output.trim() ? JSON.parse(output) : {};
};
const fields = cli(['firestore', 'indexes', 'fields', 'list']);
const indexes = cli(['firestore', 'indexes', 'composite', 'list']);
const ttls = cli(['firestore', 'fields', 'ttls', 'list']);
const base = `projects/${project}/databases/(default)/collectionGroups/`;
// The pre-existing Jev pilot belongs to its own release; never activate it in production.
const managedPolicies = policies.filter(policy => policy.collectionGroup !== 'specialtyAiRequests');
// Check the complete plan before the first mutation. Preserve explicit child indexes.
for (const policy of managedPolicies) {
  const prefix = `${base}${policy.collectionGroup}/fields/`;
  const path = policy.fieldPath;
  const current = fields.find(field => field.name === prefix + path);
  if (current?.indexConfig?.reverting) {
    throw new Error(`Exemption reverting on ${policy.collectionGroup}/${path}; wait and recheck.`);
  }
  const offset = ttls.find(field => field.name === prefix + path)?.ttlConfig?.expirationOffset;
  if (policy.ttl && offset != null && !/^0(?:\.0{1,9})?s$/.test(String(offset))) {
    throw new Error(
      `Different TTL expiration offset on ${policy.collectionGroup}/${path}; review before applying.`
    );
  }
  if (
    fields.some(
      field => field.name.startsWith(prefix + path + '.') && !field.indexConfig?.usesAncestorConfig
    )
  ) {
    throw new Error(
      `Explicit child index beneath ${policy.collectionGroup}/${path}; review before applying.`
    );
  }
  if (
    indexes.some(
      index =>
        index.name.includes(`/collectionGroups/${policy.collectionGroup}/`) &&
        index.fields.some(
          field => field.fieldPath === path || field.fieldPath.startsWith(path + '.')
        )
    )
  ) {
    throw new Error(
      `Composite index references ${policy.collectionGroup}/${path}; review before applying.`
    );
  }
  if (
    fields.some(
      field =>
        field.name === prefix + path &&
        !field.indexConfig?.usesAncestorConfig &&
        field.indexConfig?.indexes?.length
    )
  ) {
    throw new Error(
      `Explicit field index on ${policy.collectionGroup}/${path}; review before applying.`
    );
  }
  if (
    policy.ttl &&
    ttls.some(
      field => field.name.startsWith(prefix) && field.name !== prefix + path && field.ttlConfig
    )
  ) {
    throw new Error(`Different TTL field on ${policy.collectionGroup}; review before applying.`);
  }
}
console.log(
  JSON.stringify({
    project,
    mode: apply ? 'apply' : 'read-only',
    compositeIndexesPreserved: indexes.length,
  })
);
for (const policy of managedPolicies) {
  const resource = `${base}${policy.collectionGroup}/fields/${policy.fieldPath}`;
  const current = fields.find(field => field.name === resource);
  const disabled =
    current?.indexConfig &&
    !current.indexConfig.usesAncestorConfig &&
    !current.indexConfig.indexes?.length;
  const ttlState = ttls.find(field => field.name === resource)?.ttlConfig?.state;
  const ttlEnabled = ['ACTIVE', 'CREATING'].includes(ttlState);
  if (disabled && (!policy.ttl || ttlEnabled)) {
    console.log(
      JSON.stringify({
        field: `${policy.collectionGroup}/${policy.fieldPath}`,
        status: policy.ttl && ttlState !== 'ACTIVE' ? 'pending' : 'already-configured',
      })
    );
    continue;
  }
  if (!apply) {
    console.log(
      JSON.stringify({
        field: `${policy.collectionGroup}/${policy.fieldPath}`,
        status: 'planned',
        ttl: Boolean(policy.ttl),
      })
    );
    continue;
  }
  const operations = [];
  const target = [
    policy.fieldPath,
    `--collection-group=${policy.collectionGroup}`,
    '--database=(default)',
    '--async',
  ];
  if (!disabled)
    operations.push(
      cli(['firestore', 'indexes', 'fields', 'update', ...target, '--disable-indexes'])
    );
  if (policy.ttl && !ttlEnabled) {
    operations.push(cli(['firestore', 'fields', 'ttls', 'update', ...target, '--enable-ttl']));
  }
  if (operations.some(operation => operation.error))
    throw new Error('Policy operation failed; inspect gcloud metadata.');
  console.log(
    JSON.stringify({
      field: `${policy.collectionGroup}/${policy.fieldPath}`,
      status: 'accepted',
      operations: operations.map(operation => operation.name),
    })
  );
}
// Acceptance is not completion: index reclamation and TTL deletion are asynchronous.
if (apply)
  console.log(
    'Requests accepted. Verify field/operation status and storage metrics; no savings claimed yet.'
  );
