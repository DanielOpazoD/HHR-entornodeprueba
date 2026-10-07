import type { Workbook } from 'exceljs';
import type { CudyrReportDataset } from '@/types/domain/cudyrReport';
import type { CudyrHistoryObservation } from '@/types/domain/cudyrHistory';
import { addCudyrDataSheet } from './cudyrDataSheet';

type Context = CudyrHistoryObservation['captureContexts'][number];
const fields: Array<[keyof Context, string]> = [
  ['clinicalEpisodeId', 'Episodio del contexto'],
  ['patientName', 'Nombre completo'],
  ['firstName', 'Nombres'],
  ['lastName', 'Primer apellido'],
  ['secondLastName', 'Segundo apellido'],
  ['rut', 'RUT o documento'],
  ['documentType', 'Tipo documento'],
  ['pathology', 'Diagnóstico'],
  ['cie10Code', 'CIE-10'],
  ['admissionDate', 'Fecha ingreso'],
  ['admissionTime', 'Hora ingreso'],
  ['section', 'Sección HHR'],
  ['bedId', 'Cama ID'],
  ['bedName', 'Cama nombre'],
  ['bedMode', 'Modalidad informada'],
  ['location', 'Servicio'],
  ['specialty', 'Especialidad'],
  ['movementId', 'Movimiento ID'],
  ['movementDate', 'Fecha egreso'],
  ['movementTime', 'Hora egreso'],
  ['movementRecordedAt', 'Egreso registrado ISO'],
  ['movementSource', 'Fuente egreso'],
  ['movementRunId', 'Ejecución egreso'],
  ['movementLineageId', 'Linaje egreso'],
  ['medicalEpicrisisStatus', 'Epicrisis médica'],
  ['nursingEpicrisisStatus', 'Epicrisis enfermería'],
  ['epicrisisRegisteredAt', 'Epicrisis registrada ISO'],
];

/** Exact source snapshots, including unlinked contexts; these rows are never patient-day counts. */
export const addCudyrReportContextTable = (workbook: Workbook, data: CudyrReportDataset) => {
  const rows = (kind: string, id: string, episode: string, date: string, contexts: Context[]) =>
    contexts.map(context => [kind, id, episode, date, ...fields.map(([key]) => context[key])]);
  addCudyrDataSheet(
    workbook,
    'Contextos capturados',
    [
      'Origen',
      'Observación o recibo ID',
      'Episodio de origen',
      'Fecha censo de captura',
      ...fields.map(([, label]) => label),
    ],
    [
      ...data.observations.flatMap(item =>
        rows(
          'Evaluación',
          item.id,
          item.evaluation.clinicalEpisodeId,
          item.captureCensusDate,
          item.captureContexts
        )
      ),
      ...data.captures.flatMap(item =>
        rows(
          'Captura',
          item.id,
          item.capture.clinicalEpisodeId,
          item.censusDate,
          item.captureContexts
        )
      ),
    ]
  );
};
