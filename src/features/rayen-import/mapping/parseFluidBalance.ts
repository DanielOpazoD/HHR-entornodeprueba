import type { FluidBalancePeriod, PatientFluidBalance } from '@/types/domain/fluidBalance';
import { addCalendarDays, calendarDayAtUtcNoon } from '@/utils/clinicalDateUtils';
import { calendarStampInClinicalTimeZone } from '@/utils/clinicalTimeZone';
import { removeAccents } from '@/utils/stringUtils';

/*
 * Eloísa's balance periods, fixed whatever the day: 08:00–19:59 and 20:00–07:59 (docs/DOMAIN_RULES.md,
 * fluid balance). They are not the handoff shift, which starts at 09:00 on weekends and holidays.
 */
// clinical-clock-allow shift-start-literal: Eloísa's balance day starts at 08:00 every day, unlike the handoff shift.
const FLUID_BALANCE_DAY_START = '08:00';
// clinical-clock-allow shift-start-literal: Eloísa's balance night starts at 20:00 every day.
const FLUID_BALANCE_NIGHT_START = '20:00';

const emptyPeriod = (): FluidBalancePeriod => ({ intakeMl: 0, urineOutputMl: 0, records: 0 });
const invalid = (): never => {
  throw new Error('El balance de Eloísa contiene registros no verificables.');
};
const quantity = (value: unknown): number => {
  if (typeof value !== 'number' && typeof value !== 'string') return invalid();
  if (typeof value === 'string' && !value.trim()) return invalid();
  const parsed = Number(typeof value === 'string' ? value.replace(',', '.') : value);
  return Number.isFinite(parsed) ? parsed : invalid();
};
const normalizedName = (value: unknown): string =>
  removeAccents(String(value ?? ''))
    .trim()
    .toLowerCase();

/** Whole successful snapshot replaces totals, so corrections/deletions do not accumulate. */
export const parseFluidBalance = (entries: unknown[], censusDate: string): PatientFluidBalance => {
  // As lenient as before: an impossible day such as 2026-02-30 is not rejected here.
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(censusDate) ||
    !Number.isFinite(calendarDayAtUtcNoon(censusDate).getTime())
  )
    return invalid();
  const nextDay = addCalendarDays(censusDate, 1);
  const balance: PatientFluidBalance = { censusDate, day: emptyPeriod(), night: emptyPeriod() };
  const seen = new Map<string, string>();
  for (const raw of entries) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid();
    const entry = raw as Record<string, unknown>;
    if (entry.archived === true || entry.deleted === true || entry.deletedDateTime) continue;
    const type = entry.hydBalType;
    if (type !== 'IN' && type !== 'EG') return invalid();
    if (type === 'EG' && normalizedName(entry.hydBalName) !== 'diuresis') continue;
    // The empty inspected episode could not establish a timezone for naive regDatetime.
    // Reject ambiguous timestamps instead of silently assigning volumes to the wrong shift.
    const stamp = typeof entry.regDatetime === 'string' ? entry.regDatetime : '';
    if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(stamp)) return invalid();
    const date = new Date(stamp);
    if (!Number.isFinite(date.getTime())) return invalid();
    const { iso, hhmm } = calendarStampInClinicalTimeZone(date);
    const shift =
      iso === censusDate && hhmm >= FLUID_BALANCE_DAY_START
        ? hhmm < FLUID_BALANCE_NIGHT_START
          ? 'day'
          : 'night'
        : iso === nextDay && hhmm < FLUID_BALANCE_DAY_START
          ? 'night'
          : undefined;
    if (!shift) continue;
    const value = type === 'IN' ? quantity(entry.inputQuantity) : quantity(entry.outputQuantity);
    if (type === 'IN' && value < 0) return invalid();
    // Eloísa's own editor reverses outputQuantity's sign; display the measured volume.
    const amount = type === 'IN' ? value : Math.abs(value);
    const identity = entry.id ?? entry.guid;
    if (typeof identity !== 'string' && typeof identity !== 'number') return invalid();
    const key = String(identity);
    const content = JSON.stringify([stamp, type, normalizedName(entry.hydBalName), amount]);
    if (seen.has(key)) {
      if (seen.get(key) !== content) return invalid();
      continue;
    }
    seen.set(key, content);
    balance[shift][type === 'IN' ? 'intakeMl' : 'urineOutputMl'] += amount;
    balance[shift].records++;
  }
  for (const period of [balance.day, balance.night]) {
    period.intakeMl = Math.round(period.intakeMl * 100) / 100;
    period.urineOutputMl = Math.round(period.urineOutputMl * 100) / 100;
  }
  return balance;
};
