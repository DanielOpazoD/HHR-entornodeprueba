import { describe, expect, it, vi } from 'vitest';
import {
  executeArchiveMedicalIndicationTemplate,
  executeCreateMedicalIndicationRecord,
  executeCreateMedicalIndicationTemplate,
  executeGetLatestMedicalIndicationRecord,
  executeMarkMedicalIndicationTemplateUsed,
  executeUpdateMedicalIndicationTemplate,
} from '@/application/medical-indications/medicalIndicationsUseCases';
import type {
  MedicalIndicationRecordPort,
  MedicalIndicationTemplatePort,
} from '@/application/ports/medicalIndicationPort';
import type { MedicalIndicationsPatientOption } from '@/shared/contracts/medicalIndications';

const patient: MedicalIndicationsPatientOption = {
  bedId: 'R1',
  label: 'R1 - Ana Test',
  patientName: 'Ana Test',
  rut: '11.111.111-1',
  diagnosis: 'Neumonia',
  age: '63',
  birthDate: '1963-01-01',
  allergies: 'No conocidas',
  admissionDate: '2026-05-27',
  daysOfStay: '3',
  treatingDoctor: 'Dra. Rapa Nui',
  clinicalEpisodeId: 'ep_ana_20260527',
};

describe('medicalIndications use cases', () => {
  it('creates personal templates scoped to the Firebase user id and audits the action', async () => {
    const templatePort: MedicalIndicationTemplatePort = {
      listActiveByUser: vi.fn(),
      create: vi.fn().mockResolvedValue(undefined),
      update: vi.fn(),
      archive: vi.fn(),
      markUsed: vi.fn(),
    };
    const writeAuditEvent = vi
      .fn()
      .mockResolvedValue({ status: 'success', data: null, errors: [] });

    const template = await executeCreateMedicalIndicationTemplate(
      {
        userId: 'user_doctor',
        userLabel: 'doctor@example.com',
        text: 'Control de signos vitales cada 6 horas',
        now: '2026-05-29T10:00:00.000Z',
      },
      { templatePort, writeAuditEvent }
    );

    expect(template.userId).toBe('user_doctor');
    expect(template.text).toBe('Control de signos vitales cada 6 horas');
    expect(templatePort.create).toHaveBeenCalledWith(template, undefined);
    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'doctor@example.com',
        action: 'MEDICAL_INDICATION_TEMPLATE_CREATED',
        entityType: 'medicalIndicationTemplate',
        entityId: template.id,
      })
    );
  });

  it('archives personal templates instead of hard deleting them', async () => {
    const templatePort: MedicalIndicationTemplatePort = {
      listActiveByUser: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      archive: vi.fn().mockResolvedValue(undefined),
      markUsed: vi.fn(),
    };
    const writeAuditEvent = vi
      .fn()
      .mockResolvedValue({ status: 'success', data: null, errors: [] });

    await executeArchiveMedicalIndicationTemplate(
      {
        templateId: 'tpl-1',
        userId: 'user_doctor',
        userLabel: 'doctor@example.com',
        now: '2026-05-29T11:00:00.000Z',
      },
      { templatePort, writeAuditEvent }
    );

    expect(templatePort.archive).toHaveBeenCalledWith(
      'tpl-1',
      'user_doctor',
      '2026-05-29T11:00:00.000Z',
      undefined
    );
  });

  it('persists generated indications as a shared clinical record before printing', async () => {
    const recordPort: MedicalIndicationRecordPort = {
      listByEpisodeAndTargetDate: vi.fn(),
      create: vi.fn().mockResolvedValue(undefined),
      createWithAuditEvent: vi.fn().mockResolvedValue(undefined),
    };
    const writeAuditEvent = vi
      .fn()
      .mockResolvedValue({ status: 'success', data: null, errors: [] });

    const record = await executeCreateMedicalIndicationRecord(
      {
        patient,
        targetDate: '2026-05-31',
        generatedAt: '2026-05-29T10:42:00.000Z',
        generatedByUserId: 'user_doctor',
        generatedByName: 'Dra. Test',
        generatedByRole: 'doctor_specialist',
        generatedByAuditLabel: 'doctor@example.com',
        generatedFromTemplateIds: ['tpl-1'],
        content: {
          reposo: 'Relativo',
          regimen: 'Liviano',
          kineType: 'motora',
          kineTimes: '2 veces/dia',
          treatingDoctor: 'Dra. Rapa Nui',
          pendingNotes: 'Revisar examenes',
          indications: ['Control de signos vitales cada 6 horas'],
        },
      },
      { recordPort, writeAuditEvent }
    );

    expect(record).toMatchObject({
      episodeId: 'ep_ana_20260527',
      targetDate: '2026-05-31',
      generatedAt: '2026-05-29T10:42:00.000Z',
      daysOfStayForTargetDate: '5',
      generatedFromTemplateIds: ['tpl-1'],
    });
    expect(recordPort.createWithAuditEvent).toHaveBeenCalledWith(
      record,
      expect.objectContaining({
        userId: 'doctor@example.com',
        action: 'MEDICAL_INDICATION_RECORD_CREATED',
        entityType: 'medicalIndicationRecord',
        entityId: record.id,
        patientRut: '11.111.111-1',
        recordDate: '2026-05-31',
      }),
      undefined
    );
    expect(recordPort.create).not.toHaveBeenCalled();
    expect(writeAuditEvent).not.toHaveBeenCalled();
  });

  it('loads the latest shared generated record for the patient episode and target date', async () => {
    const recordPort: MedicalIndicationRecordPort = {
      listByEpisodeAndTargetDate: vi.fn().mockResolvedValue([
        {
          id: 'record-new',
          patientRut: '11.111.111-1',
          patientName: 'Ana Test',
          episodeId: 'ep_ana_20260527',
          bedId: 'R1',
          targetDate: '2026-05-31',
          generatedAt: '2026-05-29T12:00:00.000Z',
          generatedByUserId: 'user_doctor',
          generatedByName: 'Dra. Test',
          generatedByRole: 'doctor_specialist',
          generatedFromTemplateIds: [],
          admissionDate: '2026-05-27',
          daysOfStayForTargetDate: '5',
          treatingDoctor: 'Dra. Persistida',
          reposo: 'Relativo',
          regimen: 'Liviano',
          kineType: 'respiratoria',
          kineTimes: '3 veces/dia',
          pendingNotes: 'Revisar gases',
          indications: ['Control actualizado'],
          pdfPrintedAt: null,
        },
      ]),
      create: vi.fn(),
      createWithAuditEvent: vi.fn(),
    };

    const record = await executeGetLatestMedicalIndicationRecord(
      {
        patient,
        targetDate: '31-05-2026',
      },
      { recordPort }
    );

    expect(record?.id).toBe('record-new');
    expect(recordPort.listByEpisodeAndTargetDate).toHaveBeenCalledWith(
      'ep_ana_20260527',
      '2026-05-31',
      undefined
    );
  });

  describe('fail-closed (audit-first): a failed audit aborts before mutating', () => {
    const failedAudit = () =>
      vi.fn().mockResolvedValue({ status: 'failed', data: null, errors: [] });
    const buildTemplatePort = (): MedicalIndicationTemplatePort => ({
      listActiveByUser: vi.fn(),
      create: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
      archive: vi.fn().mockResolvedValue(undefined),
      markUsed: vi.fn().mockResolvedValue(undefined),
    });

    it('CREATE does not create when the audit fails', async () => {
      const templatePort = buildTemplatePort();
      const writeAuditEvent = failedAudit();
      await expect(
        executeCreateMedicalIndicationTemplate(
          { userId: 'u', userLabel: 'd@e.com', text: 'X', now: '2026-05-29T10:00:00.000Z' },
          { templatePort, writeAuditEvent }
        )
      ).rejects.toThrow();
      expect(writeAuditEvent).toHaveBeenCalledTimes(1);
      expect(templatePort.create).not.toHaveBeenCalled();
    });

    it('UPDATE does not update when the audit fails', async () => {
      const templatePort = buildTemplatePort();
      const writeAuditEvent = failedAudit();
      await expect(
        executeUpdateMedicalIndicationTemplate(
          {
            templateId: 'tpl-1',
            userId: 'u',
            userLabel: 'd@e.com',
            text: 'X',
            now: '2026-05-29T10:00:00.000Z',
          },
          { templatePort, writeAuditEvent }
        )
      ).rejects.toThrow();
      expect(writeAuditEvent).toHaveBeenCalledTimes(1);
      expect(templatePort.update).not.toHaveBeenCalled();
    });

    it('ARCHIVE does not archive when the audit fails', async () => {
      const templatePort = buildTemplatePort();
      const writeAuditEvent = failedAudit();
      await expect(
        executeArchiveMedicalIndicationTemplate(
          {
            templateId: 'tpl-1',
            userId: 'u',
            userLabel: 'd@e.com',
            now: '2026-05-29T11:00:00.000Z',
          },
          { templatePort, writeAuditEvent }
        )
      ).rejects.toThrow();
      expect(writeAuditEvent).toHaveBeenCalledTimes(1);
      expect(templatePort.archive).not.toHaveBeenCalled();
    });

    it('USED does not mark used when the audit fails', async () => {
      const templatePort = buildTemplatePort();
      const writeAuditEvent = failedAudit();
      await expect(
        executeMarkMedicalIndicationTemplateUsed(
          {
            template: { id: 'tpl-1', userId: 'u', text: 'X', useCount: 0 } as never,
            userLabel: 'd@e.com',
            now: '2026-05-29T11:00:00.000Z',
          },
          { templatePort, writeAuditEvent }
        )
      ).rejects.toThrow();
      expect(writeAuditEvent).toHaveBeenCalledTimes(1);
      expect(templatePort.markUsed).not.toHaveBeenCalled();
    });
  });
});
