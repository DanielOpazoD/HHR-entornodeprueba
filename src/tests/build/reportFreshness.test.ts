// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { getEvidenceReportDependencyFiles } from '../../../scripts/evidenceDependencyGraph.mjs';
import { buildDependencyFingerprint } from '../../../scripts/evidenceProvenanceSupport.mjs';

import { buildCriticalCoverageReport } from '../../../scripts/criticalCoverageSupport.mjs';
import { buildReleaseConfidenceMatrixReport } from '../../../scripts/releaseConfidenceMatrixSupport.mjs';

const scriptPath = path.join(process.cwd(), 'scripts/check-report-freshness.mjs');
const tempRoots: string[] = [];

const trackedReports = [
  { id: 'critical-coverage', file: 'reports/critical-coverage.json' },
  { id: 'quality-metrics', file: 'reports/quality-metrics.json' },
  { id: 'sync-convergence', file: 'reports/sync-convergence.json' },
  { id: 'system-confidence', file: 'reports/system-confidence.json' },
  { id: 'operational-health', file: 'reports/operational-health.json' },
  { id: 'release-confidence-matrix', file: 'reports/release-confidence-matrix.json' },
  { id: 'release-readiness-scorecard', file: 'reports/release-readiness-scorecard.json' },
];

const run = (root: string, command: string, args: string[] = []) =>
  execFileSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

const write = (root: string, file: string, content: string) => {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
};

const makeGitRepoWithMergeCommit = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'report-freshness-'));
  tempRoots.push(root);

  run(root, 'git', ['init', '-b', 'main']);
  run(root, 'git', ['config', 'user.email', 'test@example.com']);
  run(root, 'git', ['config', 'user.name', 'Test User']);

  write(root, '.gitignore', 'reports/\n');
  write(root, 'README.md', '# report freshness fixture\n');
  run(root, 'git', ['add', '.gitignore', 'README.md']);
  run(root, 'git', ['commit', '-m', 'initial commit']);

  run(root, 'git', ['switch', '-c', 'feature']);
  write(root, 'feature.txt', 'feature evidence source\n');
  run(root, 'git', ['add', 'feature.txt']);
  run(root, 'git', ['commit', '-m', 'feature commit']);
  const featureSha = run(root, 'git', ['rev-parse', '--short', 'HEAD']);

  run(root, 'git', ['switch', 'main']);
  write(root, 'main.txt', 'main side change\n');
  run(root, 'git', ['add', 'main.txt']);
  run(root, 'git', ['commit', '-m', 'main commit']);
  run(root, 'git', ['merge', '--no-ff', 'feature', '-m', 'merge feature']);

  return { root, featureSha };
};

const makeGitRepoWithLinearCommit = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'report-freshness-'));
  tempRoots.push(root);

  run(root, 'git', ['init', '-b', 'main']);
  run(root, 'git', ['config', 'user.email', 'test@example.com']);
  run(root, 'git', ['config', 'user.name', 'Test User']);

  write(root, '.gitignore', 'reports/\n');
  write(root, 'README.md', '# report freshness fixture\n');
  run(root, 'git', ['add', '.gitignore', 'README.md']);
  run(root, 'git', ['commit', '-m', 'initial commit']);
  const previousSha = run(root, 'git', ['rev-parse', '--short', 'HEAD']);

  write(root, 'main.txt', 'linear change\n');
  run(root, 'git', ['add', 'main.txt']);
  run(root, 'git', ['commit', '-m', 'linear commit']);

  return { root, previousSha };
};

