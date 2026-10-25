import type { JsonImportResult } from '@/services/exporters/exportImportJson';

type NotificationChannel = 'success' | 'warning' | 'error';

export interface ImportNotification {
  channel: NotificationChannel;
  title: string;
  message?: string;
}

export const buildJsonImportNotifications = (result: JsonImportResult): ImportNotification[] => {
  if (!result.success) {
    return [{ channel: 'error', title: 'Error al importar datos', message: 'Import Error' }];
  }

  const notifications: ImportNotification[] = [];
  if (result.outcome === 'clean') {
    notifications.push({
      channel: 'success',
      title: 'Datos importados correctamente',
      message: `${result.importedCount} registro(s) importado(s).`,
    });
  }

  if (result.outcome === 'repaired') {
    notifications.push({
      channel: 'success',
      title: 'Datos importados correctamente',
      message: `${result.importedCount} registro(s) importado(s).`,
    });
    notifications.push({
      channel: 'warning',
      title: 'Se corrigieron datos heredados',
      message: `${result.repairedCount} registro(s) fueron reparados automáticamente durante la importación.`,
    });
  }

  if (result.outcome === 'partial') {
    notifications.push({
      channel: 'warning',
      title: 'Importación completada con observaciones',
      message: `${result.importedCount} registro(s) importado(s), ${result.repairedCount} reparado(s) y ${result.skippedEntries.length} omitido(s).`,
    });
  }

  if (result.clinicalDerivedIncompleteDates?.length) {
    notifications.push({
      channel: 'warning',
      title: 'Faltan datos clínicos por episodio',
      message:
        'No se restauraron el historial de signos vitales ni el punto de sincronización de ' +
        `Rayen de: ${result.clinicalDerivedIncompleteDates.slice(0, 5).join(', ')}`,
    });
  }

  if (result.skippedEntries.length > 0) {
    notifications.push({
      channel: 'error',
      title: 'Algunos registros no se importaron',
      message: result.skippedEntries.slice(0, 5).join(', '),
    });
  }

  return notifications;
};
