// Barril liviano para la tabla del censo: solo los ayudantes que se usan por fila.
// La maquinaria de importación vive detrás de `index.ts` y se carga al usarla, así que
// el censo puede dibujarse sin descargarla.
export { useRayenFillStatus, useRayenFillProgress } from './hooks/useRayenFillStatus';
export type { RayenFillProgress } from './hooks/useRayenFillStatus';
export { mapRayenInvasiveDeviceEntries } from './mapping/mapDeviceToInstance';
export { mergeReportDevices } from './domain/mergeReportDevices';
export {
  requestRayenStatisticalDischargeReport,
  requestRayenHospitalizationDocument,
  requestRayenHospitalizationEpisodes,
} from './bridge/hospitalizationReportsBridge';
export type {
  RayenHospitalizationDocumentType,
  RayenHospitalizationEpisode,
} from './bridge/hospitalizationReportsBridge';
