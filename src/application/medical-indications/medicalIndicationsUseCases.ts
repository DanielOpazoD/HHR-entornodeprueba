import {
  loadExecuteWriteAuditEvent,
  type WriteAuditEvent,
} from '@/application/audit/writeAuditEventUseCaseLoader';
import {
  defaultMedicalIndicationRecordPort,
  defaultMedicalIndicationTemplatePort,
  type MedicalIndicationRecordPort,
  type MedicalIndicationTemplatePort,
} from '@/application/ports/medicalIndicationPort';
import {
  buildMedicalIndicationRecordId,
  buildMedicalIndicationsEpisodeId,
  buildMedicalIndicationTemplateId,
  calculateMedicalIndicationsStayDays,
  normalizeMedicalIndicationsDateKey,
  type MedicalIndicationRecord,
  type MedicalIndicationRecordContent,
  type MedicalIndicationTemplate,
  type MedicalIndicationsPatientOption,
} from '@/shared/contracts/medicalIndications';

type AuditWriter = WriteAuditEvent;

interface MedicalIndicationUseCaseDeps {
  templatePort?: MedicalIndicationTemplatePort;
  recordPort?: MedicalIndicationRecordPort;
  writeAuditEvent?: AuditWriter;
}

export interface CreateMedicalIndicationTemplateInput {
  userId: string;
  userLabel: string;
  text: string;
  now?: string;
  hospitalId?: string;
}

export interface UpdateMedicalIndicationTemplateInput {
  templateId: string;
  userId: string;
  userLabel: string;
  text: string;
  now?: string;
  hospitalId?: string;
}

export interface ArchiveMedicalIndicationTemplateInput {
  templateId: string;
  userId: string;
  userLabel: string;
  now?: string;
  hospitalId?: string;
}

export interface MarkMedicalIndicationTemplateUsedInput {
  template: MedicalIndicationTemplate;
  userLabel: string;
  now?: string;
  hospitalId?: string;
}

export interface CreateMedicalIndicationRecordInput {
  patient: MedicalIndicationsPatientOption;
  targetDate: string;
  generatedAt?: string;
  generatedByUserId: string;
  generatedByName: string;
  generatedByRole?: string;
  generatedByAuditLabel: string;
  generatedFromTemplateIds: string[];
  content: MedicalIndicationRecordContent;
  hospitalId?: string;
}

export interface GetLatestMedicalIndicationRecordInput {
  patient: MedicalIndicationsPatientOption;
  targetDate: string;
  hospitalId?: string;
}

const assertAuditPersisted = async (outcomePromise: ReturnType<AuditWriter>, message: string) => {
  const outcome = await outcomePromise;
  if (outcome.status === 'failed') {
    throw new Error(message);
  }
};

const defaultNow = (): string => new Date().toISOString();

export const executeCreateMedicalIndicationTemplate = async (
  input: CreateMedicalIndicationTemplateInput,
  dependencies: MedicalIndicationUseCaseDeps = {}
): Promise<MedicalIndicationTemplate> => {
  const now = input.now || defaultNow();
  const text = input.text.trim();
  if (!text) {
    throw new Error('La indicación personal no puede quedar vacía.');
  }

  const template: MedicalIndicationTemplate = {
    id: buildMedicalIndicationTemplateId({ userId: input.userId, text, now }),
    userId: input.userId,
    text,
    createdAt: now,
    updatedAt: now,
    createdByName: input.userLabel,
    lastUsedAt: null,
    useCount: 0,
    isArchived: false,
  };

  const templatePort = dependencies.templatePort || defaultMedicalIndicationTemplatePort;
  const writeAuditEvent = dependencies.writeAuditEvent || (await loadExecuteWriteAuditEvent());

  // Fail closed: audit BEFORE creating, so a template is never persisted without an audit trail
  // (an anonymous actor or an audit-write failure aborts here). See docs/CLINICAL_MUTATION_AUDIT_POLICY.md.
  await assertAuditPersisted(
    writeAuditEvent({
      userId: input.userLabel,
      action: 'MEDICAL_INDICATION_TEMPLATE_CREATED',
      entityType: 'medicalIndicationTemplate',
      entityId: template.id,
      details: {
        templateId: template.id,
        templateOwnerUserId: input.userId,
        textPreview: text.slice(0, 120),
      },
    }),
    'No se guardó la indicación personal porque no se pudo registrar la auditoría.'
  );

  await templatePort.create(template, input.hospitalId);

  return template;
};

export const executeUpdateMedicalIndicationTemplate = async (
  input: UpdateMedicalIndicationTemplateInput,
  dependencies: MedicalIndicationUseCaseDeps = {}
): Promise<void> => {
  const now = input.now || defaultNow();
  const text = input.text.trim();
  if (!text) {
    throw new Error('La indicación personal no puede quedar vacía.');
  }

  const templatePort = dependencies.templatePort || defaultMedicalIndicationTemplatePort;
  const writeAuditEvent = dependencies.writeAuditEvent || (await loadExecuteWriteAuditEvent());

  // Fail closed: audit before mutating.
  await assertAuditPersisted(
    writeAuditEvent({
      userId: input.userLabel,
      action: 'MEDICAL_INDICATION_TEMPLATE_UPDATED',
      entityType: 'medicalIndicationTemplate',
      entityId: input.templateId,
      details: {
        templateId: input.templateId,
        templateOwnerUserId: input.userId,
        textPreview: text.slice(0, 120),
      },
    }),
    'No se actualizó la indicación personal porque no se pudo registrar la auditoría.'
  );

  await templatePort.update(
    input.templateId,
    input.userId,
    { text, updatedAt: now },
    input.hospitalId
  );
};

