import type { HandoffClinicalEventActions } from '@/features/handoff/components/handoffRowContracts';
import type { ClinicalEvent } from '@/types/domain/clinicalEvents';

interface BuildHandoffClinicalEventActionsParams {
  canEditClinicalEvents: boolean;
  onAdd: (bedId: string, event: Omit<ClinicalEvent, 'id' | 'createdAt'>) => void;
  onUpdate: (bedId: string, eventId: string, data: Partial<ClinicalEvent>) => void;
  onDelete: (bedId: string, eventId: string) => void;
}

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
