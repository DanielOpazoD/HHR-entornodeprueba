// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  emulatorTestCommand,
  prepareFirestoreRules,
} from '../../../scripts/lib/emulatorTestFiles.mjs';

const sync = 'src/tests/emulator/cudyr-legacy-official.emulator.test.ts';
const ui = 'src/tests/emulator-ui/missingRemoteDay.emulator-ui.test.ts';

describe('focused emulator command', () => {
  it('selects each configuration and forwards options to both groups', () => {
    expect(emulatorTestCommand([ui, sync, '--', '--maxWorkers=2'])).toBe(
      `RUN_FIRESTORE_EMULATOR_TESTS=1 ./node_modules/.bin/vitest run -c vitest.emulator-ui.config.ts '${ui}' '--maxWorkers=2' && RUN_FIRESTORE_EMULATOR_TESTS=1 ./node_modules/.bin/vitest run -c vitest.emulator.config.ts '${sync}' '--maxWorkers=2'`
    );
  });

  it('normalizes absolute paths and groups files in one invocation per suite', () => {
    expect(emulatorTestCommand([`${process.cwd()}/${sync}`, `./${sync}`])).toBe(
      `RUN_FIRESTORE_EMULATOR_TESTS=1 ./node_modules/.bin/vitest run -c vitest.emulator.config.ts '${sync}' '${sync}'`
    );
  });

  it.each([
    [],
    ['src/tests/hooks/no.test.ts'],
    ['src/tests/emulator/no.test.ts'],
    ['src/tests/emulator/../setup.ts'],
  ])('rejects missing or out-of-scope files: %j', (...files) => {
    expect(() => emulatorTestCommand(files)).toThrow(
      'src/tests/emulator/ o src/tests/emulator-ui/'
    );
  });

  it('preserves configured CI ports and isolates every listener in file mode', () => {
    const config = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'hhr-file-config-')),
      'firebase.json'
    );
    try {
      const generate = (mode: string) => {
        execFileSync('bash', [
          '-c',
          'source scripts/lib/firebase-emulator-ci.sh; write_firestore_emulator_config "$1" 127.0.0.1:18081 "$2"',
          '_',
          config,
          mode,
        ]);
        return JSON.parse(fs.readFileSync(config, 'utf8'));
      };
      const original = JSON.parse(fs.readFileSync('firebase.json', 'utf8'));
      expect(generate('').emulators).toEqual({
        ...original.emulators,
        firestore: { ...original.emulators.firestore, host: '127.0.0.1', port: 18081 },
      });
      const isolated = generate('isolated');
      expect(isolated.emulators.ui).toEqual({ enabled: false });
      const ports = ['firestore', 'hub', 'logging'].map(name => isolated.emulators[name].port);
      expect(new Set(ports).size).toBe(3);
      for (const port of ports) {
        expect(port).toBeGreaterThanOrEqual(20000);
        expect(port).toBeLessThanOrEqual(29999);
      }
      expect(isolated.firestore.rules).toBe(path.resolve('firestore.rules'));
    } finally {
      fs.unlinkSync(config);
      fs.rmdirSync(path.dirname(config));
    }
  });

  it('runs the unchanged CI command under nounset and cleans up after child failure', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hhr-file-exec-'));
    const runner = path.join(dir, 'firebase');
    fs.writeFileSync(runner, '#!/bin/sh\nprintf "%s\\n" "$@"\nexit 7\n', { mode: 0o755 });
    try {
      const result = spawnSync(
        'bash',
        [
          '-euc',
          'source scripts/lib/firebase-emulator-ci.sh; runner="$1"; resolve_local_firebasetools() { printf "%s" "$runner"; }; run_firestore_emulator_exec "npm run test:emulator:sync && npm run test:emulator:ui"',
          '_',
          runner,
        ],
        { encoding: 'utf8', env: { ...process.env, FIRESTORE_EMULATOR_HOST: '127.0.0.1:18081' } }
      );
      expect(result.status).toBe(7);
      const args = result.stdout.trim().split('\n');
      expect(args).toEqual([
        'emulators:exec',
        '--config',
        expect.any(String),
        '--only',
        'firestore',
        'npm run test:emulator:sync && npm run test:emulator:ui',
      ]);
      expect(fs.existsSync(args[2])).toBe(false);
    } finally {
      fs.unlinkSync(runner);
      fs.rmdirSync(dir);
    }
  });

  it('passes shell metacharacters as literal Vitest arguments', () => {
    const option = "--testNamePattern=it's $(exit 7); `exit 9`";
    const command = emulatorTestCommand([sync, '--', option]);
    const output = execFileSync(
      'bash',
      [
        '-c',
        `capture() { printf '%s\\n' "$@"; }; ${command.replace('./node_modules/.bin/vitest', 'capture')}`,
      ],
      {
        encoding: 'utf8',
      }
    );
    expect(output.trim().split('\n')).toEqual([
      'run',
      '-c',
      'vitest.emulator.config.ts',
      sync,
      option,
    ]);
  });
});

describe('emulator rule readiness', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it('waits for the rules request to complete before admitting tests', async () => {
    vi.stubEnv('FIRESTORE_EMULATOR_HOST', '127.0.0.1:23456');
    let complete!: (value: { ok: boolean }) => void;
    const request = vi.fn(
      () =>
        new Promise(resolve => {
          complete = resolve;
        })
    );
    vi.stubGlobal('fetch', request);
    let ready = false;
    const preparation = prepareFirestoreRules().then(() => {
      ready = true;
    });
    await Promise.resolve();
    expect(ready).toBe(false);
    expect(request).toHaveBeenCalledWith(
      'http://127.0.0.1:23456/emulator/v1/projects/demo-hhr-emulator-file:securityRules',
      expect.objectContaining({ method: 'PUT' })
    );
    complete({ ok: true });
    await preparation;
    expect(ready).toBe(true);
  });
  it('rejects rule preparation failures and non-local endpoints', async () => {
    vi.stubEnv('FIRESTORE_EMULATOR_HOST', '127.0.0.1:23456');
    const request = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal('fetch', request);
    await expect(prepareFirestoreRules()).rejects.toThrow('HTTP 500');
    vi.stubEnv('FIRESTORE_EMULATOR_HOST', 'example.invalid:8080');
    await expect(prepareFirestoreRules()).rejects.toThrow('local');
    expect(request).toHaveBeenCalledTimes(1);
  });
});
