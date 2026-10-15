import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SOURCE = 'hhr-serviciohospitalizados';
const TARGET = 'hhr-pruebas';
const exactHex = (value, length) =>
  typeof value === 'string' && value.length === length && /^[a-f0-9]+$/.test(value);
const MAX_AGE = 24 * 60 * 60 * 1000;
const gates = [
  [
    'projects',
    'Identidad de ambos proyectos',
    data =>
      data.sourceId === SOURCE &&
      data.sourceNumber === '179072085914' &&
      data.targetId === TARGET &&
      data.targetNumber === '339724354374',
  ],
  [
    'inventory',
    'Comparación reciente y CUDYR protegido',
    data =>
      data.readWindowStable === true &&
      data.officialCudyrUnchanged === true &&
      data.cloudWrites === 0 &&
      exactHex(data.reportHash, 64),
  ],
  [
    'mirror',
    'Espejo antiguo detenido',
    data =>
      data.project === SOURCE &&
      data.function === 'mirrorDailyRecords' &&
      data.state === 'disabled',
  ],
  [
    'deployment',
    'Código desplegado identificado',
    data =>
      data.project === TARGET &&
      exactHex(data.expectedCommit, 40) &&
      data.expectedCommit === data.deployedCommit,
  ],
  [
    'rules',
    'Reglas desplegadas cotejadas',
    data =>
      data.project === TARGET &&
      exactHex(data.expectedHash, 64) &&
      data.expectedHash === data.deployedHash,
  ],
  [
    'localSession',
    'Caché y operaciones locales aisladas',
    data =>
      data.project === TARGET &&
      data.projectIsolationVerified === true &&
      data.pendingOperations === 0 &&
      data.sameOriginTransitionTestPassed === true,
  ],
  [
    'access',
    'Funcionarios y accesos revisados',
    data =>
      data.project === TARGET &&
      data.pendingAuthorizations === 0 &&
      data.unmappedStaff === 0 &&
      data.rolesReviewed === true,
  ],
  [
    'restore',
    'Restauración ensayada',
    data =>
      data.project === TARGET &&
      data.restoreTestPassed === true &&
      data.originalsPreserved === true &&
      exactHex(data.backupManifestHash, 64),
  ],
];

const utcInstant = value => {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)
  )
    return NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) &&
    new Date(parsed).toISOString().slice(0, 19) === value.slice(0, 19)
    ? parsed
    : NaN;
};

/** Evidence assessment only. An error or an unknown is never equivalent to a pass. */
export const assessMigrationPreflight = (evidence, now = new Date().toISOString()) => {
  const instant = utcInstant(now);
  if (!Number.isFinite(instant)) throw new Error('invalid_preflight_clock');
  const checks = gates.map(([id, label, predicate]) => {
    const item = evidence?.[id];
    const observed = utcInstant(item?.verifiedAt);
    const fresh =
      Number.isFinite(observed) && instant - observed >= 0 && instant - observed <= MAX_AGE;
    const referenced = typeof item?.evidenceRef === 'string' && Boolean(item.evidenceRef.trim());
    const passed = Boolean(item && fresh && referenced && predicate(item));
    return {
      id,
      label,
      passed,
      reason:
        !item || !referenced
          ? 'missing_evidence'
          : !fresh
            ? 'stale_or_invalid_evidence'
            : passed
              ? 'verified'
              : 'condition_not_met',
    };
  });
  return {
    schemaVersion: 1,
    assessedAt: now,
    checks,
    readyForRehearsal: checks.every(check => check.passed),
    authorizesProductionCutover: false,
    cloudWrites: 0,
  };
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 2) throw new Error('no_mutation_mode');
    const report = assessMigrationPreflight(JSON.parse(readFileSync(0, 'utf8')));
    console.log(JSON.stringify(report));
    process.exitCode = report.readyForRehearsal ? 0 : 2;
  } catch {
    console.error('Preflight incompleto; no se cambió ningún entorno.');
    process.exitCode = 1;
  }
}
