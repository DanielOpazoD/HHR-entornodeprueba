export const isWithinDayShift = (time?: string): boolean => {
  if (!time || time.length < 5) return true;

  const [hourPart = '', minutePart = ''] = time.trim().split(':');
  const hour = parseInt(hourPart, 10);
  const minute = parseInt(minutePart, 10);

  if (isNaN(hour) || isNaN(minute)) return true;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return true;

  const timeMinutes = hour * 60 + minute;
  const dayStartMinutes = 8 * 60;
  const dayEndMinutes = 20 * 60;

  return timeMinutes >= dayStartMinutes && timeMinutes < dayEndMinutes;
};
