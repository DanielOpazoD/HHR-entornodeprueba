import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const EXPECTED_NOISY_CONSOLE_PATTERNS = [
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

const extractAllowedPatterns = (setup: string) => {
  const match = setup.match(
    /export const ALLOWED_OPERATIONAL_CONSOLE_NOISE_PATTERNS = \[(?<body>[\s\S]*?)\] as const;/
  );
  if (!match?.groups?.body) return [];

  return [...match.groups.body.matchAll(/^\s*'(?<pattern>[^']+)',\s*$/gm)].map(
    ({ groups }) => groups?.pattern ?? ''
  );
};

const readProjectFile = (relativePath: string) =>
  fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

describe('test setup console noise filter', () => {
  it('keeps the expected operational-noise filters explicit and reviewed', () => {
    const sharedFilter = readProjectFile('src/tests/utils/operationalConsoleNoiseFilter.ts');
    const allowedPatterns = extractAllowedPatterns(sharedFilter);

    expect(allowedPatterns).toEqual(EXPECTED_NOISY_CONSOLE_PATTERNS);

    expect(sharedFilter).not.toContain("'Firestore query failed'");
    expect(sharedFilter).not.toContain("'Firebase bootstrap failed'");
    expect(sharedFilter).not.toContain("'Network error'");
    expect(sharedFilter).not.toContain("'Error'");
  });

  it('shares the operational-noise filter with unit and emulator UI setup', () => {
    const unitSetup = readProjectFile('src/tests/setup.ts');
    const emulatorConfig = readProjectFile('vitest.emulator.config.ts');
    const emulatorSetup = readProjectFile('src/tests/emulator/setup.ts');
    const emulatorUiSetup = readProjectFile('src/tests/emulator-ui/setup.ts');
    const sharedFilter = readProjectFile('src/tests/utils/operationalConsoleNoiseFilter.ts');

    expect(sharedFilter).toContain('export const ALLOWED_OPERATIONAL_CONSOLE_NOISE_PATTERNS');
    expect(sharedFilter).toContain('export const shouldFilterOperationalConsoleMessage');
    expect(sharedFilter).toContain('export const wrapConsoleForOperationalNoise');
    expect(unitSetup).toContain(
      "wrapConsoleForOperationalNoise(['log', 'warn', 'error', 'info', 'debug'])"
    );
    expect(emulatorConfig).toContain("setupFiles: ['./src/tests/emulator/setup.ts']");
    expect(emulatorSetup).toContain("wrapConsoleForOperationalNoise(['warn', 'error'])");
    expect(emulatorUiSetup).toContain("wrapConsoleForOperationalNoise(['warn', 'error'])");
  });
});
