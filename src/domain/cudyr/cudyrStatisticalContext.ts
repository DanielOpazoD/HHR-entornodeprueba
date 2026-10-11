import type { NeonatalPlacementDecision } from '@/types/domain/neonatalPlacementDecision';
import { resolveCudyrEligibility } from './cudyrEligibility';
import { normalizeDateOnly, parseTimeMinutes } from '@/utils/clinicalDayUtils';
import { cudyrSourceInstant } from './cudyrPlacementTimeline';

/** Statistical grouping from the original HHR report. Independent of UPC and bed-type overrides. */
export type CudyrStatisticalGroup = 'media' | 'intermedia' | 'sin_grupo';
export type CudyrModality = 'hospitalizacion' | 'cuna' | 'cma' | 'uea' | 'desconocida';
export type CudyrEligibility = 'elegible' | 'no_elegible' | 'por_revisar';

export interface CudyrPlacement {
  bedId: string;
  neonatalPlacementDecision?: NeonatalPlacementDecision;
  sourceBedId?: string;
  bedName?: string;
  bedMode?: string;
  location?: string;
  section?: 'census' | 'crib' | 'discharges' | 'transfers' | 'cma';
  isClinicalCrib?: boolean;
  modality?: CudyrModality;
}

const fold = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();

export const cudyrStatisticalGroup = (bedId: string): CudyrStatisticalGroup => {
  const id = fold(bedId).replace(/\s/g, '');
  if (/^R[1-4]$/.test(id)) return 'intermedia';
  if (/^(?:NEO[12]|H[1-6]C[12])$/.test(id)) return 'media';
  return 'sin_grupo';
};

/** All explicitly labelled CMA modalities are excluded, including operating/recovery locations. */
export const cudyrModality = (placement: CudyrPlacement): CudyrModality => {
  if (
    placement.isClinicalCrib ||
    placement.section === 'crib' ||
    fold(placement.bedMode ?? '') === 'CUNA'
  )
    return 'cuna';
  const labels = [placement.location, placement.bedName, placement.bedId, placement.sourceBedId]
    .filter(Boolean)
    .join(' / ');
  const normalized = fold(labels);
  if (
    placement.section === 'cma' ||
    /(?:^|[^A-Z])CMA/.test(normalized) ||
    normalized
      .split('/')
      .some(part => part.includes('QUIRURGICA INDIFERENCIADA') && !part.includes('MEDICO'))
  )
    return 'cma';
  if (
    /(?:^|[^A-Z])(?:B[1-3])?UEA(?:$|[^A-Z])/.test(normalized) ||
    [placement.bedId, placement.bedName, placement.sourceBedId, placement.location].some(value =>
      /^BOX[1-3]$/.test(fold(value || '').replace(/\s/g, ''))
    )
  )
    return 'uea';
  if (placement.modality) return placement.modality;
  if (cudyrStatisticalGroup(placement.bedId) !== 'sin_grupo') return 'hospitalizacion';
  return 'desconocida';
};

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
