export { normalizeDateOnly } from './clinicalDateUtils';
export {
  DEFAULT_SHIFT_SCHEDULE,
  getNextDay,
  getPreviousDay,
  getShiftSchedule,
  isBusinessDay,
  isWithinDayShift,
  NIGHT_SHIFT_START_MINUTES,
  parseTimeMinutes,
  resolveClinicalDayBounds,
} from './clinicalDayScheduleUtils';
export type { ClinicalDayBounds, ShiftSchedule } from './clinicalDayScheduleUtils';
export {
  getCurrentShift,
  isAdmittedDuringShift,
  isNewAdmissionForClinicalDay,
  resolveClinicalDayForDateTime,
  resolveCurrentClinicalDay,
} from './clinicalDayAdmissionUtils';
export {
  calculateDischargeStayDays,
  calculateHospitalizedDays,
  calculateOperationalHospitalizedDays,
} from './clinicalStayDayUtils';
