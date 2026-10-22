import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  assignUnitTestFilesToShards,
  buildUnitShardBalanceReport,
  buildUnitShardRuntimeProfile,
  collectUnitShardBalanceIssues,
  normalizePersistedDurationByFile,
  parseUnitShardRunArguments,
} from '../../../scripts/unitShardBalanceSupport.mjs';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

type ShardSummary = {
  index: number;
  files: string[];
  estimatedDurationMs: number;
};

describe('unit shard balance support', () => {
  it('keeps published calibration stable despite stale snapshots and private measurements', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hhr-calibrated-shards-'));
    roots.push(root);
    fs.mkdirSync(path.join(root, 'scripts/config'), { recursive: true });
    fs.mkdirSync(path.join(root, 'src/tests'), { recursive: true });
    fs.mkdirSync(path.join(root, 'reports'));
    const files = ['a', 'b', 'c', 'd'].map(name => `src/tests/${name}.test.ts`);
    for (const file of files) fs.writeFileSync(path.join(root, file), '// synthetic');
    fs.writeFileSync(
      path.join(root, 'scripts/config/unit-shard-balance.json'),
      JSON.stringify({
        shardCount: 4,
        durationSource: 'hints',
        perFileOverheadMs: 100,
        durationHints: [{ globs: ['src/tests/**'], estimatedDurationMs: 20 }],
      })
    );
    const stable = buildUnitShardBalanceReport(root);
    fs.writeFileSync(
      path.join(root, 'reports/unit-shard-runtime-profile.json'),
      JSON.stringify({
        summary: { perFileOverheadMs: 100 },
        durationByFile: { [files[0]]: 900_100 },
      })
    );
    fs.writeFileSync(
      path.join(root, 'reports/unit-shard-vitest-profile.json'),
      JSON.stringify({
        testResults: [{ name: path.join(root, files[0]), startTime: 0, endTime: 500_000 }],
      })
    );
    const reused = buildUnitShardBalanceReport(root);
    expect(reused.shards).toEqual(stable.shards);
    expect(reused.durationByFile).toEqual(Object.fromEntries(files.map(file => [file, 120])));
    expect(reused.shards.flatMap(shard => shard.files).sort()).toEqual(files);
    // Profiling remains an explicit experiment, without changing normal CI inputs.
    const measured = buildUnitShardBalanceReport(root, { useLocalMeasurements: true });
    expect(measured.durationByFile).toMatchObject({ [files[0]]: 500_100 });
    expect(buildUnitShardBalanceReport(root).shards).toEqual(stable.shards);
  });
  it('balances files by measured duration instead of file count', () => {
    const files = [
      'src/tests/a/heavy-a.test.ts',
      'src/tests/a/heavy-b.test.ts',
      'src/tests/b/medium-a.test.ts',
      'src/tests/b/medium-b.test.ts',
      'src/tests/c/light-a.test.ts',
      'src/tests/c/light-b.test.ts',
    ];

    const shards = assignUnitTestFilesToShards({
      files,
      shardCount: 2,
      durationByFile: {
        'src/tests/a/heavy-a.test.ts': 9000,
        'src/tests/a/heavy-b.test.ts': 8000,
        'src/tests/b/medium-a.test.ts': 5000,
        'src/tests/b/medium-b.test.ts': 4000,
        'src/tests/c/light-a.test.ts': 1000,
        'src/tests/c/light-b.test.ts': 1000,
      },
    });

    const totals = shards
      .map((shard: ShardSummary) => shard.estimatedDurationMs)
      .sort((a, b) => a - b);

    expect(shards).toHaveLength(2);
    expect(totals).toEqual([14000, 14000]);
    expect(shards.flatMap((shard: ShardSummary) => shard.files).sort()).toEqual([...files].sort());
  });

  it('detects duplicate locked files and missing critical tests', () => {
    const issues = collectUnitShardBalanceIssues({
      allFiles: [
        'src/tests/risk/clinicalSync.test.ts',
        'src/tests/risk/census.test.ts',
        'src/tests/other/covered.test.ts',
      ],
      config: {
        shardCount: 2,
        tolerancePercent: 25,
        criticalTestGlobs: ['src/tests/risk/*.test.ts'],
        lockedAssignments: {
          1: ['src/tests/risk/clinicalSync.test.ts', 'src/tests/risk/census.test.ts'],
          2: ['src/tests/risk/clinicalSync.test.ts'],
        },
      },
      assignments: [
        {
          index: 1,
          files: ['src/tests/risk/clinicalSync.test.ts', 'src/tests/other/covered.test.ts'],
          estimatedDurationMs: 1000,
        },
        {
          index: 2,
          files: ['src/tests/risk/clinicalSync.test.ts'],
          estimatedDurationMs: 1000,
        },
      ],
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        'src/tests/risk/clinicalSync.test.ts is assigned to multiple unit shards.',
        'Critical unit test is not assigned to any shard: src/tests/risk/census.test.ts.',
      ])
    );
  });

  it('builds a runtime profile with slow files, functional groups and rebalance guidance', () => {
    const profile = buildUnitShardRuntimeProfile({
      files: [
        'src/tests/features/census/censusFlow.test.ts',
        'src/tests/services/storage/syncQueue.test.ts',
        'src/tests/hooks/useAudit.test.ts',
        'src/tests/build/ciWorkflowGovernance.test.ts',
      ],
      durationByFile: {
        'src/tests/features/census/censusFlow.test.ts': 12000,
        'src/tests/services/storage/syncQueue.test.ts': 9000,
        'src/tests/hooks/useAudit.test.ts': 4000,
        'src/tests/build/ciWorkflowGovernance.test.ts': 1000,
      },
      config: {
        shardCount: 2,
        tolerancePercent: 25,
        criticalTestGlobs: ['src/tests/features/census/*.test.ts'],
        lockedAssignments: {},
      },
    });

    expect(profile.summary.totalFiles).toBe(4);
    expect(profile.slowestFiles[0]).toMatchObject({
      file: 'src/tests/features/census/censusFlow.test.ts',
      estimatedDurationMs: 12000,
    });
    expect(profile.functionalGroups.map((group: { id: string }) => group.id)).toEqual(
      expect.arrayContaining(['census', 'storage-sync', 'audit-observability', 'governance'])
    );
    expect(profile.recommendation).toContain('unit shard');
  });

  it('adds configurable per-file overhead so wall-clock balance does not ignore file count', () => {
    const profile = buildUnitShardRuntimeProfile({
      files: ['src/tests/a/slow.test.ts', 'src/tests/b/fast.test.ts'],
      durationByFile: {
        'src/tests/a/slow.test.ts': 1000,
        'src/tests/b/fast.test.ts': 100,
      },
      config: {
        shardCount: 2,
        tolerancePercent: 200,
        perFileOverheadMs: 250,
        criticalTestGlobs: [],
        lockedAssignments: {},
      },
    });

    expect(profile.durationByFile).toMatchObject({
      'src/tests/a/slow.test.ts': 1250,
      'src/tests/b/fast.test.ts': 350,
    });
  });

  it('does not add per-file overhead twice when reusing a persisted profile', () => {
    const measured = normalizePersistedDurationByFile(
      {
        summary: { perFileOverheadMs: 100 },
        durationByFile: {
          'src/tests/a/slow.test.ts': 1100,
          'src/tests/b/fast.test.ts': 150,
        },
      },
      { perFileOverheadMs: 100 }
    );

    const profile = buildUnitShardRuntimeProfile({
      files: ['src/tests/a/slow.test.ts', 'src/tests/b/fast.test.ts'],
      durationByFile: measured,
      config: {
        shardCount: 2,
        tolerancePercent: 200,
        perFileOverheadMs: 100,
        criticalTestGlobs: [],
        lockedAssignments: {},
      },
    });

    expect(profile.durationByFile).toEqual({
      'src/tests/a/slow.test.ts': 1100,
      'src/tests/b/fast.test.ts': 150,
    });
  });

  it('parses the shard argument while preserving passthrough Vitest flags', () => {
    expect(parseUnitShardRunArguments(['2/4', '--reporter=dot', '--runInBand'])).toEqual({
      requestedShard: { index: 2, count: 4 },
      passthroughArgs: ['--reporter=dot', '--runInBand'],
    });
  });
});
