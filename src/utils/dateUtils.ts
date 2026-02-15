/**
 * Date Formatting Utilities
 * Pure functions for date manipulation and formatting.
 */

/**
 * Converts an ISO date string (YYYY-MM-DD) to Chilean format (DD-MM-YYYY).
 *
 * @param isoDate - The string to format, expected to be "YYYY-MM-DD".
 * @returns The formatted date "DD-MM-YYYY", or '-' if the input is falsy,
 *          or the original string if it doesn't match the expected format.
 *
 * @example
 * formatDateDDMMYYYY('2024-12-31') // '31-12-2024'
 * formatDateDDMMYYYY('') // '-'
 */
export const formatDateDDMMYYYY = (isoDate?: string): string => {
  if (!isoDate) return '-';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}-${parts[1]}-${parts[0]}`;
};

/**
 * Returns today's date in local ISO format (YYYY-MM-DD).
 * Uses the local machine time but preserves semantic "calendar day" logic.
 *
 * @returns A string in "YYYY-MM-DD" format.
 */
export const getTodayISO = (): string => {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000; // Offset in ms
  const localISOTime = new Date(now.getTime() - offset).toISOString().split('T')[0];
  return localISOTime;
};

/**
 * Format date for display in UI (Spanish locale)
 * Example: "miércoles, 11 de diciembre de 2024"
 */
export const formatDateForDisplay = (date: Date): string => {
  return date.toLocaleDateString('es-CL', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

/**
 * Calculates the absolute number of calendar days between two ISO date strings.
 * Note: This function calculates strict difference (24h blocks).
 * For duration of stay where admission day = Day 1, use calculateHospitalizedDays.
 *
 * @param startDate - Initial date (YYYY-MM-DD)
 * @param endDate - Final date (YYYY-MM-DD)
 * @returns Number of days between dates (absolute value).
 *
 * @example
 * daysBetween('2024-01-01', '2024-01-02') // 1
 */
export const daysBetween = (startDate: string, endDate: string): number => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffTime = Math.abs(end.getTime() - start.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

/**
 * Formats a Date object to a string (HH:MM), rounded to the nearest minute block.
 * Primarily used to align form inputs with consistent time steps.
 *
 * @param date - The Date object to round (defaults to now).
 * @param stepMinutes - The granularity in minutes (e.g., 5, 15, 30).
 * @returns A string in "HH:MM" format.
 *
 * @example
 * // If current time is 14:32:15 and step is 5
 * getTimeRoundedToStep() // "14:30"
 */
export const getTimeRoundedToStep = (date: Date = new Date(), stepMinutes = 5): string => {
  const stepMs = stepMinutes * 60 * 1000;
  const roundedMs = Math.round(date.getTime() / stepMs) * stepMs;
  const roundedDate = new Date(roundedMs);
  return roundedDate.toTimeString().slice(0, 5);
};

/**
 * Checks if a YYYY-MM-DD string represents a date chronologically after today.
 *
 * @param dateString - Date to compare (YYYY-MM-DD)
 * @returns TRUE if the date is strictly after today according to local system time.
 */
export const isFutureDate = (dateString: string): boolean => {
  const today = getTodayISO();
  return dateString > today;
};

/**
 * Safe parser for ISO date strings.
 *
 * @param isoDate - The string to parse (YYYY-MM-DD or full ISO).
 * @returns A Date object if valid, or NULL if the string is empty or invalid.
 */
export const parseISODate = (isoDate?: string): Date | null => {
  if (!isoDate) return null;
  const date = new Date(isoDate);
  return isNaN(date.getTime()) ? null : date;
};

// ==========================================
// CONFIGURACIÓN DE FERIADOS (CHILE)
// ==========================================
// Lista de feriados para cálculo de horarios de turno.
// Formato: YYYY-MM-DD
// IMPORTANTE: Mantener actualizado este listado cada año.
export const CHILEAN_HOLIDAYS = [
  // 2024
  '2024-01-01', // Año Nuevo
  '2024-03-29', // Viernes Santo
  '2024-03-30', // Sábado Santo
  '2024-05-01', // Día del Trabajo
  '2024-05-21', // Glorias Navales
  '2024-06-09', // Elecciones Primarias (Irrenunciable)
  '2024-06-20', // Pueblos Indígenas
  '2024-06-29', // San Pedro y San Pablo
  '2024-07-16', // Virgen del Carmen
  '2024-08-15', // Asunción de la Virgen
  '2024-09-18', // Independencia Nacional
  '2024-09-19', // Día de las Glorias del Ejército
  '2024-09-20', // Feriado Adicional
  '2024-10-12', // Encuentro de Dos Mundos
  '2024-10-27', // Elecciones Municipales
  '2024-10-31', // Iglesias Evangélicas
  '2024-11-01', // Todos los Santos
  '2024-12-08', // Inmaculada Concepción
  '2024-12-25', // Navidad

  // 2025
  '2025-01-01', // Año Nuevo
  '2025-04-18', // Viernes Santo
  '2025-04-19', // Sábado Santo
  '2025-05-01', // Día del Trabajo
  '2025-05-21', // Glorias Navales
  '2025-06-20', // Pueblos Indígenas
  '2025-06-29', // San Pedro y San Pablo (se mueve al lunes 30)
  '2025-06-30', // San Pedro y San Pablo (movido)
  '2025-07-16', // Virgen del Carmen
  '2025-08-15', // Asunción de la Virgen
  '2025-09-18', // Independencia Nacional
  '2025-09-19', // Día de las Glorias del Ejército
  '2025-10-12', // Encuentro de Dos Mundos (se mueve al lunes 13)
  '2025-10-13', // Encuentro de Dos Mundos (movido)
  '2025-10-31', // Iglesias Evangélicas
  '2025-11-01', // Todos los Santos
  '2025-12-08', // Inmaculada Concepción
  '2025-12-25', // Navidad

  // 2026
  '2026-01-01', // Año Nuevo
  '2026-04-03', // Viernes Santo
  '2026-04-04', // Sábado Santo
  '2026-05-01', // Día del Trabajo
  '2026-05-21', // Glorias Navales
  '2026-06-20', // Pueblos Indígenas (sábado)
  '2026-06-29', // San Pedro y San Pablo
  '2026-07-16', // Virgen del Carmen
  '2026-08-15', // Asunción de la Virgen
  '2026-09-18', // Independencia Nacional
  '2026-09-19', // Día de las Glorias del Ejército
  '2026-10-12', // Encuentro de Dos Mundos
  '2026-10-31', // Iglesias Evangélicas
  '2026-11-01', // Todos los Santos (domingo)
  '2026-11-02', // Todos los Santos (movido al lunes)
  '2026-12-08', // Inmaculada Concepción
  '2026-12-25', // Navidad

  // 2027
  '2027-01-01', // Año Nuevo
  '2027-03-26', // Viernes Santo
  '2027-03-27', // Sábado Santo
  '2027-05-01', // Día del Trabajo (sábado)
  '2027-05-21', // Glorias Navales
  '2027-06-20', // Pueblos Indígenas (domingo)
  '2027-06-21', // Pueblos Indígenas (movido al lunes)
  '2027-06-28', // San Pedro y San Pablo (movido al lunes)
  '2027-07-16', // Virgen del Carmen
  '2027-08-15', // Asunción de la Virgen (domingo)
  '2027-08-16', // Asunción de la Virgen (movido al lunes)
  '2027-09-18', // Independencia Nacional (sábado)
  '2027-09-19', // Día de las Glorias del Ejército (domingo)
  '2027-09-20', // Feriado adicional (lunes)
  '2027-10-11', // Encuentro de Dos Mundos (movido al lunes)
  '2027-10-31', // Iglesias Evangélicas (domingo)
  '2027-11-01', // Todos los Santos
  '2027-12-08', // Inmaculada Concepción
  '2027-12-25', // Navidad (sábado)

  // 2028
  '2028-01-01', // Año Nuevo (sábado)
  '2028-04-14', // Viernes Santo
  '2028-04-15', // Sábado Santo
  '2028-05-01', // Día del Trabajo
  '2028-05-21', // Glorias Navales (domingo)
  '2028-05-22', // Glorias Navales (movido al lunes)
  '2028-06-20', // Pueblos Indígenas
  '2028-06-29', // San Pedro y San Pablo
  '2028-07-16', // Virgen del Carmen (domingo)
  '2028-07-17', // Virgen del Carmen (movido al lunes)
  '2028-08-15', // Asunción de la Virgen
  '2028-09-18', // Independencia Nacional
  '2028-09-19', // Día de las Glorias del Ejército
  '2028-10-12', // Encuentro de Dos Mundos
  '2028-10-31', // Iglesias Evangélicas
  '2028-11-01', // Todos los Santos
  '2028-12-08', // Inmaculada Concepción
  '2028-12-25', // Navidad
];

/**
 * Validates if a date is a standard Chilean Business Day.
 * Takes into account both weekends (Saturday/Sunday) and the CHILEAN_HOLIDAYS list.
 *
 * @param dateString - The date to check in "YYYY-MM-DD" format.
 * @returns TRUE if it is Mon-Fri and NOT a holiday. FALSE otherwise.
 *
 * @important Uses midday (T12:00:00) instantiation to prevent timezone offsets
 * from shifting the day count during calculation.
 */
export const isBusinessDay = (dateString: string): boolean => {
  // 1. Check Holiday List
  if (CHILEAN_HOLIDAYS.includes(dateString)) {
    return false; // Es feriado -> No es día hábil
  }

  // 2. Check Weekend
  // Note: new Date('YYYY-MM-DD') creates a UTC date.
  // We want local semantic date. A safe way is to append T12:00:00 to avoid timezone shifts affecting the day
  const date = new Date(`${dateString}T12:00:00`);
  const day = date.getDay(); // 0 = Sunday, 6 = Saturday

  if (day === 0 || day === 6) {
    return false; // Fin de semana -> No es día hábil
  }

  return true; // Lunes-Viernes y no feriado
};

/**
 * Get the next calendar day from a given date string
 */
const getNextDay = (dateString: string): string => {
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() + 1);
  return date.toISOString().split('T')[0];
};

export interface ShiftSchedule {
  dayStart: string;
  dayEnd: string;
  nightStart: string;
  nightEnd: string;
  description: string;
}

/**
 * Determines the specific start and end hours for medical/nursing shifts.
 * Shift durations change depending on whether today and tomorrow are business days.
 *
 * - **Day Shift Start**: 08:00 (Business) or 09:00 (Weekend/Holiday)
 * - **Night Shift End**: 08:00 (If tomorrow is Business) or 09:00 (If tomorrow is Weekend/Holiday)
 *
 * @param dateString - The reference date (YYYY-MM-DD) to calculate shift boundaries for.
 * @returns A structure containing shift hours and a human-readable description.
 *
 * @example
 * // If Friday (Busines) -> Saturday (Holiday)
 * getShiftSchedule('2024-03-29') // { dayStart: "08:00", nightEnd: "09:00", ... }
 */
export const getShiftSchedule = (dateString: string): ShiftSchedule => {
  const todayIsBusinessDay = isBusinessDay(dateString);
  const nextDay = getNextDay(dateString);
  const tomorrowIsBusinessDay = isBusinessDay(nextDay);

  // Horario de INICIO del turno largo (basado en HOY)
  const dayStart = todayIsBusinessDay ? '08:00' : '09:00';

  // El turno largo siempre termina a las 20:00
  const dayEnd = '20:00';

  // El turno noche siempre empieza a las 20:00
  const nightStart = '20:00';

  // Horario de FIN del turno noche (basado en MAÑANA)
  const nightEnd = tomorrowIsBusinessDay ? '08:00' : '09:00';

  // Descripción para UI
  let description = todayIsBusinessDay ? 'Día Hábil' : 'Fin de Semana / Feriado';
  if (todayIsBusinessDay !== tomorrowIsBusinessDay) {
    description += tomorrowIsBusinessDay ? ' → Día Hábil' : ' → No Hábil';
  }

  return {
    dayStart,
    dayEnd,
    nightStart,
    nightEnd,
    description,
  };
};

// ==========================================
// SHIFT FILTERING UTILITIES
// ==========================================

/**
 * Shift boundaries in 24h format
 */
export const DAY_SHIFT_START = '08:00';
export const DAY_SHIFT_END = '20:00';
export const NIGHT_SHIFT_START = '20:00';
export const NIGHT_SHIFT_END = '08:00';

/**
 * Check if a time string (HH:MM) falls within the day shift (08:00 - 20:00).
 *
 * @param time - Time in HH:MM format
 * @returns true if time is between 08:00 (inclusive) and 20:00 (exclusive)
 *
 * @example
 * isWithinDayShift('10:00') // true
 * isWithinDayShift('22:00') // false
 * isWithinDayShift('08:00') // true
 * isWithinDayShift('20:00') // false (start of night shift)
 * isWithinDayShift('03:00') // false (night/madrugada)
 */
export const isWithinDayShift = (time?: string): boolean => {
  if (!time || time.length < 5) return true; // Default to day if no time

  const timeMinutes = parseTimeMinutes(time);
  if (timeMinutes === null) return true;
  const dayStartMinutes = 8 * 60; // 08:00
  const dayEndMinutes = 20 * 60; // 20:00

  return timeMinutes >= dayStartMinutes && timeMinutes < dayEndMinutes;
};

/**
 * Normalizes YYYY-MM-DD-like values that may arrive as full ISO strings.
 * Examples:
 * - "2026-02-15" -> "2026-02-15"
 * - "2026-02-15T00:00:00.000Z" -> "2026-02-15"
 */
const normalizeDateOnly = (value?: string): string | undefined => {
  if (!value) return undefined;
  return value.split('T')[0];
};

/**
 * Parses HH:MM-like values into minutes. Returns null if missing/invalid.
 */
const parseTimeMinutes = (value?: string): number | null => {
  if (!value) return null;

  const [hourPart = '', minutePart = ''] = value.trim().split(':');
  const hour = parseInt(hourPart, 10);
  const minute = parseInt(minutePart, 10);

  if (isNaN(hour) || isNaN(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  return hour * 60 + minute;
};

/**
 * Determines if a patient record should be visible within a specific shift's handoff view.
 *
 * ## Behavioral Logic:
 * The "census" record represents a specific date, but the shifts within that date can
 * technically span across calendar boundaries, especially the Night Shift.
 *
 * ### 1. Day Shift (08:00 - 20:00):
 * - Only shows patients admitted on the **same calendar date** as the record.
 * - Admittance time must be **before 20:00**.
 *
 * ### 2. Night Shift (20:00 - 08:00 next day):
 * - Shows all patients admitted on the **record date** (since they remained there overnight).
 * - Exceptionally shows patients admitted on the **next calendar date** but **before 08:00**
 *   (e.g., an admission at 03:00 AM is part of the previous night's shift).
 *
 * @param recordDate - The anchor date of the Daily Record (YYYY-MM-DD).
 * @param admissionDate - The patient's actual admission date (YYYY-MM-DD).
 * @param admissionTime - The patient's actual admission time (HH:MM).
 * @param shift - The current viewing context ('day' or 'night').
 * @returns TRUE if the patient was present during that specific shift interval.
 *
 * @example
 * // Record: Jan 3rd. Night Shift covers Jan 3rd 20:00 to Jan 4th 08:00.
 * isAdmittedDuringShift('2026-01-03', '2026-01-04', '04:30', 'night') // TRUE
 * isAdmittedDuringShift('2026-01-03', '2026-01-04', '04:30', 'day')   // FALSE
 */
export const isAdmittedDuringShift = (
  recordDate: string,
  admissionDate?: string,
  admissionTime?: string,
  shift: 'day' | 'night' = 'day'
): boolean => {
  const normalizedRecordDate = normalizeDateOnly(recordDate);
  const normalizedAdmissionDate = normalizeDateOnly(admissionDate);

  // If no admission date, assume patient was already there (show in both shifts)
  if (!normalizedAdmissionDate || !normalizedRecordDate) return true;

  // If patient was admitted on a previous date, they're in both shifts
  if (normalizedAdmissionDate < normalizedRecordDate) return true;

  // If admission time is missing/invalid, keep null and apply shift-specific fallback.
  const admissionTimeMinutes = parseTimeMinutes(admissionTime);

  // Day shift cutoff: 20:00 (1200 minutes)
  const dayEndMinutes = 20 * 60;
  // Night shift end depends on schedule (08:00 or 09:00 according to calendar/holidays).
  const schedule = getShiftSchedule(normalizedRecordDate);
  const nightEndMinutes = parseTimeMinutes(schedule.nightEnd) ?? 8 * 60;

  // Calculate next day from record date
  const nextDay = getNextDay(normalizedRecordDate);

  if (shift === 'day') {
    // Day shift shows patients admitted on record date BEFORE 20:00
    if (normalizedAdmissionDate === normalizedRecordDate) {
      if (admissionTimeMinutes === null) return true;
      return admissionTimeMinutes < dayEndMinutes;
    }
    // Patients admitted after record date don't appear in day shift
    return false;
  } else {
    // Night shift (20:00 recordDate -> 08:00 nextDay)

    // 1. Patient admitted on record date: show if admitted before end of night shift
    //    (they were there during the night)
    if (normalizedAdmissionDate === normalizedRecordDate) {
      return true; // All patients admitted on record date are visible at night
    }

    // 2. Patient admitted on next day: show only if before night-end (madrugada).
    // If admission time is missing, prefer visibility to avoid hiding a potentially valid night admission.
    if (normalizedAdmissionDate === nextDay) {
      if (admissionTimeMinutes === null) return true;
      return admissionTimeMinutes < nightEndMinutes;
    }

    // Patients admitted on other dates don't appear
    return false;
  }
};

/**
 * Calculates the number of days a patient has been hospitalized (Estadía).
 *
 * ## Behavioral Rules:
 * 1. The day of admission counts as **Day 1**.
 * 2. Uses pure UTC calculation at mid-day (12:00:00) to neutralize Daylight Saving Time (DST)
 *    transitions and local machine timezone offsets.
 * 3. Minimum result is 1 (if admission and current day are the same).
 *
 * @param admissionDate - Patient's admission date (YYYY-MM-DD or ISO string)
 * @param currentDate - Comparison date (usually today, YYYY-MM-DD)
 * @returns Number of days (integer), or null if inputs are invalid.
 *
 * @example
 * calculateHospitalizedDays('2024-01-01', '2024-01-01') // 1
 * calculateHospitalizedDays('2024-01-01', '2024-01-02') // 2
 */
export const calculateHospitalizedDays = (
  admissionDate?: string,
  currentDate?: string
): number | null => {
  if (!admissionDate || !currentDate) return null;

  try {
    // Ensure we only have the date portion if a full ISO string is provided
    const cleanAdmission = admissionDate.split('T')[0];
    const cleanCurrent = currentDate.split('T')[0];

    const [aYear, aMonth, aDay] = cleanAdmission.split('-').map(Number);
    const [cYear, cMonth, cDay] = cleanCurrent.split('-').map(Number);

    // Use UTC at mid-day (12:00:00) to be 100% safe from DST and local time quirks
    const start = Date.UTC(aYear, aMonth - 1, aDay, 12, 0, 0);
    const end = Date.UTC(cYear, cMonth - 1, cDay, 12, 0, 0);

    const diffTime = end - start;
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1;

    return diffDays < 1 ? 1 : diffDays;
  } catch (_e) {
    return null;
  }
};

/**
 * Returns the number of days in a specific month of a year.
 */
export const getDaysInMonth = (year: number, month: number): number => {
  return new Date(year, month, 0).getDate();
};

/**
 * Generates an array of ISO date strings (YYYY-MM-DD) for every day of a month.
 * Optionally limits the range to today if the month/year is current.
 */
export const generateDateRange = (
  year: number,
  month: number,
  limitToToday: boolean = false
): string[] => {
  const days = getDaysInMonth(year, month);
  const range: string[] = [];
  const monthStr = String(month).padStart(2, '0');
  const today = getTodayISO();

  for (let day = 1; day <= days; day++) {
    const dayStr = String(day).padStart(2, '0');
    const dateStr = `${year}-${monthStr}-${dayStr}`;

    if (limitToToday && dateStr > today) {
      break;
    }

    range.push(dateStr);
  }

  return range;
};
