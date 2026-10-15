// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { assessMigrationPreflight } from '../../../scripts/migration/cutoverPreflight.mjs';

const now = '2026-10-15T12:00:00Z',
  project = 'hhr-pruebas';
const base = { verifiedAt: now, evidenceRef: '/private/checked-evidence' };
const sha = 'a'.repeat(40),
  hash = 'b'.repeat(64);
const fixture = () => ({
  projects: {
    ...base,
    sourceId: 'hhr-serviciohospitalizados',
    sourceNumber: '179072085914',
    targetId: project,
    targetNumber: '339724354374',
  },
  inventory: {
    ...base,
    readWindowStable: true,
    officialCudyrUnchanged: true,
    cloudWrites: 0,
    reportHash: hash,
  },
  mirror: {
    ...base,
    project: 'hhr-serviciohospitalizados',
    function: 'mirrorDailyRecords',
    state: 'disabled',
  },
  deployment: { ...base, project, expectedCommit: sha, deployedCommit: sha },
  rules: { ...base, project, expectedHash: hash, deployedHash: hash },
  localSession: {
    ...base,
    project,
    projectIsolationVerified: true,
    pendingOperations: 0,
    sameOriginTransitionTestPassed: true,
  },
  access: { ...base, project, pendingAuthorizations: 0, unmappedStaff: 0, rolesReviewed: true },
  restore: {
    ...base,
    project,
    restoreTestPassed: true,
    originalsPreserved: true,
    backupManifestHash: hash,
  },
});

describe('migration preflight evidence', () => {
  it('requires every gate, while never authorizing a production cutover', () => {
    const data = fixture(),
      before = structuredClone(data),
      report = assessMigrationPreflight(data, now);
    expect(report.readyForRehearsal).toBe(true);
    expect(report.authorizesProductionCutover).toBe(false);
    expect(report.cloudWrites).toBe(0);
    expect(data).toEqual(before);
    expect(JSON.stringify(report)).not.toContain('/private/');
  });
  it.each(Object.keys(fixture()))('holds absent evidence for %s', key => {
    const data: Record<string, object> = fixture();
    delete data[key];
    expect(assessMigrationPreflight(data, now).readyForRehearsal).toBe(false);
  });
  it.each([
    '2026-10-13T12:00:00Z',
    '2026-10-15T12:00:01Z',
    'invalid',
    '2026-10-15',
    '2026-10-15T12:00:00+00:00',
    '2026-02-30T12:00:00Z',
    '2026-10-14T24:00:00Z',
  ])('rejects stale, future or invalid timestamps: %s', value => {
    const data = fixture();
    data.projects.verifiedAt = value;
    expect(assessMigrationPreflight(data, now).readyForRehearsal).toBe(false);
  });
  it('distinguishes a failed mirror from a disabled mirror', () => {
    const data = fixture();
    data.mirror.state = 'authentication_failed';
    expect(
      assessMigrationPreflight(data, now).checks.find(item => item.id === 'mirror')?.passed
    ).toBe(false);
  });
  it('rejects wrong projects, mismatched deployments/rules and outstanding operations', () => {
    const data = fixture();
    data.projects.targetId = 'other';
    data.deployment.deployedCommit = 'c'.repeat(40);
    data.rules.deployedHash = 'd'.repeat(64);
    data.localSession.pendingOperations = 1;
    expect(
      assessMigrationPreflight(data, now)
        .checks.filter(item => !item.passed)
        .map(item => item.id)
    ).toEqual(['projects', 'deployment', 'rules', 'localSession']);
  });
  it('rejects array hashes and trailing newlines in hashes and commits', () => {
    const data = fixture();
    Object.assign(data.inventory, { reportHash: [hash] });
    Object.assign(data.restore, { backupManifestHash: [hash] });
    data.deployment.expectedCommit = sha + '\n';
    data.deployment.deployedCommit = sha + '\n';
    data.rules.expectedHash = hash + '\n';
    data.rules.deployedHash = hash + '\n';
    expect(
      assessMigrationPreflight(data, now)
        .checks.filter(item => !item.passed)
        .map(item => item.id)
    ).toEqual(['inventory', 'deployment', 'rules', 'restore']);
  });
  it('rejects string booleans, blank references and incomplete restoration proof', () => {
    const data = fixture();
    Object.assign(data.localSession, { projectIsolationVerified: 'true' });
    data.access.evidenceRef = ' ';
    data.restore.restoreTestPassed = false;
    expect(assessMigrationPreflight(data, now).readyForRehearsal).toBe(false);
    expect(assessMigrationPreflight({}, now).checks.every(item => !item.passed)).toBe(true);
  });
});
