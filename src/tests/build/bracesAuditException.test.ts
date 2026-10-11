// @vitest-environment node
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  BRACES_EXCEPTION,
  evaluateBracesException,
} from '../../../scripts/lib/bracesAuditException.mjs';

const lockText = fs.readFileSync('package-lock.json', 'utf8');
const functionsLock = JSON.parse(fs.readFileSync('functions/package-lock.json', 'utf8'));
const now = Date.parse('2026-10-08T00:00:00Z');
type Vulnerability = {
  name: string;
  severity: string;
  nodes: string[];
  via: (string | Record<string, unknown>)[];
};
const fixture = () => {
  const edges: Record<string, string[]> = {
    '@boundaries/elements': ['micromatch'],
    braces: [],
    chokidar: ['braces'],
    'eslint-plugin-boundaries': ['@boundaries/elements', 'micromatch'],
    'firebase-tools': ['chokidar', 'moderate-dependency'],
    'lint-staged': ['micromatch'],
    micromatch: ['braces'],
  };
  const vulnerabilities: Record<string, Vulnerability> = Object.fromEntries(
    Object.entries(edges).map(([name, via]) => [
      name,
      { name, severity: 'high', nodes: [`node_modules/${name}`], via },
    ])
  );
  vulnerabilities.braces.via = [
    {
      name: 'braces',
      source: 1240992,
      dependency: 'braces',
      severity: 'high',
      url: `https://github.com/advisories/${BRACES_EXCEPTION.advisory}`,
    },
  ];
  vulnerabilities['moderate-dependency'] = {
    name: 'moderate-dependency',
    severity: 'moderate',
    nodes: ['node_modules/moderate-dependency'],
    via: [
      {
        source: 2,
        name: 'moderate-dependency',
        dependency: 'moderate-dependency',
        severity: 'moderate',
        url: 'https://example.test/moderate',
      },
    ],
  };
  return {
    workspace: {
      id: 'root',
      status: 'vulnerable',
      exitCode: 1,
      firstFailureCategory: 'audit_failed',
      report: {
        auditReportVersion: 2,
        vulnerabilities,
        metadata: {
          vulnerabilities: { info: 0, low: 0, moderate: 1, high: 7, critical: 0, total: 8 },
        },
      },
    },
    lockText,
    functionsLock: structuredClone(functionsLock),
    now,
  };
};

