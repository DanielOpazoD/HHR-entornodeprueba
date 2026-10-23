import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

import { build } from 'esbuild';

export const readNetlifyExternalModules = root => {
  const content = fs.readFileSync(path.join(root, 'netlify.toml'), 'utf8');
  const match = content.match(/external_node_modules\s*=\s*\[([^\]]*)\]/m);
  if (!match) return [];

  return match[1]
    .split(',')
    .map(part => part.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
};

export const buildFunctionBundle = async ({ root, entryPoint, outDir }) => {
  const name = path.basename(entryPoint, path.extname(entryPoint));
  const outputPath = path.resolve(outDir, `${name}.cjs`);
  const result = await build({
    absWorkingDir: path.resolve(root),
    entryPoints: [path.resolve(root, entryPoint)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    write: true,
    outfile: outputPath,
    tsconfig: path.join(root, 'tsconfig.json'),
    external: readNetlifyExternalModules(root),
    metafile: true,
    logLevel: 'silent',
  });
  const source = fs.readFileSync(outputPath);
  const googleApis = Object.keys(result.metafile.inputs).flatMap(input => {
    const api = input
      .replaceAll('\\', '/')
      .match(/(?:^|\/)googleapis\/build\/src\/apis\/([^/]+)\//)?.[1];
    return api ? [api] : [];
  });
  const externalImports = Object.values(result.metafile.outputs).flatMap(output =>
    output.imports.filter(item => item.external).map(item => item.path)
  );

  return {
    name,
    path: outputPath,
    bytes: source.length,
    gzipBytes: gzipSync(source).length,
    sha256: createHash('sha256').update(source).digest('hex'),
    googleApis: [...new Set(googleApis)].sort(),
    externalImports: [...new Set(externalImports)].sort(),
  };
};

/** Netlify ships modern-API functions (a default export) as ESM traced by nft, not bundled. */
export const usesModernFunctionApi = source => /^export\s+default\b/m.test(source);

/** Leaves every import that resolves into node_modules as an import, the way nft ships it. */
const keepNodeModulesAsImports = {
  name: 'keep-node-modules-as-imports',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^[^./]/ }, async args => {
      if (args.pluginData?.probing) return undefined;
      const resolved = await pluginBuild.resolve(args.path, {
        kind: args.kind,
        importer: args.importer,
        resolveDir: args.resolveDir,
        pluginData: { probing: true },
      });
      if (resolved.errors.length > 0 || !resolved.path.split(path.sep).includes('node_modules')) {
        return undefined;
      }
      return { path: args.path, external: true };
    });
  },
};

/**
 * Builds a modern-API function as Netlify runs it: its own sources inlined, packages resolved by
 * Node's ESM loader at runtime. A CJS bundle hides ESM-only failures such as directory imports.
 */
export const buildModernFunctionEsmArtifact = async ({ root, entryPoint, outDir }) => {
  const name = path.basename(entryPoint, path.extname(entryPoint));
  const outputPath = path.resolve(outDir, `${name}.mjs`);
  await build({
    absWorkingDir: path.resolve(root),
    entryPoints: [path.resolve(root, entryPoint)],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    write: true,
    outfile: outputPath,
    tsconfig: path.join(root, 'tsconfig.json'),
    plugins: [keepNodeModulesAsImports],
    logLevel: 'silent',
  });
  return { name, path: outputPath };
};

/** Imports an ESM artifact in a fresh Node process: null when it loads, else the first error line. */
export const loadEsmArtifact = artifactPath => {
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `await import(${JSON.stringify(pathToFileURL(artifactPath).href)});`,
    ],
    { cwd: path.dirname(artifactPath), encoding: 'utf8', env: { PATH: process.env.PATH ?? '' } }
  );
  if (result.status === 0) return null;
  const firstError = (result.stderr || result.stdout || 'unknown load failure')
    .split('\n')
    .find(line => /Error|ERR_/.test(line));
  return (firstError ?? 'unknown load failure').trim();
};

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export const checkMailBundleBudgets = (bundles, policy) => {
  if (!isObject(policy) || policy.version !== 1 || !isObject(policy.functions)) {
    return ['Mail bundle policy must have version 1 and a functions object'];
  }

  const entries = Object.entries(policy.functions).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  if (entries.length === 0) return ['Mail bundle policy must configure at least one function'];

  const failures = [];
  for (const [name, limits] of entries) {
    if (
      !name ||
      !isObject(limits) ||
      !Number.isSafeInteger(limits.maxBytes) ||
      limits.maxBytes <= 0 ||
      !Number.isSafeInteger(limits.maxGzipBytes) ||
      limits.maxGzipBytes <= 0
    ) {
      failures.push(
        `${name || '(unnamed function)'}: mail bundle ceilings must be positive integers`
      );
      continue;
    }

    const bundle = bundles.find(item => item.name === name);
    if (!bundle) {
      failures.push(`${name}: required mail function bundle is missing`);
      continue;
    }
    if (bundle.bytes > limits.maxBytes) {
      failures.push(`${name}: bytes ${bundle.bytes} exceeds maxBytes ${limits.maxBytes}`);
    }
    if (bundle.gzipBytes > limits.maxGzipBytes) {
      failures.push(
        `${name}: gzipBytes ${bundle.gzipBytes} exceeds maxGzipBytes ${limits.maxGzipBytes}`
      );
    }
    if (bundle.googleApis.length !== 1 || bundle.googleApis[0] !== 'gmail') {
      failures.push(
        `${name}: expected only the Gmail Google API; found ${bundle.googleApis.join(', ') || 'none'}`
      );
    }
  }
  return failures;
};
