// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CLINICAL_DAY_UTILS_PATH = 'src/utils/clinicalDayUtils.ts';

describe('clinicalDayUtils entrypoint governance', () => {
  it('keeps clinicalDayUtils as a stable public entrypoint over focused clinical date modules', () => {
    const content = readFileSync(CLINICAL_DAY_UTILS_PATH, 'utf8');

    expect(content).toMatch(/from ['"]\.\/clinicalDayScheduleUtils['"]/);
    expect(content).toMatch(/from ['"]\.\/clinicalDayAdmissionUtils['"]/);
    expect(content).toMatch(/from ['"]\.\/clinicalStayDayUtils['"]/);
    expect(content).not.toMatch(/from ['"]\.\/chileanHolidays['"]/);
    expect(content).not.toMatch(/export const getShiftSchedule\s*=/);
    expect(content).not.toMatch(/export const isAdmittedDuringShift\s*=/);
    expect(content).not.toMatch(/export const calculateDischargeStayDays\s*=/);
  });
});