describe('authorized development-only braces exception', () => {
  it('accepts the exact causal chain without modifying raw findings or counts', () => {
    const input = fixture();
    const original = JSON.stringify(input);
    expect(evaluateBracesException(input)).toMatchObject({
      accepted: true,
      expiresAt: '2026-10-15T00:00:00Z',
      packages: expect.arrayContaining(['firebase-tools', 'braces']),
    });
    expect(JSON.stringify(input)).toBe(original);
  });
  it.each(['2026-10-06T23:59:59Z', '2026-10-15T00:00:00Z', '2027-01-01T00:00:00Z'])(
    'blocks outside the authorized window: %s',
    time => {
      expect(evaluateBracesException({ ...fixture(), now: Date.parse(time) }).accepted).toBe(false);
    }
  );
  it('blocks a changed lockfile, production reclassification, or braces in Functions', () => {
    expect(evaluateBracesException({ ...fixture(), lockText: lockText + '\n' }).accepted).toBe(
      false
    );
    const changed = JSON.parse(lockText);
    changed.packages['node_modules/braces'].dev = false;
    expect(
      evaluateBracesException({ ...fixture(), lockText: JSON.stringify(changed) }).accepted
    ).toBe(false);
    const input = fixture();
    input.functionsLock.packages['node_modules/braces'] = { version: '3.0.3', dev: true };
    expect(evaluateBracesException(input).accepted).toBe(false);
  });
  it.each(['high', 'critical'])(
    'does not hide an additional %s advisory inside an accepted aggregate package',
    severity => {
      const input = fixture();
      input.workspace.report.vulnerabilities['firebase-tools'].via.push({
        source: 3,
        name: 'firebase-tools',
        dependency: 'firebase-tools',
        severity,
        url: 'https://example.test/new-advisory',
      });
      expect(evaluateBracesException(input)).toMatchObject({
        accepted: false,
        reason: 'additional_blocking_advisory',
      });
    }
  );
  it('blocks unrelated high packages even when counts are consistent', () => {
    const input = fixture();
    input.workspace.report.vulnerabilities.unrelated = {
      name: 'unrelated',
      severity: 'high',
      nodes: [],
      via: [{ severity: 'high' }],
    };
    input.workspace.report.metadata.vulnerabilities.high++;
    input.workspace.report.metadata.vulnerabilities.total++;
    expect(evaluateBracesException(input).accepted).toBe(false);
  });
  it.each([
    'missing',
    'cycle',
    'counts',
    'nodes',
    'advisory',
    'severity',
    'error',
    'moderate-incomplete',
    'network',
  ])('fails closed on changed/incomplete evidence: %s', change => {
    const input = fixture();
    const report = input.workspace.report;
    if (change === 'missing') report.vulnerabilities.micromatch.via = ['unknown'];
    if (change === 'cycle') report.vulnerabilities.micromatch.via = ['micromatch'];
    if (change === 'counts') report.metadata.vulnerabilities.high = 6;
    if (change === 'nodes')
      report.vulnerabilities.braces.nodes.push('node_modules/other/node_modules/braces');
    if (change === 'advisory')
      report.vulnerabilities.braces.via = [{ severity: 'high', url: 'https://example.test/new' }];
    if (change === 'severity') report.vulnerabilities.braces.severity = 'unknown';
    if (change === 'error') input.workspace.exitCode = 2;
    if (change === 'moderate-incomplete')
      report.vulnerabilities['moderate-dependency'].via = [{ severity: 'moderate' }];
    if (change === 'network') input.workspace.firstFailureCategory = 'network_unavailable';
    expect(evaluateBracesException(input).accepted).toBe(false);
  });
  it('retains a visible exception notice, raw reports and nonzero npm exit code in the real CLI', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'braces-audit-'));
    try {
      fs.mkdirSync(path.join(root, 'functions'));
      fs.mkdirSync(path.join(root, 'bin'));
      fs.writeFileSync(path.join(root, 'package.json'), '{}');
      fs.writeFileSync(path.join(root, 'functions/package.json'), '{}');
      fs.writeFileSync(path.join(root, 'package-lock.json'), lockText);
      fs.writeFileSync(
        path.join(root, 'functions/package-lock.json'),
        JSON.stringify(functionsLock)
      );
      const report = fixture().workspace.report;
      fs.writeFileSync(path.join(root, 'root-audit.json'), JSON.stringify(report));
      fs.writeFileSync(
        path.join(root, 'functions/audit.json'),
        JSON.stringify({
          auditReportVersion: 2,
          vulnerabilities: {},
          metadata: {
            vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 },
          },
        })
      );
      const npm = path.join(root, 'bin/npm');
      fs.writeFileSync(
        npm,
        '#!/usr/bin/env node\nconst fs=require("node:fs"); if(JSON.stringify(process.argv.slice(2))!==JSON.stringify(["audit","--audit-level=high","--json"]))process.exit(2); const isFunctions=process.cwd().endsWith("/functions"); process.stdout.write(fs.readFileSync(isFunctions?"audit.json":"root-audit.json"));process.exit(isFunctions?0:1);'
      );
      fs.chmodSync(npm, 0o755);
      const clock = path.join(root, 'clock.mjs');
      const run = (time: string) => {
        fs.writeFileSync(clock, `Date.now = () => Date.parse(${JSON.stringify(time)});`);
        return spawnSync(
          process.execPath,
          ['--import', clock, path.resolve('scripts/check-dependency-vulnerabilities.mjs')],
          {
            cwd: root,
            encoding: 'utf8',
            env: {
              ...process.env,
              NODE_OPTIONS: '',
              PATH: `${path.join(root, 'bin')}${path.delimiter}${process.env.PATH}`,
            },
          }
        );
      };
      const accepted = run('2026-10-08T00:00:00Z');
      expect(accepted.status).toBe(0);
      expect(accepted.stderr).toContain('TEMPORARY RISK ACCEPTANCE');
      const output = JSON.parse(
        fs.readFileSync(path.join(root, 'reports/security/dependency-audit.json'), 'utf8')
      );
      expect(output.overallStatus).toBe('accepted_with_exception');
      expect(output.workspaces[0].report).toEqual(report);
      expect(output.workspaces[0]).toMatchObject({
        status: 'vulnerable',
        exitCode: 1,
        counts: { high: 7 },
      });
      expect(
        fs.readFileSync(path.join(root, 'reports/security/dependency-audit.md'), 'utf8')
      ).toContain('The vulnerability is NOT fixed');
      expect(run('2026-10-15T00:00:00Z').status).toBe(1);
      const cleanFunctions = fs.readFileSync(path.join(root, 'functions/audit.json'), 'utf8');
      fs.writeFileSync(
        path.join(root, 'functions/audit.json'),
        JSON.stringify({
          vulnerabilities: {
            other: { name: 'other', severity: 'critical', via: [{ severity: 'critical' }] },
          },
          metadata: { vulnerabilities: { critical: 1, total: 1 } },
        })
      );
      expect(run('2026-10-08T00:00:00Z').status).toBe(1);

      fs.writeFileSync(path.join(root, 'functions/audit.json'), cleanFunctions);
      report.vulnerabilities['firebase-tools'].via.push({
        source: 3,
        name: 'firebase-tools',
        dependency: 'firebase-tools',
        severity: 'high',
        url: 'https://example.test/other',
      });
      fs.writeFileSync(path.join(root, 'root-audit.json'), JSON.stringify(report));
      expect(run('2026-10-08T00:00:00Z').status).toBe(1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
