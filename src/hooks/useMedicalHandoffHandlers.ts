import { useCallback, useMemo } from 'react';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';
import {
  executeAddMedicalEntry,
  executeCreateMedicalPrimaryEntry,
  executeDeleteMedicalEntry,
  executeRefreshMedicalEntryAsCurrent,
  executeUpdateMedicalEntryNote,
  executeUpdateMedicalEntrySpecialty,
  executeUpdateMedicalPrimaryNote,
} from '@/application/handoff';
import type { AuditAction } from '@/types/auditActionTypes';
import type { AuditLogEntry } from '@/types/auditLogTypes';
import type { MedicalHandoffAuditActor, PatientData } from '@/hooks/contracts/patientHookContracts';
import { canEditMedicalHandoffForDate } from '@/shared/access/operationalAccessPolicy';
import {
  buildEntryDeleteAuditPayload,
  buildEntryNoteChangeAuditPayload,
  buildEntryRefreshAuditPayload,
  buildPrimaryNoteChangeAuditPayload,
  createMedicalFieldsPersister,
  resolveMedicalHandoffMutationContext,
  resolveRefreshableMedicalEntry,
  shouldLogMedicalHandoffOutcome,
} from '@/hooks/controllers/medicalHandoffHandlersController';
import {
  runMedicalHandoffMutation,
  type MedicalHandoffMutationDeps,
} from '@/hooks/controllers/medicalHandoffMutationRunner';
import { medicalHandoffHandlersLogger } from './hookLoggers';

type MedicalPatientFields = Pick<
  PatientData,
  'medicalHandoffEntries' | 'medicalHandoffNote' | 'medicalHandoffAudit'
>;

