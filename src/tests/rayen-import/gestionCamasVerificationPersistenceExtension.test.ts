// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createFixture } from './gestionCamasRuntimeTestHarness';

const sessionRecord = (overrides: Record<string, unknown> = {}) => ({
  token: 'test-token-placeholder',
  apiBase: 'https://hospbackend.rayensalud.cl/api',
  facId: '1342',
  sourceTabId: 7,
  connectionAttemptId: 'current-attempt',
  lastVerifiedAt: Date.now(),
  expiresAt: null,
  ...overrides,
});
const activeOptions = { verifySessions: true };

describe('Gestión de Camas verification survives worker lifecycle', () => {
  it.each(['network', 'http-503'])(
    'keeps a failed %s preflight unverified after a new worker opens the stored session',
    async failure => {
      const record = sessionRecord();
      const fixture = createFixture({ 'gc-session': record }, { fullLifecycle: true });
      if (failure === 'network')
        fixture.fetchWithTimeout.mockRejectedValue(new Error('Failed to fetch'));
      else fixture.fetchWithTimeout.mockResolvedValue({ ok: false, status: 503 });
      await expect(
        fixture.runtime.health('generation', undefined, activeOptions)
      ).resolves.toMatchObject({ status: 'stale' });
      expect(fixture.values['gc-session']).toMatchObject({
        token: 'test-token-placeholder',
        sourceTabId: 7,
        connectionAttemptId: record.connectionAttemptId,
        lastVerifiedAt: null,
      });
      const resumed = fixture.restartRuntime();
      await expect(resumed.health()).resolves.toMatchObject({ status: 'stale' });
      expect(fixture.fetchWithTimeout).toHaveBeenCalledTimes(2);

      fixture.fetchWithTimeout.mockResolvedValue({ ok: true });
      await expect(resumed.health()).resolves.toMatchObject({ status: 'ready' });
      await expect(resumed.health()).resolves.toMatchObject({ status: 'ready' });
      expect(fixture.fetchWithTimeout).toHaveBeenCalledTimes(3);
    }
  );

  it('does not revoke a replacement connection when an older connection probe fails', async () => {
    const fixture = createFixture({ 'gc-session': sessionRecord() }, { fullLifecycle: true });
    let release: ((value: { ok: boolean; status: number }) => void) | undefined;
    fixture.fetchWithTimeout.mockImplementation(
      () =>
        new Promise(resolve => {
          release = resolve;
        })
    );
    const pending = fixture.runtime.health('generation', undefined, activeOptions);
    await vi.waitFor(() => expect(fixture.fetchWithTimeout).toHaveBeenCalledOnce());
    const replacement = sessionRecord({
      token: 'test-auth-token',
      connectionAttemptId: 'new-attempt',
    });
    fixture.values['gc-session'] = replacement;
    release?.({ ok: false, status: 503 });
    await pending;
    expect(fixture.values['gc-session']).toEqual(replacement);
    await expect(fixture.restartRuntime().health()).resolves.toMatchObject({ status: 'ready' });
    expect(fixture.fetchWithTimeout).toHaveBeenCalledOnce();
  });

  it('does not let an older failed probe revoke a newer successful verification', async () => {
    const fixture = createFixture({ 'gc-session': sessionRecord() }, { fullLifecycle: true });
    const releases: Array<(value: { ok: boolean; status: number }) => void> = [];
    fixture.fetchWithTimeout.mockImplementation(
      () => new Promise(resolve => releases.push(resolve))
    );
    const older = fixture.runtime.health('generation', undefined, activeOptions);
    await vi.waitFor(() => expect(fixture.fetchWithTimeout).toHaveBeenCalledTimes(1));
    const newer = fixture.runtime.health('generation', undefined, activeOptions);
    await vi.waitFor(() => expect(fixture.fetchWithTimeout).toHaveBeenCalledTimes(2));
    releases[1]({ ok: true, status: 200 });
    await expect(newer).resolves.toMatchObject({ status: 'ready' });
    const verified = fixture.values['gc-session'];
    releases[0]({ ok: false, status: 503 });
    await older;
    expect(fixture.values['gc-session']).toEqual(verified);
    await expect(fixture.restartRuntime().health()).resolves.toMatchObject({ status: 'ready' });
    expect(fixture.fetchWithTimeout).toHaveBeenCalledTimes(2);
  });

  it('requires a new real probe when a passive success arrives after an active failure', async () => {
    const fixture = createFixture(
      { 'gc-session': sessionRecord({ lastVerifiedAt: null }) },
      { fullLifecycle: true }
    );
    const releases: Array<(value: { ok: boolean; status: number }) => void> = [];
    fixture.fetchWithTimeout.mockImplementation(
      () => new Promise(resolve => releases.push(resolve))
    );
    const passive = fixture.runtime.health();
    await vi.waitFor(() => expect(fixture.fetchWithTimeout).toHaveBeenCalledTimes(1));
    const active = fixture.runtime.health('generation', undefined, activeOptions);
    await vi.waitFor(() => expect(fixture.fetchWithTimeout).toHaveBeenCalledTimes(2));
    releases[1]({ ok: false, status: 503 });
    await expect(active).resolves.toMatchObject({ status: 'stale' });
    releases[0]({ ok: true, status: 200 });
    await vi.waitFor(() => expect(fixture.fetchWithTimeout).toHaveBeenCalledTimes(3));
    expect(fixture.values['gc-session']).toMatchObject({ lastVerifiedAt: null });
    releases[2]({ ok: false, status: 503 });
    await expect(passive).resolves.toMatchObject({ status: 'stale' });
    expect(fixture.values['gc-session']).toMatchObject({ lastVerifiedAt: null });
  });
});
