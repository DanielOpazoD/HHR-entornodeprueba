import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const FUNCTIONS_DIR = path.join(ROOT, 'functions');
const readJson = <T>(relativePath: string): T =>
  JSON.parse(readFileSync(path.join(ROOT, relativePath), 'utf8')) as T;

interface FunctionsPackageManifest {
  engines: { node: string };
  dependencies: Record<string, string>;
}

interface FunctionsPackageLock {
  packages: Record<
    string,
    {
      version: string;
      engines?: { node?: string };
      dependencies?: Record<string, string>;
    }
  >;
}

const collectJavaScriptFiles = (directory: string): string[] =>
  readdirSync(directory).flatMap(entry => {
    if (entry === 'node_modules') return [];
    const absolutePath = path.join(directory, entry);
    if (statSync(absolutePath).isDirectory()) return collectJavaScriptFiles(absolutePath);
    return entry.endsWith('.js') ? [absolutePath] : [];
  });

describe('Firebase Functions modular runtime contract', () => {
  it('pins the supported Node 22 runtime and Firebase Admin v14 toolchain', () => {
    const packageJson = readJson<FunctionsPackageManifest>('functions/package.json');
    const packageLock = readJson<FunctionsPackageLock>('functions/package-lock.json');
    const rootLockPackage = packageLock.packages[''];

    expect(packageJson.engines.node).toBe('22');
    expect(packageJson.dependencies['firebase-admin']).toMatch(/^\^14\./);
    expect(packageJson.dependencies['firebase-functions']).toMatch(/^\^7\.3\./);
    expect(rootLockPackage.engines?.node).toBe('22');
    expect(rootLockPackage.dependencies?.['firebase-admin']).toMatch(/^\^14\./);
    expect(Number(packageLock.packages['node_modules/firebase-admin'].version.split('.')[0])).toBe(
      14
    );
    expect(
      Number(packageLock.packages['node_modules/firebase-functions'].version.split('.')[0])
    ).toBe(7);
  });

  it('keeps production code on modular Firebase Admin entrypoints', () => {
    const violations = collectJavaScriptFiles(FUNCTIONS_DIR).flatMap(file => {
      const source = readFileSync(file, 'utf8');
      const usesLegacyRootImport = /require\(['"]firebase-admin['"]\)/.test(source);
      const usesLegacyNamespace =
        /\badmin\.(auth|firestore|storage|initializeApp|apps|app)\b/.test(source);
      return usesLegacyRootImport || usesLegacyNamespace
        ? [path.relative(ROOT, file)]
        : [];
    });

    expect(violations).toEqual([]);

    const appContext = readFileSync(path.join(FUNCTIONS_DIR, 'lib/appContext.js'), 'utf8');
    expect(appContext).toContain("require('firebase-admin/app')");
    expect(appContext).toContain("require('firebase-admin/auth')");
    expect(appContext).toContain("require('firebase-admin/firestore')");
    expect(appContext).toContain("require('firebase-admin/storage')");
    expect(appContext).toContain('auth,');
    expect(appContext).toContain('firestore,');
    expect(appContext).toContain('storage,');
  });
});
