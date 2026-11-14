import { afterEach, describe, expect, it } from 'vitest';
import { parseClinicalPanel } from '@/features/rayen-import/mapping/parseClinicalPanel';
import type { RayenClinicalPanelEvent } from '@/features/rayen-import/bridge/clinicalPanelBridge';

const event = (over: Partial<RayenClinicalPanelEvent> = {}): RayenClinicalPanelEvent => ({
  publishDatetime: '2026-07-10T08:00:00',
  evolutionResume: [],
  shiftChangeResume: [],
  patientPharmaIndicationResume: [],
  patientFreeIndicationResume: [],
  nutritionOrderResume: [],
  restResume: [],
  ...over,
});

const pharma = (publishedAt: string) =>
  event({
    patientPharmaIndicationResume: [
      { MRE_ID: 910, DESCRIPTOR: 'CEFTRIAXONA 2 g', PUBLISH_DATETIME: publishedAt },
    ],
  });

const careDayOf = (scheduledDate: string): string =>
  parseClinicalPanel([], {
    medicationStates: [],
    carePlanHeaders: [{ scheduledDate, carePlanBody: [{ entryGuid: 'care', title: 'Curación' }] }],
  }).careDays[0].label;

// Auckland is more than twelve hours ahead of UTC and Pago Pago eleven behind: a day read on the
// device clock instead of the hospital clock shifts in one of them.
describe.each([
  'UTC',
  'America/Santiago',
  'Pacific/Easter',
  'Pacific/Auckland',
  'Pacific/Pago_Pago',
])('clinical panel days on a device in %s', zone => {
  const deviceZone = process.env.TZ;
  afterEach(() => {
    if (deviceZone === undefined) delete process.env.TZ;
    else process.env.TZ = deviceZone;
  });

  it('files an instant with an offset under its Rapa Nui day', () => {
    process.env.TZ = zone;
    // 20:30 on 14-07 in Rapa Nui (UTC-6 in winter), already 15-07 in UTC.
    expect(parseClinicalPanel([pharma('2026-07-15T02:30:00Z')]).indicationDays[0].day).toBe(
      '2026-07-14'
    );
    // 21:30 on 07-01 in Rapa Nui (UTC-5 in summer): the zone, not a fixed number of hours.
    expect(parseClinicalPanel([pharma('2026-01-08T02:30:00Z')]).indicationDays[0].day).toBe(
      '2026-01-07'
    );
    // 23:00 on 11-07 in Rapa Nui, written with the mainland offset.
    expect(parseClinicalPanel([pharma('2026-07-12T01:00:00-04:00')]).indicationDays[0].day).toBe(
      '2026-07-11'
    );
    expect(careDayOf('2026-07-16T03:00:00Z')).toBe('15-07-2026');
  });

  it('projects a daily validation with an offset onto its Rapa Nui day', () => {
    process.env.TZ = zone;
    const panel = parseClinicalPanel(
      [
        pharma('2026-07-10T08:00:00'),
        event({
          publishDatetime: '2026-07-12T01:00:00-04:00',
          validationDatetime: '2026-07-12T01:00:00-04:00',
        }),
      ],
      {
        carePlanHeaders: [],
        medicationStates: [{ id: 910, suspended: false, archived: false, finalized: false }],
      }
    );

    expect(
      panel.indicationDays.map(day => [day.day, day.active[0]?.validitySource ?? null])
    ).toEqual([
      ['2026-07-11', 'daily-validation'],
      ['2026-07-10', 'indication'],
    ]);
  });

  it('keeps the date Eloísa wrote for a date alone or a time without an offset', () => {
    process.env.TZ = zone;
    expect(parseClinicalPanel([pharma('2026-07-14T23:30:00')]).indicationDays[0].day).toBe(
      '2026-07-14'
    );
    expect(parseClinicalPanel([pharma('2026-07-15T00:30')]).indicationDays[0].day).toBe(
      '2026-07-15'
    );
    expect(careDayOf('2026-07-15')).toBe('15-07-2026');
    expect(careDayOf('2026-07-15T00:00:00')).toBe('15-07-2026');
  });
});
