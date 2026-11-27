// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as authBootstrapBudgets from '@/services/auth/authBootstrapBudgets';
import * as indexedDbRecoveryBudgets from '@/services/storage/indexeddb/indexedDbRecoveryBudgets';
import * as syncQueueBudgets from '@/services/storage/sync/syncQueueOperationalBudgets';
import * as versionConstants from '@/constants/version';

// The operational-health report is what a maintainer reads to understand a delay; its runtime
// budgets must be the exported values the app executes, not a re-reading of their source text.
let root = '';
let report: Partial<
  Record<'schema' | 'syncQueue' | 'systemHealth' | 'authBootstrap' | 'localPersistence', unknown>
> = {};
let markdown = '';

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'operational-health-'));
  // Read sources from this checkout; the generated reports belong to the temporary root.
  for (const entry of fs.readdirSync(process.cwd())) {
    if (['reports', '.git', 'coverage', 'dist'].includes(entry)) continue;
    fs.symlinkSync(path.join(process.cwd(), entry), path.join(root, entry));
  }
  for (const args of [
    ['init', '-q'],
    [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'Synthetic operational health',
    ],
  ]) {
    expect(spawnSync('git', args, { cwd: root }).status).toBe(0);
  }
  const result = spawnSync(
    process.execPath,
    [path.join(process.cwd(), 'scripts/report-operational-health.mjs')],
    { cwd: root, encoding: 'utf8', timeout: 60_000 }
  );
  expect(result.status, result.stderr).toBe(0);
  report = JSON.parse(fs.readFileSync(path.join(root, 'reports/operational-health.json'), 'utf8'));
  markdown = fs.readFileSync(path.join(root, 'reports/operational-health.md'), 'utf8');
}, 120_000);

afterAll(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

describe('operational health report runtime budgets', () => {
  it('publishes the schema versions the app runs', () => {
    expect(report.schema).toEqual({
      current: versionConstants.CURRENT_SCHEMA_VERSION,
      legacy: versionConstants.LEGACY_SCHEMA_VERSION,
    });
    expect(markdown).toContain(
      `- Schema current: v${versionConstants.CURRENT_SCHEMA_VERSION}\n` +
        `- Schema legacy: v${versionConstants.LEGACY_SCHEMA_VERSION}\n`
    );
  });

  it('publishes the sync queue budgets the app runs', () => {
    expect(report.syncQueue).toEqual({
      batchSize: syncQueueBudgets.SYNC_QUEUE_BATCH_SIZE,
      maxRetries: syncQueueBudgets.MAX_RETRIES,
      baseRetryDelayMs: syncQueueBudgets.BASE_RETRY_DELAY_MS,
      maxRetryDelayMs: syncQueueBudgets.MAX_RETRY_DELAY_MS,
      runtimeThresholds: syncQueueBudgets.SYNC_QUEUE_RUNTIME_THRESHOLDS,
    });
    expect(report.systemHealth).toMatchObject(syncQueueBudgets.SYNC_QUEUE_RUNTIME_THRESHOLDS);
    expect(markdown).toContain(
      `- Base retry delay (ms): ${syncQueueBudgets.BASE_RETRY_DELAY_MS}\n` +
        `- Max retry delay (ms): ${syncQueueBudgets.MAX_RETRY_DELAY_MS}\n` +
        `- Warning queue age (ms): ${syncQueueBudgets.SYNC_QUEUE_RUNTIME_THRESHOLDS.warningOldestPendingAgeMs}\n` +
        `- Critical queue age (ms): ${syncQueueBudgets.SYNC_QUEUE_RUNTIME_THRESHOLDS.criticalOldestPendingAgeMs}\n`
    );
  });

  it('publishes the auth bootstrap budgets the app runs', () => {
    const timeouts = authBootstrapBudgets.AUTH_BOOTSTRAP_TIMEOUTS_MS;
    expect(report.authBootstrap).toEqual({
      pendingTtlMs: authBootstrapBudgets.AUTH_BOOTSTRAP_PENDING_TTL_MS,
      timeoutsMs: timeouts,
    });
    expect(markdown).toContain(
      `- Pending TTL (ms): ${authBootstrapBudgets.AUTH_BOOTSTRAP_PENDING_TTL_MS}\n` +
        `- Timeouts (ms): recent logout ${timeouts.recentManualLogout} · offline ${timeouts.offline}` +
        ` · default ${timeouts.default} · redirect pending ${timeouts.redirectPending}\n`
    );
  });

  it('publishes the IndexedDB recovery budgets the app runs', () => {
    expect(report.localPersistence).toEqual({
      openTimeoutMs: indexedDbRecoveryBudgets.INDEXED_DB_OPEN_TIMEOUT_MS,
      maxBackgroundRecoveryAttempts: indexedDbRecoveryBudgets.MAX_BACKGROUND_RECOVERY_ATTEMPTS,
      recoveryRetryDelaysMs: indexedDbRecoveryBudgets.INDEXED_DB_RECOVERY_RETRY_DELAYS_MS,
    });
    expect(markdown).toContain(
      `- IndexedDB open timeout (ms): ${indexedDbRecoveryBudgets.INDEXED_DB_OPEN_TIMEOUT_MS}\n` +
        `- Max background recovery attempts: ${indexedDbRecoveryBudgets.MAX_BACKGROUND_RECOVERY_ATTEMPTS}\n` +
        `- Recovery retry delays (ms): ${indexedDbRecoveryBudgets.INDEXED_DB_RECOVERY_RETRY_DELAYS_MS.join(', ')}\n`
    );
  });
});
