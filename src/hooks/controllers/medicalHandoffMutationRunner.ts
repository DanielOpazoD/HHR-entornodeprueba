/**
 * Generic runner for medical-handoff mutations. Encapsulates the
 * boilerplate that every handler in `useMedicalHandoffHandlers`
 * repeated nine times:
 *
 *   1. Resolve the mutation context (returns early if the bed cannot
 *      be edited or no patient is present).
 *   2. Build the per-handler `persistMedicalFields` callback.
 *   3. Execute the handler-specific use case.
 *   4. Bail out (and emit a logger entry) when the outcome is not a
 *      success — every handler treated this the same way.
 *   5. Optionally emit a debounced `MEDICAL_HANDOFF_MODIFIED` audit
 *      event with a payload computed from the outcome.
 *
 * Extracting this lets each handler in the hook collapse from ~25 LOC
 * of repetitive plumbing into ~10 LOC of declarative description, and
 * gives the boilerplate a single, exhaustively unit-tested entry
 * point.
 */

import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';
import type { AuditAction } from '@/types/auditActionTypes';
import type { AuditLogEntry } from '@/types/auditLogTypes';
import type { PatientData } from '@/hooks/contracts/patientHookContracts';
import {
  isSuccessfulMedicalHandoffOutcome,
  type MedicalHandoffMutationContext,
} from '@/hooks/controllers/medicalHandoffHandlersController';

export type { MedicalHandoffMutationContext };

export type MedicalHandoffPersistFieldsFn = (
  fields: Pick<PatientData, 'medicalHandoffEntries' | 'medicalHandoffNote' | 'medicalHandoffAudit'>
) => Promise<void>;

export interface MedicalHandoffMutationDeps {
  resolveContext: (bedId: string, isNested: boolean) => MedicalHandoffMutationContext | null;
  resolvePersister: (bedId: string, isNested: boolean) => MedicalHandoffPersistFieldsFn;
  logUnexpectedOutcome: (handlerName: string, outcome: ApplicationOutcome<unknown>) => void;
  logDebouncedEvent: (
    action: AuditAction,
    entityType: AuditLogEntry['entityType'],
    entityId: string,
    details: Record<string, unknown>,
    patientRut?: string,
    recordDate?: string,
    authors?: string,
    waitMs?: number
  ) => void;
}

export interface MedicalHandoffMutationOptions<TData extends object> {
  bedId: string;
  isNested: boolean;
  handlerName: string;
  execute: (
    context: MedicalHandoffMutationContext,
    persist: MedicalHandoffPersistFieldsFn
  ) => Promise<ApplicationOutcome<TData | null>>;
  audit?: {
    debounceMs: number;
    buildPayload: (context: MedicalHandoffMutationContext, data: TData) => Record<string, unknown>;
  };
}

export const runMedicalHandoffMutation = async <TData extends object>(
  deps: MedicalHandoffMutationDeps,
  options: MedicalHandoffMutationOptions<TData>
): Promise<void> => {
  const context = deps.resolveContext(options.bedId, options.isNested);
  if (!context) return;

  const persist = deps.resolvePersister(options.bedId, options.isNested);
  const outcome = await options.execute(context, persist);

  if (!isSuccessfulMedicalHandoffOutcome(outcome)) {
    deps.logUnexpectedOutcome(options.handlerName, outcome);
    return;
  }

  if (!options.audit) return;

  deps.logDebouncedEvent(
    'MEDICAL_HANDOFF_MODIFIED',
    'patient',
    options.bedId,
    options.audit.buildPayload(context, outcome.data),
    context.patient?.rut,
    context.recordDate,
    undefined,
    options.audit.debounceMs
  );
};
