// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import {
  extractAssetChunkImports,
  extractDynamicRelativeJsImports,
  extractStaticRelativeJsImports,
} from '../../../scripts/lib/staticChunkImports.mjs';

const roots: string[] = [];

afterEach(() => {
  roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true }));
});

const runChunkGraph = (assets: Record<string, string>, entryChunk = 'entry.js') => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chunk-graph-check-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'dist', 'assets'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'dist', 'index.html'),
    `<script type="module" src="/assets/${entryChunk}"></script>`
  );
  for (const [name, content] of Object.entries(assets)) {
    fs.writeFileSync(path.join(root, 'dist', 'assets', name), content);
  }
  return spawnSync(process.execPath, [path.resolve('scripts/check-chunk-graph.mjs')], {
    cwd: root,
    encoding: 'utf8',
  });
};

describe('staticChunkImports extractor', () => {
  it('captures both from-imports and bare side-effect imports while excluding dynamic import()', () => {
    const chunk = [
      'import"./vendor-side-effect.js";',
      'import { a } from "./vendor-named.js";',
      "export * from './vendor-reexport.js';",
      'const lazy = () => import("./feature-lazy.js");',
      'const lazySpaced = () => import( "../outside.js" );',
    ].join('\n');

    expect(extractStaticRelativeJsImports(chunk)).toEqual([
      './vendor-side-effect.js',
      './vendor-named.js',
      './vendor-reexport.js',
    ]);
    expect(extractDynamicRelativeJsImports(chunk)).toEqual(['./feature-lazy.js', '../outside.js']);
    expect(extractAssetChunkImports(chunk)).toEqual({
      static: ['vendor-side-effect.js', 'vendor-named.js', 'vendor-reexport.js'],
      dynamic: ['feature-lazy.js'],
    });
  });
});

describe('check-chunk-graph.mjs', () => {
  it('fails on a synthetic mutual side-effect cycle between vendor chunks', () => {
    const result = runChunkGraph({
      'entry.js': 'import"./vendor-a.js";',
      'vendor-a.js': 'import"./vendor-b.js";export const a=1;',
      'vendor-b.js': 'import"./vendor-a.js";export const b=2;',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Circular dependencies between vendor chunks');
    expect(result.stderr).toContain('vendor-a.js');
    expect(result.stderr).toContain('vendor-b.js');
  });

  it('fails on a mixed named-import and bare side-effect cycle between vendor chunks', () => {
    const result = runChunkGraph({
      'entry.js': 'import{a}from"./vendor-a.js";console.log(a);',
      'vendor-a.js': 'import{b}from"./vendor-b.js";export const a=b;',
      'vendor-b.js': 'import"./vendor-a.js";export const b=1;',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Circular dependencies between vendor chunks');
  });

  it('fails when a vendor chunk performs a bare side-effect import of a feature chunk', () => {
    const result = runChunkGraph({
      'entry.js': 'import"./vendor-core.js";',
      'vendor-core.js': 'import"./feature-census.js";',
      'feature-census.js': 'export const ok=true;',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Vendor → Feature import violations');
    expect(result.stderr).toContain('vendor-core.js --[static]--> feature-census.js');
  });

  it('passes on an acyclic chain of static side-effect vendor imports', () => {
    const result = runChunkGraph({
      'entry.js': 'import"./vendor-a.js";',
      'vendor-a.js': 'import"./vendor-b.js";',
      'vendor-b.js': 'import"./vendor-c.js";',
      'vendor-c.js': 'export const c=3;',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('3 vendor chunks acyclic');
    expect(result.stdout).toContain('Startup loads 4 chunks');
  });

  it('does not treat a dynamic import() as a static vendor cycle or pre-login startup load', () => {
    const result = runChunkGraph({
      'entry.js':
        'import"./vendor-a.js";export const load=()=>import("./app-authenticated-shell-1.js");',
      'vendor-a.js': 'import"./vendor-b.js";',
      'vendor-b.js': 'export const loadA=()=>import("./vendor-a.js");',
      'app-authenticated-shell-1.js': 'export const shell=true;',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('2 vendor chunks acyclic');
    expect(result.stdout).toContain('Startup loads 3 chunks');
  });

  it('fails when a forbidden startup chunk is pulled via bare side-effect import', () => {
    const result = runChunkGraph({
      'entry.js': 'import"./boot.js";',
      'boot.js': 'import "./vendor-firebase-firestore-1.js";',
      'vendor-firebase-firestore-1.js': 'export const db={};',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('vendor-firebase-firestore-1.js');
  });
});
