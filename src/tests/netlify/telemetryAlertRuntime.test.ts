import { describe, expect, it, vi } from 'vitest';
import { createAlertQueue } from '../../../netlify/functions/lib/telemetry-alerts/queue';
import {
  alertStoreName,
  createAlertBlobFetch,
} from '../../../netlify/functions/lib/telemetry-alerts/store';
import { createAlertTestStore } from './support/alertTestStore';
import type { AlertEvent } from '../../../netlify/functions/lib/telemetry-alerts/queueTypes';
const event: AlertEvent = {
  category: 'integration',
  status: 'failed',
  operation: 'rayen_sync_run',
  timestamp: '2026-09-11T00:00:00.000Z',
  context: {},
  issues: [],
  droppedContextKeys: [],
};

describe('runtime alert safety', () => {
  it('does not consume an attempt or lease when invocation time is insufficient', async () => {
    const store = createAlertTestStore();
    const send = vi.fn(async () => ({ kind: 'sent' as const, code: 'accepted' as const }));
    const queue = createAlertQueue({ store, send, canClaim: () => false });
    const queued = await queue.enqueue(event);
    expect((await queue.deliver(queued.id!)).alert).toBe('throttled');
    expect(send).not.toHaveBeenCalled();
    expect((await store.read())?.ledger.jobs[0]).toMatchObject({ state: 'pending', attempts: 0 });
    const nextInvocation = createAlertQueue({ store, send, canClaim: () => true });
    expect((await nextInvocation.deliver(queued.id!)).alert).toBe('sent');
    expect(send).toHaveBeenCalledOnce();
  });
  it('isolates preview and unpublished production from published production', () => {
    const context = {
      deploy: { context: 'production', id: 'deploy-1', published: true },
      site: { url: 'https://example.com' },
    };
    expect(alertStoreName(context)).toBe('operational-alerts-v1-production');
    expect(alertStoreName({ ...context, deploy: { ...context.deploy, published: false } })).toBe(
      'operational-alerts-v1-preview-deploy-1'
    );
    expect(
      alertStoreName({ ...context, deploy: { ...context.deploy, context: 'deploy-preview' } })
    ).not.toContain('-production');
    expect(() => alertStoreName({ ...context, deploy: { ...context.deploy, id: '' } })).toThrow(
      'context_missing'
    );
  });
  it('refuses storage operations past the execution deadline', async () => {
    const fetcher = vi.fn();
    await expect(
      createAlertBlobFetch(fetcher, Date.now() - 1)('https://example.com')
    ).rejects.toThrow('deadline');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
