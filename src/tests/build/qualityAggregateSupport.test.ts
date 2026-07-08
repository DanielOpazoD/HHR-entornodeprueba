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
  { id: 'report:legacy-bridge', group: 'governance-inputs' },
  { id: 'check:schema-governance', group: 'governance' },
  { id: 'check:critical-any', group: 'type-safety' },
  { id: 'check:repo-hygiene', group: 'hygiene' },
  { id: 'check:security', group: 'security' },
  { id: 'check:module-size', group: 'size' },
  { id: 'check:test-governance', group: 'tests' },
  { id: 'check:report-freshness', group: 'reports', reportOnly: true },
];

describe('quality aggregate support', () => {
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
