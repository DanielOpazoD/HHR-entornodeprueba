const HH_MM_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const isValidHourMinute = (value: string | undefined): boolean => {
  if (!value) {
    return false;
  }

  return HH_MM_REGEX.test(value.trim());
};

export const resolveValidHourMinuteOrFallback = (
  value: string | undefined,
  fallback: string
): string => {
  if (value && isValidHourMinute(value)) {
    return value.trim();
  }

  return fallback;
};