export const executeArchiveMedicalIndicationTemplate = async (
  input: ArchiveMedicalIndicationTemplateInput,
  dependencies: MedicalIndicationUseCaseDeps = {}
): Promise<void> => {
  const now = input.now || defaultNow();
  const templatePort = dependencies.templatePort || defaultMedicalIndicationTemplatePort;
  const writeAuditEvent = dependencies.writeAuditEvent || (await loadExecuteWriteAuditEvent());

  // Fail closed: audit before mutating.
  await assertAuditPersisted(
    writeAuditEvent({
      userId: input.userLabel,
      action: 'MEDICAL_INDICATION_TEMPLATE_ARCHIVED',
      entityType: 'medicalIndicationTemplate',
      entityId: input.templateId,
      details: {
        templateId: input.templateId,
        templateOwnerUserId: input.userId,
      },
    }),
    'No se archivó la indicación personal porque no se pudo registrar la auditoría.'
  );

  await templatePort.archive(input.templateId, input.userId, now, input.hospitalId);
};

export const executeMarkMedicalIndicationTemplateUsed = async (
  input: MarkMedicalIndicationTemplateUsedInput,
  dependencies: MedicalIndicationUseCaseDeps = {}
): Promise<void> => {
  const now = input.now || defaultNow();
  const templatePort = dependencies.templatePort || defaultMedicalIndicationTemplatePort;
  const writeAuditEvent = dependencies.writeAuditEvent || (await loadExecuteWriteAuditEvent());

  // Fail closed: audit before mutating.
  await assertAuditPersisted(
    writeAuditEvent({
      userId: input.userLabel,
      action: 'MEDICAL_INDICATION_TEMPLATE_USED',
      entityType: 'medicalIndicationTemplate',
      entityId: input.template.id,
      details: {
        templateId: input.template.id,
        templateOwnerUserId: input.template.userId,
        textPreview: input.template.text.slice(0, 120),
      },
    }),
    'No se insertó la indicación personal porque no se pudo registrar la auditoría.'
  );

  await templatePort.markUsed(
    input.template.id,
    input.template.userId,
    now,
    input.template.useCount + 1,
    input.hospitalId
  );
};

export const executeGetLatestMedicalIndicationRecord = async (
  input: GetLatestMedicalIndicationRecordInput,
  dependencies: MedicalIndicationUseCaseDeps = {}
): Promise<MedicalIndicationRecord | null> => {
  const targetDate = normalizeMedicalIndicationsDateKey(input.targetDate);
  const episodeId = buildMedicalIndicationsEpisodeId(input.patient);
  const recordPort = dependencies.recordPort || defaultMedicalIndicationRecordPort;
  const records = await recordPort.listByEpisodeAndTargetDate(
    episodeId,
    targetDate,
    input.hospitalId
  );
  return records[0] ?? null;
};

export const executeCreateMedicalIndicationRecord = async (
  input: CreateMedicalIndicationRecordInput,
  dependencies: MedicalIndicationUseCaseDeps = {}
): Promise<MedicalIndicationRecord> => {
  const generatedAt = input.generatedAt || defaultNow();
  const targetDate = normalizeMedicalIndicationsDateKey(input.targetDate);
  const episodeId = buildMedicalIndicationsEpisodeId(input.patient);
  const activeIndications = input.content.indications.map(item => item.trim()).filter(Boolean);
  if (activeIndications.length === 0) {
    throw new Error('Debe existir al menos una indicación médica para registrar.');
  }

  const record: MedicalIndicationRecord = {
    id: buildMedicalIndicationRecordId({ episodeId, targetDate, generatedAt }),
    patientRut: input.patient.rut,
    patientName: input.patient.patientName,
    episodeId,
    bedId: input.patient.bedId,
    targetDate,
    generatedAt,
    generatedByUserId: input.generatedByUserId,
    generatedByName: input.generatedByName,
    generatedByRole: input.generatedByRole,
    generatedFromTemplateIds: input.generatedFromTemplateIds,
    admissionDate: normalizeMedicalIndicationsDateKey(input.patient.admissionDate),
    daysOfStayForTargetDate: calculateMedicalIndicationsStayDays(
      input.patient.admissionDate,
      targetDate
    ),
    treatingDoctor: input.content.treatingDoctor,
    reposo: input.content.reposo,
    regimen: input.content.regimen,
    kineType: input.content.kineType,
    kineTimes: input.content.kineTimes,
    pendingNotes: input.content.pendingNotes,
    indications: activeIndications,
    pdfPrintedAt: null,
  };

  const recordPort = dependencies.recordPort || defaultMedicalIndicationRecordPort;
  await recordPort.createWithAuditEvent(
    record,
    {
      userId: input.generatedByAuditLabel,
      action: 'MEDICAL_INDICATION_RECORD_CREATED',
      entityType: 'medicalIndicationRecord',
      entityId: record.id,
      patientRut: record.patientRut,
      recordDate: record.targetDate,
      authors: record.generatedByName,
      details: {
        patientName: record.patientName,
        patientRut: record.patientRut,
        bedId: record.bedId,
        episodeId: record.episodeId,
        targetDate: record.targetDate,
        generatedAt: record.generatedAt,
        generatedByName: record.generatedByName,
        daysOfStayForTargetDate: record.daysOfStayForTargetDate,
        indicationsCount: record.indications.length,
        generatedFromTemplateIds: record.generatedFromTemplateIds,
      },
    },
    input.hospitalId
  );

  return record;
};
