import { calendarStampInClinicalTimeZone } from '@/utils/clinicalTimeZone';
import { cudyrModality, cudyrStatisticalGroup } from './cudyrStatisticalContext';
import { cudyrSourceInstant, type ObservedCudyrPlacement } from './cudyrPlacementTimeline';
import type { CudyrSourcePlacement } from '@/types/domain/cudyrPlacement';

export const sourceCudyrModality = (p: CudyrSourcePlacement) =>
  p.sourceVersion === 'eloisa-patient-flow-v1'
    ? p.modality
    : cudyrModality({
        bedId: p.bedId,
        sourceBedId: p.sourceBedId,
        bedName: p.sourceBedLabel,
        location: p.sourceDepartmentLabel,
        modality: p.modality,
      });

const unknown = () => ({
  at: '',
  source: 'Sin una primera asignación hospitalaria válida registrada en HHR para esta fecha.',
});

export interface CudyrCensusAdmission {
  date: string;
  time: string;
}

/** Demographic admission belongs to the selected daily census, never to another day's snapshot. */
const censusAdmission = (
  admission: CudyrCensusAdmission | undefined,
  reference: number
): { at: string; source: string } | null => {
  if (
    !admission ||
    !/^\d{4}-\d{2}-\d{2}$/.test(admission.date) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(admission.time)
  )
    return null;
  const nominal = cudyrSourceInstant(`${admission.date}T${admission.time}:00Z`);
  if (nominal === null) return null;
  const matches: string[] = [];
  for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) {
    const candidate = new Date(nominal + offset * 60_000);
    const stamp = calendarStampInClinicalTimeZone(candidate);
    if (stamp.iso === admission.date && stamp.hhmm === admission.time)
      matches.push(candidate.toISOString());
  }
  if (matches.length !== 1 || Date.parse(matches[0]) > reference) return null;
  return { at: matches[0], source: 'Censo HHR · ingreso registrado en Datos demográficos.' };
};

