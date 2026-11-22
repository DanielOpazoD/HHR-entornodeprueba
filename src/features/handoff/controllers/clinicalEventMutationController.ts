import type { PatientData } from '@/types/domain/patient';

import type { ClinicalEvent } from '@/types/domain/clinicalEvents';

export const buildAddedClinicalEvent = (
  event: Omit<ClinicalEvent, 'id' | 'createdAt'>,
  createId: () => string,
  nowIso: () => string
): ClinicalEvent => ({
  ...event,
  id: createId(),
  createdAt: nowIso(),
});

export const appendClinicalEvent = (
  patient: Pick<PatientData, 'clinicalEvents'>,
  event: ClinicalEvent
): ClinicalEvent[] => [...(patient.clinicalEvents || []), event];

export const updateClinicalEventList = (
  patient: Pick<PatientData, 'clinicalEvents'>,
  eventId: string,
  data: Partial<ClinicalEvent>
): ClinicalEvent[] =>
  (patient.clinicalEvents || []).map(event =>
    event.id === eventId ? { ...event, ...data } : event
  );

export const removeClinicalEventFromList = (
  patient: Pick<PatientData, 'clinicalEvents'>,
  eventId: string
): { nextEvents: ClinicalEvent[]; deletedEvent: ClinicalEvent | null } => {
  const deletedEvent = (patient.clinicalEvents || []).find(event => event.id === eventId) || null;

  return {
    nextEvents: (patient.clinicalEvents || []).filter(event => event.id !== eventId),
    deletedEvent,
  };
};
