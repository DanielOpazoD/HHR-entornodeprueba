// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  auth: { emulatorConfig: null as null | { protocol: string; host: string; port: number } },
  signIn: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('firebase/auth', () => ({ signInWithEmailAndPassword: runtime.signIn }));
vi.mock('@/services/firebase-runtime/authRuntime', () => ({
  defaultAuthRuntime: { auth: runtime.auth, ready: Promise.resolve(), getCurrentUser: () => null },
}));

import { signInWithEmulatorPassword } from '../../../e2e/fixtures/emulatorPasswordSignIn';

describe('e2e emulator password sign-in fixture', () => {
  afterEach(() => {
    runtime.auth.emulatorConfig = null;
    vi.clearAllMocks();
  });

  it.each([
    ['no emulator', null],
    ['a non-loopback emulator', { protocol: 'http', host: 'auth.example.test', port: 9099 }],
  ])('refuses before handing credentials to the SDK with %s', async (_label, emulatorConfig) => {
    runtime.auth.emulatorConfig = emulatorConfig;

    await expect(
      signInWithEmulatorPassword('fixture@synthetic.invalid', 'synthetic')
    ).rejects.toThrow('not connected to a local emulator');
    expect(runtime.signIn).not.toHaveBeenCalled();
  });

  it('signs in through the app auth instance when it uses the local emulator', async () => {
    runtime.auth.emulatorConfig = { protocol: 'http', host: '127.0.0.1', port: 19099 };

    await signInWithEmulatorPassword('fixture@synthetic.invalid', 'synthetic');

    expect(runtime.signIn).toHaveBeenCalledWith(
      runtime.auth,
      'fixture@synthetic.invalid',
      'synthetic'
    );
  });
});
