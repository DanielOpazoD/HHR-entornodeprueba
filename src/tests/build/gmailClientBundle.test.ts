// @vitest-environment node
import path from 'node:path';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

describe('server-side Gmail bundle', () => {
  it('includes Gmail without bundling clients for unrelated Google APIs', async () => {
    const result = await build({
      entryPoints: [path.resolve('src/services/email/gmailClient.ts')],
      tsconfig: path.resolve('tsconfig.json'),
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node22',
      write: false,
      metafile: true,
      logLevel: 'silent',
    });
    const bundledApis = Object.keys(result.metafile.inputs).flatMap(input => {
      const api = input.match(/(?:^|\/)googleapis\/build\/src\/apis\/([^/]+)\//)?.[1];
      return api ? [api] : [];
    });

    expect([...new Set(bundledApis)]).toEqual(['gmail']);
  });
});
