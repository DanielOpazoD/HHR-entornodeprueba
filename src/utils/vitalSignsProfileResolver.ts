import type { VitalSignsProfile } from '@/constants/vitalSignsThresholds';

export const NEWBORN_MAX_COMPLETED_DAYS = 27;

interface VitalSignsProfileInput {
  age?: string;
  birthDate?: string;
  /** ISO day of the measurement; age must be evaluated in that historical context. */
  referenceDate?: string;
}

const parseCalendarDay = (value: string | undefined): number | null => {
  if (!value) return null;
  const text = value.trim().slice(0, 10);
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const cl = text.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  const match = iso ?? cl;
  if (!match) return null;
  const [year, month, day] = iso
    ? [Number(match[1]), Number(match[2]), Number(match[3])]
    : [Number(match[3]), Number(match[2]), Number(match[1])];
  const stamp = Date.UTC(year, month - 1, day);
  const date = new Date(stamp);
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? stamp
    : null;
};

const explicitAgeInDays = (age: string | undefined): number | null => {
  const match = (age ?? '').trim().match(/^(\d{1,5})\s*(?:d|día|días)$/i);
  return match ? Number(match[1]) : null;
};

const explicitAgeProfile = (age: string | undefined): VitalSignsProfile | null => {
  const text = (age ?? '').trim();

  // Rayen and manual census edits store completed years without a suffix for
  // most children and adults (for example, "5" or "52"). A bare zero is not
  // precise enough to distinguish a newborn from an older infant.
  const bareYears = text.match(/^(\d{1,3})$/);
  if (bareYears) {
    const completedYears = Number(bareYears[1]);
    return completedYears === 0 ? 'unknown' : profileForCompletedYears(completedYears);
  }

  const days = explicitAgeInDays(text);
  if (days != null) {
    if (days <= NEWBORN_MAX_COMPLETED_DAYS) return 'newborn';
    return profileForCompletedYears(Math.floor(days / 365.2425));
  }

  const months = text.match(/^(\d{1,4})\s*(?:m|mes|meses)(?:\b|$)/i);
  if (months) {
    const completedMonths = Number(months[1]);
    if (completedMonths === 0) return 'unknown';
    return profileForCompletedYears(Math.floor(completedMonths / 12));
  }

  const years = text.match(/^(\d{1,3})\s*(?:a|año|años)(?:\b|$)/i);
  if (!years) return null;
  const completedYears = Number(years[1]);
  return completedYears === 0 ? 'unknown' : profileForCompletedYears(completedYears);
};

const profileForCompletedYears = (years: number): VitalSignsProfile => {
  if (years < 1) return 'infant';
  if (years <= 4) return 'child_1_4';
  if (years <= 11) return 'child_5_11';
  if (years <= 17) return 'adolescent_12_17';
  return 'adult';
};

/** Resolve population strictly by age; bed id, bed mode and parent/subrow layout are ignored. */
export const resolveVitalSignsProfile = ({
  age,
  birthDate,
  referenceDate,
}: VitalSignsProfileInput): VitalSignsProfile => {
  const born = parseCalendarDay(birthDate);
  const reference = parseCalendarDay(referenceDate);
  if (born != null && reference != null) {
    const completedDays = Math.floor((reference - born) / 86_400_000);
    if (completedDays >= 0 && completedDays <= NEWBORN_MAX_COMPLETED_DAYS) return 'newborn';
    if (completedDays < 0) return 'unknown';

    const bornDate = new Date(born);
    const measuredAt = new Date(reference);
    let completedYears = measuredAt.getUTCFullYear() - bornDate.getUTCFullYear();
    const beforeBirthday =
      measuredAt.getUTCMonth() < bornDate.getUTCMonth() ||
      (measuredAt.getUTCMonth() === bornDate.getUTCMonth() &&
        measuredAt.getUTCDate() < bornDate.getUTCDate());
    if (beforeBirthday) completedYears -= 1;
    return profileForCompletedYears(completedYears);
  }
  return explicitAgeProfile(age) ?? 'unknown';
};
