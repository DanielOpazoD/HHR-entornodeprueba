import { afterEach, describe, expect, it } from 'vitest';
import { compareStamps } from '@/features/rayen-import/mapping/clinicalPanelParsingUtils';
import { parseClinicalPanel } from '@/features/rayen-import/mapping/parseClinicalPanel';
import { projectValidatedMedicationDays } from '@/features/rayen-import/mapping/projectValidatedMedicationDays';
import type { ClinicalPanelEntry } from '@/features/rayen-import/mapping/clinicalPanelTypes';
import type { RayenClinicalPanelEvent } from '@/features/rayen-import/bridge/clinicalPanelBridge';
import { buildAdmissionAuditEntry } from '@/features/admin/admission-audit/admissionAuditModel';

const ZONES = [
  'UTC',
  'America/Santiago',
  'Pacific/Easter',
  'Pacific/Auckland',
  'Pacific/Pago_Pago',
];
const SHIFTS = [-13, -6, -5, -1, 1, 5, 6, 13];

const deviceZone = process.env.TZ;
afterEach(() => {
  if (deviceZone === undefined) delete process.env.TZ;
  else process.env.TZ = deviceZone;
});

/** `iso` (UTC, without offset) moved by `hours`, still without offset. */
const shifted = (iso: string, hours: number): string =>
  new Date(Date.parse(`${iso}Z`) + hours * 3_600_000).toISOString().slice(0, 19);

/** The same result with the device in each zone. */
const inEveryZone = <T>(run: () => T): T[] =>
  ZONES.map(zone => {
    process.env.TZ = zone;
    return run();
  });

const order = (stamp: string): ClinicalPanelEntry => ({
  id: '910',
  kind: 'pharma',
  title: 'CEFTRIAXONA',
  text: '1 g c/8 h',
  author: '',
  role: '',
  publishedAt: stamp,
  prescribedAt: stamp,
  archived: false,
  suspended: false,
  finalized: false,
  isNew: false,
  crossedOut: false,
});

const project = (
  validations: string[],
  stamp: string,
  state: Record<string, unknown> = {},
  sourceDays: string[] = []
) =>
  projectValidatedMedicationDays({
    treatmentValidations: validations,
    candidatesByMedicationId: new Map([['910', [order(stamp)]]]),
    sourceMedicationDays: new Set(sourceDays),
    medicationStates: new Map([['910', state]]),
  }).map(entry => entry.publishedAt);

const event = (over: Partial<RayenClinicalPanelEvent>): RayenClinicalPanelEvent => ({
  publishDatetime: '2026-07-15T08:00:00',
  evolutionResume: [],
  shiftChangeResume: [],
  patientPharmaIndicationResume: [],
  patientFreeIndicationResume: [],
  nutritionOrderResume: [],
  restResume: [],
  ...over,
});

describe('stamp order without offsets, against Date.parse on a Rapa Nui device', () => {
  // Mulberry32 with a fixed seed: the same pairs on every run.
  const random = (() => {
    let seed = 20261114;
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
    };
  })();
  // Around both clock changes of 2026 and anywhere in the year.
  const anchors = ['2026-04-04T21:00:00', '2026-09-05T22:00:00', '2026-01-01T00:00:00'];
  const stamp = (): string => {
    const anchor = anchors[Math.floor(random() * anchors.length)];
    const span = anchor.startsWith('2026-01') ? 365 * 24 : 6;
    return shifted(anchor, Math.floor((random() - 0.5) * 2 * span * 3600) / 3600);
  };
  // 21:00–21:59 of 04-04 happens twice; 22:00–22:59 of 05-09 does not exist in Rapa Nui.
  const changeHour = (value: string): 'repeated' | 'missing' | null =>
    value.startsWith('2026-04-04T21:')
      ? 'repeated'
      : value.startsWith('2026-09-05T22:')
        ? 'missing'
        : null;

  it('gives the same order outside the hours of a clock change', () => {
    process.env.TZ = 'Pacific/Easter';
    const disagreements: Array<{ a: string; b: string }> = [];
    for (let i = 0; i < 20_000; i += 1) {
      const a = stamp();
      const b = stamp();
      if (Math.sign(compareStamps(a, b)) !== Math.sign(Date.parse(a) - Date.parse(b))) {
        disagreements.push({ a, b });
      }
    }
    for (const { a, b } of disagreements) expect(changeHour(a) ?? changeHour(b)).not.toBeNull();
    // Only the missing hour disagrees: Date.parse moves it an hour ahead, the wall clock keeps it.
    expect(disagreements.length).toBeGreaterThan(0);
    expect(
      disagreements.every(({ a, b }) => changeHour(a) === 'missing' || changeHour(b) === 'missing')
    ).toBe(true);
  });
});

