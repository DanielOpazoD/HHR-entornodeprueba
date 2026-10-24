// @vitest-environment node
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

type Workspace = 'root' | 'functions';
type AuditOutput = { stdout: string; exitCode: number };
const auditReport = (severity?: 'moderate' | 'high' | 'critical', name = 'fixture-package') => ({
  auditReportVersion: 2,
  vulnerabilities: severity
    ? {
        [name]: {
          name,
          severity,
          nodes: [`node_modules/${name}`],
          via: [{ name, dependency: name, severity, url: 'https://example.test/advisory' }],
        },
      }
    : {},
  metadata: {
    vulnerabilities: {
      info: 0,
      low: 0,
      moderate: Number(severity === 'moderate'),
      high: Number(severity === 'high'),
      critical: Number(severity === 'critical'),
      total: Number(Boolean(severity)),
    },
  },
});

const runAudit = (outputs: Partial<Record<Workspace, AuditOutput>> = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dependency-audit-gate-'));
  try {
    fs.mkdirSync(path.join(root, 'functions'));
    fs.mkdirSync(path.join(root, 'bin'));
    for (const workspace of ['root', 'functions'] as const) {
      const directory = workspace === 'root' ? root : path.join(root, 'functions');
      fs.writeFileSync(path.join(directory, 'package.json'), '{}');
      fs.writeFileSync(path.join(directory, 'package-lock.json'), '{"packages":{}}');
      fs.writeFileSync(
        path.join(directory, 'audit-output.json'),
        JSON.stringify(outputs[workspace] ?? { stdout: JSON.stringify(auditReport()), exitCode: 0 })
      );
    }
    const npm = path.join(root, 'bin/npm');
    fs.writeFileSync(
      npm,
      [
        '#!/usr/bin/env node',
        'const fs = require("node:fs");',
        'if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(["audit", "--audit-level=high", "--json"])) process.exit(2);',
        'const result = JSON.parse(fs.readFileSync("audit-output.json", "utf8"));',
        'process.stdout.write(result.stdout);',
        'process.exit(result.exitCode);',
      ].join('\n')
    );
    fs.chmodSync(npm, 0o755);
    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts/check-dependency-vulnerabilities.mjs')],
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
    return {
      ...result,
      summary: JSON.parse(
        fs.readFileSync(path.join(root, 'reports/security/dependency-audit.json'), 'utf8')
      ),
      markdown: fs.readFileSync(path.join(root, 'reports/security/dependency-audit.md'), 'utf8'),
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

describe('dependency audit gate after retiring the withdrawn braces advisory exception', () => {
  it('accepts both workspaces without blocking findings and preserves moderate findings', () => {
    const report = auditReport('moderate');
    const result = runAudit({ root: { stdout: JSON.stringify(report), exitCode: 0 } });
    expect(result.status).toBe(0);
    expect(result.summary).toMatchObject({
      overallStatus: 'ok',
      policy: { scope: 'all dependencies', blockingSeverities: ['high', 'critical'] },
      workspaces: [
        { id: 'root', status: 'ok', counts: { moderate: 1 }, report },
        { id: 'functions', status: 'ok' },
      ],
    });
    expect(result.summary).not.toHaveProperty('exception');
    expect(result.markdown).toContain('fixture-package [moderate]');
  });

  it.each([
    ['root', 'high'],
    ['root', 'critical'],
    ['functions', 'high'],
    ['functions', 'critical'],
  ] as const)('blocks %s %s findings while preserving raw evidence', (workspace, severity) => {
    const report = auditReport(severity);
    const result = runAudit({ [workspace]: { stdout: JSON.stringify(report), exitCode: 1 } });
    expect(result.status).toBe(1);
    expect(result.summary.overallStatus).toBe('failed');
    expect(result.summary.workspaces).toContainEqual(
      expect.objectContaining({ id: workspace, status: 'vulnerable', exitCode: 1, report })
    );
    expect(result.stderr).toContain('Dependency audit failed');
    expect(result.markdown).toContain(`fixture-package [${severity}]`);
  });

  it('blocks braces if npm ever reports it as high again', () => {
    const report = auditReport('high', 'braces');
    const result = runAudit({ root: { stdout: JSON.stringify(report), exitCode: 1 } });
    expect(result.status).toBe(1);
    expect(result.summary.overallStatus).toBe('failed');
    expect(result.summary.workspaces[0].report).toEqual(report);
    expect(result.markdown).toContain('braces [high]');
  });

  it('does not treat unavailable audit evidence as a clean report', () => {
    const result = runAudit({ root: { stdout: JSON.stringify(auditReport()), exitCode: 1 } });
    expect(result.status).toBe(1);
    expect(result.summary.workspaces[0]).toMatchObject({ status: 'unavailable', exitCode: 1 });
  });

  it('blocks invalid audit output', () => {
    const result = runAudit({ functions: { stdout: 'not JSON', exitCode: 0 } });
    expect(result.status).toBe(1);
    expect(result.summary.workspaces[1].status).toBe('invalid_output');
  });
});
