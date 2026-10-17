import { createRequire } from 'node:module';
import { openSync, writeSync, fsyncSync, closeSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { runMigrationGcloud } from './readBackendReadiness.mjs';

// Explicit operational write to an isolated named database; never a callable.
const { values } = parseArgs({
  options: {
    database: { type: 'string' },
    month: { type: 'string' },
    receipt: { type: 'string' },
    apply: { type: 'boolean', default: false },
  },
});
if (
  !values.apply ||
  !/^migration-restore-\d{8}-[a-f0-9]{8}$/.test(values.database || '') ||
  !/^2026-(08|09)$/.test(values.month || '') ||
  !values.receipt?.startsWith('/') ||
  process.env.FIRESTORE_EMULATOR_HOST
)
  throw new Error('restore_explicit_isolated_destination_required');
const project = 'hhr-pruebas';
const metadata = JSON.parse(
  runMigrationGcloud([
    'projects',
    'describe',
    project,
    '--format=json(projectId,projectNumber,lifecycleState)',
  ])
);
if (
  metadata.projectId !== project ||
  String(metadata.projectNumber) !== '339724354374' ||
  metadata.lifecycleState !== 'ACTIVE'
)
  throw new Error('restore_project_mismatch');
const require = createRequire(new URL('../../functions/package.json', import.meta.url));
const { Firestore } = require('@google-cloud/firestore');
const { GoogleAuth } = require('google-auth-library');
const { attestOfficialRestore } = require('./lib/cudyrOfficialRestore');
const { readOfficialReport } = require('./lib/cudyrOfficialReportStore');
// Use operator-configured Application Default Credentials; no token files or shell token plumbing.
const auth = new GoogleAuth({
  projectId: project,
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});
const source = new Firestore({ projectId: project, databaseId: '(default)', auth });
const restored = new Firestore({ projectId: project, databaseId: values.database, auth });
const intent = openSync(values.receipt, 'wx', 0o600);
const append = value => {
  writeSync(intent, JSON.stringify(value) + '\n');
  fsyncSync(intent);
};
try {
  // An interrupted attempt must be reconciled using this receipt, never blindly repeated.
  append({
    state: 'intent',
    at: new Date().toISOString(),
    project,
    database: values.database,
    month: values.month,
    sourceClinicalWrites: 0,
    officialArtifactWrites: 0,
  });
  const result = await attestOfficialRestore({
    sourceHospital: source.doc('hospitals/hanga_roa'),
    restoredHospital: restored.doc('hospitals/hanga_roa'),
    month: values.month,
  });
  const readback = await readOfficialReport(restored.doc('hospitals/hanga_roa'), {
    month: values.month,
  });
  if (readback.state !== 'ready' || readback.version !== result.reportVersion)
    throw new Error('restore_reader_acceptance_failed');
  append({
    ...result,
    state: 'verified',
    readerState: readback.state,
    at: new Date().toISOString(),
  });
  console.log(
    JSON.stringify({ verified: true, created: result.created, readerState: readback.state })
  );
} catch {
  append({ state: 'reconcile-required', at: new Date().toISOString() });
  process.exitCode = 1;
} finally {
  closeSync(intent);
  await Promise.all([source.terminate(), restored.terminate()]);
}
