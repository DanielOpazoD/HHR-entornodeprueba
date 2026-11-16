import { PatientStatus } from '@/domain/handoff/patientContracts';
import type { MedicalBadgeVariant } from '@/shared/ui/medicalBadgeContracts';

export const resolveHandoffStatusVariant = (
  status: PatientStatus | string | undefined
): MedicalBadgeVariant =>
  status === PatientStatus.GRAVE ? 'red' : status === PatientStatus.DE_CUIDADO ? 'orange' : 'green';

export const canToggleClinicalEvents = ({
  isSubRow,
  hasEvents,
  canEditEvents,
}: {
  isSubRow: boolean;
  hasEvents: boolean;
  canEditEvents: boolean;
}): boolean => !isSubRow && (canEditEvents || hasEvents);

export const shouldRenderClinicalEventsPanel = ({
  showEvents,
  canAdd,
  canUpdate,
  canDelete,
}: {
  showEvents: boolean;
  canAdd: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}): boolean => showEvents && canAdd && canUpdate && canDelete;

interface ClinicalEventsCellState {
  statusVariant: MedicalBadgeVariant;
  canToggleEvents: boolean;
  shouldRenderEventsPanel: boolean;
  showStatusBadge: boolean;
}

export const resolveClinicalEventsCellState = ({
  patientStatus,
  isSubRow,
  hasEvents,
  canAdd,
  canUpdate,
  canDelete,
  showEvents,
}: {
  patientStatus: PatientStatus | string | undefined;
  isSubRow: boolean;
  hasEvents: boolean;
  canAdd: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  showEvents: boolean;
}): ClinicalEventsCellState => {
  const canToggleEvents = canToggleClinicalEvents({
    isSubRow,
    hasEvents,
    canEditEvents: canAdd,
  });
  const shouldRenderEventsPanel = shouldRenderClinicalEventsPanel({
    showEvents,
    canAdd,
    canUpdate,
    canDelete,
  });

  return {
    statusVariant: resolveHandoffStatusVariant(patientStatus),
    canToggleEvents,
    shouldRenderEventsPanel,
    showStatusBadge: !showEvents,
  };
};
