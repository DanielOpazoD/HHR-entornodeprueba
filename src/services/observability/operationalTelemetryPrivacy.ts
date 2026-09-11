/**
 * Shared privacy sanitizer for operational telemetry.
 *
 * Operational telemetry describes the system, never a patient. This module is the single place that
 * decides what may leave the device: the external adapter runs it BEFORE dispatching a beacon and
 * the ingest policy runs it AGAIN after schema validation, so a hand-crafted POST to the public
 * endpoint is held to exactly the same rules as the app itself. The rule is allowlist-only:
 *  - `operation` must be a known literal; anything else collapses to `other_operation`. The event
 *    is never rejected for an unknown name, so a failed signal is preserved rather than lost.
 *  - `issues` become stable codes. Raw `Error.message` is discarded, never clipped and forwarded.
 *  - `context` keeps a finite list of bounded numeric keys plus a few closed string/boolean enums.
 *  - identifiers (`runId`, `userId`, `documentId`, `bedId`, …) and every unknown key are dropped
 *    and only counted, never echoed back.
 *
 * The allowlists are the current hot set of real producers (grepped from the app), not an exhaustive
 * catalog. A new or rare operation degrades to the generic mapping instead of leaking.
 * Browser-safe by construction: no `Buffer`, no `crypto`, no Node built-ins, no dependencies.
 */

/** Allowlists are written as whitespace separated literals to stay readable and compact. */
const tokens = (raw: string): string[] => raw.split(/\s+/).filter(Boolean);

export const OPERATIONAL_TELEMETRY_CATEGORIES = [
  'auth',
  'daily_record',
  'firestore',
  'sync',
  'indexeddb',
  'integration',
  'export',
  'backup',
  'reminders',
  'transfers',
  'clinical_document',
  'create_day',
  'handoff',
  'prescription',
] as const;
export type OperationalTelemetryPrivacyCategory = (typeof OPERATIONAL_TELEMETRY_CATEGORIES)[number];

export const OPERATIONAL_TELEMETRY_STATUSES = ['success', 'partial', 'degraded', 'failed'] as const;
export type OperationalTelemetryPrivacyStatus = (typeof OPERATIONAL_TELEMETRY_STATUSES)[number];

const RUNTIME_STATES = tokens('retryable recoverable degraded blocked unauthorized');

/** Deliberate end-to-end check of the alert channel. Never an incident. */
export const OPERATIONAL_TELEMETRY_PROBE_OPERATION = 'telemetry_delivery_probe';
/** Every operation outside the allowlist reports under this name. */
export const OPERATIONAL_TELEMETRY_FALLBACK_OPERATION = 'other_operation';
export const OPERATIONAL_TELEMETRY_UNCLASSIFIED_ISSUE = 'unclassified_issue';
/** Dropped keys are counted with an opaque token; a rejected key name is untrusted input itself. */
export const OPERATIONAL_TELEMETRY_DROPPED_KEY_TOKEN = 'dropped';
export const OPERATIONAL_TELEMETRY_MAX_CONTEXT_KEYS = 20;
export const OPERATIONAL_TELEMETRY_MAX_ISSUES = 10;

export const OPERATIONAL_TELEMETRY_ISSUE_CODES = [
  'timeout_issue',
  'auth_issue',
  'unavailable_issue',
  'schema_issue',
  'persistence_issue',
  OPERATIONAL_TELEMETRY_UNCLASSIFIED_ISSUE,
] as const;
export type OperationalTelemetryIssueCode = (typeof OPERATIONAL_TELEMETRY_ISSUE_CODES)[number];

