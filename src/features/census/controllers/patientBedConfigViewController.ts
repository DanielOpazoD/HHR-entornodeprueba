import { calculateOperationalHospitalizedDays } from '@/utils/clinicalDayUtils';

interface CalculateHospitalizedDaysParams {
  admissionDate?: string;
  currentDate?: string;
}

export const calculateHospitalizedDays = ({
  admissionDate,
  currentDate,
}: CalculateHospitalizedDaysParams): number | null =>
  calculateOperationalHospitalizedDays(admissionDate, currentDate);
