/**
 * Assets that never join the PWA precache: they need the network (Eloísa, Syslab, MMRAD, Firebase
 * administration) or are optional tools opened on demand. This is the only list. Vite reads the
 * globs for Workbox, the bundle-budget check and the tests read the derived patterns, so the two
 * can never drift apart again.
 *
 * Each entry says why it stays online-only. An entry may carry its own `pattern` when the glob
 * does not translate one to one into the dist path (globs match any directory; patterns match the
 * manifest URL).
 *
 * @typedef {{ glob: string, reason: string, pattern?: string }} OnlineOnlyAsset
 */

/** @type {readonly OnlineOnlyAsset[]} */
export const ONLINE_ONLY_ASSETS = Object.freeze([
  { glob: '**/images/moa/**', reason: 'Optional mascot artwork is cached on use by the existing image route.' },
  { glob: '**/avatars/**', reason: 'Optional profile icons are only opened on demand.' },
  { glob: '**/assets/MoaCompanion-*.js', reason: 'Opt-in decorative scenes; no clinical dependency lives in this chunk.' },
  { glob: '**/assets/MoaCompanion-*.css', reason: 'Same policy as the entry above.' },
  { glob: '**/downloads/**', reason: 'Same policy as the entry above.' },
  { glob: '**/docs/**', reason: 'Same policy as the entry above.' },
  { glob: '**/templates/**', reason: 'Same policy as the entry above.' },
  { glob: '**/images/forms/**', reason: 'Same policy as the entry above.' },
  { glob: '**/assets/MedifTool-*.js', reason: 'MEDIF is opened explicitly and needs the original PDF under docs/, already fetched on demand. Keep its editor under the same policy; the library\'s offline calculators and transfer cover stay cached.' },
  { glob: '**/assets/MedifTool-*.css', reason: 'Same policy as the entry above.' },
  { glob: '**/assets/ClinicalFormTool-*.js', reason: 'The additional PDF editors use the same explicit-load policy as MEDIF.' },
  { glob: '**/assets/ClinicalFormTool-*.css', reason: 'Same policy as the entry above.' },
  { glob: '**/assets/clinicalFormDocx-*.js', reason: 'Word export needs the form\'s template under docs/, already on demand.' },
  { glob: '**/vendor/exceljs.bare.min.js', reason: 'Same policy as the entry above.' },
  { glob: '**/assets/exceljs.min-*.js', reason: 'Same policy as the entry above.' },
  { glob: '**/assets/pdf.worker-*.mjs', reason: 'Same policy as the entry above.' },
  { glob: '**/assets/cudyrSupplement.worker-*.js', reason: 'Optional monthly XLS import; loaded only when a file is selected.' },
  { glob: '**/assets/vendor-pdfjs-*.js', reason: 'Same policy as the entry above.' },
  { glob: '**/assets/pdf-*.js', reason: 'Same policy as the entry above.' },
  { glob: '**/assets/vendor-pdf-*.js', reason: 'Same policy as the entry above.' },
  { glob: '**/assets/LineChart-*.js', reason: 'Same policy as the entry above.' },
  { glob: '**/assets/LabViewerAnalysis-*.js', reason: 'The Syslab analysis view shows reports just read from Syslab and statically needs the online-only LineChart chunk, so it never opened offline. Its lazy loader waits for the network.' },
  { glob: '**/assets/labExcelService-*.js', reason: 'Excel export of that analysis; loaded only from it, and its ExcelJS runtime is already online-only.' },
  { glob: '**/assets/vendor-excel-*.js', reason: 'Same policy as the entry above.' },
  { glob: '**/assets/vendor-canvas-*.js', reason: 'Same policy as the entry above.' },
  { glob: '**/assets/terminologyService-*.js', reason: 'Same policy as the entry above.' },
  { glob: '**/assets/DiagnosisCie10Cell-*.js', reason: 'CIE-10 cell: its catalogue is already outside precache, so caching the wrapper alone would not make the search work offline.' },
  { glob: '**/assets/fonasaDatabase-*.js', reason: 'Same policy as the entry above.' },
  { glob: '**/assets/clinicalDocumentTemplateEditorController-*.js', reason: 'Same policy as the entry above.' },
  { glob: '**/assets/vendor-heic2any-*.js', reason: 'Same policy as the entry above.' },
  { glob: '**/assets/specialistMedicalHandoffClient-*.js', reason: 'The specialist note callable and its queued replay need the network. They load through the shared Functions loader, which queues the note while offline.' },
  { glob: '**/assets/clinicalCarryoverVerification-*.js', reason: 'Carryover verification requires fresh remote clinical reports; load it with sync. The copied evidence and its creation seed remain available in offline precache.' },
  { glob: '**/assets/clinicalEnrichmentBatchExecutionSupport-*.js', reason: 'Shared callable-batch support is consumed only by the online sync chunks above. Cache it on demand with those owners; offline day creation does not import it.' },
  { glob: '**/assets/dailyRecordClinicalDerivedReadService-*.js', reason: 'Split-day reads (phase 1a, D10) load on demand and need the server or the SDK cache; a reader that cannot load keeps the day\'s embedded copy, as it shows today.' },
  { glob: '**/assets/clinicalDerivedEpisodeReader-*.js', reason: 'Same policy as the entry above.' },
  { glob: '**/assets/clinicalDerivedBackupRestore-*.js', reason: 'The backup restore of split days shares the contract and the episode schema with them. A restore that cannot load it reports those days partial, never clean.' },
  { glob: '**/assets/clinicalDerivedContract-*.js', reason: 'Same policy as the entry above.' },
  { glob: '**/assets/clinicalDerived-*.js', reason: 'Same policy as the entry above.' },
  { glob: '**/assets/NursingAccountsPanel-*.js', reason: 'Account administration, activation and password changes require Firebase online.' },
  { glob: '**/assets/RoleManagementPanel-*.js', reason: 'Same policy as the entry above.' },
  { glob: '**/assets/InvalidClinicalEpisodesPanel-*.js', reason: 'The admin review of «paciente no válido» marks reads and removes them on the server only.' },
  { glob: '**/assets/NursingPasswordDialog-*.js', reason: 'Same policy as the entry above.' },
  { glob: '**/assets/NursingAccessForm-*.js', reason: 'Same policy as the entry above.' },
  { glob: '**/assets/CudyrReportExplorer-*.js', reason: 'Contextual CUDYR reports read server-authoritative history and cannot load offline. Keep the new explorer and workbook on demand as well.' },
  { glob: '**/assets/CudyrMonthlyIndicator-*.js', reason: 'Optional census indicator uses the same on-demand historical reader.' },
  { glob: '**/assets/useCudyrReport-*.js', reason: 'Same policy as the entry above.' },
  { glob: '**/assets/cudyrReportWorkbook-*.js', reason: 'Same policy as the entry above.' },
  { glob: '**/assets/cudyrEssentialWorkbook-*.js', reason: 'The simplified Excel uses the same on-demand ExcelJS runtime.' },
  { glob: '**/assets/cudyrSourceWorkbook-*.js', reason: 'Same policy as the entry above.' },
  { glob: '**/assets/cudyrReportLoader-*.js', reason: 'Same policy as the entry above.' },
  { glob: '**/assets/cudyrReportModel-*.js', reason: 'Shared historical reconstruction split from the report loader; same on-demand policy.' },
  { glob: '**/assets/cudyrReportFacts-*.js', reason: 'Shared report facts and recovery require a verified Firebase/Eloisa read.' },
  { glob: '**/assets/publicCudyrPolicyRecovery-*.js', reason: 'Same policy as the entry above.' },
  { glob: '**/assets/applyClinicalEnrichmentBatch-*.js', reason: 'Rayen enrichment only runs while Eloisa is connected, so it is an on-demand online workflow rather than PWA install payload.' },
  { glob: '**/assets/applyHistoricalCudyr-*.js', reason: 'Same policy as the entry above.' },
  { glob: '**/assets/clinicalFillRunner-*.js', reason: 'Same policy as the entry above.' },
  { glob: '**/assets/clinicalEnrichmentBatchPayload-*.js', reason: 'Same policy as the entry above.' },
  { glob: '**/assets/clinicalEnrichmentPersistenceStrategy-*.js', reason: 'Same policy as the entry above.' },
  { glob: '**/assets/replanRayenStructure-*.js', reason: 'Same policy as the entry above.' },
  { glob: '**/assets/RayenImportButton-*.js', reason: 'The Rayen import workflow requires a live Eloisa session, so it is an online-only surface rather than PWA install payload.' },
  { glob: '**/assets/RayenSyncQueueDetails-*.js', reason: 'Optional send review and backup tools belong to that same on-demand panel. They never participate in clinical capture, persistence or queue processing.' },
  { glob: '**/assets/DailyRecordTaskRecovery-*.js', reason: 'Same policy as the entry above.' },
  { glob: '**/assets/PatientDocumentManagerDialog-*.js', reason: 'The patient repository requires a live Eloisa/extension session and is opened explicitly from the clinical drawer, so it remains an online-only lazy surface.' },
  { glob: '**/assets/PatientHospitalizationReportsDialog-*.js', reason: 'Official hospitalization reports need a live Eloisa session. Their deferred dialog already contains chunk failures without replacing the editable census.' },
  { glob: '**/assets/audit-documents-*.js', reason: 'Audit downloads of official Eloísa reports work only with Eloísa and the extension.' },
  { glob: '**/assets/ClinicalPanelDrawer-*.js', reason: 'Same policy as the entry above.' },
  { glob: '**/assets/ClinicalExplorerView-*.js', reason: 'The clinical explorer reads Eloísa, Syslab and MMRAD; it is a consultation mode opened on demand, never part of the offline census. The Ficha Médico reader it shares with the drawer only works while Eloísa is connected.' },
  { glob: '**/assets/useClinicalPanelSnapshot-*.js', reason: 'Same policy as the entry above.' },
  { glob: '**/assets/RayenSyncHistoryModal-*.js', reason: 'Sync history panel: reviewed on demand while Eloísa is connected.' },
  { glob: '**/assets/sendCensusEmailUseCases-*.js', reason: 'Census email delivery always needs the network; local exports stay cached.' },
  { glob: '**/assets/perfAuditReport-*.js', reason: 'Optional console-only formatter. Core timing capture remains offline-capable.' },
  { glob: '**/assets/SystemHealthReporterBridge-*.js', reason: 'Same policy as the entry above.' },
  { glob: '**/assets/healthService-*.js', reason: 'Same policy as the entry above.' },
  { glob: '**/assets/vendor-dicom-*.js', reason: 'DICOM is online-only and must not download during PWA installation or census startup.' },
  { glob: '**/assets/RadiologyViewerModal-*.js', reason: 'Same policy as the entry above.' },
  { glob: '**/assets/radiologyExamListMemory-*.js', reason: 'MMRAD list memory shared by the imaging modal, the DICOM viewer and the explorer.' },
  { glob: '**/assets/radiologyViewerContentController-*.js', reason: 'Radiology controller and the shared MMRAD study search; every importer (imaging modal, DICOM viewer, explorer) is online-only.' },
  { glob: '**/assets/Dicom*-*', reason: 'Same policy as the entry above.' },
  { glob: '**/assets/dicom*-*.js', reason: 'Same policy as the entry above.' },
  { glob: '**/assets/decodeImageFrameWorker-*.js', reason: 'Same policy as the entry above.' },
  { glob: '**/assets/computeWorker-*.js', reason: 'Same policy as the entry above.' },
  { glob: '**/assets/jpeg-*.js', reason: 'Same policy as the entry above.' },
  { glob: '**/*.wasm', reason: 'Same policy as the entry above.', pattern: '^assets/.*\\.wasm$' },
]);

/** Workbox glob form, for `globIgnores`. */
export const ONLINE_ONLY_ASSET_GLOBS = Object.freeze(ONLINE_ONLY_ASSETS.map(asset => asset.glob));

/** `**\/assets/X-*.js` becomes `^assets/X-.*\.js$`; a directory glob becomes its prefix. */
export const globToPrecachePattern = glob => {
  const relative = glob.replace(/^\*\*\//, '');
  if (relative.endsWith('/**')) return `^${relative.slice(0, -3)}/`;
  const body = relative.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return `^${body}$`;
};

/** Regular-expression source strings over manifest URLs, for the budget check and the tests. */
export const ONLINE_ONLY_PRECACHE_PATTERNS = Object.freeze(
  ONLINE_ONLY_ASSETS.map(asset => asset.pattern ?? globToPrecachePattern(asset.glob))
);
