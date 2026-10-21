import type { RayenSyncStructuralIssueReason } from '@/types/domain/rayenSync';

export const explainRayenStructuralIssue = (reason: RayenSyncStructuralIssueReason) => {
  if (reason === 'admission-date-policy') {
    return {
      title: 'Fecha de ingreso protegida',
      meaning:
        'La validación detectó una fecha de ingreso distinta para un episodio ya registrado.',
      action:
        'Comprueba el episodio, la cama y ambas fechas indicadas en el detalle antes de reintentar.',
    };
  }
  if (reason === 'structural-write-rejected') {
    return {
      title: 'Guardado del censo no confirmado',
      meaning: 'El intento se detuvo al guardar los cambios del censo; la fase clínica no comenzó.',
      action:
        'Revisa la categoría técnica del detalle. Si se repite, copia el informe de sincronización.',
    };
  }
  if (
    ['occupied-local-bed', 'principal-bed-collision', 'cma-physical-bed-collision'].includes(reason)
  ) {
    return {
      title: 'Conflicto de ubicación',
      meaning: 'Las fuentes no coinciden sobre quién ocupa esta cama.',
      action:
        'Revisa si alguno de los pacientes cambió de cama o servicio en Gestión de Camas y vuelve a sincronizar.',
    };
  }
  if (
    ['unverified-report-row', 'episode-less-report-row', 'report-predates-admission'].includes(
      reason
    )
  ) {
    return {
      title: 'Alta sin vinculación confirmada',
      meaning:
        'El alta del informe no pudo asociarse con seguridad a la hospitalización de este paciente.',
      action:
        'Comprueba el episodio y las fechas de ingreso y alta en Gestión de Camas; luego vuelve a sincronizar.',
    };
  }
  if (reason === 'previous-census-continuity' || reason === 'crib-conflict-blocks-discharge') {
    return {
      title: 'Movimiento del paciente pendiente de confirmar',
      meaning:
        'Falta evidencia para determinar si el paciente continúa hospitalizado, se trasladó o egresó.',
      action:
        'Revisa su último movimiento en Gestión de Camas. Si es un RN, verifica también su cuna y el episodio propio.',
    };
  }
  if (
    [
      'historical-reconstruction',
      'historical-admission-evidence',
      'unconfirmed-principal-bed',
    ].includes(reason)
  ) {
    return {
      title: 'Ubicación o episodio sin confirmar',
      meaning:
        'No se pudo confirmar la hospitalización o la cama que correspondía al cierre del turno solicitado.',
      action:
        'Revisa el informe de movimientos del paciente y sus fechas en Gestión de Camas; después vuelve a sincronizar ese día.',
    };
  }
  return {
    title: 'Cambio del censo no confirmado',
    meaning:
      'Este intento no pudo confirmar un cambio. La categoría registrada no permite precisar más.',
    action:
      'Vuelve a revisar el censo. Si se repite, copia el informe de sincronización para investigar el caso.',
  };
};
