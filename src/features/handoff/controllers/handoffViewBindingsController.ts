import type {
  HandoffClinicalEventActions,
  HandoffMedicalActions,
} from '@/features/handoff/components/handoffRowContracts';
import { resolveHandoffMedicalScreenState } from '@/application/handoff';
import type { MedicalHandoffCapabilities } from '@/features/handoff/controllers/medicalHandoffAccessController';
import type { Specialty } from '@/domain/handoff/patientContracts';
import type { ClinicalEvent } from '@/types/domain/clinicalEvents';
import type { BedDefinition } from '@/types/domain/beds';
import type { HandoffDailyRecordContract } from '@/domain/handoff/recordContracts';
import type { MedicalHandoffScope } from '@/types/medicalHandoff';

interface BuildHandoffMedicalActionsParams {
  capabilities: MedicalHandoffCapabilities;
  onCreatePrimaryEntry: (bedId: string, isNested: boolean) => void;
  onEntryNoteChange: (bedId: string, entryId: string, value: string, isNested: boolean) => void;
  onEntrySpecialtyChange: (
    bedId: string,
    entryId: string,
    specialty: string,
    isNested: boolean
  ) => void;
  onEntryAdd: (bedId: string, isNested: boolean) => void;
  onEntryDelete: (bedId: string, entryId: string, isNested: boolean) => void;
  onRefreshAsCurrent: (bedId: string, entryId: string, isNested: boolean) => void;
}

interface BuildHandoffClinicalEventActionsParams {
  canEditClinicalEvents: boolean;
  onAdd: (bedId: string, event: Omit<ClinicalEvent, 'id' | 'createdAt'>) => void;
  onUpdate: (bedId: string, eventId: string, data: Partial<ClinicalEvent>) => void;
  onDelete: (bedId: string, eventId: string) => void;
}

interface BuildHandoffActionBundlesParams extends BuildHandoffMedicalActionsParams {
  capabilities: MedicalHandoffCapabilities;
  onAdd: (bedId: string, event: Omit<ClinicalEvent, 'id' | 'createdAt'>) => void;
  onUpdate: (bedId: string, eventId: string, data: Partial<ClinicalEvent>) => void;
  onDelete: (bedId: string, eventId: string) => void;
}

interface ResolveHandoffMedicalBindingsParams {
  visibleBeds: BedDefinition[];
  record: HandoffDailyRecordContract | null;
  isMedical: boolean;
  medicalScope: MedicalHandoffScope;
  selectedMedicalSpecialty: Specialty | 'all';
  shouldShowPatient: (bedId: string) => boolean;
}

export const resolveEffectiveSelectedMedicalSpecialty = (
  selectedMedicalSpecialty: Specialty | 'all',
  availableMedicalSpecialties: Specialty[]
): Specialty | 'all' =>
  selectedMedicalSpecialty !== 'all' &&
  !availableMedicalSpecialties.includes(selectedMedicalSpecialty)
    ? 'all'
    : selectedMedicalSpecialty;

export const resolveHandoffMedicalBindings = ({
  visibleBeds,
  record,
  isMedical,
  medicalScope,
  selectedMedicalSpecialty,
  shouldShowPatient,
}: ResolveHandoffMedicalBindingsParams) => {
  const baseState = resolveHandoffMedicalScreenState({
    visibleBeds,
    record,
    isMedical,
    medicalScope,
    selectedMedicalSpecialty: 'all',
    shouldShowPatient,
  });

  const effectiveSelectedMedicalSpecialty = resolveEffectiveSelectedMedicalSpecialty(
    selectedMedicalSpecialty,
    baseState.medicalSpecialties
  );

  const specialtyState =
    effectiveSelectedMedicalSpecialty === 'all'
      ? baseState
      : resolveHandoffMedicalScreenState({
          visibleBeds,
          record,
          isMedical,
          medicalScope,
          selectedMedicalSpecialty: effectiveSelectedMedicalSpecialty,
          shouldShowPatient,
        });

  return {
    ...baseState,
    effectiveSelectedMedicalSpecialty,
    specialtyFilteredBeds: specialtyState.specialtyFilteredBeds,
    hasAnyVisiblePatients: specialtyState.hasAnyVisiblePatients,
  };
};

export const buildHandoffMedicalActions = ({
  capabilities,
  onCreatePrimaryEntry,
  onEntryNoteChange,
  onEntrySpecialtyChange,
  onEntryAdd,
  onEntryDelete,
  onRefreshAsCurrent,
}: BuildHandoffMedicalActionsParams): HandoffMedicalActions => ({
  onCreatePrimaryEntry: capabilities.canCreatePrimaryObservationEntry
    ? onCreatePrimaryEntry
    : undefined,
  onEntryNoteChange: capabilities.canEditObservationEntries ? onEntryNoteChange : undefined,
  onEntrySpecialtyChange: capabilities.canEditObservationEntrySpecialty
    ? onEntrySpecialtyChange
    : undefined,
  onEntryAdd: capabilities.canAddObservationEntries ? onEntryAdd : undefined,
  onEntryDelete: capabilities.canDeleteObservationEntries ? onEntryDelete : undefined,
  onRefreshAsCurrent: capabilities.canEditObservationEntries ? onRefreshAsCurrent : undefined,
});

export const buildHandoffClinicalEventActions = ({
  canEditClinicalEvents,
  onAdd,
  onUpdate,
  onDelete,
}: BuildHandoffClinicalEventActionsParams): HandoffClinicalEventActions => ({
  onAdd: canEditClinicalEvents ? onAdd : undefined,
  onUpdate: canEditClinicalEvents ? onUpdate : undefined,
  onDelete: canEditClinicalEvents ? onDelete : undefined,
});

export const buildHandoffActionBundles = ({
  capabilities,
  onCreatePrimaryEntry,
  onEntryNoteChange,
  onEntrySpecialtyChange,
  onEntryAdd,
  onEntryDelete,
  onRefreshAsCurrent,
  onAdd,
  onUpdate,
  onDelete,
}: BuildHandoffActionBundlesParams): {
  medicalActions: HandoffMedicalActions;
  clinicalEventActions: HandoffClinicalEventActions;
} => ({
  medicalActions: buildHandoffMedicalActions({
    capabilities,
    onCreatePrimaryEntry,
    onEntryNoteChange,
    onEntrySpecialtyChange,
    onEntryAdd,
    onEntryDelete,
    onRefreshAsCurrent,
  }),
  clinicalEventActions: buildHandoffClinicalEventActions({
    canEditClinicalEvents: capabilities.canEditClinicalEvents,
    onAdd,
    onUpdate,
    onDelete,
  }),
});
