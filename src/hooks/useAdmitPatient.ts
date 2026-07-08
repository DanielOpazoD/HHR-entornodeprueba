/**
 * React hook over admitPatientCommand: closes the loop between the canonical
 * command (validate → persist → audit → typed outcome) and the runtime
 * components, by injecting the authenticated actor from AuthContext.
 *
 * UI callers receive a single async function that takes everything except the
 * actor (which the hook resolves). The returned outcome carries both the
 * RuntimeOperationStatusSnapshot (for badges / banners) and the
 * ApplicationOutcome (for issue messages / telemetry). Existing UI flows can
 * adopt this hook one entry point at a time without rewriting their state
 * machines.
 */
import { useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { resolveAuditActor } from '@/context/AuditContext';
import {
  executeAdmitPatientCommand,
  type AdmitPatientInput,
  type AdmitPatientOutcome,
  type AdmitPatientPort,
} from '@/application/daily-record/commands/admitPatientCommand';
import { defaultDailyRecordAdmitPatientPort } from '@/services/daily-record/dailyRecordAdmitPatientPort';

export type AdmitPatientHookInput = Omit<AdmitPatientInput, 'actor'>;

export type AdmitPatientHookFn = (input: AdmitPatientHookInput) => Promise<AdmitPatientOutcome>;

export interface UseAdmitPatientOptions {
  port?: AdmitPatientPort;
}

export const useAdmitPatient = (options: UseAdmitPatientOptions = {}): AdmitPatientHookFn => {
  const { currentUser } = useAuth();
  const port = options.port ?? defaultDailyRecordAdmitPatientPort;

  return useCallback(
    (input: AdmitPatientHookInput) => {
      const actor = resolveAuditActor(currentUser);
      return executeAdmitPatientCommand({ ...input, actor }, { port });
    },
    [currentUser, port]
  );
};
