import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MedicalIndicationRecordRepository } from '@/services/repositories/MedicalIndicationRecordRepository';
import { MedicalIndicationTemplateRepository } from '@/services/repositories/MedicalIndicationTemplateRepository';
import { firestoreDb } from '@/services/storage/firestore';

vi.mock('@/services/storage/firestore', () => ({
  firestoreDb: {
    getDocs: vi.fn(),
    setDoc: vi.fn(),
    updateDoc: vi.fn(),
    runBatch: vi.fn(),
  },
}));

vi.mock('@/services/repositories/repositoryConfig', () => ({
  isFirestoreEnabled: () => true,
}));

describe('MedicalIndication repositories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists only active personal templates from the owner collection', async () => {
    vi.mocked(firestoreDb.getDocs).mockResolvedValue([
      {
        id: 'tpl-active',
        userId: 'user_doctor',
        text: 'Control cada 6 horas',
        createdAt: '2026-05-29T10:00:00.000Z',
        updatedAt: '2026-05-29T10:00:00.000Z',
        createdByName: 'Dra. Test',
        useCount: 0,
        isArchived: false,
      },
      {
        id: 'tpl-archived',
        userId: 'user_doctor',
        text: 'Archivada',
        createdAt: '2026-05-29T10:00:00.000Z',
        updatedAt: '2026-05-29T10:00:00.000Z',
        createdByName: 'Dra. Test',
        useCount: 0,
        isArchived: true,
      },
    ]);

    const result = await MedicalIndicationTemplateRepository.listActiveByUser('user_doctor', 'hhr');

    expect(firestoreDb.getDocs).toHaveBeenCalledWith(
      'hospitals/hhr/medicalIndicationTemplates/user_doctor/items',
      { orderBy: [{ field: 'updatedAt', direction: 'desc' }] }
    );
    expect(result.map(item => item.id)).toEqual(['tpl-active']);
  });

  it('stores generated records in the shared hospital collection', async () => {
    await MedicalIndicationRecordRepository.create(
      {
        id: 'record-1',
        patientRut: '11.111.111-1',
        patientName: 'Ana Test',
        episodeId: 'ep_ana',
        bedId: 'R1',
        targetDate: '2026-05-31',
        generatedAt: '2026-05-29T10:42:00.000Z',
        generatedByUserId: 'user_doctor',
        generatedByName: 'Dra. Test',
        generatedByRole: 'doctor_specialist',
        generatedFromTemplateIds: [],
        admissionDate: '2026-05-27',
        daysOfStayForTargetDate: '5',
        treatingDoctor: 'Dra. Rapa Nui',
        reposo: 'Relativo',
        regimen: 'Liviano',
        kineType: 'motora',
        kineTimes: '2 veces/dia',
        pendingNotes: '',
        indications: ['Control'],
        pdfPrintedAt: null,
      },
      'hhr'
    );

    expect(firestoreDb.setDoc).toHaveBeenCalledWith(
      'hospitals/hhr/medicalIndicationRecords',
      'record-1',
      expect.objectContaining({ episodeId: 'ep_ana', targetDate: '2026-05-31' })
    );
  });

  it('stores generated records and audit logs in one Firestore batch', async () => {
    const batch = { set: vi.fn() };
    vi.mocked(firestoreDb.runBatch).mockImplementation(async operation => {
      operation(batch as never);
    });

    await MedicalIndicationRecordRepository.createWithAuditEvent(
      {
        id: 'record-1',
        patientRut: '11.111.111-1',
        patientName: 'Ana Test',
        episodeId: 'ep_ana',
        bedId: 'R1',
        targetDate: '2026-05-31',
        generatedAt: '2026-05-29T10:42:00.000Z',
        generatedByUserId: 'user_doctor',
        generatedByName: 'Dra. Test',
        generatedByRole: 'doctor_specialist',
        generatedFromTemplateIds: [],
        admissionDate: '2026-05-27',
        daysOfStayForTargetDate: '5',
        treatingDoctor: 'Dra. Rapa Nui',
        reposo: 'Relativo',
        regimen: 'Liviano',
        kineType: 'motora',
        kineTimes: '2 veces/dia',
        pendingNotes: '',
        indications: ['Control'],
        pdfPrintedAt: null,
      },
      {
        userId: 'doctor@example.com',
        action: 'MEDICAL_INDICATION_RECORD_CREATED',
        entityType: 'medicalIndicationRecord',
        entityId: 'record-1',
        patientRut: '11.111.111-1',
        recordDate: '2026-05-31',
        authors: 'Dra. Test',
        details: {
          patientName: 'Ana Test',
          bedId: 'R1',
        },
      },
      'hhr'
    );

    expect(firestoreDb.runBatch).toHaveBeenCalledTimes(1);
    expect(batch.set).toHaveBeenCalledWith(
      'hospitals/hhr/medicalIndicationRecords',
      'record-1',
      expect.objectContaining({ episodeId: 'ep_ana', targetDate: '2026-05-31' })
    );
    expect(batch.set).toHaveBeenCalledWith(
      'hospitals/hhr/auditLogs',
      expect.stringContaining('audit_medical_indication_record-1'),
      expect.objectContaining({
        action: 'MEDICAL_INDICATION_RECORD_CREATED',
        entityType: 'medicalIndicationRecord',
        userId: 'doctor@example.com',
        userUid: 'user_doctor',
        patientIdentifier: '11.111.***-*',
      })
    );
  });

  it('lists generated records by episode and target date from the shared hospital collection', async () => {
    vi.mocked(firestoreDb.getDocs).mockResolvedValue([
      {
        id: 'record-old',
        episodeId: 'ep_ana',
        targetDate: '2026-05-31',
        generatedAt: '2026-05-29T10:00:00.000Z',
        patientRut: '11.111.111-1',
        patientName: 'Ana Test',
        bedId: 'R1',
        generatedByUserId: 'user_doctor',
        generatedByName: 'Dra. Test',
        generatedFromTemplateIds: [],
        admissionDate: '2026-05-27',
        daysOfStayForTargetDate: '5',
        treatingDoctor: 'Dra. Rapa Nui',
        reposo: 'Relativo',
        regimen: 'Liviano',
        kineType: 'motora',
        kineTimes: '2 veces/dia',
        pendingNotes: '',
        indications: ['Control antiguo'],
        pdfPrintedAt: null,
      },
      {
        id: 'record-new',
        episodeId: 'ep_ana',
        targetDate: '2026-05-31',
        generatedAt: '2026-05-29T12:00:00.000Z',
        patientRut: '11.111.111-1',
        patientName: 'Ana Test',
        bedId: 'R1',
        generatedByUserId: 'user_doctor',
        generatedByName: 'Dra. Test',
        generatedFromTemplateIds: [],
        admissionDate: '2026-05-27',
        daysOfStayForTargetDate: '5',
        treatingDoctor: 'Dra. Rapa Nui',
        reposo: 'Relativo',
        regimen: 'Liviano',
        kineType: 'motora',
        kineTimes: '2 veces/dia',
        pendingNotes: '',
        indications: ['Control actualizado'],
        pdfPrintedAt: null,
      },
    ]);

    const result = await MedicalIndicationRecordRepository.listByEpisodeAndTargetDate(
      'ep_ana',
      '2026-05-31',
      'hhr'
    );

    expect(firestoreDb.getDocs).toHaveBeenCalledWith('hospitals/hhr/medicalIndicationRecords', {
      where: [
        { field: 'episodeId', operator: '==', value: 'ep_ana' },
        { field: 'targetDate', operator: '==', value: '2026-05-31' },
      ],
    });
    expect(result.map(record => record.id)).toEqual(['record-new', 'record-old']);
  });
});
