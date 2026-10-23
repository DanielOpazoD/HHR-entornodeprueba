// @vitest-environment node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildFunctionBundle,
  buildModernFunctionEsmArtifact,
  checkMailBundleBudgets,
  loadEsmArtifact,
  readNetlifyExternalModules,
  usesModernFunctionApi,
} from '../../../scripts/netlifyFunctionBundleSupport.mjs';

const fixtures: string[] = [];
const policy = {
  version: 1,
  functions: {
    'send-census-email': { maxBytes: 1000, maxGzipBytes: 500 },
    'send-fuga-notification': { maxBytes: 1000, maxGzipBytes: 500 },
  },
};
const bundle = (name: string) => ({
  name,
  path: `/tmp/${name}.cjs`,
  bytes: 1000,
  gzipBytes: 500,
  sha256: 'fixture',
  googleApis: ['gmail'],
  externalImports: [],
});

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fs.rmSync(fixture, { recursive: true, force: true });
});

describe('Netlify function bundle support', () => {
  it('builds the emitted CJS file using root config and measures that exact artifact', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'netlify-bundle-fixture-'));
    fixtures.push(root);
    const write = (relativePath: string, content: string) => {
      const target = path.join(root, relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    };
    write(
      'netlify.toml',
      '[functions]\nexternal_node_modules = ["fixture-native", "other-native"]'
    );
    write(
      'tsconfig.json',
      JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@fixture/*': ['src/*'] } } })
    );
    write('src/value.ts', 'export const value: string = "resolved-fixture-alias";');
    write(
      'node_modules/googleapis/build/src/apis/gmail/v1.js',
      'exports.version = "gmail-fixture";'
    );
    write(
      'node_modules/googleapis/build/src/apis/gmail/index.js',
      'exports.gmail = require("./v1").version;'
    );
    write(
      'function.ts',
      [
        'import { value } from "@fixture/value";',
        'import { gmail } from "googleapis/build/src/apis/gmail/index.js";',
        'import native from "fixture-native";',
        'export const handler = () => [value, gmail, native];',
      ].join('\n')
    );

    const outDir = path.join(root, 'output');
    const built = await buildFunctionBundle({ root, entryPoint: 'function.ts', outDir });
    const emitted = fs.readFileSync(built.path);

    expect(readNetlifyExternalModules(root)).toEqual(['fixture-native', 'other-native']);
    expect(built).toEqual({
      name: 'function',
      path: path.join(outDir, 'function.cjs'),
      bytes: emitted.length,
      gzipBytes: gzipSync(emitted).length,
      sha256: createHash('sha256').update(emitted).digest('hex'),
      googleApis: ['gmail'],
      externalImports: ['fixture-native'],
    });
    expect(emitted.toString()).toContain('resolved-fixture-alias');
    expect(emitted.toString()).toContain('require("fixture-native")');

    write('netlify.toml', '[functions]\nnode_bundler = "esbuild"');
    expect(readNetlifyExternalModules(root)).toEqual([]);
  });

  it('accepts ceilings inclusively and permits unrelated function bundles', () => {
    expect(
      checkMailBundleBudgets(
        [bundle('send-census-email'), bundle('send-fuga-notification'), bundle('other-function')],
        policy
      )
    ).toEqual([]);
  });

  it('reports each raw and gzip overage and every missing configured bundle', () => {
    expect(
      checkMailBundleBudgets(
        [{ ...bundle('send-census-email'), bytes: 1001, gzipBytes: 501 }],
        policy
      )
    ).toEqual([
      'send-census-email: bytes 1001 exceeds maxBytes 1000',
      'send-census-email: gzipBytes 501 exceeds maxGzipBytes 500',
      'send-fuga-notification: required mail function bundle is missing',
    ]);
  });

  it.each([{ googleApis: [] }, { googleApis: ['drive'] }, { googleApis: ['gmail', 'drive'] }])(
    'rejects Google API directories $googleApis',
    ({ googleApis }) => {
      expect(
        checkMailBundleBudgets(
          [{ ...bundle('send-census-email'), googleApis }, bundle('send-fuga-notification')],
          policy
        )
      ).toEqual([
        `send-census-email: expected only the Gmail Google API; found ${googleApis.join(', ') || 'none'}`,
      ]);
    }
  );

  it.each([
    null,
    { version: 2, functions: policy.functions },
    { version: 1, functions: {} },
    { version: 1, functions: { mail: { maxBytes: 0, maxGzipBytes: 500 } } },
    { version: 1, functions: { mail: { maxBytes: 1000, maxGzipBytes: 1.5 } } },
  ])('rejects malformed policy %j', invalidPolicy => {
    expect(checkMailBundleBudgets([], invalidPolicy)).not.toEqual([]);
  });
});

describe('modern-API functions loaded as Netlify runs them', () => {
  const createFixtureRoot = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'netlify-esm-fixture-'));
    fixtures.push(root);
    const write = (relativePath: string, content: string) => {
      const target = path.join(root, relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    };
    write(
      'tsconfig.json',
      JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@fixture/*': ['src/*'] } } })
    );
    write('src/value.ts', 'export const value: string = "resolved-fixture-alias";');
    // A CommonJS package without an exports map, like googleapis.
    write('node_modules/fixture-cjs/package.json', '{"name":"fixture-cjs","main":"index.js"}');
    write('node_modules/fixture-cjs/lib/api/index.js', 'exports.ping = () => "pong";');
    return { root, write };
  };

  it('recognizes the modern API by its default export', () => {
    expect(usesModernFunctionApi('export default async (request) => new Response("ok");')).toBe(
      true
    );
    expect(usesModernFunctionApi('export const handler = async () => ({ statusCode: 200 });')).toBe(
      false
    );
  });

  it('fails a directory import of a package, which only resolves under require()', async () => {
    const { root, write } = createFixtureRoot();
    write(
      'directory-import.ts',
      [
        'import { value } from "@fixture/value";',
        'import { ping } from "fixture-cjs/lib/api";',
        'export default () => [value, ping()];',
      ].join('\n')
    );

    const artifact = await buildModernFunctionEsmArtifact({
      root,
      entryPoint: 'directory-import.ts',
      outDir: path.join(root, 'output'),
    });

    expect(fs.readFileSync(artifact.path, 'utf8')).toContain('resolved-fixture-alias');
    expect(loadEsmArtifact(artifact.path)).toContain('ERR_UNSUPPORTED_DIR_IMPORT');
  });

  it('loads the same import when it names the file', async () => {
    const { root, write } = createFixtureRoot();
    write(
      'file-import.ts',
      [
        'import { value } from "@fixture/value";',
        'import { ping } from "fixture-cjs/lib/api/index.js";',
        'export default () => [value, ping()];',
      ].join('\n')
    );

    const artifact = await buildModernFunctionEsmArtifact({
      root,
      entryPoint: 'file-import.ts',
      outDir: path.join(root, 'output'),
    });

    expect(fs.readFileSync(artifact.path, 'utf8')).toContain('fixture-cjs/lib/api/index.js');
    expect(loadEsmArtifact(artifact.path)).toBeNull();
  });
});
