import type { CudyrSourcePlacement } from '@/types/domain/cudyrPlacement';
import { calendarStampInClinicalTimeZone } from '@/utils/clinicalTimeZone';
import { normalizeRut } from '@/utils/rutUtils';
import { isCmaBedLabel, mapRayenBed } from './bedMapping';
import { parsePatientFlowTimeline, patientRunFromFlowReport } from './parsePatientFlow';

export const CUDYR_PATIENT_FLOW_SOURCE = 'eloisa-patient-flow-v1';

/** PDF clocks are local to Rapa Nui. Reject nonexistent/ambiguous DST times. */
const flowInstant = (local: string): string => {
  const candidates = ['-05:00', '-06:00']
    .map(offset => local + offset)
    .filter(value => {
      const stamp = calendarStampInClinicalTimeZone(new Date(value));
      return `${stamp.iso}T${stamp.hhmm}` === local.slice(0, 16);
    });
  if (candidates.length !== 1) throw new Error('Hora de movimiento ambigua.');
  return candidates[0];
};

/** Preserve complete episode evidence, never confuse Urgencias/CMA with a hospital entry. */
export const cudyrPlacementsFromPatientFlow = (
  text: string,
  episode: string,
  rut: string,
  observedAt: string
): CudyrSourcePlacement[] => {
  if (
    !/^\d+$/.test(episode) ||
    !normalizeRut(rut) ||
    patientRunFromFlowReport(text) !== normalizeRut(rut)
  )
    throw new Error('El informe no corresponde al paciente del episodio solicitado.');
  const rows = parsePatientFlowTimeline(text);
  if (!rows.length) throw new Error('Historial de camas incompleto.');
  const unique = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const prior = unique.get(row.changedAt);
    if (
      prior &&
      (prior.sourceLocation !== row.sourceLocation ||
        prior.bedId !== row.bedId ||
        prior.sourceBedLabel !== row.sourceBedLabel)
    )
      throw new Error('Movimientos simultáneos contradictorios.');
    unique.set(row.changedAt, row);
  }
  return [...unique.values()].map(row => {
    const sourceStartAt = flowInstant(row.changedAt);
    if (
      !Number.isFinite(Date.parse(observedAt)) ||
      Date.parse(sourceStartAt) > Date.parse(observedAt)
    )
      throw new Error('Movimiento posterior a la consulta.');
    const bed = mapRayenBed({ bed: row.bedId || row.sourceBedLabel, service: row.sourceLocation });
    const excluded = /\b(?:UEA|URGENCIA|URGENCIAS|CMA|CUNA)\b/i.test(row.sourceLocation);
    const modality =
      bed.isCma || isCmaBedLabel(row.sourceBedLabel) || /\bCMA\b/i.test(row.sourceLocation)
        ? 'cma'
        : bed.isClinicalCrib || /\bCUNA\b/i.test(row.sourceLocation)
          ? 'cuna'
          : !excluded &&
              row.bedId &&
              !row.bedId.startsWith('BOX') &&
              /Hospitalizados/i.test(row.sourceLocation)
            ? 'hospitalizacion'
            : 'desconocida';
    if (row.sourceLocation.length > 300) throw new Error('Descriptor de cama demasiado extenso.');
    return {
      clinicalEpisodeId: episode,
      // Explicitly a PDF row key, never masquerades as Gestión de Camas' mapping ID.
      sourceMappingId: `flow:${episode}:${row.changedAt}`,
      sourceBedId: `flow:${row.sourceBedLabel}`,
      sourceBedLabel: row.sourceBedLabel,
      sourceDepartmentId: '',
      sourceDepartmentLabel: row.sourceLocation,
      sourceVersion: CUDYR_PATIENT_FLOW_SOURCE,
      sourceStartAt,
      // The PDF gives entries, not explicit closures or proof of current occupancy.
      sourceEndAt: '',
      currentAssignment: false,
      isDeleted: false,
      bedId: row.bedId || '',
      modality,
    };
  });
};
