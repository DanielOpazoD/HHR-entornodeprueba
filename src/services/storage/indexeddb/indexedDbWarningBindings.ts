import { recordIndexedDbRecoveryNotice } from './indexedDbRecoveryController';

type IndexedDbEventSource = {
  on: (event: 'blocked' | 'close', callback: () => void) => void;
};

export const attachIndexedDbWarningBindings = (
  database: IndexedDbEventSource,
  isUsingMock: () => boolean,
  emittedWarnings: Set<string>
): void => {
  database.on('blocked', () => {
    if (emittedWarnings.has('blocked')) return;
    emittedWarnings.add('blocked');
    recordIndexedDbRecoveryNotice(
      'indexeddb_blocked',
      'La base IndexedDB fue bloqueada por otra pestana.'
    );
  });

  database.on('close', () => {
    if (isUsingMock() || emittedWarnings.has('unexpected-close')) return;
    emittedWarnings.add('unexpected-close');
    recordIndexedDbRecoveryNotice(
      'indexeddb_unexpected_close',
      'La conexion de IndexedDB se cerro de forma inesperada.'
    );
  });
};
