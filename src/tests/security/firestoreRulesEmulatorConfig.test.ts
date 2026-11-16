// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resolveFirestoreRulesEmulatorConfig } from './firestoreRulesEmulatorConfig';

describe('firestore rules emulator config', () => {
  it('uses the default local emulator when FIRESTORE_EMULATOR_HOST is absent', () => {
    expect(resolveFirestoreRulesEmulatorConfig(undefined)).toEqual({
      host: '127.0.0.1',
      port: 8080,
    });
  });

  it('uses FIRESTORE_EMULATOR_HOST when the rules CI runs on a non-default port', () => {
    expect(resolveFirestoreRulesEmulatorConfig('127.0.0.1:18080')).toEqual({
      host: '127.0.0.1',
      port: 18080,
    });
  });

  it('falls back to the default local emulator when FIRESTORE_EMULATOR_HOST is malformed', () => {
    expect(resolveFirestoreRulesEmulatorConfig('not-a-host-port')).toEqual({
      host: '127.0.0.1',
      port: 8080,
    });
  });
});
