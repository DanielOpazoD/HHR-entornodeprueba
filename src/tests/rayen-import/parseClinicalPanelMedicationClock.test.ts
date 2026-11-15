import { afterEach, describe, expect, it } from 'vitest';
import { parseClinicalPanel } from '@/features/rayen-import/mapping/parseClinicalPanel';
import type { RayenClinicalPanelEvent } from '@/features/rayen-import/bridge/clinicalPanelBridge';
import { formatWhen } from '@/features/census/components/patient-row/ClinicalPanelSections';

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

const medicationOrder = (publishDatetime: string, posology = '1 g c/8 h', suspended = false) =>
  event({
    patientPharmaIndicationResume: [
      {
        MRE_ID: 910,
        DESCRIPTOR: 'CEFTRIAXONA',
        POSOLOGY: posology,
        PUBLISH_DATETIME: publishDatetime,
        SUSPENDED: suspended,
      },
    ],
  });

/** Active and suspended versions of the order on the sheets, for the events in both orders. */
const versionsInBothOrders = (events: RayenClinicalPanelEvent[]) =>
  [events, [...events].reverse()].map(order =>
    parseClinicalPanel(order).indicationDays.map(day => ({
      day: day.day,
      active: day.active.map(entry => entry.text),
      suspended: day.suspended.map(entry => entry.text),
    }))
  );

/** Sheet and time the panel shows for the only medication order of `events`. */
const shown = (events: RayenClinicalPanelEvent[]) => {
  const [sheet] = parseClinicalPanel(events).indicationDays;
  return { sheet: sheet.label, when: formatWhen(sheet.active[0].publishedAt) };
};

// TIME-02: the history JSON writes medication orders' PUBLISH_DATETIME in UTC without an offset,
// as the extension's prescription center reads them. Rapa Nui is UTC-6 in winter, UTC-5 in summer.
const SIGNED_IN_RAPA_NUI: Array<[utc: string, sheet: string, when: string]> = [
  ['2026-07-14T14:00:00', '14-07-2026', '14-07-2026 08:00'],
  ['2026-07-14T23:59:00', '14-07-2026', '14-07-2026 17:59'],
  ['2026-07-15T00:00:00', '14-07-2026', '14-07-2026 18:00'],
  ['2026-07-15T01:30:00', '14-07-2026', '14-07-2026 19:30'],
  ['2026-07-15T05:30:00', '14-07-2026', '14-07-2026 23:30'],
  ['2026-01-14T13:00:00', '14-01-2026', '14-01-2026 08:00'],
  ['2026-01-14T22:59:00', '14-01-2026', '14-01-2026 17:59'],
  ['2026-01-14T23:00:00', '14-01-2026', '14-01-2026 18:00'],
  ['2026-01-15T00:30:00', '14-01-2026', '14-01-2026 19:30'],
  ['2026-01-15T04:30:00', '14-01-2026', '14-01-2026 23:30'],
];

describe.each([
  'UTC',
  'America/Santiago',
  'Pacific/Easter',
  'Pacific/Auckland',
  'Pacific/Pago_Pago',
])('medication orders on a device in %s', zone => {
  const deviceZone = process.env.TZ;
  afterEach(() => {
    if (deviceZone === undefined) delete process.env.TZ;
    else process.env.TZ = deviceZone;
  });

  it.each(SIGNED_IN_RAPA_NUI)(
    'shows an order published %s UTC on the %s sheet at %s',
    (utc, sheet, when) => {
      process.env.TZ = zone;
      expect(shown([medicationOrder(utc)])).toEqual({ sheet, when });
    }
  );

  it('keeps a stamp that already carries its offset', () => {
    process.env.TZ = zone;
    expect(shown([medicationOrder('2026-07-15T01:30:00Z')])).toEqual({
      sheet: '14-07-2026',
      when: '14-07-2026 19:30',
    });
  });

  it('shows the evening change of posology as that day’s current order', () => {
    process.env.TZ = zone;
    const panel = parseClinicalPanel([
      medicationOrder('2026-07-14T14:00:00', '1 g c/8 h'),
      medicationOrder('2026-07-15T01:30:00', '2 g c/12 h'),
    ]);
    expect(panel.indicationDays.map(day => [day.day, day.active.map(entry => entry.text)])).toEqual(
      [['2026-07-14', ['2 g c/12 h']]]
    );
  });

  // On 05-04-2026 Rapa Nui goes back from UTC-5 to UTC-6: 02:50Z is 21:50 and 03:10Z is 21:10.
  it('keeps the later suspension within the repeated hour of the clock change', () => {
    process.env.TZ = zone;
    const sheets = versionsInBothOrders([
      medicationOrder('2026-04-05T02:50:00', 'activa'),
      medicationOrder('2026-04-05T03:10:00', 'suspendida', true),
    ]);
    for (const sheet of sheets) {
      expect(sheet).toEqual([{ day: '2026-04-04', active: [], suspended: ['suspendida'] }]);
    }
  });

  it('keeps the later reactivation within the repeated hour of the clock change', () => {
    process.env.TZ = zone;
    const sheets = versionsInBothOrders([
      medicationOrder('2026-04-05T02:50:00', 'suspendida', true),
      medicationOrder('2026-04-05T03:10:00', 'reactivada'),
    ]);
    for (const sheet of sheets) {
      expect(sheet).toEqual([{ day: '2026-04-04', active: ['reactivada'], suspended: [] }]);
    }
  });

  it('orders a stamp with Z and one without an offset by their instants', () => {
    process.env.TZ = zone;
    const sheets = versionsInBothOrders([
      medicationOrder('2026-07-14T15:00:00Z', 'activa'),
      medicationOrder('2026-07-14T16:00:00', 'suspendida', true),
    ]);
    for (const sheet of sheets) {
      expect(sheet).toEqual([{ day: '2026-07-14', active: [], suspended: ['suspendida'] }]);
    }
  });

  // The validation's clock is not measured: it is compared, as before, with the Rapa Nui time.
  it('compares a daily validation with the order’s Rapa Nui time', () => {
    process.env.TZ = zone;
    const panel = parseClinicalPanel(
      [
        medicationOrder('2026-07-15T05:30:00'),
        event({
          publishDatetime: '2026-07-15T00:10:00',
          validationDatetime: '2026-07-15T00:10:00',
        }),
      ],
      {
        carePlanHeaders: [],
        medicationStates: [{ id: 910, suspended: false, archived: false, finalized: false }],
      }
    );
    expect(panel.indicationDays.map(day => [day.day, day.active[0]?.validitySource])).toEqual([
      ['2026-07-15', 'daily-validation'],
      ['2026-07-14', 'indication'],
    ]);
  });

  it('projects a daily validation from the order’s Rapa Nui time', () => {
    process.env.TZ = zone;
    const panel = parseClinicalPanel(
      [
        medicationOrder('2026-07-15T01:30:00'),
        event({
          publishDatetime: '2026-07-15T09:00:00',
          validationDatetime: '2026-07-15T09:00:00',
        }),
      ],
      {
        carePlanHeaders: [],
        medicationStates: [{ id: 910, suspended: false, archived: false, finalized: false }],
      }
    );
    expect(
      panel.indicationDays.map(day => [
        day.day,
        day.active[0]?.validitySource,
        formatWhen(day.active[0]?.prescribedAt ?? ''),
      ])
    ).toEqual([
      ['2026-07-15', 'daily-validation', '14-07-2026 19:30'],
      ['2026-07-14', 'indication', '14-07-2026 19:30'],
    ]);
  });
});
