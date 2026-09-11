/**
 * Test runners emulate the clinical staff's devices: mainland Chile clocks operating a hospital
 * that lives in Rapa Nui. Pinning the process and browser time zone keeps CI (UTC by default) and
 * every developer machine on the same footing, so the two-hour calendar gap between Santiago and
 * Pacific/Easter is exercised on every run instead of depending on where the tests happen to run.
 */
export const TEST_DEVICE_TIME_ZONE = 'America/Santiago';

export const pinTestTimeZone = (): string => {
  process.env.TZ ||= TEST_DEVICE_TIME_ZONE;
  return process.env.TZ;
};