interface UseMedicalHandoffHandlersParams {
  isMedical: boolean;
  record: { date: string; beds: Record<string, PatientData> } | null;
  role?: string;
  medicalAuditActor: MedicalHandoffAuditActor | null;
  persistMedicalFields: (
    bedId: string,
    fields: MedicalPatientFields,
    isNested: boolean
  ) => Promise<void>;
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

export const useMedicalHandoffHandlers = ({
  isMedical,
  record,
  role,
  medicalAuditActor,
  persistMedicalFields,
  logDebouncedEvent,
}: UseMedicalHandoffHandlersParams) => {
  const canMutateCurrentMedicalRecord = canEditMedicalHandoffForDate({
    role,
    readOnly: false,
    recordDate: record?.date,
  });

  const resolveMutationContext = useCallback(
    (bedId: string, isNested: boolean) =>
      resolveMedicalHandoffMutationContext({
        bedId,
        isNested,
        isMedical,
        canMutateCurrentMedicalRecord,
        record,
      }),
    [canMutateCurrentMedicalRecord, isMedical, record]
  );

  const logUnexpectedOutcome = useCallback(
    <T>(operation: string, outcome: ApplicationOutcome<T>) => {
      if (!shouldLogMedicalHandoffOutcome(outcome)) {
        return;
      }

      medicalHandoffHandlersLogger.error('Unexpected medical patient handoff outcome', {
        operation,
        outcome,
      });
    },
    []
  );

  const resolveFieldsPersister = useCallback(
    (bedId: string, isNested: boolean) =>
      createMedicalFieldsPersister(persistMedicalFields, bedId, isNested),
    [persistMedicalFields]
  );

  const runnerDeps = useMemo<MedicalHandoffMutationDeps>(
    () => ({
      resolveContext: resolveMutationContext,
      resolvePersister: resolveFieldsPersister,
      logUnexpectedOutcome,
      logDebouncedEvent,
    }),
    [resolveMutationContext, resolveFieldsPersister, logUnexpectedOutcome, logDebouncedEvent]
  );

  const handleMedicalPrimaryNoteChange = useCallback(
    (bedId: string, value: string, isNested: boolean = false) =>
      runMedicalHandoffMutation(runnerDeps, {
        bedId,
        isNested,
        handlerName: 'handleMedicalPrimaryNoteChange',
        execute: (context, persist) =>
          executeUpdateMedicalPrimaryNote({
            medicalAuditActor,
            patient: context.patient,
            persistMedicalFields: persist,
            recordDate: context.recordDate,
            value,
          }),
        audit: {
          debounceMs: 30000,
          buildPayload: (context, data) =>
            buildPrimaryNoteChangeAuditPayload({
              patient: context.patient,
              isNested,
              value,
              previousNote: data.previousEntry?.note || '',
            }),
        },
      }),
    [medicalAuditActor, runnerDeps]
  );

  const handleMedicalEntryNoteChange = useCallback(
    (bedId: string, entryId: string, value: string, isNested: boolean = false) =>
      runMedicalHandoffMutation(runnerDeps, {
        bedId,
        isNested,
        handlerName: 'handleMedicalEntryNoteChange',
        execute: (context, persist) =>
          executeUpdateMedicalEntryNote({
            entryId,
            medicalAuditActor,
            patient: context.patient,
            persistMedicalFields: persist,
            recordDate: context.recordDate,
            value,
          }),
        audit: {
          debounceMs: 30000,
          buildPayload: (context, data) =>
            buildEntryNoteChangeAuditPayload({
              patient: context.patient,
              specialty: data.entry?.specialty,
              value,
              previousNote: data.previousEntry?.note || '',
            }),
        },
      }),
    [medicalAuditActor, runnerDeps]
  );

  const handleMedicalEntrySpecialtyChange = useCallback(
    (bedId: string, entryId: string, specialty: string, isNested: boolean = false) =>
      runMedicalHandoffMutation(runnerDeps, {
        bedId,
        isNested,
        handlerName: 'handleMedicalEntrySpecialtyChange',
        execute: (context, persist) =>
          executeUpdateMedicalEntrySpecialty({
            entryId,
            patient: context.patient,
            persistMedicalFields: persist,
            specialty,
          }),
      }),
    [runnerDeps]
  );

  const handleMedicalEntryAdd = useCallback(
    (bedId: string, isNested: boolean = false) =>
      runMedicalHandoffMutation(runnerDeps, {
        bedId,
        isNested,
        handlerName: 'handleMedicalEntryAdd',
        execute: (context, persist) =>
          executeAddMedicalEntry({
            patient: context.patient,
            persistMedicalFields: persist,
          }),
      }),
    [runnerDeps]
  );

  const handleMedicalPrimaryEntryCreate = useCallback(
    (bedId: string, isNested: boolean = false) =>
      runMedicalHandoffMutation(runnerDeps, {
        bedId,
        isNested,
        handlerName: 'handleMedicalPrimaryEntryCreate',
        execute: (context, persist) =>
          executeCreateMedicalPrimaryEntry({
            patient: context.patient,
            persistMedicalFields: persist,
          }),
      }),
    [runnerDeps]
  );

  const handleMedicalEntryDelete = useCallback(
    (bedId: string, entryId: string, isNested: boolean = false) =>
      runMedicalHandoffMutation(runnerDeps, {
        bedId,
        isNested,
        handlerName: 'handleMedicalEntryDelete',
        execute: (context, persist) =>
          executeDeleteMedicalEntry({
            entryId,
            patient: context.patient,
            persistMedicalFields: persist,
          }),
        audit: {
          debounceMs: 10000,
          buildPayload: (context, data) =>
            buildEntryDeleteAuditPayload({
              patient: context.patient,
              specialty: data.entry?.specialty,
              previousNote: data.previousEntry?.note || '',
            }),
        },
      }),
    [runnerDeps]
  );

  const handleMedicalRefreshAsCurrent = useCallback(
    (bedId: string, entryId: string, isNested: boolean = false) => {
      const context = resolveMutationContext(bedId, isNested);
      if (!context) return;
      if (!resolveRefreshableMedicalEntry(context.patient, entryId)) return;

      void runMedicalHandoffMutation(runnerDeps, {
        bedId,
        isNested,
        handlerName: 'handleMedicalRefreshAsCurrent',
        execute: (ctx, persist) =>
          executeRefreshMedicalEntryAsCurrent({
            entryId,
            medicalAuditActor,
            patient: ctx.patient,
            persistMedicalFields: persist,
            recordDate: ctx.recordDate,
          }),
        audit: {
          debounceMs: 10000,
          buildPayload: (ctx, data) =>
            buildEntryRefreshAuditPayload({
              patient: ctx.patient,
              specialty: data.entry?.specialty,
              previousUpdatedAt: data.previousEntry?.updatedAt || '',
              newUpdatedAt: data.entry?.updatedAt || '',
            }),
        },
      });
    },
    [medicalAuditActor, resolveMutationContext, runnerDeps]
  );

  return {
    handleMedicalPrimaryEntryCreate,
    handleMedicalPrimaryNoteChange,
    handleMedicalEntryNoteChange,
    handleMedicalEntrySpecialtyChange,
    handleMedicalEntryAdd,
    handleMedicalEntryDelete,
    handleMedicalRefreshAsCurrent,
  };
};
