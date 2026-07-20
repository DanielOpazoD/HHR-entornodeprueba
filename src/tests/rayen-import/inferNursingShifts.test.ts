import { describe, expect, it } from 'vitest';
import {
  hasNursingShiftSuggestions,
  inferNursingShifts,
  isNurseRole,
  type NursingActivityObservation,
} from '@/features/rayen-import/domain/inferNursingShifts';

const activity = (
  author: string,
  recordedAt: string,
  encounterId: string,
  overrides: Partial<NursingActivityObservation> = {}
): NursingActivityObservation => ({
  author,
  role: 'Enfermera(o)',
  recordedAt,
  encounterId,
  source: 'evolution',
  ...overrides,
});

describe('inferNursingShifts', () => {
  it('identifies up to two nurses per shift using independent patients and local wall time', () => {
    const proposal = inferNursingShifts(
      [
        activity('ANA PÉREZ', '2026-07-20T09:10:00', 'E1'),
        activity('ANA PÉREZ', '2026-07-20T14:20:00', 'E2', { source: 'evaluation-scale' }),
        activity('Berta Soto', '2026-07-20T10:00:00', 'E1', { source: 'shift-change' }),
        activity('Berta Soto', '2026-07-20T17:10:00', 'E3'),
        activity('Carla Rojas', '2026-07-20T21:05:00', 'E1'),
        activity('Carla Rojas', '2026-07-20T23:10:00', 'E2'),
        activity('Daniela Vera', '2026-07-21T02:15:00', 'E1'),
        activity('Daniela Vera', '2026-07-21T06:40:00', 'E3'),
      ],
      '2026-07-20'
    );

    expect(proposal.day.names).toEqual(['Berta Soto', 'Ana Pérez']);
    expect(proposal.night.names).toEqual(['Carla Rojas', 'Daniela Vera']);
    expect(hasNursingShiftSuggestions(proposal)).toBe(true);
  });

  it('excludes delayed records in the first hour after each handoff boundary', () => {
    const proposal = inferNursingShifts(
      [
        activity('Saliente Día', '2026-07-20T20:30:00', 'E1'),
        activity('Saliente Día', '2026-07-20T20:40:00', 'E2'),
        activity('Saliente Noche', '2026-07-20T08:30:00', 'E1'),
        activity('Saliente Noche', '2026-07-20T08:45:00', 'E2'),
        activity('Saliente Noche', '2026-07-21T08:30:00', 'E3'),
      ],
      '2026-07-20'
    );

    expect(proposal.day.names).toEqual([]);
    expect(proposal.night.names).toEqual([]);
    expect(proposal.day.ignoredBoundaryRecords).toBe(2);
    expect(proposal.night.ignoredBoundaryRecords).toBe(3);
  });

  it('recognizes a locally catalogued nurse from one valid Eloísa record', () => {
    const proposal = inferNursingShifts(
      [
        activity('Camila Soto Alegria', '2026-07-20T10:20:00', 'E1', {
          authorIdentity: { firstGivenName: 'Camila', firstSurname: 'Soto' },
        }),
      ],
      '2026-07-20',
      ['Camila Soto']
    );

    expect(proposal.day.names).toEqual(['Camila Soto']);
    expect(proposal.day.candidates[0]).toMatchObject({
      name: 'Camila Soto',
      records: 1,
      catalogMatched: true,
    });
  });

  it('keeps Camila alongside Pedro when stale date labels are mixed into the feed', () => {
    const proposal = inferNursingShifts(
      [
        activity('Camila Soto', '2026-07-20T10:20:59', '141119'),
        activity('Pedro Moreno', '2026-07-20T10:43:12', '141616'),
        activity('Pedro Moreno', '2026-07-20T10:01:19', '141496'),
        activity(
          '20-07-2026 - 09:25:48 - Pedro Moreno - Enfermera(o)',
          '2026-07-20T09:25:48',
          '141119',
          { source: 'evaluation-scale' }
        ),
      ],
      '2026-07-20',
      ['Pedro Moreno', 'Camila Soto']
    );

    expect(proposal.day.names).toEqual(['Pedro Moreno', 'Camila Soto']);
    expect(proposal.day.candidates.map(candidate => candidate.name)).not.toContain('20-07-2026 -');
  });

  it('reconciles full and short names without duplicating the same nurse', () => {
    const proposal = inferNursingShifts(
      [
        activity('Pedro Moreno Opazo', '2026-07-20T10:20:00', 'E1', {
          authorIdentity: { firstGivenName: 'Pedro', firstSurname: 'Moreno' },
        }),
        activity('Pedro Moreno', '2026-07-20T14:20:00', 'E2'),
      ],
      '2026-07-20',
      ['Pedro Moreno']
    );

    expect(proposal.day.names).toEqual(['Pedro Moreno']);
    expect(proposal.day.candidates).toHaveLength(1);
    expect(proposal.day.candidates[0]).toMatchObject({ records: 2, patients: 2 });
  });

  it('uses the unique local surname when Eloísa includes a second given name', () => {
    const proposal = inferNursingShifts(
      [
        activity('María José Soto Alegría', '2026-07-20T10:20:00', 'E1', {
          authorIdentity: { firstGivenName: 'María', firstSurname: 'Soto' },
        }),
      ],
      '2026-07-20',
      ['María Soto']
    );

    expect(proposal.day.names).toEqual(['María Soto']);
  });

  it('marks a full-name and short-label collision ambiguous without a short catalog identity', () => {
    const proposal = inferNursingShifts(
      [
        activity('Ana María Pérez Soto', '2026-07-20T10:20:00', 'E1', {
          authorIdentity: { firstGivenName: 'Ana', firstSurname: 'Pérez' },
        }),
        activity('Ana Pérez', '2026-07-20T14:20:00', 'E2', {
          source: 'evaluation-scale',
        }),
      ],
      '2026-07-20',
      ['Ana María Pérez Soto']
    );

    expect(proposal.day.names).toEqual([]);
    expect(proposal.day.ambiguous).toBe(true);
    expect(proposal.day.candidates.map(candidate => candidate.name)).toContain(
      'Ana María Pérez Soto'
    );
  });

  it('keeps an exact short catalog identity distinct from a full-name alias', () => {
    const proposal = inferNursingShifts(
      [
        activity('Pedro Moreno Opazo', '2026-07-20T10:20:00', 'E1', {
          authorIdentity: { firstGivenName: 'Pedro', firstSurname: 'Moreno' },
        }),
        activity('Pedro Moreno', '2026-07-20T14:20:00', 'E2', {
          source: 'evaluation-scale',
        }),
      ],
      '2026-07-20',
      ['Pedro Moreno', 'Pedro Moreno Opazo']
    );

    expect(proposal.day.names).toEqual([]);
    expect(proposal.day.ambiguous).toBe(true);
  });

  it('does not merge distinct full identities that share first name and surname', () => {
    const proposal = inferNursingShifts(
      [
        activity('Ana María Pérez Soto', '2026-07-20T10:20:00', 'E1', {
          authorIdentity: { firstGivenName: 'Ana', firstSurname: 'Pérez' },
        }),
        activity('Ana Isabel Pérez Rojas', '2026-07-20T14:20:00', 'E2', {
          authorIdentity: { firstGivenName: 'Ana', firstSurname: 'Pérez' },
        }),
        activity('Ana Pérez', '2026-07-20T15:20:00', 'E3', {
          source: 'evaluation-scale',
        }),
      ],
      '2026-07-20'
    );

    expect(proposal.day.names).toEqual([]);
    expect(proposal.day.candidates).toEqual([]);
  });

  it('uses the 09:00 start on weekends and holidays', () => {
    const proposal = inferNursingShifts(
      [
        activity('Ana Pérez', '2026-07-18T09:30:00', 'E1'),
        activity('Ana Pérez', '2026-07-18T09:40:00', 'E2'),
        activity('Berta Soto', '2026-07-18T10:05:00', 'E1'),
        activity('Berta Soto', '2026-07-18T12:05:00', 'E2'),
      ],
      '2026-07-18'
    );

    expect(proposal.day.names).toEqual(['Berta Soto']);
    expect(proposal.day.ignoredBoundaryRecords).toBe(2);
  });

  it('does not let duplicates, archived rows, crossed-out rows or TENS become nurse evidence', () => {
    const valid = activity('Ana Pérez', '2026-07-20T10:00:00', 'E1');
    const proposal = inferNursingShifts(
      [
        valid,
        valid,
        activity('Ana Pérez', '2026-07-20T12:00:00', 'E1', { archived: true }),
        activity('Ana Pérez', '2026-07-20T14:00:00', 'E1', { crossedOut: true }),
        activity('Técnico Uno', '2026-07-20T10:00:00', 'E1', {
          role: 'Técnico en enfermería',
        }),
        activity('Técnico Uno', '2026-07-20T12:00:00', 'E2', { role: 'TENS' }),
        activity('NoInformado', '2026-07-20T10:00:00', 'E1'),
        activity('NoInformado', '2026-07-20T12:00:00', 'E2'),
      ],
      '2026-07-20'
    );

    expect(proposal.day.names).toEqual([]);
    expect(proposal.day.candidates).toEqual([]);
  });

  it('requires review instead of choosing arbitrarily when three candidates tie for two slots', () => {
    const observations = ['Ana Pérez', 'Berta Soto', 'Carla Rojas'].flatMap(name => [
      activity(name, '2026-07-20T10:00:00', `${name}-1`),
      activity(name, '2026-07-20T12:00:00', `${name}-2`),
    ]);
    const proposal = inferNursingShifts(observations, '2026-07-20');

    expect(proposal.day.candidates).toHaveLength(3);
    expect(proposal.day.names).toEqual([]);
    expect(proposal.day.ambiguous).toBe(true);
  });

  it('keeps the clear first candidate when only the second slot is tied', () => {
    const observations = [
      activity('Ana Pérez', '2026-07-20T10:00:00', 'A1'),
      activity('Ana Pérez', '2026-07-20T12:00:00', 'A2'),
      activity('Ana Pérez', '2026-07-20T14:00:00', 'A3'),
      activity('Berta Soto', '2026-07-20T10:00:00', 'B1'),
      activity('Berta Soto', '2026-07-20T12:00:00', 'B2'),
      activity('Carla Rojas', '2026-07-20T10:00:00', 'C1'),
      activity('Carla Rojas', '2026-07-20T12:00:00', 'C2'),
    ];
    const result = inferNursingShifts(observations, '2026-07-20');

    expect(result.day.names).toEqual(['Ana Pérez']);
    expect(result.day.ambiguous).toBe(true);
  });

  it.each([
    ['Enfermera(o)', true],
    ['Enfermería', true],
    ['TENS', false],
    ['Técnico en enfermería', false],
    ['Paramédico', false],
    ['Médico', false],
  ])('classifies role %s as nurse=%s', (role, expected) => {
    expect(isNurseRole(role)).toBe(expected);
  });
});
