/*
 * Chile's legal holidays, which move the census day shift from 08:00 to 09:00
 * (`clinicalDayScheduleUtils`). The trusted extension keeps an identical copy
 * (`extension/clinical-day-runtime.js`). Every date follows the law:
 * - fixed: 1 Jan, Good Friday and Holy Saturday, 21 May, 15 Aug, 18 and 19 Sep, 1 Nov, 8 and 25 Dec
 *   (Ley 2.977); 1 May (Código del Trabajo); 16 Jul (Ley 20.148);
 * - Día Nacional de los Pueblos Indígenas: the day of the southern winter solstice (Ley 21.357);
 * - 29 Jun and 12 Oct: Tuesday to Thursday move to that week's Monday, Friday to the next Monday
 *   (Ley 19.668);
 * - 31 Oct: Tuesday moves to the previous Friday, Wednesday to that week's Friday (Ley 20.299);
 * - 17 Sep: Friday when 18 and 19 Sep fall on the weekend, and Monday 2 Jan when 1 Jan is a
 *   Sunday (Ley 20.983); Monday 17 or Friday 20 Sep when 18 and 19 Sep fall Tuesday–Wednesday or
 *   Wednesday–Thursday (Código del Trabajo, art. 35 ter);
 * - election days that include Isla de Pascua (Ley 18.700, art. 180), listed with their source in the
 *   test below.
 * `src/tests/utils/chileanHolidays.test.ts` derives each year from these rules; add a new year
 * there too.
 */
export const CHILEAN_HOLIDAYS = [
  // 2024
  '2024-01-01',
  '2024-03-29',
  '2024-03-30',
  '2024-05-01',
  '2024-05-21',
  '2024-06-20',
  '2024-06-29',
  '2024-07-16',
  '2024-08-15',
  '2024-09-18',
  '2024-09-19',
  '2024-09-20',
  '2024-10-12',
  '2024-10-27',
  '2024-10-31',
  '2024-11-01',
  '2024-11-24',
  '2024-12-08',
  '2024-12-25',

  // 2025
  '2025-01-01',
  '2025-04-18',
  '2025-04-19',
  '2025-05-01',
  '2025-05-21',
  '2025-06-20',
  '2025-06-29',
  '2025-07-16',
  '2025-08-15',
  '2025-09-18',
  '2025-09-19',
  '2025-10-12',
  '2025-10-31',
  '2025-11-01',
  '2025-11-16',
  '2025-12-08',
  '2025-12-14',
  '2025-12-25',

  // 2026
  '2026-01-01',
  '2026-04-03',
  '2026-04-04',
  '2026-05-01',
  '2026-05-21',
  '2026-06-21',
  '2026-06-29',
  '2026-07-16',
  '2026-08-15',
  '2026-09-18',
  '2026-09-19',
  '2026-10-12',
  '2026-10-31',
  '2026-11-01',
  '2026-12-08',
  '2026-12-25',

  // 2027
  '2027-01-01',
  '2027-03-26',
  '2027-03-27',
  '2027-05-01',
  '2027-05-21',
  '2027-06-21',
  '2027-06-28',
  '2027-07-16',
  '2027-08-15',
  '2027-09-17',
  '2027-09-18',
  '2027-09-19',
  '2027-10-11',
  '2027-10-31',
  '2027-11-01',
  '2027-12-08',
  '2027-12-25',

  // 2028
  '2028-01-01',
  '2028-04-14',
  '2028-04-15',
  '2028-05-01',
  '2028-05-21',
  '2028-06-20',
  '2028-06-26',
  '2028-07-16',
  '2028-08-15',
  '2028-09-18',
  '2028-09-19',
  '2028-10-09',
  '2028-10-27',
  '2028-10-29',
  '2028-11-01',
  '2028-12-08',
  '2028-12-25',
] as readonly string[];
