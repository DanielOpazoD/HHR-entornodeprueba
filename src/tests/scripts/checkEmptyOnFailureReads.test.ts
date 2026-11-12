// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const GUARD = path.resolve('scripts/check-empty-on-failure-reads.mjs');
const roots: string[] = [];

const READ_WITH_EMPTY_FALLBACK = [
  'export const getMonth = async (',
  '  year: number',
  '): Promise<string[]> => {',
  '  try {',
  '    return await read(year);',
  '  } catch (error) {',
  '    log(error);',
  '    return [];',
  '  }',
  '};',
].join('\n');

const createRepository = (files: Record<string, string>) => {
  const root = mkdtempSync(path.join(tmpdir(), 'hhr-empty-reads-'));
  roots.push(root);
  const write = (relativePath: string, content: string) => {
    mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true });
    writeFileSync(path.join(root, relativePath), content);
  };
  for (const [relativePath, content] of Object.entries(files)) write(relativePath, content);
  return root;
};

const runGuard = (root: string, args: string[] = []) => {
  const result = spawnSync(process.execPath, [GUARD, ...args], { cwd: root, encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('check-empty-on-failure-reads', () => {
  it.each([
    ['', 1],
    ['// empty-on-failure-allow optional-capability: Storage unavailable; use memory.', 0],
    ['// empty-on-failure-allow optional-capability:   ', 1],
    ['// empty-on-failure-allow optional-capability: Use memory.\n', 1],
    ['// empty-on-failure-allow data-read: Ignore failure.', 1],
    ['// empty-on-failure-allow optional-capability: Storage may throw; use memory.\n', 1],
    ['// empty-on-failure-allow optional-capability: Use memory.\n    log(error);', 1],
  ])('requires an adjacent optional-capability reason (%s)', (comment, status) => {
    const source = READ_WITH_EMPTY_FALLBACK.replace('    return [];', `${comment}\n    return [];`);
    const root = createRepository({ 'src/services/repositories/capability.ts': source });
    expect(runGuard(root).status).toBe(status);
  });

  it('does not reuse a reason from another catch or for another empty return', () => {
    const source = `export const probe = () => {
  try { read(); } catch {
    // empty-on-failure-allow optional-capability: Storage unavailable; use memory.
    return null;
  }
  try { read(); } catch {
    return null;
  }
};`;
    const root = createRepository({ 'src/services/repositories/capability.ts': source });
    expect(runGuard(root).status).toBe(1);
  });

  it('requires a separate reason for every empty return in the same catch', () => {
    const source = `export const probe = () => {
  try { read(); } catch {
    if (restricted) {
      // empty-on-failure-allow optional-capability: Storage unavailable; use memory.
      return null;
    }
    return [];
  }
};`;
    const root = createRepository({ 'src/services/repositories/capability.ts': source });
    expect(runGuard(root).status).toBe(1);
  });

  it('rejects a laboratory cache read that hides failure as an empty result', () => {
    const root = createRepository({
      'src/features/laboratory/services/labFirestoreService.ts': READ_WITH_EMPTY_FALLBACK,
    });
    expect(runGuard(root)).toEqual({
      status: 1,
      output: expect.stringContaining(
        'new: src/features/laboratory/services/labFirestoreService.ts::getMonth'
      ),
    });
  });

  it('fails a new data-layer read that turns a failure into an empty result', () => {
    const root = createRepository({
      'src/services/storage/firestore/reads.ts': READ_WITH_EMPTY_FALLBACK,
    });

    const { status, output } = runGuard(root);

    expect(status).toBe(1);
    expect(output).toContain('new: src/services/storage/firestore/reads.ts::getMonth');
  });

  it('accepts reads that rethrow and code outside the data layer', () => {
    const root = createRepository({
      'src/services/repositories/rethrows.ts': READ_WITH_EMPTY_FALLBACK.replace(
        'return [];',
        'throw error;'
      ),
      'src/features/view.ts': READ_WITH_EMPTY_FALLBACK,
    });
    expect(runGuard(root)).toEqual({
      status: 0,
      output: expect.stringContaining('OK (no reads return empty on failure)'),
    });
  });

  it.each([{ args: [] }, { args: ['--write-baseline'] }])(
    'cannot accept a failing read through legacy configuration or arguments: %j',
    ({ args }) => {
      const legacyPath = 'scripts/config/empty-on-failure-reads-baseline.json';
      const legacy = JSON.stringify({
        version: 1,
        entries: ['src/services/storage/indexeddb/reads.ts::getMonth'],
      });
      const root = createRepository({
        'src/services/storage/indexeddb/reads.ts': READ_WITH_EMPTY_FALLBACK,
        [legacyPath]: legacy,
      });
      expect(runGuard(root, args)).toEqual({
        status: 1,
        output: expect.stringContaining(
          'src/services/storage/indexeddb/reads.ts::getMonth returns empty on failure'
        ),
      });
      const withoutLegacy = createRepository({
        'src/services/storage/indexeddb/reads.ts': READ_WITH_EMPTY_FALLBACK,
      });
      expect(runGuard(withoutLegacy, args).status).toBe(1);
      expect(existsSync(path.join(withoutLegacy, legacyPath))).toBe(false);
    }
  );

  it('rejects a subscription error emitted as an empty feed but accepts a genuine empty snapshot', () => {
    const subscribe = (failure: string) => `export const subscribe = () => {
  return onSnapshot(ref, snapshot => callback([]), error => { ${failure} });
};`;
    const bad = createRepository({
      'src/services/reminders/ReminderRepository.ts': subscribe('onError(error); callback([]);'),
    });
    expect(runGuard(bad)).toEqual({
      status: 1,
      output: expect.stringContaining(
        'new: src/services/reminders/ReminderRepository.ts::subscribe'
      ),
    });
    const good = createRepository({
      'src/services/reminders/ReminderRepository.ts': subscribe('onError(error);'),
    });
    expect(runGuard(good).status).toBe(0);
  });

  it('handles onSnapshot options without confusing a missing document with a read failure', () => {
    const root = createRepository({
      'src/services/reminders/ReminderRepository.ts': `export const subscribe = () => {
  return onSnapshot(ref, { includeMetadataChanges: true }, snap => callback(null, snap.metadata), error => onError(error));
};`,
    });
    expect(runGuard(root).status).toBe(0);
    const bad = createRepository({
      'src/services/reminders/ReminderRepository.ts': `export const subscribe = () => {
  return onSnapshot(ref, {}, snap => callback(snap), error => callback([]));
};`,
    });
    expect(runGuard(bad).status).toBe(1);
  });
  it.each([
    'onSnapshot(ref, {}, snap => callback([]))',
    'onSnapshot(ref, snap => callback([]), error => onError(error), () => callback([]))',
    'onSnapshot(ref, { next: snap => callback([]) })',
  ])('accepts successful empty feeds and completion callbacks: %s', call => {
    const root = createRepository({ 'src/services/reminders/feed.ts': call });
    expect(runGuard(root).status).toBe(0);
  });

  it.each([
    'onSnapshot(ref, snap => callback(snap), error => callback([]), () => done())',
    'onSnapshot(ref, {}, snap => callback(snap), error => callback([]), () => done())',
    'onSnapshot(ref, { next: snap => callback(snap), error: error => callback([]) })',
    'onSnapshot(ref, {}, { next: snap => callback(snap), error(error) { callback([]); } })',
  ])('rejects empty failure callbacks in supported overloads: %s', call => {
    const root = createRepository({ 'src/services/reminders/feed.ts': call });
    expect(runGuard(root).status).toBe(1);
  });
});
