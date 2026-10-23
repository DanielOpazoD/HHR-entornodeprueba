// @vitest-environment node
import path from 'node:path';
import { expect, it } from 'vitest';
import { loadConfigFromFile } from 'vite';

it('keeps queue load nightly-only while retaining the deterministic drain in critical coverage', async () => {
  const loaded = await loadConfigFromFile(
    { command: 'serve', mode: 'test' },
    path.resolve('vitest.critical-coverage.config.ts')
  );
  expect(loaded).not.toBeNull();
  expect(loaded?.config.test?.include).toContain('src/tests/**/*.test.ts');
  expect(loaded?.config.test?.exclude).toContain(
    'src/tests/services/storage/syncQueueLoad.test.ts'
  );
  expect(loaded?.config.test?.exclude).not.toContain(
    'src/tests/services/storage/syncQueueDrain.test.ts'
  );
});
