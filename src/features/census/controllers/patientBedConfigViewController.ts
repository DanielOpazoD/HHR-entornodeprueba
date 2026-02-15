interface CalculateHospitalizedDaysParams {
  admissionDate?: string;
  currentDate?: string;
}

export const calculateHospitalizedDays = ({
  admissionDate,
  currentDate,
}: CalculateHospitalizedDaysParams): number | null => {
  if (!admissionDate || !currentDate) {
    return null;
  }

  // Noon is used to avoid timezone drift around midnight when parsing YYYY-MM-DD.
  const start = new Date(`${admissionDate}T12:00:00`);
  const end = new Date(`${currentDate}T12:00:00`);
  const diff = end.getTime() - start.getTime();
  // Round to absorb DST offsets (23h/25h days).
  const days = Math.round(diff / (1000 * 3600 * 24));

  return days >= 0 ? days : 0;
};
