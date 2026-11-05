import { describe, expect, it } from 'vitest';
import { parseFluidBalance } from '@/features/rayen-import/mapping/parseFluidBalance';
const DAY = '2026-11-04';
const entry = (id: number, regDatetime: string, extra: Record<string, unknown> = {}) => ({
  id,
  regDatetime,
  hydBalType: 'IN',
  hydBalName: 'Oral',
  inputQuantity: 100,
  ...extra,
});

describe('Eloísa intake and diuresis by hospital shift', () => {
  it('respects all four shift boundaries and adds next-day morning to the preceding night', () => {
    const result = parseFluidBalance(
      [
        entry(1, `${DAY}T07:59:59-05:00`),
        entry(2, `${DAY}T08:00:00-05:00`),
        entry(3, `${DAY}T19:59:59-05:00`),
        entry(4, `${DAY}T20:00:00-05:00`),
        entry(5, '2026-11-05T07:59:59-05:00'),
        entry(6, '2026-11-05T08:00:00-05:00'),
      ],
      DAY
    );
    expect(result.day).toEqual({ intakeMl: 200, urineOutputMl: 0, records: 2 });
    expect(result.night).toEqual({ intakeMl: 200, urineOutputMl: 0, records: 2 });
  });
  it('converts mainland and UTC instants, regardless of the workstation timezone', () => {
    expect(
      parseFluidBalance([entry(1, `${DAY}T09:59:00-03:00`), entry(2, `${DAY}T13:00:00Z`)], DAY).day
        .intakeMl
    ).toBe(100);
    expect(parseFluidBalance([entry(3, '2026-07-10T14:00:00Z')], '2026-07-10').day.intakeMl).toBe(
      100
    );
  });
  it('counts only diuresis outputs, includes every author and deduplicates the same entry', () => {
    const urine = entry(1, `${DAY}T09:00:00-05:00`, {
      hydBalType: 'EG',
      hydBalName: ' Diurésis ',
      outputQuantity: -250,
      authorHealthCarePractitionerRoleName: 'TENS',
    });
    const result = parseFluidBalance(
      [
        urine,
        urine,
        entry(2, `${DAY}T10:00:00-05:00`, {
          inputQuantity: '125,5',
          authorHealthCarePractitionerId: 99,
        }),
        entry(3, `${DAY}T10:00:00-05:00`, {
          hydBalType: 'EG',
          hydBalName: 'Deposiciones',
          outputQuantity: -80,
        }),
        entry(4, `${DAY}T10:00:00-05:00`, { archived: true }),
        entry(5, `${DAY}T10:00:00-05:00`, { deleted: true }),
      ],
      DAY
    );
    expect(result.day).toEqual({ intakeMl: 125.5, urineOutputMl: 250, records: 2 });
  });
  it.each([
    { regDatetime: '2026-11-04T10:00:00' },
    { regDatetime: 'badZ' },
    { inputQuantity: '' },
    { inputQuantity: -10 },
    { inputQuantity: Infinity },
    { id: undefined },
    { hydBalType: 'unknown' },
  ])('rejects ambiguous clinical evidence: %j', extra => {
    expect(() => parseFluidBalance([entry(1, `${DAY}T09:00:00-05:00`, extra)], DAY)).toThrow();
  });
  it('rejects conflicting copies rather than counting an arbitrary revision', () => {
    expect(() =>
      parseFluidBalance(
        [
          entry(1, `${DAY}T09:00:00-05:00`),
          entry(1, `${DAY}T09:00:00-05:00`, { inputQuantity: 200 }),
        ],
        DAY
      )
    ).toThrow();
  });
  it('distinguishes a verified empty period from zero volume explicitly recorded', () => {
    expect(parseFluidBalance([], DAY).day.records).toBe(0);
    expect(
      parseFluidBalance([entry(1, `${DAY}T09:00:00-05:00`, { inputQuantity: 0 })], DAY).day
    ).toEqual({ intakeMl: 0, urineOutputMl: 0, records: 1 });
  });
});
