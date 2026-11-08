import { classifyPatientMovementForRecord } from '@/application/patient-flow/clinicalEpisode';
import { normalizeDateOnly } from '@/utils/clinicalDayUtils';

interface ResolveIsNewAdmissionForRecordParams {
  recordDate: string;
  firstSeenDate?: string;
  admissionDate?: string;
  admissionTime?: string;
}

export const resolveIsNewAdmissionForRecord = ({
  recordDate,
  firstSeenDate,
  admissionDate,
  admissionTime,
}: ResolveIsNewAdmissionForRecordParams): boolean => {
  const isNewAdmission = classifyPatientMovementForRecord(recordDate, {
    firstSeenDate,
    admissionDate,
    admissionTime,
  }).isNewAdmission;

  if (isNewAdmission) {
    return true;
  }

  // A madrugada admission belongs to the previous clinical day, where it already shows as new;
  // nurses also expect it marked on the calendar day it happened.
  const normalizedRecordDate = normalizeDateOnly(recordDate);
  const normalizedAdmissionDate = normalizeDateOnly(admissionDate);
  return Boolean(normalizedRecordDate) && normalizedAdmissionDate === normalizedRecordDate;
};