const ALLOWED_OPERATIONS = new Set([
  ...tokens(`
    save save_many delete list clear search summary outbox download
    initialize_daily_record delete_daily_record safe_parse_daily_record refresh_daily_record
    recover_today_empty_daily_record post_deploy_recent_record_refresh daily_record_bed_patch_failed
    daily_record_clinical_authority daily_record_clinical_consistency
    daily_record_remote_canonical_reconciled daily_record_clinical_patch_blocked_until_fresh
    daily_record_resume_refresh_started daily_record_resume_refresh_completed
    daily_record_resume_refresh_failed daily_record_resume_refresh_remote_newer
    daily_record_clinical_inputs_block_started daily_record_clinical_inputs_block_completed
    daily_record_clinical_inputs_block_failed daily_record_clinical_inputs_block_duration
    confirmed_null_realtime_record recovered_null_realtime_record reconcile_null_realtime_record
    firestore_read firestore_write sync_queue_ack_failure sync_queue_backpressure_rejected
    sync_queue_budget_threshold sync_queue_clear_all_failure sync_queue_enqueue_failure
    sync_queue_owner_clear_failure sync_queue_process_failure sync_queue_quarantine_retry
    sync_queue_stale_claim_noop sync_queue_task_conflict sync_queue_task_failure
    sync_queue_transactional_enqueue_failure sync_queue_truth_selected bootstrap_timeout
    app_shell_ready chunk_load_recovery center_subscription_ready error_service_log
    session_state_change session_owner_changed session_owner_changed_cleanup
    session_owner_cleared_cleanup session_cleanup_failed session_permission_storm_logout
    indexeddb_recovery indexeddb_fallback_mode create_clinical_document delete_clinical_document
    duplicate_clinical_document autosave_clinical_document autosave_clinical_document_rejected
    export_clinical_document_pdf export_clinical_document_json import_clinical_document_json
    import_clinical_document_ai open_clinical_document_print_preview clinical_document_import
    list_clinical_document_templates seed_clinical_document_templates
    clinical_document_repository_invalid_read_record clinical_document_template_repository_list_all
    clinical_document_template_repository_list_active
    clinical_document_template_repository_invalid_template clinical_episode_id_coverage
    clinical_episode_key_fallback clinical_attachment_name_suggestion rayen_sync_run read_patient
    read_encounter search_exams cie10_search cie10_database_sync_before_load portal_receipt_proxy
    pdf_proxy redirect_resolution_failure redirect_empty_result_without_tab_hint send_census_email
    send_medical_handoff send_fuga_notification delete_medical_handoff_entry
    refresh_medical_entry_as_current specialty_note_update confirm_no_changes
    copy_day_locked_by_schedule contador_local_acumulado census_empty_state_visible
    import_json_backup image_upload image_delete pdf_exists_timeout census_exists_timeout
    cudyr_exists_timeout list_storage_files_timeout list_storage_file_unparsed create_reminder
    update_reminder remove_reminder subscribe_reminders list_reminders list_reminder_receipts
    mark_reminder_read check_reminder_read prescription
    prescription_repository_invalid_read_record photo_repository_invalid_read_record
    consent_repository_invalid_read_record
  `),
  // Controlled diagnostics, plus the generic bucket itself so sanitizing stays idempotent.
  OPERATIONAL_TELEMETRY_PROBE_OPERATION,
  OPERATIONAL_TELEMETRY_FALLBACK_OPERATION,
]);
/** Ordered: the first match wins, so a timeout inside a write is reported as a timeout. */
const ISSUE_PATTERNS: ReadonlyArray<readonly [RegExp, OperationalTelemetryIssueCode]> = [
  [/timeout|timed?[ _-]?out|deadline|abort|super[oó] los|tiempo de espera/i, 'timeout_issue'],
  [/auth|unauthori|permission|forbidden|denied|token|credential|sesi[oó]n/i, 'auth_issue'],
  [/unavailable|offline|network|connect|conexi|no disponible|50[234]/i, 'unavailable_issue'],
  [/schema|zod|validat|validac|invalid|malformed|parse|json|mismatch/i, 'schema_issue'],
  [/persist|storage|quota|indexeddb|guarda|commit|write|disk/i, 'persistence_issue'],
];

const KNOWN_ISSUE_CODES = new Set<string>(OPERATIONAL_TELEMETRY_ISSUE_CODES);

