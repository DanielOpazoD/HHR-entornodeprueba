import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildAuditAttemptEnv,
  buildAuditReproducibilityMetadata,
  classifyAuditFailure,
  getAuditFailureGuidance,
  shouldRetryAuditWithSystemCa,
} from '../../../scripts/lib/dependencyAuditSupport.mjs';

describe('dependency audit support', () => {
  it('audits production and development dependencies at the blocking threshold', () => {
    const script = fs.readFileSync('scripts/check-dependency-vulnerabilities.mjs', 'utf8');
    const workflow = fs.readFileSync('.github/workflows/security-audit.yml', 'utf8');

    expect(script).toContain("const auditArgs = ['audit', '--audit-level=high', '--json'];");
    expect(script).not.toContain('--omit=dev');
    expect(workflow).toContain('Audit production and development dependencies');
  });

  it('classifies npm audit certificate trust failures distinctly', () => {
    expect(
      classifyAuditFailure({
        stdout: '',
        stderr:
          'request to https://registry.npmjs.org/-/npm/v1/security/advisories/bulk failed, reason: unable to verify the first certificate',
      })
    ).toBe('certificate_untrusted');

    expect(
      classifyAuditFailure({
        stdout: '',
        stderr: 'curl: (60) SSL certificate problem: unable to get local issuer certificate',
      })
    ).toBe('certificate_untrusted');

    expect(
      classifyAuditFailure({
        stdout: '',
        stderr: 'npm ERR! code SELF_SIGNED_CERT_IN_CHAIN',
      })
    ).toBe('certificate_untrusted');
  });

  it('classifies registry policy blocks separately from generic audit failures', () => {
    expect(
      classifyAuditFailure({
        stdout:
          '<html><title>Application Blocked</title><body>FortiGate Application Control blocked Npmjs</body></html>',
        stderr: 'npm error 403 Forbidden - registry.npmjs.org',
      })
    ).toBe('registry_policy_blocked');
  });

  it('returns operator guidance for external audit blockers', () => {
    expect(getAuditFailureGuidance('certificate_untrusted')).toContain('npm CA');
    expect(getAuditFailureGuidance('certificate_untrusted')).toContain(
      'docs/CI_GATES_AND_FAILURE_RUNBOOKS.md'
    );
    expect(getAuditFailureGuidance('registry_policy_blocked')).toContain('allowlist');
  });

  it('builds exact local and CI repro steps for dependency audit blockers', () => {
    const metadata = buildAuditReproducibilityMetadata({
      failureCategories: ['certificate_untrusted', 'network_unavailable'],
    });

    expect(metadata.status).toBe('external_blocker');
    expect(metadata.localCommands).toEqual([
      'NODE_OPTIONS=--use-system-ca npm run check:dependency-vulnerabilities',
      'npm config get cafile',
      'npm ping --registry=https://registry.npmjs.org',
    ]);
    expect(metadata.ciEvidence).toContain('GitHub Actions');
    expect(metadata.mustNotDo).toContain('npm config set strict-ssl false');
  });

  it('retries certificate failures with the system CA option exactly once', () => {
    expect(
      shouldRetryAuditWithSystemCa({
        failureCategory: 'certificate_untrusted',
        nodeOptions: '',
      })
    ).toBe(true);

    const retryEnv = buildAuditAttemptEnv({ NODE_OPTIONS: '--trace-warnings' }) as {
      NODE_OPTIONS?: string;
    };
    expect(retryEnv.NODE_OPTIONS).toBe('--trace-warnings --use-system-ca');

    expect(
      shouldRetryAuditWithSystemCa({
        failureCategory: 'certificate_untrusted',
        nodeOptions: '--use-system-ca',
      })
    ).toBe(false);
  });

  it('lets the dependency audit script recover from a certificate-only npm audit failure', () => {
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dependency-audit-'));
    const fakeBinDir = path.join(fixtureDir, 'bin');
    const functionsDir = path.join(fixtureDir, 'functions');
    fs.mkdirSync(fakeBinDir);
    fs.mkdirSync(functionsDir);

    const manifest = JSON.stringify({ name: 'audit-fixture', version: '1.0.0' });
    const lockfile = JSON.stringify({ name: 'audit-fixture', lockfileVersion: 3, packages: {} });
    fs.writeFileSync(path.join(fixtureDir, 'package.json'), manifest);
    fs.writeFileSync(path.join(fixtureDir, 'package-lock.json'), lockfile);
    fs.writeFileSync(path.join(functionsDir, 'package.json'), manifest);
    fs.writeFileSync(path.join(functionsDir, 'package-lock.json'), lockfile);

    const fakeNpmPath = path.join(fakeBinDir, 'npm');
    fs.writeFileSync(
      fakeNpmPath,
      [
        '#!/bin/sh',
        'if printf "%s" "$NODE_OPTIONS" | grep -q -- "--use-system-ca"; then',
        '  printf \'{"metadata":{"vulnerabilities":{"info":0,"low":0,"moderate":0,"high":0,"critical":0,"total":0}},"vulnerabilities":{}}\\n\'',
        '  exit 0',
        'fi',
        'echo "request to https://registry.npmjs.org/-/npm/v1/security/advisories/bulk failed, reason: unable to verify the first certificate" >&2',
        'exit 1',
        '',
      ].join('\n')
    );
    fs.chmodSync(fakeNpmPath, 0o755);

    const scriptPath = path.join(process.cwd(), 'scripts/check-dependency-vulnerabilities.mjs');
    execFileSync(process.execPath, [scriptPath], {
      cwd: fixtureDir,
      env: {
        ...process.env,
        PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH || ''}`,
        NODE_OPTIONS: '',
      },
      encoding: 'utf8',
    });

    const report = JSON.parse(
      fs.readFileSync(path.join(fixtureDir, 'reports/security/dependency-audit.json'), 'utf8')
    );

    expect(report.overallStatus).toBe('ok');
    expect(report.workspaces).toHaveLength(2);
    expect(
      report.workspaces.every(
        (workspace: {
          firstFailureCategory: string;
          recoveryAttempted: string;
          retriedWithSystemCa: boolean;
        }) =>
          workspace.firstFailureCategory === 'certificate_untrusted' &&
          workspace.recoveryAttempted === 'system_ca_retry' &&
          workspace.retriedWithSystemCa
      )
    ).toBe(true);

    const markdown = fs.readFileSync(
      path.join(fixtureDir, 'reports/security/dependency-audit.md'),
      'utf8'
    );
    expect(markdown).toContain('- First failure category: `certificate_untrusted`');
    expect(markdown).toContain('- Retried with system CA: `yes`');
    expect(markdown).toContain('## Reproducibility');
    expect(markdown).toContain('npm ping --registry=https://registry.npmjs.org');
  });
});
