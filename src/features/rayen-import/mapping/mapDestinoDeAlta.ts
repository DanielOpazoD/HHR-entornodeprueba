/**
 * Maps the report's "Destino de Alta" (+ "Motivo de Alta") text to an HHR discharge kind and
 * patient status. The bulk report is the authoritative source of the destination (domicilio vs
 * traslado) that the gestión de camas JSON lookup did not expose. Text-based, accent-insensitive.
 */

import type { DischargeKind } from './dischargeMapping';

export interface DestinoDischarge {
  kind: DischargeKind;
  status: 'Vivo' | 'Fallecido';
}

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/** Transfer to another establishment/hospital. */
const TRASLADO = /traslad|deriv|otro establecimiento|otro hospital|referenc/;
/** CMA (ambulatory major surgery). */
const CMA = /cma|cirugia mayor ambulatoria|ambulatori/;
/** Death. */
const FALLECIDO = /fallec|defunc|obito|muert/;

export const mapDestinoDeAlta = (destino?: string, motivo?: string): DestinoDischarge => {
  const text = [destino, motivo]
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .map(normalize)
    .join(' | ');
  const status: DestinoDischarge['status'] = FALLECIDO.test(text) ? 'Fallecido' : 'Vivo';
  if (CMA.test(text)) return { kind: 'cma', status };
  if (TRASLADO.test(text)) return { kind: 'traslado', status };
  // Domicilio / habitual / voluntaria / … → regular alta.
  return { kind: 'alta', status };
};