describe('stamp comparisons are the same on every device', () => {
  it('keeps a projected sheet when the validation carries its offset (R1)', () => {
    const sheets = inEveryZone(() =>
      parseClinicalPanel(
        [
          event({
            publishDatetime: '2026-07-15T06:10:00Z',
            validationDatetime: '2026-07-15T06:10:00Z',
            patientPharmaIndicationResume: [
              { MRE_ID: 910, DESCRIPTOR: 'CEFTRIAXONA', PUBLISH_DATETIME: '2026-07-15T05:30:00Z' },
            ],
          }),
        ],
        { carePlanHeaders: [], medicationStates: [{ id: 910 }] }
      ).indicationDays.map(day => [day.day, day.active.map(entry => entry.validitySource)])
    );
    for (const sheet of sheets) {
      expect(sheet).toEqual([
        ['2026-07-15', ['daily-validation']],
        ['2026-07-14', ['indication']],
      ]);
    }
  });

  it('chooses the original order of an admission in the repeated hour (R2)', () => {
    // 02:50Z is 21:50 and 03:10Z is 21:10 of 04-04 in Rapa Nui: the original came first.
    const versions = ['2026-04-05T02:50:00', '2026-04-05T03:10:00'].map((stamp, i) =>
      event({
        publishDatetime: '2026-04-05T08:00:00',
        patientPharmaIndicationResume: [
          {
            MRE_ID: 910,
            DESCRIPTOR: 'CEFTRIAXONA',
            POSOLOGY: i ? 'revisión posterior' : 'original',
            PUBLISH_DATETIME: stamp,
          },
        ],
      })
    );
    const patient = {
      key: 'person:1',
      episodeId: '1',
      patientName: 'Paciente Sintético',
      document: '12.345.678-5',
      admissionDate: '2026-04-04',
      admissionTime: '20:00',
    };
    for (const events of [versions, [...versions].reverse()]) {
      const chosen = inEveryZone(() =>
        buildAdmissionAuditEntry(patient, events, [], 'first-set').indications.map(n => n.text)
      );
      expect(chosen).toEqual(ZONES.map(() => ['original']));
    }
  });

  describe.each(SHIFTS)('%i hours from each threshold', hours => {
    const after = hours > 0;
    // 18:00Z is 12:00 in Rapa Nui (winter, UTC-6).
    const noonInstant = '2026-07-15T18:00:00Z';

    it('compares an order with a validation, with and without offset', () => {
      const wall = inEveryZone(
        () => project([shifted('2026-07-15T12:00:00', hours)], noonInstant).length
      );
      const instant = inEveryZone(
        () => project([`${shifted('2026-07-15T18:00:00', hours)}Z`], noonInstant).length
      );
      expect(wall).toEqual(ZONES.map(() => (after ? 1 : 0)));
      expect(instant).toEqual(ZONES.map(() => (after ? 1 : 0)));
    });

    it('compares a validation with an inactivation of the other clock (R3)', () => {
      const end = `${shifted('2026-07-15T18:00:00', hours)}Z`;
      const ended = inEveryZone(
        () =>
          project(['2026-07-15T12:00:00'], '2026-07-14T18:00:00Z', { endDateTime: end }, [
            '910:2026-07-14',
          ]).length
      );
      const earliest = inEveryZone(
        () =>
          project(
            ['2026-07-15T12:00:00'],
            '2026-07-14T18:00:00Z',
            { endDateTime: end, deletedDateTime: '2026-07-15T13:00:00' },
            ['910:2026-07-14']
          ).length
      );
      expect(ended).toEqual(ZONES.map(() => (after ? 1 : 0)));
      expect(earliest).toEqual(ZONES.map(() => (after ? 1 : 0)));
    });

    it('keeps the latest validation of a day, with and without offset (R3)', () => {
      const second = `${shifted('2026-07-15T18:00:00', hours)}Z`;
      const chosen = inEveryZone(() =>
        project(['2026-07-15T12:00:00', second], '2026-07-13T18:00:00Z', {}, ['910:2026-07-13'])
      );
      for (const zone of chosen) expect(zone).toEqual(chosen[0]);
      if (Math.abs(hours) <= 6) {
        expect(chosen[0]).toEqual([after ? second : '2026-07-15T12:00:00']);
      }
    });
  });
});
