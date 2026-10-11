// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllEnvs());

it('bundles consumed client settings without serializing unrelated configuration', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('VITE_UNUSED_CONFIGURATION_PROBE', 'unused-configuration-marker');
  vi.stubEnv('VITE_FIREBASE_APP_ID', 'synthetic-app-marker');
  vi.stubEnv('VITE_LEGACY_FIREBASE_PROJECT_ID', 'synthetic-legacy-marker');
  const cacheDir = mkdtempSync(join(tmpdir(), 'hhr-client-env-build-'));

  try {
    const result = await build({
      configFile: false,
      envDir: false,
      cacheDir,
      mode: 'production',
      logLevel: 'silent',
      build: {
        write: false,
        minify: false,
        rollupOptions: {
          // Keep public readers alive: an empty, tree-shaken bundle would falsely pass.
          preserveEntrySignatures: 'strict',
          input: [
            'src/config/envValidator.ts',
            'src/services/storage/legacyfirebase/legacyFirebaseCore.ts',
          ],
          external: id =>
            id === 'zod' ||
            id.startsWith('firebase/') ||
            id.includes('loggerScope') ||
            id === './legacyFirebaseLogger',
          output: { format: 'es' },
        },
      },
    });
    const outputs = Array.isArray(result) ? result : [result];
    const code = outputs
      .flatMap(output => ('output' in output ? output.output : []))
      .filter(output => output.type === 'chunk')
      .map(chunk => chunk.code)
      .join('\n');

    expect(code).toContain('synthetic-app-marker');
    expect(code).toContain('synthetic-legacy-marker');
    expect(code).not.toContain('unused-configuration-marker');
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});
