/**
 * Entry for the census clinical explorer: the official Eloísa hospitalization history of one
 * patient, read by the extension with the person's own session and handed back to this page as a
 * ZIP. The explorer joins it with the Syslab results and the MMRAD CT reports of the stay.
 *
 * Kept apart from `index.ts` on purpose: the explorer loads it on demand, only when a person asks
 * for that download, and needs the bridge alone, not the audit screen.
 */
export { requestAuditDocuments } from './services/auditDocumentsBridge';
export type {
  AuditDocumentsPatientSummary,
  AuditDocumentsPhase,
  AuditDocumentsProgress,
  AuditDocumentsResult,
  AuditDocumentsRun,
} from './services/auditDocumentsBridge';
