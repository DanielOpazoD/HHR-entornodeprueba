// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  collectBackendReadiness,
  makeRulesReader,
  runMigrationGcloud,
} from '../../../scripts/migration/readBackendReadiness.mjs';

const target = 'hhr-pruebas';
const source = 'hhr-serviciohospitalizados';
const releaseName = `projects/${target}/releases/cloud.firestore`;
const rulesetName = `projects/${target}/rulesets/test-123`;
const content = "rules_version = '2'; service cloud.firestore {}";
const release = { name: releaseName, rulesetName, updateTime: '2026-10-16T12:00:00Z' };

const fixture = () => {
  const runGcloud = vi.fn((args: string[]) => {
    if (args[0] === 'projects')
      return JSON.stringify({
        projectId: args[2],
        projectNumber: args[2] === target ? '339724354374' : '179072085914',
        lifecycleState: 'ACTIVE',
      });
    if (args[0] === 'auth') return 'synthetic-secret';
    if (args[0] === 'functions') return '[]';
    throw new Error('unexpected_command');
  });
  const fetchImpl = vi.fn<typeof fetch>(async url =>
    Response.json(
      String(url).endsWith('/releases/cloud.firestore')
        ? release
        : { name: rulesetName, source: { files: [{ name: 'firestore.rules', content }] } }
    )
  );
  return { expectedRules: content, runGcloud, fetchImpl, observedAt: '2026-10-16T12:01:00Z' };
};