/** An assignment start proves entry into that service. Neither episode time nor a prior closure is required. */
export const resolveCudyrHospitalAdmission = (
  episode: string,
  history: ObservedCudyrPlacement[],
  referenceAt: string,
  forEligibility = false,
  census?: CudyrCensusAdmission
): { at: string; source: string } => {
  const reference = cudyrSourceInstant(referenceAt);
  if (!episode || reference === null) return unknown();
  const own = history.filter(x => x.placement.clinicalEpisodeId === episode);
  const annulled = new Set(
    own
      .filter(x => x.placement.isDeleted && x.placement.sourceMappingId)
      .map(x => x.placement.sourceMappingId)
  );
  const valid = own.filter(({ placement: p, observedAt }) => {
    const start = cudyrSourceInstant(p.sourceStartAt);
    const seen = cudyrSourceInstant(observedAt);
    return (
      !p.isDeleted &&
      !annulled.has(p.sourceMappingId) &&
      start !== null &&
      seen !== null &&
      start <= reference &&
      start <= seen
    );
  });
  // Different starts/locations for one assignment cannot identify an unambiguous first entry.
  if (
    valid.some(
      ({ placement: p }) =>
        p.sourceMappingId &&
        valid.some(
          ({ placement: other }) =>
            other.sourceMappingId === p.sourceMappingId &&
            (cudyrSourceInstant(other.sourceStartAt) !== cudyrSourceInstant(p.sourceStartAt) ||
              other.sourceBedId !== p.sourceBedId ||
              sourceCudyrModality(other) !== sourceCudyrModality(p))
        )
    )
  )
    return {
      at: '',
      source: 'Asignaciones con fechas o camas contradictorias; ingreso por confirmar.',
    };
  if (
    forEligibility &&
    valid.some(
      ({ placement: p }) =>
        p.sourceEndAt &&
        !/^0001-01-01T00:00:00(?:\.0+)?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(p.sourceEndAt) &&
        cudyrSourceInstant(p.sourceEndAt) === null
    )
  )
    return {
      at: '',
      source: 'Hora de salida de cama inválida; permanencia hospitalaria por confirmar.',
    };
  if (
    forEligibility &&
    valid.some(({ placement: p, observedAt }) => {
      const end = cudyrSourceInstant(p.sourceEndAt);
      if (end === null || !p.sourceMappingId) return false;
      return (
        end <= Date.parse(p.sourceStartAt) ||
        valid.some(
          other =>
            other.placement.sourceMappingId === p.sourceMappingId &&
            cudyrSourceInstant(other.placement.sourceEndAt) !== end &&
            (cudyrSourceInstant(other.placement.sourceEndAt) !== null ||
              Date.parse(other.observedAt) >= Date.parse(observedAt))
        )
      );
    })
  )
    return {
      at: '',
      source: 'Cierres de camas contradictorios; permanencia hospitalaria por confirmar.',
    };
  const events = [
    ...new Map(
      [...valid]
        .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt))
        .map(x => [
          JSON.stringify([
            x.placement.sourceMappingId,
            x.placement.sourceBedId,
            x.placement.sourceStartAt,
          ]),
          x.placement,
        ])
    ).values(),
  ].sort((a, b) => Date.parse(a.sourceStartAt) - Date.parse(b.sourceStartAt));
  // Service entry and CUDYR eligibility are different: a newborn can enter the
  // Hospitalizados service in a crib without becoming eligible for CUDYR.
  const first = events.find(p => {
    if (sourceCudyrModality(p) === 'hospitalizacion') return true;
    if (forEligibility || sourceCudyrModality(p) !== 'cuna') return false;
    const cribLocation = cudyrModality({
      bedId: p.bedId,
      sourceBedId: p.sourceBedId,
      bedName: p.sourceBedLabel,
      location: p.sourceDepartmentLabel,
      modality: 'cuna',
    });
    return (
      cribLocation === 'cuna' &&
      (cudyrStatisticalGroup(p.bedId) !== 'sin_grupo' ||
        /Hospitalizados/i.test(p.sourceDepartmentLabel) ||
        /^C(?:H[1-6]C[12]|R[1-4]|NEO[12])$/i.test(p.sourceBedLabel.replace(/\s/g, '')))
    );
  });
  if (!first) {
    // A later capture must not hide an older daily admission. Existing past movements,
    // invalid timestamps, closures or excluded services must not be overridden by this fallback.
    const hasPriorOrInvalidMovement = own.some(({ placement: p }) => {
      const start = cudyrSourceInstant(p.sourceStartAt);
      return start === null || start <= reference;
    });
    return (!hasPriorOrInvalidMovement && censusAdmission(census, reference)) || unknown();
  }
  if (!forEligibility)
    return {
      at: first.sourceStartAt,
      source:
        sourceCudyrModality(first) === 'cuna'
          ? 'Eloísa · primera entrada registrada en cuna de Hospitalizados. La elegibilidad CUDYR se evalúa por separado.'
          : first.sourceVersion === 'eloisa-patient-flow-v1'
            ? 'Eloísa · Flujo del Paciente · primera entrada registrada a Hospitalizados.'
            : 'Eloísa · primera asignación registrada a una cama de Hospitalizados.',
    };

  // Internal bed changes do not reset entry, including source intervals without a closing timestamp.
  // Explicit excluded locations or a documented gap start a new stay for the eight-hour calculation.
  let start: CudyrSourcePlacement | undefined;
  let previous: CudyrSourcePlacement | undefined;
  // A second-granularity PDF entry can duplicate a native assignment. Keep the native
  // interval (including its documented closure), rather than replacing it with an open row.
  const stayEvents = events.filter(
    event =>
      event.sourceVersion !== 'eloisa-patient-flow-v1' ||
      !events.some(
        native =>
          native.sourceVersion !== 'eloisa-patient-flow-v1' &&
          native.bedId === event.bedId &&
          sourceCudyrModality(native) === sourceCudyrModality(event) &&
          Math.floor(Date.parse(native.sourceStartAt) / 1000) ===
            Math.floor(Date.parse(event.sourceStartAt) / 1000)
      )
  );
  for (const event of stayEvents) {
    if (sourceCudyrModality(event) !== 'hospitalizacion') {
      start = undefined;
      previous = undefined;
      continue;
    }
    const previousEnd = previous ? cudyrSourceInstant(previous.sourceEndAt) : null;
    if (!start || (previousEnd !== null && previousEnd < Date.parse(event.sourceStartAt)))
      start = event;
    previous = event;
  }
  const finalEnd = previous ? cudyrSourceInstant(previous.sourceEndAt) : null;
  if (!start || (finalEnd !== null && finalEnd < reference)) return unknown();
  return {
    at: start.sourceStartAt,
    source: 'Eloísa · inicio registrado del tramo hospitalario para el cálculo de ocho horas.',
  };
};