/** Bounded operational magnitudes. Counts and sizes are non-negative; durations may be negative. */
const COUNT_KEYS = tokens(`
  count patientCount issueCount recordCount eventCount documentCount clinicalDocumentCount
  clinicalFieldCount pendingTasks maxPendingTasks retryCount attempt attempts maxAttempts batchSize
  pageCount rowCount totalCount failedCount blockedCount occupiedCount unchangedCount selectedCount
  eligibleCount correctionCount limitCount categorizedCount localErrorCount droppedCount
`);
const DURATION_KEYS = tokens(`
  durationMs elapsedMs timeoutMs remainingMs ttlMs ageMs pendingAgeMs oldestPendingAgeMs debounceMs
  driftSeconds remainingSeconds
`);
const SIZE_KEYS = tokens(`
  sizeBytes byteSize uploadBytes maxBytes queryLength sourceTextLength maxLength
`);
const [MAX_COUNT, MAX_DURATION_MS, MAX_SIZE] = [1_000_000, 86_400_000, 1_073_741_824];

const NUMERIC_BOUNDS = new Map<string, { min: number; max: number }>([
  ...COUNT_KEYS.map(key => [key, { min: 0, max: MAX_COUNT }] as const),
  ...DURATION_KEYS.map(key => [key, { min: -MAX_DURATION_MS, max: MAX_DURATION_MS }] as const),
  ...SIZE_KEYS.map(key => [key, { min: 0, max: MAX_SIZE }] as const),
]);

/** Booleans carry a single bit, but the key still has to be a known operational flag. */
const BOOLEAN_KEYS = new Set(
  tokens('isOnline offline allowed authBootstrapPending fallbackUsed truncated retried')
);

/**
 * String context values must come from a closed enum owned by a real producer. Anything else is
 * dropped: a snake_case shape check would still happily forward `paciente_juan_perez`.
 */
const STRING_ENUMS = new Map<string, ReadonlySet<string>>(
  Object.entries({
    runtimeState: RUNTIME_STATES.join(' '),
    status: OPERATIONAL_TELEMETRY_STATUSES.join(' '),
    stage: `ai_transform client_recovery done error extract_text firebase_ready persisting_structure
      save_draft unexpected uploading validating`,
    reason: `offline ready manual manual_override autosave ai_import no_effect no_records
      missing_record missing_remote_record missing_base_version record_load_failed invalid_format
      invalid_json invalid_shape auth_connecting auth_loading auth_unavailable backend_schema_drift
      backend_too_old compatible client_too_old_for_backend base_version_mismatch remote_blocked
      episode_closed clinical_day_changed historical_archive_failed default_local_priority
      default_remote_priority metadata_remote_priority admin_remote_priority`,
  }).map(([key, values]) => [key, new Set(tokens(values))])
);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Stable code for an issue. Already classified codes pass through unchanged (idempotent). */
export const classifyOperationalTelemetryIssue = (raw: unknown): OperationalTelemetryIssueCode => {
  const text = asString(raw);
  if (KNOWN_ISSUE_CODES.has(text)) return text as OperationalTelemetryIssueCode;
  for (const [pattern, code] of ISSUE_PATTERNS) {
    if (pattern.test(text)) return code;
  }
  return OPERATIONAL_TELEMETRY_UNCLASSIFIED_ISSUE;
};

export const normalizeOperationalTelemetryOperation = (raw: unknown): string => {
  const value = asString(raw).trim();
  return ALLOWED_OPERATIONS.has(value) ? value : OPERATIONAL_TELEMETRY_FALLBACK_OPERATION;
};

export type OperationalTelemetryContextValue = string | number | boolean | null;

/** Allowlist-only context. Returns the kept entries plus how many keys were refused. */
export const sanitizeOperationalTelemetryContextValues = (
  context: unknown
): { context: Record<string, OperationalTelemetryContextValue>; droppedCount: number } => {
  const out: Record<string, OperationalTelemetryContextValue> = {};
  let droppedCount = 0;
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    return { context: out, droppedCount };
  }
  for (const [key, raw] of Object.entries(context as Record<string, unknown>)) {
    if (Object.keys(out).length >= OPERATIONAL_TELEMETRY_MAX_CONTEXT_KEYS) {
      droppedCount += 1;
      continue;
    }
    const bounds = NUMERIC_BOUNDS.get(key);
    if (bounds && typeof raw === 'number' && Number.isFinite(raw)) {
      out[key] = Math.min(bounds.max, Math.max(bounds.min, Math.round(raw * 1000) / 1000));
      continue;
    }
    if (BOOLEAN_KEYS.has(key) && typeof raw === 'boolean') {
      out[key] = raw;
      continue;
    }
    const allowedValues = STRING_ENUMS.get(key);
    if (allowedValues && typeof raw === 'string' && allowedValues.has(raw)) {
      out[key] = raw;
      continue;
    }
    droppedCount += 1;
  }
  return { context: out, droppedCount };
};

