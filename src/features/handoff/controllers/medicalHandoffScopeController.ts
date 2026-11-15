import type { MedicalHandoffScope } from '@/types/medicalHandoff';

interface ScopedMedicalSignature {
  doctorName: string;
  signedAt: string;
  userAgent?: string;
}

interface MedicalHandoffScopeRecordLike {
  medicalHandoffSentAt?: string;
  medicalHandoffSentAtByScope?: Partial<Record<MedicalHandoffScope, string>>;
  medicalSignatureLinkTokenByScope?: Partial<Record<MedicalHandoffScope, string>>;
  medicalSignature?: ScopedMedicalSignature;
  medicalSignatureByScope?: Partial<Record<MedicalHandoffScope, ScopedMedicalSignature>>;
}

const VALID_SCOPES: MedicalHandoffScope[] = ['all', 'upc', 'no-upc'];

export const resolveMedicalHandoffScope = (
  rawScope: string | null | undefined
): MedicalHandoffScope => {
  if (rawScope && VALID_SCOPES.includes(rawScope as MedicalHandoffScope)) {
    return rawScope as MedicalHandoffScope;
  }

  return 'all';
};

export const resolveScopedMedicalSignature = (
  record: MedicalHandoffScopeRecordLike | null | undefined,
  scope: MedicalHandoffScope
): ScopedMedicalSignature | null => {
  if (!record) return null;

  if (record.medicalSignatureByScope?.[scope]) {
    return record.medicalSignatureByScope[scope] || null;
  }

  return scope === 'all' ? record.medicalSignature || null : null;
};
