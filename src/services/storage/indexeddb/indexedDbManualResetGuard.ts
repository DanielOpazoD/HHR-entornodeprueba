import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntimeCore';

/** Read the durable database directly: the app's memory fallback cannot prove it is empty. */
const hasLocalWorkOrUnreadableDatabase = (): Promise<boolean> =>
  new Promise(resolve => {
    let settled = false;
    let database: IDBDatabase | undefined;
    const finish = (needsConfirmation: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      database?.close();
      resolve(needsConfirmation);
    };
    const timeout = window.setTimeout(() => finish(true), 1500);
    try {
      const request = window.indexedDB.open('HangaRoaDB');
      request.onupgradeneeded = () => {
        // An absent database has no pending work. Do not create it just to inspect it.
        request.transaction?.abort();
        finish(false);
      };
      request.onerror = () => finish(true);
      request.onblocked = () => finish(true);
      request.onsuccess = () => {
        database = request.result;
        if (settled) {
          database.close();
          return;
        }
        const stores = ['syncQueue', 'dailyRecords'].filter(name =>
          database?.objectStoreNames.contains(name)
        );
        if (stores.length !== 2) {
          finish(true);
          return;
        }
        try {
          const transaction = database.transaction(stores, 'readonly');
          let hasWork = false;
          for (const name of stores) {
            const count = transaction.objectStore(name).count();
            count.onsuccess = () => {
              hasWork ||= count.result > 0;
            };
          }
          // Local records have no durable remote-confirmation marker; a nonempty store is uncertain.
          // Retired queue rows also hold recoverable backups, so they must not be silently removed.
          transaction.oncomplete = () => finish(hasWork);
          transaction.onerror = () => finish(true);
          transaction.onabort = () => finish(true);
        } catch {
          finish(true);
        }
      };
    } catch {
      finish(true);
    }
  });

export const confirmManualDatabaseReset = async (): Promise<boolean> => {
  if (!(await hasLocalWorkOrUnreadableDatabase())) return true;
  return defaultBrowserWindowRuntime.confirm(
    'No se puede asegurar que todos los cambios de este computador hayan llegado al servidor. ' +
      'Si reinicias el guardado local, se perderán los cambios de la base local que este computador aún no envió, ' +
      'incluidos los respaldos guardados en ella. Los parches y envíos pendientes guardados fuera de esa base se conservarán. ' +
      '¿Quieres reiniciar y perder esos cambios?'
  );
};
