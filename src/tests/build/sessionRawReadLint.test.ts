// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const RULE = 'session/raw-read';
const LEDGER: { owners: Record<string, string>; pending: Record<string, string> } = JSON.parse(
  readFileSync('scripts/config/session-raw-read-ledger.json', 'utf8')
);
// The ledger only goes down: S2 lowers this number as it migrates the remaining files.
const LEDGER_CEILING = 30;

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

  it('lists only existing files, and the ledger does not grow', () => {
    for (const file of [...Object.keys(LEDGER.owners), ...Object.keys(LEDGER.pending)]) {
      expect(existsSync(file), file).toBe(true);
      expect(isOwner(file), file).toBe(Object.hasOwn(LEDGER.owners, file));
    }
    expect(Object.keys(LEDGER.pending).length).toBeLessThanOrEqual(LEDGER_CEILING);
  });
});

const isOwner = (file: string) =>
  Object.keys(LEDGER.owners).some(owner =>
    owner.endsWith('/') ? file.startsWith(owner) : file === owner
  );
