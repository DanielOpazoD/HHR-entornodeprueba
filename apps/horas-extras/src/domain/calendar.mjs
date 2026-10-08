// Explicit national calendar snapshot. Review new exceptional/local holidays before production.
// Laws and review scope are recorded in calendar-sources.md.
export const YEARS = [2026, 2027];
export const MONTHS = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];
const dates = {
  2026: [
    '01-01',
    '04-03',
    '04-04',
    '05-01',
    '05-21',
    '06-21',
    '06-29',
    '07-16',
    '08-15',
    '09-18',
    '09-19',
    '10-12',
    '10-31',
    '11-01',
    '12-08',
    '12-25',
  ],
  2027: [
    '01-01',
    '03-26',
    '03-27',
    '05-01',
    '05-21',
    '06-21',
    '06-28',
    '07-16',
    '08-15',
    '09-17',
    '09-18',
    '09-19',
    '10-11',
    '10-31',
    '11-01',
    '12-08',
    '12-25',
  ],
};
export const HOLIDAYS = new Set([
  ...Object.entries(dates).flatMap(([year, days]) => days.map(day => `${year}-${day}`)),
  '2028-01-01',
]);
export function periodInfo(period) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period) || !YEARS.includes(Number(period.slice(0, 4))))
    throw new Error('Selecciona un año y mes del calendario disponible.');
  const [year, month] = period.split('-').map(Number);
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    year,
    month,
    count,
    first: `${period}-01`,
    last: `${period}-${count}`,
    offset: (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7,
    label: `${MONTHS[month - 1]} ${year}`,
  };
}
