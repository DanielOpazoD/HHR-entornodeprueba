export interface BackupImportSummary {
  success: number;
  failed: number;
  repaired: number;
  outcome: 'clean' | 'repaired' | 'partial' | 'blocked';
  /** Restored split days whose per-episode clinical data did not come back. */
  clinicalDerivedIncompleteDates?: string[];
}

const describeClinicalDerivedIncomplete = (dates: string[] = []): string =>
  dates.length === 0
    ? ''
    : ' No se restauraron los datos clínicos por episodio (historial de signos vitales y punto ' +
      `de sincronización de Rayen) de ${dates.length} ${dates.length === 1 ? 'día' : 'días'} ` +
      `(${dates.join(', ')}).`;

export const summarizeBackupImportOutcome = (result: BackupImportSummary): string => {
  if (result.outcome === 'clean') {
    return `Se han restaurado ${result.success} registros correctamente.`;
  }
  if (result.outcome === 'repaired') {
    return `Se restauraron ${result.success} registros. ${result.repaired} requirieron reparación automática.`;
  }
  if (result.outcome === 'partial') {
    return (
      `Se restauraron ${result.success} registros, ${result.failed} fallaron y ${result.repaired} requirieron reparación.` +
      describeClinicalDerivedIncomplete(result.clinicalDerivedIncompleteDates)
    );
  }
  return 'No fue posible restaurar registros desde el respaldo.';
};
