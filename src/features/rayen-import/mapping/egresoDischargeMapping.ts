/**
 * Maps a gestión de camas egreso record to an HHR discharge kind + status.
 *
 * gestión de camas is the only source that knows the discharge DESTINATION, so this is
 * where "alta a domicilio" vs "traslado" is decided. Rayen's exact destination field is
 * confirmed against a real response; we read every plausible field and classify by text,
 * so the mapping is robust to which field actually carries it.
 *
 * NOTE: the keyword lists below are the initial best-guess for Chilean discharge
 * destinations; confirm/extend them once a real egreso response is inspected.
 */

import type { DischargeKind } from './dischargeMapping';
import type { EgresoRecord } from '../contracts/egresoLookup';

export interface EgresoDischarge {
  kind: DischargeKind;
  status: 'Vivo' | 'Fallecido';
}

/** Fields that may carry the destination / discharge-type text (exact one is Rayen's). */
const TEXT_FIELDS: Array<keyof EgresoRecord> = [
  'dischargeDestination',
  'dischargeDestinationName',
  'destinationSystemName',
  'dischargeReasonName',
  'dischargeTypeName',
  'bedDestination',
  'destinationBed',
];

/** Fold accents, lowercase — so "Traslado" / "traslado" / "TRASLADÓ" all match. */
const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const collectText = (egreso: EgresoRecord): string =>
  TEXT_FIELDS.map(field => egreso[field])
    .filter((v): v is string => typeof v === 'string')
    .map(normalize)
    .join(' | ');

/** Transfer to another establishment/hospital. */
const TRASLADO = /traslad|deriv|otro establecimiento|otro hospital|referenc|derivac/;
/** CMA (ambulatory major surgery). */
const CMA = /cma|cirugia mayor ambulatoria|ambulatori/;

export const mapEgresoToDischarge = (egreso: EgresoRecord): EgresoDischarge => {
  const status: EgresoDischarge['status'] = egreso.isDead ? 'Fallecido' : 'Vivo';
  const text = collectText(egreso);
  if (CMA.test(text)) return { kind: 'cma', status };
  if (TRASLADO.test(text)) return { kind: 'traslado', status };
  // Everything else (domicilio / habitual / alta a domicilio / voluntaria / …) is an alta;
  // the alta subtype is applied at build time (buildDischarge defaults to Domicilio).
  return { kind: 'alta', status };
};
