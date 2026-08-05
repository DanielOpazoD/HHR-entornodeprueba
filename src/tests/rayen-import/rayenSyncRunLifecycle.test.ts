import { describe, expect, it } from 'vitest';
import { createRayenSyncRunLifecycle } from '@/features/rayen-import/domain/rayenSyncRunLifecycle';
import type { RayenSyncRun } from '@/features/rayen-import/domain/rayenSyncHistory';

const run = (id: string): RayenSyncRun => ({
  id,
  sourceDate: '2026-07-14',
  startedAt: '2026-08-02T10:00:00.000Z',
  by: 'Operador HHR',
});

describe('rayenSyncRunLifecycle', () => {
  it('supersedes only a run that has not reached the applied stage', () => {
    const lifecycle = createRayenSyncRunLifecycle();

    expect(lifecycle.start(run('run-1'))).toEqual({});
    expect(lifecycle.start(run('run-2'))).toEqual({ superseded: run('run-1') });
    expect(lifecycle.getRun('run-1')).toBeUndefined();
    expect(lifecycle.getActiveRun()?.id).toBe('run-2');
  });

  it('detaches an applied run from the preview but leaves it completable', () => {
    const lifecycle = createRayenSyncRunLifecycle();
    lifecycle.start(run('applied-run'));
    lifecycle.markApplied('applied-run');

    expect(lifecycle.cancelActive()).toEqual({
      run: run('applied-run'),
      disposition: 'detached',
    });
    const claim = lifecycle.claimTerminal('applied-run');
    expect(claim?.run?.id).toBe('applied-run');
    if (!claim) throw new Error('Expected a terminal claim.');
    lifecycle.commitTerminal(claim);
    expect(lifecycle.claimTerminal('applied-run')).toBeNull();
  });

  it('allows a failed terminal write to release and retry the same run', () => {
    const lifecycle = createRayenSyncRunLifecycle();
    lifecycle.start(run('retry-run'));
    lifecycle.markApplied('retry-run');

    const first = lifecycle.claimTerminal('retry-run');
    expect(first).not.toBeNull();
    expect(lifecycle.claimTerminal('retry-run')).toBeNull();
    if (!first) throw new Error('Expected a terminal claim.');
    lifecycle.releaseTerminal(first);

    const retry = lifecycle.claimTerminal('retry-run');
    expect(retry?.run?.id).toBe('retry-run');
  });
});