describe('read-only migration backend verification', () => {
  it('rejects a successful but incomplete regional list reported on stderr', () => {
    const execute = vi.fn((..._args: unknown[]) => ({
      status: 0,
      stdout: '[]',
      stderr: 'WARNING: Some regions were unreachable. PRIVATE_PROVIDER_DETAIL',
    }));
    expect(() => runMigrationGcloud(['functions', 'list'], execute)).toThrow(
      'migration_gcloud_verification_incomplete'
    );
    expect(() => runMigrationGcloud(['functions', 'list'], execute)).not.toThrow(
      'PRIVATE_PROVIDER_DETAIL'
    );
    expect(execute.mock.calls[0][1]).toEqual(['functions', 'list', '--verbosity=warning']);
  });

  it('accepts only a successful command without completeness warnings', () => {
    expect(
      runMigrationGcloud(
        [],
        vi.fn(() => ({ status: 0, stdout: '[]\n', stderr: '' }))
      )
    ).toBe('[]');
    expect(() =>
      runMigrationGcloud(
        [],
        vi.fn(() => ({ status: 1, stdout: '[]', stderr: '' }))
      )
    ).toThrow('migration_gcloud_verification_incomplete');
  });

  it('checks both project identities and exact deployed content without exposing rules or tokens', async () => {
    const input = fixture();
    const report = await collectBackendReadiness(input);
    expect(report.rules.matchesExpected).toBe(true);
    expect(report.rules.readWindowStable).toBe(true);
    expect(report.rules.expectedHash).toMatch(/^[a-f0-9]{64}$/);
    expect(report.mirror.state).toBe('deleted');
    expect(report.cloudWrites).toBe(0);
    expect(report.authorizesDeployment).toBe(false);
    expect(JSON.stringify(report)).not.toContain('synthetic-secret');
    expect(JSON.stringify(report)).not.toContain(content);
    expect(input.runGcloud.mock.calls[0][0]).toContain(target);
    expect(input.runGcloud.mock.calls[1][0]).toContain(source);
    expect(input.runGcloud.mock.calls.find(([args]) => args[0] === 'functions')?.[0]).toContain(
      '--regions=-'
    );
    for (const [, options] of input.fetchImpl.mock.calls as unknown as [string, RequestInit][]) {
      expect(options.method).toBe('GET');
      expect(options.redirect).toBe('error');
      expect(options.body).toBeUndefined();
      expect(options.headers).toMatchObject({ 'x-goog-user-project': target });
    }
  });

  it('reports stale deployed rules as drift rather than a successful login repair', async () => {
    const input = fixture();
    input.expectedRules += '\n// New recovery policy';
    const report = await collectBackendReadiness(input);
    expect(report.rules.readWindowStable).toBe(true);
    expect(report.rules.matchesExpected).toBe(false);
    expect(report.rules.expectedHash).not.toBe(report.rules.deployedHash);
  });

  it('does not accept a release that changes while being inspected', async () => {
    const input = fixture();
    let reads = 0;
    const original = input.fetchImpl.getMockImplementation()!;
    input.fetchImpl.mockImplementation(async url => {
      if (String(url).endsWith('/releases/cloud.firestore') && ++reads === 2)
        return Response.json({ ...release, updateTime: '2026-10-16T12:02:00Z' });
      return original(url);
    });
    const report = await collectBackendReadiness(input);
    expect(report.rules.matchesExpected).toBe(false);
    expect(report.rules.readWindowStable).toBe(false);
  });

  it('holds a present mirror regardless of an error or offline status', async () => {
    const input = fixture();
    const original = input.runGcloud.getMockImplementation()!;
    input.runGcloud.mockImplementation(args =>
      args[0] === 'functions'
        ? JSON.stringify([
            {
              name: `projects/${source}/locations/region/functions/mirrorDailyRecords`,
              status: 'OFFLINE',
            },
          ])
        : original(args)
    );
    expect((await collectBackendReadiness(input)).mirror.state).toBe('present');
  });

  it('refuses project mismatches before loading credentials or making requests', async () => {
    const input = fixture();
    input.runGcloud.mockReturnValue(JSON.stringify({ projectId: target, projectNumber: '0' }));
    await expect(collectBackendReadiness(input)).rejects.toThrow(
      'migration_project_identity_mismatch'
    );
    expect(input.fetchImpl).not.toHaveBeenCalled();
    expect(input.runGcloud).toHaveBeenCalledTimes(1);
  });

  it('rejects rulesets from other projects before sending credentials', async () => {
    const input = fixture();
    input.fetchImpl.mockResolvedValue(
      Response.json({ ...release, rulesetName: `projects/${source}/rulesets/foreign` })
    );
    await expect(collectBackendReadiness(input)).rejects.toThrow('rules_endpoint_not_allowed');
    expect(input.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    { files: [] },
    { files: [{ name: 'other.rules', content }] },
    { files: [{ name: 'firestore.rules', content: '' }] },
    {
      files: [
        { name: 'firestore.rules', content },
        { name: 'other.rules', content },
      ],
    },
  ])('rejects absent, unexpected or incomplete rules sources', async ({ files }) => {
    const input = fixture();
    input.fetchImpl.mockImplementation(async url =>
      Response.json(
        String(url).endsWith('/releases/cloud.firestore')
          ? release
          : { name: rulesetName, source: { files } }
      )
    );
    await expect(collectBackendReadiness(input)).rejects.toThrow('invalid_rules_source');
  });

  it('rejects malformed function inventory instead of declaring deletion', async () => {
    const input = fixture();
    const original = input.runGcloud.getMockImplementation()!;
    input.runGcloud.mockImplementation(args => (args[0] === 'functions' ? '{}' : original(args)));
    await expect(collectBackendReadiness(input)).rejects.toThrow('invalid_mirror_inventory');
  });

  it('does not treat permission errors as an empty collection', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 403 }));
    await expect(makeRulesReader('test', fetchImpl)(releaseName)).rejects.toThrow(
      'rules_read_failed'
    );
  });

  it.each(['https://example.test', `projects/${source}/rulesets/id`, `${releaseName}/extra`])(
    'never sends credentials to an unapproved endpoint: %s',
    async resource => {
      const fetchImpl = vi.fn();
      await expect(makeRulesReader('test', fetchImpl)(resource)).rejects.toThrow(
        'rules_endpoint_not_allowed'
      );
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  );

  it('CLI rejects mutation flags before any credential or cloud command', () => {
    const result = spawnSync(
      process.execPath,
      ['scripts/migration/readBackendReadiness.mjs', '--apply'],
      {
        encoding: 'utf8',
        env: { ...process.env, GCLOUD_BIN: '/nonexistent-must-not-run' },
      }
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('No se modificaron reglas, funciones ni datos');
    expect(result.stderr).not.toContain('/nonexistent');
  });
});
