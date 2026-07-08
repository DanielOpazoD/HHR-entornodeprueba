const normalizeIsoDate = value => {
  if (!value || typeof value !== 'string') return undefined;
  const datePart = value.split('T')[0].trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    return datePart;
  }

  if (/^\d{2}-\d{2}-\d{4}$/.test(datePart)) {
    const [day, month, year] = datePart.split('-');
    return `${year}-${month}-${day}`;
  }

  return undefined;
};

const calculateDischargeStayDays = (admissionDate, dischargeDate) => {
  const admission = normalizeIsoDate(admissionDate);
  const discharge = normalizeIsoDate(dischargeDate);
  if (!admission || !discharge) return null;

  const [aYear, aMonth, aDay] = admission.split('-').map(Number);
  const [dYear, dMonth, dDay] = discharge.split('-').map(Number);
  const start = Date.UTC(aYear, aMonth - 1, aDay, 12, 0, 0);
  const end = Date.UTC(dYear, dMonth - 1, dDay, 12, 0, 0);
  const diffDays = Math.round((end - start) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return null;
  return diffDays === 0 ? 1 : diffDays;
};

const buildStaySummary = durations => {
  if (!durations || durations.length === 0) {
    return { minimum: 0, maximum: 0 };
  }

  return {
    minimum: Math.min(...durations),
    maximum: Math.max(...durations),
  };
};

const sumStayDurations = durations =>
  (durations || []).reduce((total, duration) => total + duration, 0);

module.exports = {
  buildStaySummary,
  calculateDischargeStayDays,
  normalizeIsoDate,
  sumStayDurations,
};
