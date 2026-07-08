import { getActiveHospitalId, getMedicalIndicationRecordsPath } from '@/constants/firestorePaths';
import { getCachedIpAddress } from '@/services/admin/utils/auditUtils';
import { generateSummary } from '@/services/admin/utils/auditSummaryGenerator';
import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { firestoreDb } from '@/services/storage/firestore';
import type {
  MedicalIndicationRecord,
  MedicalIndicationRecordAuditEvent,
} from '@/shared/contracts/medicalIndications';
import { maskRut, type AuditLogEntry } from '@/types/auditLogTypes';

const buildAuditLogId = (recordId: string): string =>
  `audit_medical_indication_${recordId}`.replace(/\//g, '_');

const getAuditLogsPath = (hospitalId: string): string => `hospitals/${hospitalId}/auditLogs`;

const buildAuditEntry = (
  record: MedicalIndicationRecord,
  auditEvent: MedicalIndicationRecordAuditEvent
): AuditLogEntry => ({
  id: buildAuditLogId(record.id),
  timestamp: record.generatedAt,
  userId: auditEvent.userId,
  userDisplayName: record.generatedByName,
  userUid: record.generatedByUserId,
  ipAddress: getCachedIpAddress(),
  action: auditEvent.action,
  entityType: auditEvent.entityType,
  entityId: auditEvent.entityId,
  summary: generateSummary(auditEvent.action, auditEvent.details, auditEvent.entityId),
  details: auditEvent.details,
  patientIdentifier: auditEvent.patientRut ? maskRut(auditEvent.patientRut) : undefined,
  recordDate: auditEvent.recordDate,
  authors: auditEvent.authors,
});

export const MedicalIndicationRecordRepository = {
  async listByEpisodeAndTargetDate(
    episodeId: string,
    targetDate: string,
    hospitalId: string = getActiveHospitalId()
  ): Promise<MedicalIndicationRecord[]> {
    if (!isFirestoreEnabled() || !episodeId.trim() || !targetDate.trim()) return [];

    const documents = await firestoreDb.getDocs<MedicalIndicationRecord>(
      getMedicalIndicationRecordsPath(hospitalId),
      {
        where: [
          { field: 'episodeId', operator: '==', value: episodeId },
          { field: 'targetDate', operator: '==', value: targetDate },
        ],
      }
    );

    return [...documents].sort((left, right) => right.generatedAt.localeCompare(left.generatedAt));
  },

  async create(
    record: MedicalIndicationRecord,
    hospitalId: string = getActiveHospitalId()
  ): Promise<void> {
    if (!isFirestoreEnabled()) {
      throw new Error('Firestore no está disponible para guardar el registro clínico.');
    }

    await firestoreDb.setDoc(getMedicalIndicationRecordsPath(hospitalId), record.id, record);
  },

  async createWithAuditEvent(
    record: MedicalIndicationRecord,
    auditEvent: MedicalIndicationRecordAuditEvent,
    hospitalId: string = getActiveHospitalId()
  ): Promise<void> {
    if (!isFirestoreEnabled()) {
      throw new Error('Firestore no está disponible para guardar el registro clínico.');
    }

    const auditEntry = buildAuditEntry(record, auditEvent);
    await firestoreDb.runBatch(batch => {
      batch.set(getMedicalIndicationRecordsPath(hospitalId), record.id, record);
      batch.set(getAuditLogsPath(hospitalId), auditEntry.id, auditEntry);
    });
  },
};
