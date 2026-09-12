import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCensusPerfModel } from '@/shared/runtime/censusPerfModel';
import {
  mountGoogleIdentityButton,
  type GoogleIdentityApi,
} from '@/services/auth/googleIdentityButton';

const { mockBeginAuthPerfAttempt, mockRecordAuthPerfEvent } = vi.hoisted(() => ({
  mockBeginAuthPerfAttempt: vi.fn(),
  mockRecordAuthPerfEvent: vi.fn(),
}));
vi.mock('@/shared/runtime/censusStartupPerf', () => ({
  beginAuthPerfAttempt: mockBeginAuthPerfAttempt,
  recordAuthPerfEvent: mockRecordAuthPerfEvent,
}));

describe('explicit Google identity button', () => {
  beforeEach(() => {
    mockBeginAuthPerfAttempt.mockReset();
    mockRecordAuthPerfEvent.mockReset();
  });
  const setup = () => {
    const api = { initialize: vi.fn(), renderButton: vi.fn(), cancel: vi.fn() };
    const onCredential = vi.fn();
    const dispose = mountGoogleIdentityButton(
      api,
      document.createElement('div'),
      'test-client',
      onCredential
    );
    const config = api.initialize.mock.calls[0][0] as Parameters<
      GoogleIdentityApi['initialize']
    >[0];
    const button = api.renderButton.mock.calls[0][1] as Parameters<
      GoogleIdentityApi['renderButton']
    >[1];
    return { api, config, button, onCredential, dispose };
  };
  it('accepts the FedCM button callback without relying on a click listener', async () => {
    const { config, button, onCredential } = setup();
    expect(config).toMatchObject({
      use_fedcm_for_button: true,
      auto_select: false,
      button_auto_select: false,
    });
    config.callback({ credential: 'test-auth-token' });
    config.callback({ credential: 'test-auth-token' });
    await Promise.resolve();
    expect(onCredential).toHaveBeenCalledTimes(1);
    expect(button.click_listener).toEqual(expect.any(Function));
    expect(mockBeginAuthPerfAttempt).not.toHaveBeenCalled();
  });
  it('starts an attempt only from the real GIS click listener, without credential data', () => {
    const { button } = setup();
    expect(mockBeginAuthPerfAttempt).not.toHaveBeenCalled();
    button.click_listener?.();
    button.click_listener?.();
    expect(mockBeginAuthPerfAttempt.mock.calls).toEqual([['google_button'], ['google_button']]);
  });
  it('does not measure stale GIS clicks after disposal', () => {
    const { button, dispose } = setup();
    dispose();
    button.click_listener?.();
    expect(mockBeginAuthPerfAttempt).not.toHaveBeenCalled();
  });
  it('keeps the credential exchange working if click instrumentation throws', async () => {
    mockBeginAuthPerfAttempt.mockImplementation(() => {
      throw new Error('audit unavailable');
    });
    const { button, config, onCredential } = setup();
    expect(() => button.click_listener?.()).not.toThrow();
    config.callback({ credential: 'synthetic-sensitive-token' });
    await Promise.resolve();
    expect(onCredential).toHaveBeenCalledWith('synthetic-sensitive-token', expect.any(Function));
    expect(mockBeginAuthPerfAttempt.mock.calls).toEqual([['google_button']]);
  });
  it('cancels the previous click before starting another and cancels only the latest ID on dispose', () => {
    const events: string[] = [];
    mockBeginAuthPerfAttempt
      .mockImplementationOnce(() => {
        events.push('begin-a');
        return 'click-a';
      })
      .mockImplementationOnce(() => {
        events.push('begin-b');
        return 'click-b';
      });
    mockRecordAuthPerfEvent.mockImplementation((id, event) => events.push(id + ':' + event));
    const { button, dispose } = setup();
    button.click_listener?.();
    button.click_listener?.();
    dispose();
    expect(events).toEqual(['begin-a', 'click-a:cancelled', 'begin-b', 'click-b:cancelled']);
    button.click_listener?.();
    dispose();
    expect(mockRecordAuthPerfEvent.mock.calls).toEqual([
      ['click-a', 'cancelled'],
      ['click-b', 'cancelled'],
    ]);
  });

  it('ignores clicks while an accepted credential exchange is pending', async () => {
    mockBeginAuthPerfAttempt.mockReturnValue('click-a');
    const { button, config, onCredential, dispose } = setup();
    let release!: () => void;
    onCredential.mockImplementation(
      () =>
        new Promise<void>(resolve => {
          release = resolve;
        })
    );
    button.click_listener?.();
    config.callback({ credential: 'synthetic-token' });
    button.click_listener?.();
    await Promise.resolve();
    button.click_listener?.();
    config.callback({ credential: 'ignored-token' });
    expect(mockBeginAuthPerfAttempt).toHaveBeenCalledOnce();
    expect(mockRecordAuthPerfEvent).not.toHaveBeenCalled();
    expect(onCredential).toHaveBeenCalledOnce();
    release();
    await vi.waitFor(() => {
      button.click_listener?.();
      expect(mockBeginAuthPerfAttempt).toHaveBeenCalledTimes(2);
    });
    expect(mockRecordAuthPerfEvent).toHaveBeenCalledWith('click-a', 'cancelled');
    dispose();
  });

  it('isolates cancellation audit errors from replacement clicks and GIS disposal', () => {
    mockBeginAuthPerfAttempt.mockReturnValueOnce('click-a').mockReturnValueOnce('click-b');
    mockRecordAuthPerfEvent.mockImplementation(() => {
      throw new Error('audit unavailable');
    });
    const { button, dispose, api } = setup();
    button.click_listener?.();
    expect(() => button.click_listener?.()).not.toThrow();
    expect(mockBeginAuthPerfAttempt).toHaveBeenCalledTimes(2);
    expect(dispose).not.toThrow();
    expect(api.cancel).toHaveBeenCalledOnce();
    expect(mockRecordAuthPerfEvent.mock.calls).toEqual([
      ['click-a', 'cancelled'],
      ['click-b', 'cancelled'],
    ]);
  });

  const setupModel = () => {
    let sequence = 0;
    let now = 10;
    const model = createCensusPerfModel({
      now: () => now,
      id: () => 'attempt-' + ++sequence,
      timeOrigin: 0,
      environment: 'development',
    });
    mockBeginAuthPerfAttempt.mockImplementation(model.begin);
    mockRecordAuthPerfEvent.mockImplementation(model.auth);
    return {
      model,
      setNow: (value: number) => {
        now = value;
      },
    };
  };

  it('labels a credential-only remount as credential_received after the old click was disposed', async () => {
    const { model } = setupModel();
    const old = setup();
    old.button.click_listener?.();
    old.dispose();
    const next = setup();
    next.onCredential.mockImplementation(() => {
      const id = model.receiveCredential();
      model.auth(id, 'authorized');
    });
    next.config.callback({ credential: 'synthetic-sensitive-token' });
    await Promise.resolve();
    old.dispose();
    old.button.click_listener?.();
    old.config.callback({ credential: 'ignored-stale-token' });
    next.dispose();
    expect(model.snapshot().authAttempts).toEqual([
      { id: 'attempt-2', boundary: 'google_button', events: { started: 10, cancelled: 10 } },
      {
        id: 'attempt-3',
        boundary: 'credential_received',
        events: { started: 10, credential_received: 10, authorized: 10 },
      },
    ]);
    expect(old.onCredential).not.toHaveBeenCalled();
    expect(JSON.stringify(model.snapshot())).not.toContain('synthetic-sensitive-token');
  });

  it('keeps a live GIS click correlated after a legitimate 20-second account selection', async () => {
    const { model, setNow } = setupModel();
    const { button, config, onCredential, dispose } = setup();
    onCredential.mockImplementation(() => model.auth(model.receiveCredential(), 'authorized'));
    button.click_listener?.();
    setNow(20_010);
    config.callback({ credential: 'synthetic-token' });
    await Promise.resolve();
    dispose();
    expect(model.snapshot().authAttempts).toEqual([
      {
        id: 'attempt-2',
        boundary: 'google_button',
        events: { started: 10, credential_received: 20_010, authorized: 20_010 },
      },
    ]);
  });

  it('does not overwrite authorization of a newer mount when an older mount is disposed', async () => {
    const { model } = setupModel();
    const old = setup();
    old.button.click_listener?.();
    const next = setup();
    next.button.click_listener?.();
    next.onCredential.mockImplementation(() => model.auth(model.receiveCredential(), 'authorized'));
    next.config.callback({ credential: 'synthetic-token' });
    await Promise.resolve();
    old.dispose();
    next.dispose();
    const attempts = model.snapshot().authAttempts;
    expect(attempts[0].events).toEqual({ started: 10, cancelled: 10 });
    expect(attempts[1].events).toEqual({ started: 10, credential_received: 10, authorized: 10 });
  });

  it('lets the in-flight controller outcome decide after login unmounts', async () => {
    const { model } = setupModel();
    const { button, config, onCredential, dispose } = setup();
    let finish!: () => void;
    onCredential.mockImplementation(() => {
      const id = model.receiveCredential();
      return new Promise<void>(resolve => {
        finish = () => {
          model.auth(id, 'authorized');
          resolve();
        };
      });
    });
    button.click_listener?.();
    config.callback({ credential: 'synthetic-token' });
    await Promise.resolve();
    dispose();
    finish();
    await Promise.resolve();
    expect(model.snapshot().authAttempts[0].events).toEqual({
      started: 10,
      credential_received: 10,
      authorized: 10,
    });
  });

  it('rejects callbacks and invalidates accepted credentials after disposal', async () => {
    const { config, onCredential, dispose, api } = setup();
    config.callback({ credential: 'test-auth-token' });
    await Promise.resolve();
    const isCurrent = onCredential.mock.calls[0][1];
    expect(isCurrent()).toBe(true);
    dispose();
    expect(isCurrent()).toBe(false);
    config.callback({ credential: 'dummy' });
    expect(onCredential).toHaveBeenCalledTimes(1);
    expect(api.cancel).toHaveBeenCalledOnce();
  });
  it('allows another attempt after the previous exchange settles', async () => {
    const { config, onCredential } = setup();
    config.callback({ credential: 'fake' });
    await vi.waitFor(() => expect(onCredential).toHaveBeenCalledOnce());
    config.callback({ credential: 'dummy' });
    await Promise.resolve();
    expect(onCredential).toHaveBeenCalledTimes(2);
  });
  it('ignores an accepted callback disposed before the exchange starts', async () => {
    const { config, onCredential, dispose } = setup();
    config.callback({ credential: 'dummy' });
    dispose();
    await Promise.resolve();
    expect(onCredential).not.toHaveBeenCalled();
  });
});
