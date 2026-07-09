/**
 * Resolves how a leaving Rayen patient should be discharged in HHR.
 *
 * HHR discharge kinds (see PLAN-SINCRONIZACION.md §2.4):
 *   - alta      → regular discharge (subtypes: Domicilio (Habitual) | Voluntaria | Fuga | Otra)
 *   - traslado  → transfer to another hospital
 *   - cma       → CMA (ambulatory major surgery) discharge → record.cma[]
 * Plus patient status Vivo | Fallecido.
 *
 * CMA is inferred from the Rayen source service (`isCma`), because Eloisa can only
 * classify a CMA discharge by admitting/discharging the patient in its virtual CMA service.
 */

import type { DischargeType } from '@/types/domain/movements';
import type { RayenEncounter } from '../contracts/rayenSnapshot';

export type DischargeKind = 'alta' | 'traslado' | 'cma';

export interface DischargeIntent {
  kind: DischargeKind;
  status: 'Vivo' | 'Fallecido';
  /** Sub-classification, only meaningful when `kind === 'alta'`. */
  dischargeType?: DischargeType;
}

export const resolveDischargeIntent = (
  encounter: RayenEncounter,
  isCma: boolean
): DischargeIntent => {
  const status: DischargeIntent['status'] = encounter.isDead ? 'Fallecido' : 'Vivo';

  if (isCma) {
    return { kind: 'cma', status };
  }

  // NOTE: Rayen does not (yet, in the mapped fields) expose a reliable transfer signal,
  // so a non-CMA discharge defaults to a regular "alta". Transfer detection is refined
  // once a real transfer case is available (see PLAN-SINCRONIZACION.md §12).
  return { kind: 'alta', status, dischargeType: 'Domicilio (Habitual)' };
};
