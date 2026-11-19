// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const RULE = 'session/raw-read';
const LEDGER: { owners: Record<string, string>; pending: Record<string, string> } = JSON.parse(
  readFileSync('scripts/config/session-raw-read-ledger.json', 'utf8')
);
// The ledger only goes down. This is its exact size: migrating a file means removing its row
// (ESLint asks for it) and lowering this number in the same change, so a new row always fails.
const LEDGER_SIZE = 13;

const eslint = new ESLint({ cwd: process.cwd() });
const messages = async (code: string, filePath: string) =>
  (await eslint.lintText(code, { filePath }))[0].messages.filter(
    message => message.ruleId === RULE
  );

const RAW_IMPORT = (name: string) =>
  `import { ${name} } from '@/services/storage/sessionStorageTransition';\nexport const read = ${name};`;

describe('a session decision goes through the session gate', () => {
  it.each(['getStoredSessionOwnerKey', 'getSessionGeneration', 'getSessionEpoch'])(
    'rejects importing %s outside the gate and names the fix',
    async name => {
      const [message] = await messages(RAW_IMPORT(name), 'src/features/cudyr/newProbe.ts');
      expect(message?.message).toContain(`No compares la sesión a mano con ${name}()`);
      expect(message?.message).toContain('guardAuthoringSession()');
      expect(message?.message).toContain('sessionEpochGuard()');
    }
  );

  it('catches a renamed import and accepts the gate itself', async () => {
    expect(
      await messages(
        "import { getSessionGeneration as generation } from '@/services/storage/sessionStorageTransition';\nexport const g = generation;",
        'src/services/staff/newProbe.ts'
      )
    ).toHaveLength(1);
    expect(
      await messages(
        "import { guardAuthoringSession } from '@/services/storage/authoringSession';\nexport const g = guardAuthoringSession;",
        'src/services/staff/newProbe.ts'
      )
    ).toEqual([]);
  });

  it.each([
    [
      'a namespace import',
      "import * as session from '@/services/storage/sessionStorageTransition';\nexport const e = () => session.getSessionEpoch();",
    ],
    [
      'a namespace import read by a computed name',
      "import * as owner from '@/services/storage/sessionOwnerKey';\nexport const o = () => owner['getStoredSessionOwnerKey']();",
    ],
    [
      'an awaited import()',
      "export const g = async () => (await import('@/services/storage/sessionStorageTransition')).getSessionGeneration();",
    ],
    [
      'an import() kept in a variable',
      "export const g = async () => { const session = await import('@/services/storage/sessionStorageTransition'); return session.getSessionGeneration(); };",
    ],
    [
      'an import() destructured',
      "export const e = async () => { const { getSessionEpoch } = await import('@/services/storage/sessionStorageTransition'); return getSessionEpoch(); };",
    ],
    [
      'an import() read in then()',
      "export const e = () => import('@/services/storage/sessionStorageTransition').then(session => session.getSessionEpoch());",
    ],
    [
      'a re-export',
      "export { getSessionEpoch } from '@/services/storage/sessionStorageTransition';",
    ],
  ])('rejects the same read through %s', async (_way, code) => {
    const found = await messages(code, 'src/features/rayen-import/newProbe.ts');
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain('guardAuthoringSession()');
  });

  it('does not count a port that only shares the name, like the queue’s injected runtime', async () => {
    expect(
      await messages(
        'export const g = (runtime: { getSessionGeneration?: () => string | null }) => runtime.getSessionGeneration?.();',
        'src/services/storage/sync/newProbe.ts'
      )
    ).toEqual([]);
  });

  it('lets the owners read the session', async () => {
    for (const file of [
      'src/services/storage/authoringSession.ts',
      'src/services/auth/authSession.ts',
    ]) {
      expect(await messages(RAW_IMPORT('getSessionGeneration'), file), file).toEqual([]);
    }
  });

  it('keeps a pending file allowed until it migrates, then asks to remove its row', async () => {
    const file = Object.keys(LEDGER.pending)[0];
    expect(await messages(RAW_IMPORT('getSessionEpoch'), file)).toEqual([]);
    const [stale] = await messages('export const migrated = true;', file);
    expect(stale?.message).toContain('quita su fila de «pending»');
  });

  it('applies to production source only', async () => {
    expect(await messages(RAW_IMPORT('getSessionGeneration'), 'src/tests/probe.test.ts')).toEqual(
      []
    );
  });

  it('lists only existing files, and the ledger keeps its exact size', () => {
    for (const file of [...Object.keys(LEDGER.owners), ...Object.keys(LEDGER.pending)]) {
      expect(existsSync(file), file).toBe(true);
      expect(isOwner(file), file).toBe(Object.hasOwn(LEDGER.owners, file));
    }
    expect(
      Object.keys(LEDGER.pending),
      'El libro solo baja: al migrar un archivo, quita su fila y baja LEDGER_SIZE; no se agregan filas.'
    ).toHaveLength(LEDGER_SIZE);
  });
});

const isOwner = (file: string) =>
  Object.keys(LEDGER.owners).some(owner =>
    owner.endsWith('/') ? file.startsWith(owner) : file === owner
  );
