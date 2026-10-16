import { resolveCudyrEligibility } from './cudyrEligibility';
import { normalizeDateOnly, parseTimeMinutes } from '@/utils/clinicalDayUtils';
import { cudyrSourceInstant } from './cudyrPlacementTimeline';

import { cudyrModality, cudyrStatisticalGroup } from './cudyrModality';
import type { CudyrModality, CudyrPlacement, CudyrStatisticalGroup } from './cudyrModality';
export { cudyrModality, cudyrStatisticalGroup } from './cudyrModality';
export type { CudyrModality, CudyrPlacement, CudyrStatisticalGroup } from './cudyrModality';
export type CudyrEligibility = 'elegible' | 'no_elegible' | 'por_revisar';

export interface CudyrDailyEligibilityInput {
  date: string;
  patientName?: string;
  admissionDate?: string;
  admissionTime?: string;
  isBlocked?: boolean;
  placements: CudyrPlacement[];
  /** A change affecting modality or group with no reliable effective time in this day. */
  unresolvedTransition?: boolean;
}

export interface CudyrDailyEligibility {
  eligibility: CudyrEligibility;
  modality: CudyrModality;
  group: CudyrStatisticalGroup;
  reason: string;
}

/** Resolve a single episode/day; never infer neonatal exclusion from age or current-day location. */
export const resolveCudyrDailyEligibility = (
  input: CudyrDailyEligibilityInput
): CudyrDailyEligibility => {
  const modalities = new Set(input.placements.map(cudyrModality));
  const groups = new Set(input.placements.map(placement => cudyrStatisticalGroup(placement.bedId)));
  const modality = modalities.size === 1 ? [...modalities][0] : 'desconocida';
  const group = groups.size === 1 ? [...groups][0] : 'sin_grupo';
  const result = (eligibility: CudyrEligibility, reason: string): CudyrDailyEligibility => ({
    eligibility,
    modality,
    group,
    reason,
  });
  if (input.unresolvedTransition)
    return result('por_revisar', 'Cambio de modalidad sin hora efectiva comprobada.');
  if (modality === 'cuna') return result('no_elegible', 'Cuna: exclusión diaria CUDYR.');
  if (modality === 'uea') return result('no_elegible', 'UEA: cama de Urgencias excluida de CUDYR.');
  if (modality === 'cma') return result('no_elegible', 'CMA: excluida en todas sus modalidades.');
  if (modalities.size !== 1 || groups.size !== 1)
    return result('por_revisar', 'Cambio de cama o modalidad sin vigencia diaria resuelta.');
  if (modality === 'desconocida' || group === 'sin_grupo')
    return result('por_revisar', 'Cama o modalidad sin clasificación estadística confirmada.');
  if (input.isBlocked) return result('por_revisar', 'Paciente presente en cama bloqueada.');
  const date = normalizeDateOnly(input.date);
  const admission = normalizeDateOnly(input.admissionDate);
  if (
    !date ||
    !admission ||
    !input.patientName?.trim() ||
    cudyrSourceInstant(`${date}T00:00:00Z`) === null ||
    cudyrSourceInstant(`${admission}T00:00:00Z`) === null
  )
    return result('por_revisar', 'Falta identidad o fecha válida de ingreso/censo.');
  if (date === admission && parseTimeMinutes(input.admissionTime) === null)
    return result('por_revisar', 'Falta hora válida de ingreso para comprobar las 8 horas.');
  const eligible = resolveCudyrEligibility({ ...input, recordDate: date });
  return eligible.isEligible
    ? result('elegible', 'Cumple la regla HHR de ingreso al corte de 01:00 del día siguiente.')
    : result('no_elegible', eligible.blockedReason || 'Fuera de la regla de ingreso HHR.');
};