export interface OperationalTelemetryPrivacyInput {
  category?: unknown;
  status?: unknown;
  operation?: unknown;
  timestamp?: unknown;
  date?: unknown;
  runtimeState?: unknown;
  issues?: unknown;
  context?: unknown;
  /** Carried over so re-sanitizing an already sanitized payload keeps the same drop count. */
  droppedContextKeys?: unknown;
}

export interface SanitizedOperationalTelemetryPayload {
  category: OperationalTelemetryPrivacyCategory;
  status: OperationalTelemetryPrivacyStatus;
  operation: string;
  timestamp: string;
  date?: string;
  runtimeState?: string;
  issues: OperationalTelemetryIssueCode[];
  context: Record<string, OperationalTelemetryContextValue>;
  droppedContextKeys: string[];
}

const CATEGORY_VALUES = new Set<string>(OPERATIONAL_TELEMETRY_CATEGORIES);
const STATUS_VALUES = new Set<string>(OPERATIONAL_TELEMETRY_STATUSES);
const RUNTIME_STATE_VALUES = new Set(RUNTIME_STATES);

/** Normalized to ISO so a timestamp cannot smuggle free text; unparsable input becomes ''. */
const normalizeTimestamp = (raw: unknown): string => {
  const value = asString(raw);
  if (!value) return '';
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? '' : new Date(parsed).toISOString();
};

const countCarriedDrops = (raw: unknown): number =>
  Array.isArray(raw)
    ? raw.filter(entry => entry === OPERATIONAL_TELEMETRY_DROPPED_KEY_TOKEN).length
    : 0;

/**
 * Single gate for everything that leaves the device. Idempotent: sanitizing an already sanitized
 * payload returns an identical payload, which is what lets the adapter and the ingest both run it.
 */
export const sanitizeOperationalTelemetryEvent = (
  input: OperationalTelemetryPrivacyInput
): SanitizedOperationalTelemetryPayload => {
  const category = asString(input.category);
  const status = asString(input.status);
  const date = asString(input.date);
  const runtimeState = asString(input.runtimeState);
  const { context, droppedCount } = sanitizeOperationalTelemetryContextValues(input.context);
  const drops = Math.min(
    droppedCount + countCarriedDrops(input.droppedContextKeys),
    OPERATIONAL_TELEMETRY_MAX_CONTEXT_KEYS
  );
  return {
    // An out-of-union category or status cannot be a trustworthy report, so it degrades instead of
    // being echoed back: `integration` is the generic bucket and `degraded` never pages anyone.
    category: (CATEGORY_VALUES.has(category)
      ? category
      : 'integration') as OperationalTelemetryPrivacyCategory,
    status: (STATUS_VALUES.has(status) ? status : 'degraded') as OperationalTelemetryPrivacyStatus,
    operation: normalizeOperationalTelemetryOperation(input.operation),
    timestamp: normalizeTimestamp(input.timestamp),
    date: ISO_DATE.test(date) ? date : undefined,
    runtimeState: RUNTIME_STATE_VALUES.has(runtimeState) ? runtimeState : undefined,
    issues: (Array.isArray(input.issues) ? input.issues : [])
      .slice(0, OPERATIONAL_TELEMETRY_MAX_ISSUES)
      .map(classifyOperationalTelemetryIssue),
    context,
    droppedContextKeys: Array.from(
      { length: drops },
      () => OPERATIONAL_TELEMETRY_DROPPED_KEY_TOKEN
    ),
  };
};
