import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type { ReportEgreso } from '../contracts/egresoReport';
import { normalizeRut } from '@/utils/rutUtils';

type ConflictEntry = CensusImportDiff['conflicts'][number];
type DischargeEntry = CensusImportDiff['discharges'][number];

/**
 * Una fila del informe de Gestión de Camas que no pudo vincularse a un episodio
 * exacto (`code: 'unverified-report-row'`) deja de ser un conflicto cuando el
 * pipeline YA construyó el egreso de esa cama y ese RUN por otra vía (el lookup
 * exacto por episodio, que corre después de evaluar las filas del informe).
 *
 * Caso vivo (02-09, H5C1): Rayen registra al RN bajo el RUN de la madre, el
 * informe trae dos filas con el mismo RUN, la vinculación queda ambigua y la
 * corrida terminaba «Parcial» con un conflicto falso pese a aplicar el alta de
 * la madre con la cuna como alta asociada.
 *
 * La cuna se comprueba con el resultado REAL del adjunto (no con una
 * aproximación): si la cama tiene una cuna con ocupante, el egreso debe traer
 * `associatedClinicalCrib`; un traslado, un fallecimiento o una cuna que no
 * pudo adjuntarse (snapshot incompleto, episodio aún activo, movimiento previo)
 * conservan la revisión, porque el egreso del RN no quedaría registrado. La fila
 * del RN con RUN propio casa por el RUN de la cuna adjunta a ese mismo egreso.
 * Una cuna cerrada en Ficha (episodio aún listado) no se adjunta, pero sale por
 * `reportEgresos` con su episodio exacto: también cuenta como explicada.
 */
export const dropRedundantUnverifiedReportConflicts = (
  conflicts: ConflictEntry[],
  discharges: DischargeEntry[],
  record: DailyRecord,
  reportEgresos: ReportEgreso[] = []
): ConflictEntry[] =>
  conflicts.filter(conflict => {
    if (conflict.code !== 'unverified-report-row' || !conflict.bedId) return true;
    const run = normalizeRut(conflict.rut);
    if (!run) return true;
    const discharge = discharges.find(
      entry =>
        entry.bedId === conflict.bedId &&
        (normalizeRut(entry.rut) === run || normalizeRut(entry.associatedClinicalCrib?.rut) === run)
    );
    if (!discharge) return true;
    const crib = record.beds[conflict.bedId]?.clinicalCrib;
    const cribOccupied = Boolean(crib?.patientName?.trim());
    const cribEpisode = String(crib?.clinicalEpisodeId ?? '').trim();
    const cribExplained =
      Boolean(discharge.associatedClinicalCrib) ||
      (Boolean(cribEpisode) &&
        reportEgresos.some(egreso => String(egreso.encounterId ?? '').trim() === cribEpisode));
    return cribOccupied && !cribExplained;
  });
