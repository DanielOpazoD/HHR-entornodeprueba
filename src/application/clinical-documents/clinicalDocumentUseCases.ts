import type {
  ClinicalDocumentAuditActor,
  ClinicalDocumentRecord,
} from '@/features/clinical-documents/internal';
import {
  buildClinicalDocumentVersionSectionSnapshots,
  resolveClinicalDocumentVersionChangedSectionIds,
} from '@/domain/clinical-documents/versionHistory';
import {
  createApplicationFailed,
  createApplicationSuccess,
} from '@/shared/contracts/applicationOutcomeFactories';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';

import {
  defaultClinicalDocumentPort,
  type ClinicalDocumentPort,
} from '@/application/ports/clinicalDocumentPort';
import {
  loadExecuteWriteAuditEvent,
  type WriteAuditEvent,
} from '@/application/audit/writeAuditEventUseCaseLoader';

type PersistReason = 'autosave' | 'manual' | 'admin_fix';

interface ClinicalDocumentUseCaseDependencies {
  clinicalDocumentPort?: ClinicalDocumentPort;
  writeAuditEvent?: WriteAuditEvent;
}

/** Audit context for a fail-closed clinical-document deletion. */
export interface DeleteClinicalDocumentAuditContext {
  /** Verified actor performing the deletion. Required: a fail-closed delete must not synthesize one. */
  deletedBy: string;
  templateId?: string;
  documentTitle?: string;
  patientRut?: string;
  recordDate?: string;
}

const appendVersionAudit = (
  record: ClinicalDocumentRecord,
  actor: ClinicalDocumentAuditActor,
  reason: ClinicalDocumentRecord['versionHistory'][number]['reason'],
  now: string
): ClinicalDocumentRecord => {
  const previousVersion = record.versionHistory.at(-1);
  return {
    ...record,
    currentVersion: record.currentVersion + 1,
    versionHistory: [
      ...record.versionHistory,
      {
        version: record.currentVersion + 1,
        savedAt: now,
        savedBy: actor,
        reason,
        changedSectionIds: resolveClinicalDocumentVersionChangedSectionIds(record, previousVersion),
        sectionSnapshots: buildClinicalDocumentVersionSectionSnapshots(record),
      },
    ],
    audit: {
      ...record.audit,
      updatedAt: now,
      updatedBy: actor,
    },
  };
};

export const executeCreateClinicalDocumentDraft = async (
  record: ClinicalDocumentRecord,
  hospitalId: string,
  dependencies: ClinicalDocumentUseCaseDependencies = {}
): Promise<ApplicationOutcome<ClinicalDocumentRecord | null>> => {
  const clinicalDocumentPort = dependencies.clinicalDocumentPort || defaultClinicalDocumentPort;
  try {
    const saved = await clinicalDocumentPort.createDraft(record, hospitalId);
    return createApplicationSuccess(saved);
  } catch (error) {
    return createApplicationFailed(null, [
      {
        kind: 'unknown',
        message: error instanceof Error ? error.message : 'No se pudo crear el borrador clínico.',
      },
    ]);
  }
};

export const executeListClinicalDocumentsByEpisodeKeys = async (
  episodeKeys: string[],
  hospitalId?: string,
  dependencies: ClinicalDocumentUseCaseDependencies = {}
): Promise<ApplicationOutcome<ClinicalDocumentRecord[]>> => {
  const clinicalDocumentPort = dependencies.clinicalDocumentPort || defaultClinicalDocumentPort;
  try {
    const documents = await clinicalDocumentPort.listByEpisodeKeys(episodeKeys, hospitalId);
    return createApplicationSuccess(documents);
  } catch (error) {
    return createApplicationFailed(
      [],
      [
        {
          kind: 'unknown',
          message:
            error instanceof Error ? error.message : 'No se pudieron cargar documentos clínicos.',
        },
      ]
    );
  }
};

export const subscribeClinicalDocumentsByEpisode = (
  episodeKey: string,
  callback: (documents: ClinicalDocumentRecord[]) => void,
  hospitalId: string,
  dependencies: ClinicalDocumentUseCaseDependencies = {}
): (() => void) => {
  const clinicalDocumentPort = dependencies.clinicalDocumentPort || defaultClinicalDocumentPort;
  return clinicalDocumentPort.subscribeByEpisode(episodeKey, callback, hospitalId);
};

export const subscribeClinicalDocumentsByEpisodeKeys = (
  episodeKeys: string[],
  callback: (documents: ClinicalDocumentRecord[]) => void,
  hospitalId: string,
  dependencies: ClinicalDocumentUseCaseDependencies = {}
): (() => void) => {
  const clinicalDocumentPort = dependencies.clinicalDocumentPort || defaultClinicalDocumentPort;
  return clinicalDocumentPort.subscribeByEpisodeKeys(episodeKeys, callback, hospitalId);
};

export const executePersistClinicalDocumentDraft = async (
  record: ClinicalDocumentRecord,
  hospitalId: string,
  actor: ClinicalDocumentAuditActor,
  reason: PersistReason,
  dependencies: ClinicalDocumentUseCaseDependencies = {}
): Promise<ApplicationOutcome<ClinicalDocumentRecord | null>> => {
  const clinicalDocumentPort = dependencies.clinicalDocumentPort || defaultClinicalDocumentPort;
  try {
    const now = new Date().toISOString();
    const saved = await clinicalDocumentPort.saveDraft(
      appendVersionAudit(record, actor, reason, now),
      hospitalId
    );
    return createApplicationSuccess(saved);
  } catch (error) {
    return createApplicationFailed(null, [
      {
        kind: 'unknown',
        message: error instanceof Error ? error.message : 'No se pudo guardar el documento.',
      },
    ]);
  }
};

export const executeDeleteClinicalDocument = async (
  documentId: string,
  hospitalId: string,
  auditContext: DeleteClinicalDocumentAuditContext,
  dependencies: ClinicalDocumentUseCaseDependencies = {}
): Promise<ApplicationOutcome<null>> => {
  const clinicalDocumentPort = dependencies.clinicalDocumentPort || defaultClinicalDocumentPort;
  const writeAuditEvent = dependencies.writeAuditEvent || (await loadExecuteWriteAuditEvent());

  // Fail closed: audit BEFORE deleting, so a clinical document is never removed without a guaranteed
  // audit trail (Ley 20.584). A failed audit (anonymous actor or write error) aborts the delete and
  // returns the failed outcome. (Residual: a delete that fails AFTER a successful audit leaves a
  // "phantom" audit — accepted vs. an unaudited delete.) See docs/CLINICAL_MUTATION_AUDIT_POLICY.md.
  const auditOutcome = await writeAuditEvent({
    userId: auditContext.deletedBy,
    action: 'CLINICAL_DOCUMENT_DELETED',
    entityType: 'clinicalDocument',
    entityId: documentId,
    patientRut: auditContext.patientRut,
    recordDate: auditContext.recordDate,
    details: {
      documentId,
      templateId: auditContext.templateId,
      documentTitle: auditContext.documentTitle,
      patientRut: auditContext.patientRut,
    },
  });
  if (auditOutcome.status === 'failed') {
    return auditOutcome;
  }

  try {
    await clinicalDocumentPort.delete(documentId, hospitalId);
    return createApplicationSuccess(null);
  } catch (error) {
    return createApplicationFailed(null, [
      {
        kind: 'unknown',
        message: error instanceof Error ? error.message : 'No se pudo eliminar el documento.',
      },
    ]);
  }
};
