export interface FileOperationNotification {
  channel: 'success' | 'warning' | 'error';
  title: string;
  message?: string;
}

export const buildExportJsonNotification = (
  outcome: 'success' | 'error'
): FileOperationNotification =>
  outcome === 'success'
    ? {
        channel: 'success',
        title: 'Datos exportados',
        message: 'Se generó el respaldo JSON correctamente.',
      }
    : {
        channel: 'error',
        title: 'Exportación fallida',
        message: 'No se pudo generar el respaldo JSON.',
      };

/** The file was written, but it is not complete (for example, split days it could not read). */
export const buildExportJsonPartialNotification = (
  message: string | undefined
): FileOperationNotification => ({
  channel: 'warning',
  title: 'Respaldo incompleto',
  message: message || 'El respaldo JSON se generó incompleto.',
});

export const buildExportCsvNotification = (
  outcome: 'success' | 'error'
): FileOperationNotification =>
  outcome === 'success'
    ? {
        channel: 'success',
        title: 'Datos exportados',
        message: 'Se generó el archivo CSV correctamente.',
      }
    : {
        channel: 'error',
        title: 'Exportación fallida',
        message: 'No se pudo generar el archivo CSV.',
      };

export const buildImportFileErrorNotification = (
  reason: 'invalid_format' | 'import_failed' | 'processing_failed'
): FileOperationNotification => {
  switch (reason) {
    case 'invalid_format':
      return {
        channel: 'error',
        title: 'Formato Inválido',
        message: 'Formato Inválido',
      };
    case 'processing_failed':
      return {
        channel: 'error',
        title: 'No se pudo procesar el archivo',
        message: 'No se pudo procesar el archivo seleccionado.',
      };
    default:
      return {
        channel: 'error',
        title: 'Importación fallida',
        message: 'No se pudieron importar los datos.',
      };
  }
};
