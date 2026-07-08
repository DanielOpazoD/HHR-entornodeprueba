const originalConsoleMethods = new Map<ConsoleMethod, Console[ConsoleMethod]>();

export type ConsoleMethod = 'log' | 'warn' | 'error' | 'info' | 'debug';

export const ALLOWED_OPERATIONAL_CONSOLE_NOISE_PATTERNS = [
  '[IndexedDB]',
  '[Migration]',
  '[Repository DEBUG]',
  '[Repository]',
  '[ErrorService]',
  '[ErrorServiceSinks] Captured error service log',
  '[networkUtils]',
  '[BaseStorage]',
  '[OptimisticUpdate]',
  '[useCensusEmail]',
  '[Autocomplete]',
  'DEBUG: copyPatientToDate called',
  'DEBUG: sourcePatient',
  'Validation Errors:',
  '[ExportService] CSV import is not fully implemented.',
  'Failed to fetch audit logs for date:',
  'Error loading table config:',
  'Error fetching nurse catalog from Firestore:',
  'Error listing backup files:',
  'Error checking backup existence:',
  'Error fetching backup file:',
  'Error fetching backup by date/shift:',
  'Error enviando correo de censo',
  'Error sending email with link',
  'Clipboard error',
  'Validation failed for admissionDate:',
  'Failed to create history snapshot:',
  '⚠️ DailyRecord validation failed:',
  '❌ Error saving to Firestore:',
  '[Firestore] Concurrency conflict.',
  '[SyncQueue]',
  '[useExcelParser] Error parsing excel:',
  'Failed to fetch audit logs from Firestore:',
  'Error generating documents:',
  'Error in forceAISearch:',
  'Invariant repair applied on save',
  'Invariant repair applied on updatePartial',
  '[FirestoreQueries] Firestore query failed: getRecord',
  '[DailyRecordWriteRepository] Firestore sync failed',
  '[DailyRecordWriteRepository] Firestore partial update failed',
  '[BootstrapRuntime] Firebase bootstrap failed',
  '[BootstrapRuntime] Bootstrap paused for recovery reload',
  '[BootstrapRuntime] Detected local browser storage corruption during bootstrap',
  '[DailyRecordReadRepository] Remote fetch failed',
  '[SingleFlightAsyncCommand] Single-flight async command failed',
  '[usePatientAutocomplete] Error fetching patient suggestion',
  '[RoleManagement] Legacy role claim sync warning',
  '[RoleManagement] Role claim sync warning',
  '[DailyRecordRepositorySyncService] Sync failed',
  '[FirestoreCatalogService] Error fetching nurse catalog from Firestore',
  '[FirestoreCatalogService] Error preparing TENS catalog subscription',
  '[NetworkUtils] Retrying failed network operation',
  '[TransferViewStates] Error generating transfer documents',
  '[useAuthState] Logout due to inactivity',
  '[LoginPage] Google sign-in failed',
  '[PrintTemplateRepository] Error fetching template',
  '[PrintTemplateRepository] Error subscribing to template',
  '[FirestoreWrites] Firestore write failed:',
  '[FirestoreWrites] Firestore write retry:',
  'GrpcConnection RPC',
  '[CensusAccessService] Error getting authorized emails',
  '[CensusAccessService] Error checking email authorization',
  '[JsonImport] JSON import failed',
  '[ClinicalDocumentPdfService] Print-style generation failed',
  '[PatientRowAsyncAction] Async patient row action failed silently',
] as const;

export const shouldFilterOperationalConsoleMessage = (args: unknown[]): boolean => {
  const message = args.map(arg => String(arg)).join(' ');
  return ALLOWED_OPERATIONAL_CONSOLE_NOISE_PATTERNS.some(pattern => message.includes(pattern));
};

const wrapConsoleMethodForOperationalNoise = (method: ConsoleMethod): void => {
  if (!originalConsoleMethods.has(method)) {
    // eslint-disable-next-line no-console
    originalConsoleMethods.set(method, console[method].bind(console));
  }

  const original = originalConsoleMethods.get(method);
  if (!original) return;

  // eslint-disable-next-line no-console
  console[method] = (...args: unknown[]) => {
    if (shouldFilterOperationalConsoleMessage(args)) return;
    original(...args);
  };
};

export const wrapConsoleForOperationalNoise = (methods: ConsoleMethod[]): void => {
  methods.forEach(wrapConsoleMethodForOperationalNoise);
};
