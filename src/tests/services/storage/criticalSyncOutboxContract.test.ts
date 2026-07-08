import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SOURCE_ROOT = path.join(process.cwd(), 'src');
const SERVICES_ROOT = path.join(SOURCE_ROOT, 'services');
const ALLOWED_LEGACY_QUEUE_FILES = new Set([
  path.join(SERVICES_ROOT, 'storage/sync/publicSyncQueue.ts'),
  path.join(SERVICES_ROOT, 'storage/sync/index.ts'),
]);

const listSourceFiles = (directory: string): string[] =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return listSourceFiles(absolutePath);
    }
    return entry.isFile() && absolutePath.endsWith('.ts') ? [absolutePath] : [];
  });

describe('critical daily-record sync outbox contract', () => {
  it('keeps production services off the legacy queueSyncTask API', () => {
    const offenders = listSourceFiles(SERVICES_ROOT).filter(filePath => {
      if (ALLOWED_LEGACY_QUEUE_FILES.has(filePath)) return false;
      const source = fs.readFileSync(filePath, 'utf8');
      return /\bqueueSyncTask\s*\(/.test(source) || /\bqueueSyncTask\b/.test(source);
    });

    expect(offenders.map(filePath => path.relative(process.cwd(), filePath))).toEqual([]);
  });

  it('keeps repository writes off void local daily-record persistence wrappers', () => {
    const repositoryRoot = path.join(SERVICES_ROOT, 'repositories');
    const offenders = listSourceFiles(repositoryRoot).filter(filePath => {
      const source = fs.readFileSync(filePath, 'utf8');
      return /import\s*\{[^}]*\b(?:saveRecord|saveRecords|deleteRecord)\b(?!Strict)[^}]*\}\s*from\s*['"]@\/services\/storage\/indexeddb\/indexedDbRecordService['"]/.test(
        source
      );
    });

    expect(offenders.map(filePath => path.relative(process.cwd(), filePath))).toEqual([]);
  });

  it('keeps the sync queue store port on atomic claim APIs only', () => {
    const portSource = fs.readFileSync(
      path.join(SERVICES_ROOT, 'storage/sync/syncQueuePorts.ts'),
      'utf8'
    );
    const storeSource = fs.readFileSync(
      path.join(SERVICES_ROOT, 'storage/sync/dexieSyncQueueStore.ts'),
      'utf8'
    );

    expect(portSource).not.toContain('listReadyPending');
    expect(storeSource).not.toContain('listReadyPending');
    expect(portSource).toContain('claimReadyPending');
    expect(storeSource).toContain('claimReadyPending');
  });
});
