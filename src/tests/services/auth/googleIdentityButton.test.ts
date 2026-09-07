import { describe, expect, it, vi } from 'vitest';
import {
  mountGoogleIdentityButton,
  type GoogleIdentityApi,
} from '@/services/auth/googleIdentityButton';

describe('explicit Google identity button', () => {
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
    expect(button).not.toHaveProperty('click_listener');
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