const writeReports = (
  root: string,
  gitSha: string,
  options: {
    includeGeneratedFor?: boolean;
    generatedForOverrides?: Record<string, Record<string, unknown>>;
  } = {}
) => {
  for (const report of trackedReports) {
    write(root, report.file, `${JSON.stringify({ gitSha, gitDirty: false }, null, 2)}\n`);
  }

  if (options.includeGeneratedFor) {
    for (const report of trackedReports) {
      const dependencyFingerprint = buildDependencyFingerprint({
        root,
        dependencyFiles: getEvidenceReportDependencyFiles(report.id),
      });
      const generatedFor = {
        gitSha,
        gitDirty: false,
        treeHash: 'fixture-tree',
        reportId: report.id,
        dependencyFingerprint,
        ...(options.generatedForOverrides?.[report.id] ?? {}),
      };
      write(
        root,
        report.file,
        `${JSON.stringify({ gitSha, gitDirty: false, generatedFor }, null, 2)}\n`
      );
    }
  }

  const generatedAt = new Date('2026-05-10T12:00:00.000Z');
  for (const report of trackedReports) {
    fs.utimesSync(path.join(root, report.file), generatedAt, generatedAt);
  }
};

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('report freshness guardrail', () => {
  it.each([
    ['critical-coverage', buildCriticalCoverageReport],
    ['release-confidence-matrix', buildReleaseConfidenceMatrixReport],
  ] as const)('receives verifiable provenance from the %s producer', (reportId, buildReport) => {
    const root = process.cwd();
    const report = buildReport(root);
    expect(report.generatedFor).toMatchObject({
      reportId,
      gitSha: report.gitSha,
      gitDirty: report.gitDirty,
      dependencyFingerprint: buildDependencyFingerprint({
        root,
        dependencyFiles: getEvidenceReportDependencyFiles(reportId),
      }),
    });
    expect(report.generatedFor.treeHash).toMatch(/^[a-f0-9]{40}$/);
  });

  it('accepts reports of a reused pull request run only while its tree is HEAD tree', () => {
    const { root } = makeGitRepoWithLinearCommit();
    const tree = run(root, 'git', ['rev-parse', 'HEAD^{tree}']);
    // The pull request run tested another commit (refs/pull/N/merge) with the same tree.
    const tested = run(root, 'git', ['commit-tree', tree, '-p', 'HEAD~1', '-m', 'tested merge']);
    writeReports(root, tested.slice(0, 9), { includeGeneratedFor: true });
    const check = (evidenceTree: string) =>
      spawnSync('node', [scriptPath, '--strict'], {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          CI_EVIDENCE_RUN_ID: '100',
          CI_EVIDENCE_RUN_ATTEMPT: '2',
          CI_EVIDENCE_COMMIT: tested,
          CI_EVIDENCE_TREE: evidenceTree,
        },
      });
    expect(check(tree).status).toBe(0);
    const otherTree = check('d'.repeat(40));
    expect(otherTree.status).not.toBe(0);
    expect(otherTree.stderr).toContain('is stale by commit ancestry');
  });

  it('accepts unchanged current-commit report inputs in strict mode', () => {
    const { root } = makeGitRepoWithLinearCommit();
    const head = run(root, 'git', ['rev-parse', '--short', 'HEAD']);
    writeReports(root, head, { includeGeneratedFor: true });
    expect(() => run(root, 'node', [scriptPath, '--strict'])).not.toThrow();
  });

  it.each([undefined, {}, { value: '' }, ''])(
    'rejects a current-commit report without a usable fingerprint (%j)',
    dependencyFingerprint => {
      const { root } = makeGitRepoWithLinearCommit();
      const head = run(root, 'git', ['rev-parse', '--short', 'HEAD']);
      writeReports(root, head, {
        includeGeneratedFor: true,
        generatedForOverrides: { 'system-confidence': { dependencyFingerprint } },
      });
      expect(() =>
        run(root, 'node', [scriptPath, '--strict', '--only', 'system-confidence'])
      ).toThrow(
        /system-confidence\.json was generated for commit .* without dependency fingerprint/
      );
    }
  );

  it.each(['replace', 'remove'] as const)(
    'rejects a current-commit confidence report after input %s, independent of mtime',
    change => {
      const { root } = makeGitRepoWithLinearCommit();
      const head = run(root, 'git', ['rev-parse', '--short', 'HEAD']);
      writeReports(root, head, { includeGeneratedFor: true });
      const input = path.join(root, 'reports/quality-metrics.json');
      const before = fs.statSync(input);
      if (change === 'remove') {
        fs.unlinkSync(input);
      } else {
        const value = JSON.parse(fs.readFileSync(input, 'utf8'));
        value.tests = { flakeRiskFiles: 7 };
        fs.writeFileSync(input, JSON.stringify(value));
        fs.utimesSync(input, before.atime, before.mtime);
      }

      const args = [scriptPath, '--only', 'system-confidence'];
      expect(() => run(root, 'node', [...args, '--strict'])).toThrow(
        /system-confidence\.json is stale by real dependency fingerprint/
      );
      // Local advisory still succeeds, but never silently labels stale inputs OK.
      const advisory = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
      expect(advisory.status).toBe(0);
      expect(advisory.stderr).toContain('stale by real dependency fingerprint');
      expect(advisory.stdout).not.toContain('[report-freshness] OK');
    }
  );

  it('accepts reports generated for a direct merge parent', () => {
    const { root, featureSha } = makeGitRepoWithMergeCommit();
    writeReports(root, featureSha);

    expect(() => run(root, 'node', [scriptPath])).not.toThrow();
  });

  it('rejects direct merge-parent reports without dependency fingerprint in strict release mode', () => {
    const { root, featureSha } = makeGitRepoWithMergeCommit();
    writeReports(root, featureSha);

    expect(() => run(root, 'node', [scriptPath, '--strict'])).toThrow(
      /reports\/quality-metrics\.json was generated for direct merge parent .* without dependency fingerprint/
    );
  });

  it('accepts direct merge-parent reports with matching dependency fingerprints in strict release mode', () => {
    const { root, featureSha } = makeGitRepoWithMergeCommit();
    writeReports(root, featureSha, { includeGeneratedFor: true });

    expect(() => run(root, 'node', [scriptPath, '--strict'])).not.toThrow();
  });

  it('rejects malformed provenance when report id and git sha do not match the report', () => {
    const { root, featureSha } = makeGitRepoWithMergeCommit();
    writeReports(root, featureSha, {
      includeGeneratedFor: true,
      generatedForOverrides: {
        'quality-metrics': {
          reportId: 'operational-health',
          gitSha: 'wrongsha',
        },
      },
    });

    expect(() => run(root, 'node', [scriptPath, '--strict'])).toThrow(
      /reports\/quality-metrics\.json has malformed provenance/
    );
  });

  it('treats stale reports as advisory outside strict release mode', () => {
    const { root } = makeGitRepoWithMergeCommit();
    const staleSha = run(root, 'git', ['rev-parse', '--short', 'HEAD^1^']);
    writeReports(root, staleSha);

    expect(() => run(root, 'node', [scriptPath])).not.toThrow();
  });

  it('rejects reports generated for an older merge ancestor in strict release mode', () => {
    const { root } = makeGitRepoWithMergeCommit();
    const staleSha = run(root, 'git', ['rev-parse', '--short', 'HEAD^1^']);
    writeReports(root, staleSha);

    expect(() => run(root, 'node', [scriptPath, '--strict'])).toThrow(
      /reports\/quality-metrics\.json is stale by commit ancestry/
    );
  });

  it('rejects parent reports for a non-merge commit in strict release mode', () => {
    const { root, previousSha } = makeGitRepoWithLinearCommit();
    writeReports(root, previousSha);

    expect(() => run(root, 'node', [scriptPath, '--strict'])).toThrow(
      /reports\/quality-metrics\.json is stale by commit ancestry/
    );
  });

  it('can enforce freshness for only the sync convergence report', () => {
    const { root } = makeGitRepoWithMergeCommit();
    const staleSha = run(root, 'git', ['rev-parse', '--short', 'HEAD^1^']);
    const currentSha = run(root, 'git', ['rev-parse', '--short', 'HEAD']);

    write(
      root,
      'reports/sync-convergence.json',
      `${JSON.stringify({ gitSha: staleSha, gitDirty: false }, null, 2)}\n`
    );
    write(
      root,
      'reports/quality-metrics.json',
      `${JSON.stringify({ gitSha: currentSha, gitDirty: false }, null, 2)}\n`
    );

    expect(() => run(root, 'node', [scriptPath, '--strict', '--only', 'sync-convergence'])).toThrow(
      /reports\/sync-convergence\.json is stale by commit ancestry/
    );
  });
});
