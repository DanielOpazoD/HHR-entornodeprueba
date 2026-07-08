import { classifyPatientMovementForRecord } from '@/application/patient-flow/clinicalEpisode';
import { normalizeDateOnly, resolveClinicalDayForDateTime } from '@/utils/clinicalDayUtils';

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

  const normalizedRecordDate = normalizeDateOnly(recordDate);
  const normalizedAdmissionDate = normalizeDateOnly(admissionDate);
  const normalizedFirstSeenDate = normalizeDateOnly(firstSeenDate);

  if (
    !normalizedRecordDate ||
    !normalizedAdmissionDate ||
    !admissionTime ||
    !normalizedFirstSeenDate
  ) {
    return false;
  }

  if (normalizedFirstSeenDate >= normalizedAdmissionDate) {
    return false;
  }

  const clinicalAdmissionDate = resolveClinicalDayForDateTime(
    normalizedAdmissionDate,
    admissionTime
  );

  return (
    clinicalAdmissionDate === normalizedRecordDate &&
    normalizedAdmissionDate === normalizedRecordDate
  );
};
