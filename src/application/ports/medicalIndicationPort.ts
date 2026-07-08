import type {
  MedicalIndicationRecord,
  MedicalIndicationRecordAuditEvent,
  MedicalIndicationTemplate,
} from '@/shared/contracts/medicalIndications';
import { MedicalIndicationRecordRepository } from '@/services/repositories/MedicalIndicationRecordRepository';
import { MedicalIndicationTemplateRepository } from '@/services/repositories/MedicalIndicationTemplateRepository';

export interface MedicalIndicationTemplatePort {
  listActiveByUser: (userId: string, hospitalId?: string) => Promise<MedicalIndicationTemplate[]>;
  create: (template: MedicalIndicationTemplate, hospitalId?: string) => Promise<void>;
  update: (
    templateId: string,
    userId: string,
    patch: { text: string; updatedAt: string },
    hospitalId?: string
  ) => Promise<void>;
  archive: (
    templateId: string,
    userId: string,
    archivedAt: string,
    hospitalId?: string
  ) => Promise<void>;
  markUsed: (
    templateId: string,
    userId: string,
    lastUsedAt: string,
    useCount: number,
    hospitalId?: string
  ) => Promise<void>;
}

export interface MedicalIndicationRecordPort {
  listByEpisodeAndTargetDate: (
    episodeId: string,
    targetDate: string,
    hospitalId?: string
  ) => Promise<MedicalIndicationRecord[]>;
  create: (record: MedicalIndicationRecord, hospitalId?: string) => Promise<void>;
  createWithAuditEvent: (
    record: MedicalIndicationRecord,
    auditEvent: MedicalIndicationRecordAuditEvent,
    hospitalId?: string
  ) => Promise<void>;
}

export const defaultMedicalIndicationTemplatePort: MedicalIndicationTemplatePort =
  MedicalIndicationTemplateRepository;

export const defaultMedicalIndicationRecordPort: MedicalIndicationRecordPort =
  MedicalIndicationRecordRepository;
