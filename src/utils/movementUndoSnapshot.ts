/**
 * Snapshot del paciente que viaja dentro de un movimiento (egreso, traslado,
 * CMA) para poder deshacerlo. Excluye `clinicalSyncCheckpoint`: es un caché
 * operacional del incremental de Eloísa (medido: ~25 KB en un día con dos
 * egresos, casi la mitad del snapshot) que la siguiente sincronización
 * reconstruye sola tras un undo. Los datos clínicos visibles (historiales de
 * signos vitales y escalas, dispositivos) SÍ se conservan: pueden contener
 * registros manuales que un undo debe restaurar con fidelidad.
 */
export const buildMovementUndoSnapshot = <T extends { clinicalSyncCheckpoint?: unknown }>(
  patient: T
): T => {
  const cloned = structuredClone(patient);
  delete cloned.clinicalSyncCheckpoint;
  return cloned;
};
