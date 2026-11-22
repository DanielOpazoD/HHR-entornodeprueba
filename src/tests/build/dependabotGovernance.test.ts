// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import prettier from 'prettier';
import { describe, expect, it } from 'vitest';

const configPath = path.join(process.cwd(), '.github/dependabot.yml');
const config = fs.readFileSync(configPath, 'utf8');

const updateBlocks = config.split(/(?=^ {2}- package-ecosystem:)/m).slice(1);
const rootNpm = updateBlocks.find(
  block => block.includes('package-ecosystem: npm') && /directory: ['"]\/['"]/.test(block)
);

describe('Dependabot governance', () => {
  it('is valid YAML and keeps root groups in the root npm workspace', async () => {
    const options = (await prettier.resolveConfig(configPath)) ?? {};
    expect(await prettier.check(config, { ...options, filepath: configPath })).toBe(true);
    expect(rootNpm).toBeDefined();

    for (const group of [
      'react-runtime-minor',
      'document-runtime-minor',
      'data-runtime-minor',
      'cloud-api-runtime-minor',
      'ui-runtime-minor',
      'media-runtime-minor',
      'vitest-toolchain-minor',
      'vite-toolchain-minor',
      'lint-toolchain-minor',
      'browser-test-toolchain-minor',
      'firebase-toolchain-minor',
      'css-toolchain-minor',
      'pwa-toolchain-minor',
      'typescript-docs-toolchain-minor',
      'repository-tooling-minor',
    ]) {
      expect(rootNpm).toContain(`${group}:`);
    }
    expect(rootNpm).not.toContain('production-dependencies-minor:');
    expect(rootNpm).not.toContain('dev-dependencies-minor:');
    expect(rootNpm!.indexOf('pwa-toolchain-minor:')).toBeLessThan(
      rootNpm!.indexOf('vite-toolchain-minor:')
    );
  });

  it('does not retain retired Storybook grouping or Storybook-only major holds', () => {
    expect(rootNpm).not.toContain('storybook-toolchain-minor:');
    expect(rootNpm).not.toContain('storybook');
  });
});
