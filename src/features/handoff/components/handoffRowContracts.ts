import type { ClinicalEvent } from '@/types/domain/clinicalEvents';

export interface HandoffClinicalEventActions {
  onAdd?: (bedId: string, event: Omit<ClinicalEvent, 'id' | 'createdAt'>) => void;
  onUpdate?: (bedId: string, eventId: string, data: Partial<ClinicalEvent>) => void;
  onDelete?: (bedId: string, eventId: string) => void;
}
