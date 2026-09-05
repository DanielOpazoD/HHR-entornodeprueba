import type { UpcChecklistRecord } from '@/domain/upc/upcContracts';
import { isUpcEligibleBedId } from './upcBedPolicy';

type UpcReviewSubject = {
  patientName?: string;
  upcChecklist?: UpcChecklistRecord;
  clinicalCrib?: UpcReviewSubject;
};

export const resolveUpcReviewReason = (
  checklist: UpcChecklistRecord | undefined,
  bedId: string,
  date: string
): string | null => {
  if (!isUpcEligibleBedId(bedId)) return null;
  if (
    checklist?.reviewRequired ||
    (checklist?.evaluatedBedId && checklist.evaluatedBedId !== bedId)
  ) {
    return 'Reevaluar UPC por cambio de cama';
  }
  if (
    !checklist?.evaluatedBedId ||
    !checklist.responsibleNurse?.name.trim() ||
    !checklist.evaluatedBy?.uid ||
    !Number.isFinite(Date.parse(checklist.evaluatedAt))
  ) {
    return 'Evaluación UPC pendiente';
  }
  return checklist.evaluatedForDate === date ? null : 'Evaluación UPC diaria pendiente';
};

export const assignedUpcNurses = (names: readonly string[] = []): string[] => [
  ...new Set(
    names.map(name => name.trim()).filter(name => name && name.toLowerCase() !== 'vacante')
  ),
];

/** Gate only the census day being sent, not previous sheets in the monthly workbook. */
export const resolveUpcEmailBlockReason = (
  record: { date: string; beds: Record<string, UpcReviewSubject> } | null,
  date: string
): string | null => {
  if (!record) return null;
  if (record.date !== date) return 'El censo cambió de fecha. Revisa el día antes de enviar.';
  const pending: string[] = [];
  for (const [bedId, patient] of Object.entries(record.beds)) {
    if (!isUpcEligibleBedId(bedId)) continue;
    if (patient.patientName?.trim() && resolveUpcReviewReason(patient.upcChecklist, bedId, date)) {
      pending.push(bedId);
    }
    if (
      patient.clinicalCrib?.patientName?.trim() &&
      resolveUpcReviewReason(patient.clinicalCrib.upcChecklist, bedId, date)
    ) {
      pending.push(`${bedId} (cuna clínica)`);
    }
  }
  return pending.length
    ? `Envío bloqueado: completa la evaluación UPC del día en ${pending.join(', ')}.`
    : null;
};
