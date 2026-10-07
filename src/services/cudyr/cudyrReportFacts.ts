import type { DailyRecordCudyrExportState } from '@/services/contracts/dailyRecordServiceContracts';
import type { PatientData } from '@/types/domain/patient';
import type { CudyrHistoryObservation } from '@/types/domain/cudyrHistory';
import type { CudyrCaptureReceipt } from '@/types/domain/cudyrCapture';
import type { CudyrReportMovement } from '@/types/domain/cudyrReport';
import { cudyrModality, type CudyrPlacement } from '@/domain/cudyr/cudyrStatisticalContext';

type Context = CudyrHistoryObservation['captureContexts'][number];
type ReportPatient = Omit<Partial<PatientData>, 'documentType' | 'specialty' | 'bedMode'> & {
  documentType?: string;
  specialty?: string;
  bedMode?: string;
};
export interface CudyrReportFact {
  date: string;
  authorityDate: string;
  key: string;
  patient: ReportPatient;
  placement: CudyrPlacement;
  identitySource: string;
  identitySourceDate: string;
  contextIsDaily: boolean;
  movement?: CudyrReportMovement;
  archivedEpicrisis?: Pick<
    Context,
    'medicalEpicrisisStatus' | 'nursingEpicrisisStatus' | 'epicrisisRegisteredAt'
  >;
}
const episodeKey = (date: string, episode: string | undefined, fallback: string) =>
  `${date}:${episode ? 'episode:' + episode : 'legacy:' + fallback}`;
const epicrisis = (patient: Pick<ReportPatient, 'dischargeVerification' | 'clinicalEpisodeId'>) => {
  const verification = patient.dischargeVerification;
  return verification?.encounterId === patient.clinicalEpisodeId ? verification : undefined;
};
export const collectCudyrDailyFacts = (record: DailyRecordCudyrExportState): CudyrReportFact[] => {
  const facts: CudyrReportFact[] = [];
  const add = (
    patient: Partial<PatientData> | undefined,
    placement: CudyrPlacement,
    id: string,
    movement?: CudyrReportMovement
  ) => {
    if (!patient || (!patient.patientName?.trim() && !patient.clinicalEpisodeId)) return;
    facts.push({
      date: record.date,
      authorityDate: record.date,
      key: episodeKey(record.date, patient.clinicalEpisodeId, id),
      patient,
      placement,
      identitySource: 'Censo HHR del día',
      identitySourceDate: record.date,
      contextIsDaily: true,
      movement,
    });
  };
  for (const [bedId, patient] of Object.entries(record.beds)) {
    add(patient, { ...patient, bedId, section: 'census' }, bedId);
    add(patient.clinicalCrib, { ...patient.clinicalCrib, bedId, section: 'crib' }, bedId + ':crib');
  }
  for (const section of ['discharges', 'transfers', 'cma'] as const) {
    for (const movement of record[section] ?? []) {
      if (movement.deletedAt) continue;
      const episode = movement.clinicalEpisodeId || movement.originalData?.clinicalEpisodeId;
      const original =
        movement.originalData?.clinicalEpisodeId &&
        movement.originalData.clinicalEpisodeId !== episode
          ? undefined
          : movement.originalData;
      const patient: Partial<PatientData> = {
        ...original,
        clinicalEpisodeId: episode,
        patientName: movement.patientName,
        rut: movement.rut,
        pathology: movement.diagnosis,
        bedName: movement.bedName,
        admissionDate:
          'admissionDate' in movement
            ? movement.admissionDate || original?.admissionDate
            : original?.admissionDate,
        specialty: movement.specialty || original?.specialty,
      };
      const bedId =
        ('bedId' in movement ? movement.bedId : movement.originalBedId) || original?.bedId || '';
      const placement: CudyrPlacement = {
        ...patient,
        bedId,
        section,
        isClinicalCrib: 'isNested' in movement && movement.isNested,
      };
      const verified = epicrisis(patient);
      add(patient, placement, section + ':' + movement.id, {
        clinicalEpisodeId: episode || '',
        censusDate: record.date,
        id: movement.id,
        section,
        bedId,
        bedName: movement.bedName,
        service: original?.location || '',
        modality: cudyrModality(placement),
        date: 'movementDate' in movement ? movement.movementDate || '' : '',
        time: 'time' in movement ? movement.time : movement.dischargeTime || '',
        recordedAt: movement.movementProvenance?.classifiedAt || '',
        source: movement.movementProvenance?.source || 'HHR · procedencia no documentada',
        lineageId: movement.movementProvenance?.lineageId || '',
        medicalEpicrisisStatus: verified?.medicalEpicrisis || '',
        nursingEpicrisisStatus: verified?.nursingEpicrisis || '',
        epicrisisRegisteredAt: verified?.registeredAt || '',
      });
    }
  }
  return facts;
};

/** Archived identity is labelled with its capture day; it is never presented as a past-day diagnosis. */
export const collectCudyrArchiveFacts = (
  observations: CudyrHistoryObservation[],
  captures: CudyrCaptureReceipt[]
): CudyrReportFact[] => {
  const facts: CudyrReportFact[] = [];
  const add = (
    date: string,
    authorityDate: string,
    id: string,
    episode: string,
    contexts: Context[]
  ) => {
    for (const context of contexts) {
      // An archived source event cannot establish a patient-day without its exact episode.
      // Raw versions/receipts remain in the dataset and workbook for review.
      if (!episode || context.clinicalEpisodeId !== episode) continue;
      const movement = ['discharges', 'transfers', 'cma'].includes(context.section)
        ? {
            clinicalEpisodeId: context.clinicalEpisodeId,
            censusDate: authorityDate,
            id: context.movementId || id,
            section: context.section,
            bedId: context.bedId,
            bedName: context.bedName || '',
            service: context.location || '',
            modality: cudyrModality(context),
            date: context.movementDate || '',
            time: context.movementTime || '',
            recordedAt: context.movementRecordedAt || '',
            source: context.movementSource || '',
            lineageId: context.movementLineageId || '',
            medicalEpicrisisStatus: context.medicalEpicrisisStatus || '',
            nursingEpicrisisStatus: context.nursingEpicrisisStatus || '',
            epicrisisRegisteredAt: context.epicrisisRegisteredAt || '',
          }
        : undefined;
      facts.push({
        date,
        authorityDate,
        key: episodeKey(date, context.clinicalEpisodeId, id),
        patient: { ...context },
        archivedEpicrisis: context,
        placement: context,
        identitySource: 'Archivo HHR de captura Eloísa',
        identitySourceDate: authorityDate,
        contextIsDaily: date === authorityDate,
        movement,
      });
    }
  };
  observations.forEach(item =>
    add(
      item.censusDate,
      item.captureCensusDate,
      item.id,
      item.evaluation.clinicalEpisodeId,
      item.captureContexts
    )
  );
  captures.forEach(item =>
    add(
      item.censusDate,
      item.censusDate,
      item.id,
      item.capture.clinicalEpisodeId,
      item.captureContexts
    )
  );
  return facts;
};

export const cudyrFactEpicrisis = epicrisis;
