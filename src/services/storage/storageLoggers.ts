import { createScopedLoggerMap } from '@/services/utils/loggerScope';

export const {
  tableConfigLogger,
  firestoreQueryLogger,
  firestoreWriteLogger,
  firestoreCatalogLogger,
} = createScopedLoggerMap({
  tableConfigLogger: 'TableConfigService',
  firestoreQueryLogger: 'FirestoreQueries',
  firestoreWriteLogger: 'FirestoreWrites',
  firestoreCatalogLogger: 'FirestoreCatalogService',
});
