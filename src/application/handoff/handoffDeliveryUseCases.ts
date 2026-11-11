import {
  buildMedicalHandoffSignatureLink,
  resolveScopedMedicalSignatureToken,
} from '@/domain/handoff/scope';
import { buildMedicalSentPatch } from '@/domain/handoff/management';
import type { ApplyDailyRecordPatch } from '@/application/shared/dailyRecordCoreContracts';
import { createApplicationSuccess } from '@/shared/contracts/applicationOutcomeFactories';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';

import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntimeCore';
import type { HandoffDailyRecordContract } from '@/domain/handoff/recordContracts';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { MedicalHandoffScope } from '@/types/medicalHandoff';
import { buildPatchedRecord, createMissingRecordOutcome } from './handoffUseCaseSupport';

export interface EnsureMedicalHandoffSignatureLinkOutput {
  handoffUrl: string;
  nextRecord: HandoffDailyRecordContract;
  scope: MedicalHandoffScope;
  tokenStatus: 'existing' | 'created';
}

export interface MarkMedicalHandoffAsSentOutput {
  doctorName: string | null;
  nextRecord: HandoffDailyRecordContract;
  patch: DailyRecordPatch;
  scope: MedicalHandoffScope;
  sentAt: string | null;
}

interface PatchRecordInput {
  record: HandoffDailyRecordContract | null;
  patchRecord: ApplyDailyRecordPatch;
}

interface MarkMedicalHandoffAsSentInput extends PatchRecordInput {
  doctorName?: string;
  scope?: MedicalHandoffScope;
}

interface EnsureMedicalHandoffSignatureLinkInput extends PatchRecordInput {
  scope?: MedicalHandoffScope;
}

const generateMedicalSignatureLinkToken = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `sig_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
};

export const executeMarkMedicalHandoffAsSent = async (
  input: MarkMedicalHandoffAsSentInput
): Promise<ApplicationOutcome<MarkMedicalHandoffAsSentOutput | null>> => {
  if (!input.record) {
    return createMissingRecordOutcome(
      null,
      'mark_medical_handoff_sent',
      'No hay entrega médica disponible.'
    );
  }

  const scope = input.scope || 'all';
  const patch = buildMedicalSentPatch(input.record, input.doctorName, scope);
  await input.patchRecord(patch);
  const nextRecord = buildPatchedRecord(input.record, patch);

  return createApplicationSuccess({
    doctorName: patch.medicalHandoffDoctor || input.record.medicalHandoffDoctor || null,
    nextRecord,
    patch,
    scope,
    sentAt:
      patch.medicalHandoffSentAtByScope?.[scope] ||
      (scope === 'all' ? patch.medicalHandoffSentAt || null : null),
  });
};

export const executeEnsureMedicalHandoffSignatureLink = async (
  input: EnsureMedicalHandoffSignatureLinkInput
): Promise<ApplicationOutcome<EnsureMedicalHandoffSignatureLinkOutput | null>> => {
  if (!input.record) {
    return createMissingRecordOutcome(
      null,
      'ensure_medical_handoff_signature_link',
      'No hay entrega médica disponible para compartir.'
    );
  }

  const scope = input.scope || 'all';
  const existingToken = resolveScopedMedicalSignatureToken(input.record, scope);
  if (existingToken) {
    return createApplicationSuccess({
      handoffUrl: buildMedicalHandoffSignatureLink(
        defaultBrowserWindowRuntime.getLocationOrigin(),
        input.record.date,
        scope,
        existingToken
      ),
      nextRecord: input.record,
      scope,
      tokenStatus: 'existing',
    });
  }

  const nextToken = generateMedicalSignatureLinkToken();
  const patch: DailyRecordPatch = {
    medicalSignatureLinkTokenByScope: {
      ...(input.record.medicalSignatureLinkTokenByScope || {}),
      [scope]: nextToken,
    },
  };
  await input.patchRecord(patch);
  const nextRecord = buildPatchedRecord(input.record, patch);

  return createApplicationSuccess({
    handoffUrl: buildMedicalHandoffSignatureLink(
      defaultBrowserWindowRuntime.getLocationOrigin(),
      input.record.date,
      scope,
      nextToken
    ),
    nextRecord,
    scope,
    tokenStatus: 'created',
  });
};
