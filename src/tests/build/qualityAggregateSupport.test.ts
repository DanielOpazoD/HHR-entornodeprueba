// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import {
  buildQualityProfile,
  buildQualityProfileMarkdown,
  getQualityGroupPlan,
  selectQualitySteps,
} from '../../../scripts/qualityAggregateSupport.mjs';

const checks = [
  { id: 'check:architecture', group: 'boundaries' },
  { id: 'report:compatibility-governance', group: 'governance-inputs' },
  { id: 'check:schema-governance', group: 'governance' },
  { id: 'check:critical-any', group: 'type-safety' },
  { id: 'check:repo-hygiene', group: 'hygiene' },
  { id: 'check:security', group: 'security' },
  { id: 'check:module-size', group: 'size' },
  { id: 'check:test-governance', group: 'tests' },
  { id: 'check:report-freshness', group: 'reports', reportOnly: true },
];

describe('quality aggregate support', () => {
  it('keeps the domain home check while retiring the hotspot import restriction', () => {
    const governance = JSON.parse(
      fs.readFileSync('scripts/config/guardrail-governance.json', 'utf8')
    );
    const ids = governance.qualityAggregate.checks.map((entry: { id: string }) => entry.id);
    expect(ids).toContain('check:repo-hygiene');
    expect(ids).not.toContain('check:domain-hotspot-boundary');
    const scripts = JSON.parse(fs.readFileSync('package.json', 'utf8')).scripts;
    expect(scripts['check:repo-hygiene']).toBeDefined();
    expect(scripts['check:domain-hotspot-boundary']).toBeUndefined();
  });
  it('keeps the governed CI group plan explicit and non-overlapping', () => {
    expect(getQualityGroupPlan()).toEqual({
      boundaries: ['boundaries'],
      governance: ['governance', 'governance-inputs'],
      security: ['security', 'type-safety', 'hygiene'],
      size: ['size'],
      tests: ['tests'],
      reports: ['reports'],
    });
  });

  it('selects only the requested public quality group without losing advisory metadata', () => {
    expect(selectQualitySteps(checks, { group: 'security' })).toEqual([
      { id: 'check:critical-any', group: 'type-safety' },
      { id: 'check:repo-hygiene', group: 'hygiene' },
      { id: 'check:security', group: 'security' },
    ]);

    expect(selectQualitySteps(checks, { group: 'reports' })).toEqual([
      { id: 'check:report-freshness', group: 'reports', reportOnly: true },
    ]);
  });

  it('fails fast when the CLI group flag has no value', () => {
    expect(() =>
      execFileSync('node', ['scripts/check-quality-aggregate.mjs', '--group'], {
        cwd: process.cwd(),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    ).toThrow(/--group flag requires a value/);
  });

  it('runs only the selected valid CLI group and exits successfully', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hhr-quality-cli-'));
    try {
      fs.mkdirSync(path.join(root, 'scripts/config'), { recursive: true });
      fs.writeFileSync(
        path.join(root, 'scripts/config/guardrail-governance.json'),
        JSON.stringify({
          qualityAggregate: {
            checks: [
              { id: 'selected', group: 'size' },
              { id: 'unselected', group: 'tests' },
            ],
          },
        })
      );
      fs.writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify({
          scripts: {
            selected: 'node -e "console.log(123456)"',
            unselected: 'node -e "process.exit(17)"',
          },
        })
      );
      const output = execFileSync(
        process.execPath,
        [path.resolve('scripts/check-quality-aggregate.mjs'), '--group', 'size'],
        { cwd: root, encoding: 'utf8', timeout: 20000 }
      );
      expect(output).toContain('Running group "size" (1 checks)');
      expect(output).toContain('123456');
      const profile = JSON.parse(
        fs.readFileSync(path.join(root, 'reports/ci-quality-static-profile-size.json'), 'utf8')
      );
      expect(profile.scope).toBe('size');
      expect(profile.results.map((entry: { id: string }) => entry.id)).toEqual(['selected']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('builds a duration profile with blocking and advisory failures separated', () => {
    const profile = buildQualityProfile({
      scope: 'security',
      gitSha: 'abc1234',
      startedAt: '2026-07-01T10:00:00.000Z',
      completedAt: '2026-07-01T10:00:03.000Z',
      results: [
        {
          id: 'check:critical-any',
          group: 'type-safety',
          status: 'passed',
          durationMs: 1000,
          reportOnly: false,
        },
        {
          id: 'check:report-freshness',
          group: 'reports',
          status: 'failed',
          durationMs: 2000,
          reportOnly: true,
        },
      ],
    });

    expect(profile.summary).toMatchObject({
      totalSteps: 2,
      passed: 1,
      failed: 1,
      blockingFailures: 0,
      advisoryFailures: 1,
      durationMs: 3000,
    });
    expect(profile.groups).toEqual({
      'type-safety': { durationMs: 1000, totalSteps: 1, failed: 0 },
      reports: { durationMs: 2000, totalSteps: 1, failed: 1 },
    });
  });

  it('renders a markdown profile sorted by slowest step first', () => {
    const markdown = buildQualityProfileMarkdown(
      buildQualityProfile({
        scope: 'all',
        gitSha: 'abc1234',
        startedAt: '2026-07-01T10:00:00.000Z',
        completedAt: '2026-07-01T10:00:03.000Z',
        results: [
          {
            id: 'fast',
            group: 'tests',
            status: 'passed',
            durationMs: 100,
            reportOnly: false,
          },
          {
            id: 'slow',
            group: 'security',
            status: 'passed',
            durationMs: 2900,
            reportOnly: false,
          },
        ],
      })
    );

    expect(markdown).toContain('# CI Quality Static Profile');
    expect(markdown.indexOf('| `slow` |')).toBeLessThan(markdown.indexOf('| `fast` |'));
  });
});
