import { describe, expect, it } from 'vitest';
import { parseAdmissionVitalSigns } from '@/features/rayen-import/mapping/parseAdmissionVitalSigns';

const form = {
  formCodigo: 'VITAL_SIGNS',
  createDateTime: '13-07-2026 08:02:00 -06:00',
  metaCampList: [
    { id: 'global_Pulso', value: '82' },
    { id: 'global_EscalaDolorEVA', value: '0' },
  ],
};
describe('admission vital source coverage', () => {
  it('keeps valid measurements and measured zero', () => {
    const result = parseAdmissionVitalSigns([form]);
    expect(result.unverifiableTime).toBe(false);
    expect(result.vitals[0]).toMatchObject({
      heartRate: 82,
      painEva: 0,
      recordedAt: '13-07-2026 08:02',
    });
  });
  it('detects an undated reading discarded by the general parser before a later dated measurement', () => {
    const result = parseAdmissionVitalSigns([{ ...form, createDateTime: '' }, form]);
    expect(result.vitals).toHaveLength(1);
    expect(result.unverifiableTime).toBe(true);
  });
  it('does not turn empty timestamp-only forms or superseded forms into an undated take', () => {
    expect(
      parseAdmissionVitalSigns([
        { ...form, metaCampList: [] },
        { ...form, archived: true, createDateTime: '' },
      ])
    ).toEqual({ vitals: [], unverifiableTime: false });
  });
  it('does not invent a midnight time for a date-only source measurement', () => {
    expect(
      parseAdmissionVitalSigns([{ ...form, createDateTime: '13-07-2026' }]).unverifiableTime
    ).toBe(true);
  });
  it('marks malformed vital fields as unverifiable rather than empty clinical data', () => {
    expect(parseAdmissionVitalSigns([{ ...form, metaCampList: null }]).unverifiableTime).toBe(true);
  });
});
