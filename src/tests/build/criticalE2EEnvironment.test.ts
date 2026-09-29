import { execFileSync, spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { buildCriticalE2EEnvironment } from '../../../scripts/config/criticalE2EEnvironment.mjs';

const wrapper = 'scripts/config/criticalE2EEnvironment.mjs';

describe('critical E2E environment', () => {
  it('replaces frontend configuration without mutating the parent environment', () => {
    const parent = {
      PATH: '/test/bin',
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:18081',
      VITE_FIREBASE_PROJECT_ID: 'personal-project',
      VITE_FIREBASE_API_KEY_B64: 'personal-encoded-key',
      VITE_GOOGLE_SIGN_IN_CLIENT_ID: 'personal-client',
      VITE_UNEXPECTED_FLAG: 'true',
    };
    const before = { ...parent };
    const env = buildCriticalE2EEnvironment(parent);
    expect(env).toMatchObject({
      PATH: '/test/bin',
      VITE_E2E_MODE: 'true',
      VITE_FIREBASE_PROJECT_ID: 'demo-hhr-e2e',
      VITE_FIRESTORE_EMULATOR_HOST: '127.0.0.1:18081',
      VITE_GOOGLE_SIGN_IN_CLIENT_ID: '',
    });
    expect(env.VITE_FIREBASE_API_KEY_B64).toBe('');
    expect(env.VITE_UNEXPECTED_FLAG).toBe('');
    expect(parent).toEqual(before);
  });

  it('ignores an inherited frontend emulator endpoint without a runner override', () => {
    const env = buildCriticalE2EEnvironment({ VITE_FIRESTORE_EMULATOR_HOST: 'localhost:19999' });
    expect(env.VITE_FIRESTORE_EMULATOR_HOST).toBe('127.0.0.1:8080');
  });

  it.each(['example.invalid:8080', '127.0.0.1:0', 'localhost:65536', 'https://localhost:8080'])(
    'rejects a non-local or invalid emulator endpoint: %s',
    host => {
      expect(() => buildCriticalE2EEnvironment({ FIRESTORE_EMULATOR_HOST: host })).toThrow(
        'loopback'
      );
    }
  );

  it('uses the same isolated environment for commands and preserves their exit status', () => {
    const env = {
      ...process.env,
      FIRESTORE_EMULATOR_HOST: 'localhost:18081',
      VITE_UNEXPECTED_FLAG: 'true',
    };
    const output = execFileSync(
      process.execPath,
      [
        wrapper,
        process.execPath,
        '-e',
        'console.log(JSON.stringify({project:process.env.VITE_FIREBASE_PROJECT_ID,extra:process.env.VITE_UNEXPECTED_FLAG,host:process.env.VITE_FIRESTORE_EMULATOR_HOST}))',
      ],
      { env, encoding: 'utf8' }
    );
    expect(JSON.parse(output)).toEqual({
      project: 'demo-hhr-e2e',
      host: 'localhost:18081',
      extra: '',
    });
    const failure = spawnSync(
      process.execPath,
      [wrapper, process.execPath, '-e', 'process.exit(7)'],
      { env }
    );
    expect(failure.status).toBe(7);
  });
});
