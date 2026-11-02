import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const declaredMemory = (script: string) =>
  JSON.parse(
    execFileSync(process.execPath, ['-e', script], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, GCLOUD_PROJECT: 'demo-hhr-function-memory' },
    })
  );

// At the default 256 MB, these took over 3 s in about 1 of 5 calls during real syncs (2026-11-01).
describe('functions someone waits for, declared with the real Firebase SDK', () => {
  it('gives the CUDYR archive and its reader the memory of the other save functions', () => {
    const memory = declaredMemory(`
      const { createCudyrHistoryFunctions } = require('./functions/lib/cudyrHistoryFunctions');
      const doc = { collection: () => ({ doc: () => doc }) };
      const made = createCudyrHistoryFunctions({
        firestore: { collection: () => ({ doc: () => doc }) },
      });
      console.log(JSON.stringify({
        archive: made.archiveCudyrHistory.__endpoint.availableMemoryMb,
        read: made.readCudyrHistory.__endpoint.availableMemoryMb,
      }));
    `);
    expect(memory).toEqual({ archive: 1024, read: 1024 });
  });

  it('gives the role check and the RUT sign-in the same memory, and only them', () => {
    const memory = declaredMemory(`
      const { createAccountFunctions } = require('./functions/lib/accounts/accountFunctions');
      const { createAuthFunctions } = require('./functions/lib/auth/authFunctionsFactory');
      const accounts = createAccountFunctions({});
      const auth = createAuthFunctions({ auth: {}, helpers: {} });
      console.log(JSON.stringify({
        role: auth.checkUserRole.__endpoint.availableMemoryMb,
        signIn: accounts.signInWithRut.__endpoint.availableMemoryMb,
        santiago: accounts.signInWithRutSantiago.__endpoint.availableMemoryMb,
        activate: accounts.activateNursingAccount.__endpoint.availableMemoryMb,
      }));
    `);
    expect(memory).toEqual({ role: 1024, signIn: 1024, santiago: 256, activate: 256 });
  });
});
