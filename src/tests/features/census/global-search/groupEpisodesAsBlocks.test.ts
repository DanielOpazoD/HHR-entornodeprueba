// @vitest-environment node
/**
 * Tests for the episode grouping logic used in global patient search.
 *
 * Validates that sequential hospitalization events (Ingreso, Egreso, Traslado,
 * Fallecimiento) are correctly grouped into unified episode blocks.
 */

import { describe, it, expect } from 'vitest';
import type { HospitalizationEvent } from '@/types/domain/patientMaster';
import {
  groupEpisodesAsBlocks,
  reconcileGroupedEpisodesWithHistory,
  resolveEpisodeCensusTargetDate,
} from '@/features/census/components/global-search/episodeGroupingController';
import type { PatientHistoryResult } from '@/features/census/services/patientHistoryService';

const createEvent = (
  overrides: Partial<HospitalizationEvent> & { type: HospitalizationEvent['type']; date: string }
): HospitalizationEvent => ({
  id: `evt-${overrides.date}-${overrides.type}`,
  diagnosis: '',
  ...overrides,
});

describe('groupEpisodesAsBlocks', () => {
  it('returns empty array for empty input', () => {
    expect(groupEpisodesAsBlocks([])).toEqual([]);
  });

  it('groups a simple Ingreso + Egreso into one block', () => {
    const events: HospitalizationEvent[] = [
      createEvent({ type: 'Ingreso', date: '2026-01-10', diagnosis: 'Neumonía', bedName: 'C1' }),
      createEvent({ type: 'Egreso', date: '2026-01-15' }),
    ];

    const result = groupEpisodesAsBlocks(events);

    expect(result).toHaveLength(1);
    expect(result[0].admission.type).toBe('Ingreso');
    expect(result[0].admission.date).toBe('2026-01-10');
    expect(result[0].discharge?.type).toBe('Egreso');
    expect(result[0].discharge?.date).toBe('2026-01-15');
    expect(result[0].daysOfStay).toBe(5);
    expect(result[0].diagnosis).toBe('Neumonía');
    expect(result[0].bedName).toBe('C1');
  });

  it('groups Ingreso + Traslado correctly', () => {
    const events: HospitalizationEvent[] = [
      createEvent({ type: 'Ingreso', date: '2026-02-01' }),
      createEvent({
        type: 'Traslado',
        date: '2026-02-03',
        receivingCenter: 'Hospital Salvador',
      }),
    ];

    const result = groupEpisodesAsBlocks(events);

    expect(result).toHaveLength(1);
    expect(result[0].discharge?.type).toBe('Traslado');
    expect(result[0].daysOfStay).toBe(2);
  });

  it('groups Ingreso + Fallecimiento correctly', () => {
    const events: HospitalizationEvent[] = [
      createEvent({ type: 'Ingreso', date: '2026-03-01' }),
      createEvent({ type: 'Fallecimiento', date: '2026-03-10' }),
    ];

    const result = groupEpisodesAsBlocks(events);

    expect(result).toHaveLength(1);
    expect(result[0].discharge?.type).toBe('Fallecimiento');
    expect(result[0].daysOfStay).toBe(9);
  });

  it('handles currently admitted patient (Ingreso without Egreso)', () => {
    const events: HospitalizationEvent[] = [
      createEvent({ type: 'Ingreso', date: '2026-04-01', diagnosis: 'Observación' }),
    ];

    const result = groupEpisodesAsBlocks(events);

    expect(result).toHaveLength(1);
    expect(result[0].admission.type).toBe('Ingreso');
    expect(result[0].discharge).toBeNull();
    expect(result[0].daysOfStay).toBeGreaterThanOrEqual(0);
  });

  it('handles multiple episodes ordered most recent first', () => {
    const events: HospitalizationEvent[] = [
      createEvent({ type: 'Ingreso', date: '2026-01-10', id: 'ep1' }),
      createEvent({ type: 'Egreso', date: '2026-01-15' }),
      createEvent({ type: 'Ingreso', date: '2026-03-01', id: 'ep2' }),
      createEvent({ type: 'Egreso', date: '2026-03-05' }),
    ];

    const result = groupEpisodesAsBlocks(events);

    expect(result).toHaveLength(2);
    // Most recent first
    expect(result[0].admission.date).toBe('2026-03-01');
    expect(result[1].admission.date).toBe('2026-01-10');
  });

  it('handles unordered events (sorts by date internally)', () => {
    const events: HospitalizationEvent[] = [
      createEvent({ type: 'Egreso', date: '2026-01-15' }),
      createEvent({ type: 'Ingreso', date: '2026-01-10' }),
    ];

    const result = groupEpisodesAsBlocks(events);

    expect(result).toHaveLength(1);
    expect(result[0].admission.type).toBe('Ingreso');
    expect(result[0].discharge?.type).toBe('Egreso');
  });

  it('handles orphan discharge without matching admission', () => {
    const events: HospitalizationEvent[] = [
      createEvent({ type: 'Egreso', date: '2026-01-15', diagnosis: 'Recuperado' }),
    ];

    const result = groupEpisodesAsBlocks(events);

    expect(result).toHaveLength(1);
    expect(result[0].admission.type).toBe('Egreso');
    expect(result[0].discharge).toBeNull();
  });

  it('handles consecutive admissions (missing discharge)', () => {
    const events: HospitalizationEvent[] = [
      createEvent({ type: 'Ingreso', date: '2026-01-10', id: 'ep1' }),
      // Missing egreso
      createEvent({ type: 'Ingreso', date: '2026-02-01', id: 'ep2' }),
      createEvent({ type: 'Egreso', date: '2026-02-05' }),
    ];

    const result = groupEpisodesAsBlocks(events);

    expect(result).toHaveLength(2);
    // First episode: closed properly
    expect(result[0].admission.date).toBe('2026-02-01');
    expect(result[0].discharge?.date).toBe('2026-02-05');
    // Second episode: orphan admission (no discharge)
    expect(result[1].admission.date).toBe('2026-01-10');
    expect(result[1].discharge).toBeNull();
  });

  it('uses admission diagnosis when discharge has none', () => {
    const events: HospitalizationEvent[] = [
      createEvent({ type: 'Ingreso', date: '2026-01-10', diagnosis: 'Fractura' }),
      createEvent({ type: 'Egreso', date: '2026-01-15', diagnosis: '' }),
    ];

    const result = groupEpisodesAsBlocks(events);
    expect(result[0].diagnosis).toBe('Fractura');
  });

  it('falls back to discharge diagnosis when admission has none', () => {
    const events: HospitalizationEvent[] = [
      createEvent({ type: 'Ingreso', date: '2026-01-10', diagnosis: '' }),
      createEvent({ type: 'Egreso', date: '2026-01-15', diagnosis: 'Alta médica' }),
    ];

    const result = groupEpisodesAsBlocks(events);
    expect(result[0].diagnosis).toBe('Alta médica');
  });

  it('calculates 0 days for same-day admission and discharge', () => {
    const events: HospitalizationEvent[] = [
      createEvent({ type: 'Ingreso', date: '2026-01-10' }),
      createEvent({ type: 'Egreso', date: '2026-01-10' }),
    ];

    const result = groupEpisodesAsBlocks(events);
    expect(result[0].daysOfStay).toBe(0);
  });

  it('resolves census target date to the discharge date for closed episodes', () => {
    const episode = groupEpisodesAsBlocks([
      createEvent({ type: 'Ingreso', date: '2026-01-10' }),
      createEvent({ type: 'Traslado', date: '2026-01-15' }),
    ])[0];

    expect(resolveEpisodeCensusTargetDate(episode, '2026-01-20')).toBe('2026-01-15');
  });

  it('resolves census target date to lastSeen for open episodes', () => {
    const episode = groupEpisodesAsBlocks([
      createEvent({ type: 'Ingreso', date: '2026-04-01' }),
    ])[0];

    expect(resolveEpisodeCensusTargetDate(episode, '2026-04-12')).toBe('2026-04-12');
  });

  it('falls back to admission date for open episodes without lastSeen', () => {
    const episode = groupEpisodesAsBlocks([
      createEvent({ type: 'Ingreso', date: '2026-04-01' }),
    ])[0];

    expect(resolveEpisodeCensusTargetDate(episode)).toBe('2026-04-01');
  });

  it('closes a stale open episode when history already shows a discharge', () => {
    const episodes = groupEpisodesAsBlocks([
      createEvent({ type: 'Ingreso', date: '2026-04-07', diagnosis: 'ICC', bedName: 'H1C1' }),
    ]);
    const history: PatientHistoryResult = {
      patientName: 'Isut',
      rut: '1.000.122-6',
      totalDays: 8,
      firstSeen: '2026-04-07',
      lastSeen: '2026-04-15',
      movements: [
        {
          date: '2026-04-07',
          bedId: 'H1C1',
          bedName: 'H1C1',
          bedType: 'MEDIA',
          type: 'admission',
        },
        {
          date: '2026-04-15',
          bedId: 'H1C1',
          bedName: 'H1C1',
          bedType: 'MEDIA',
          type: 'discharge',
          details: 'Domicilio (Habitual)',
        },
      ],
    };

    const reconciled = reconcileGroupedEpisodesWithHistory(episodes, history);

    expect(reconciled).toHaveLength(1);
    expect(reconciled[0].discharge?.type).toBe('Egreso');
    expect(reconciled[0].discharge?.date).toBe('2026-04-15');
    expect(reconciled[0].daysOfStay).toBe(8);
  });

  it('closes a stale open episode as transfer when history already shows a transfer', () => {
    const episodes = groupEpisodesAsBlocks([
      createEvent({ type: 'Ingreso', date: '2026-04-07', diagnosis: 'ICC', bedName: 'H1C1' }),
    ]);
    const history: PatientHistoryResult = {
      patientName: 'Isut',
      rut: '1.000.122-6',
      totalDays: 3,
      firstSeen: '2026-04-07',
      lastSeen: '2026-04-10',
      movements: [
        {
          date: '2026-04-07',
          bedId: 'H1C1',
          bedName: 'H1C1',
          bedType: 'MEDIA',
          type: 'admission',
        },
        {
          date: '2026-04-10',
          bedId: 'H1C1',
          bedName: 'H1C1',
          bedType: 'MEDIA',
          type: 'transfer',
          details: 'SAMU aéreo → Hospital Base Valdivia',
        },
      ],
    };

    const reconciled = reconcileGroupedEpisodesWithHistory(episodes, history);

    expect(reconciled[0].discharge?.type).toBe('Traslado');
    expect(reconciled[0].discharge?.date).toBe('2026-04-10');
    expect(reconciled[0].daysOfStay).toBe(3);
  });

  it('closes a stale open episode as death when history marks fallecimiento', () => {
    const episodes = groupEpisodesAsBlocks([
      createEvent({ type: 'Ingreso', date: '2026-04-07', diagnosis: 'Sepsis', bedName: 'H1C1' }),
    ]);
    const history: PatientHistoryResult = {
      patientName: 'Isut',
      rut: '1.000.122-6',
      totalDays: 5,
      firstSeen: '2026-04-07',
      lastSeen: '2026-04-12',
      movements: [
        {
          date: '2026-04-07',
          bedId: 'H1C1',
          bedName: 'H1C1',
          bedType: 'MEDIA',
          type: 'admission',
        },
        {
          date: '2026-04-12',
          bedId: 'H1C1',
          bedName: 'H1C1',
          bedType: 'MEDIA',
          type: 'discharge',
          details: 'Fallecimiento',
        },
      ],
    };

    const reconciled = reconcileGroupedEpisodesWithHistory(episodes, history);

    expect(reconciled[0].discharge?.type).toBe('Fallecimiento');
    expect(reconciled[0].discharge?.date).toBe('2026-04-12');
    expect(reconciled[0].daysOfStay).toBe(5);
  });

  it('keeps an episode open when history still has no closing movement', () => {
    const episodes = groupEpisodesAsBlocks([
      createEvent({ type: 'Ingreso', date: '2026-04-07', diagnosis: 'ICC', bedName: 'H1C1' }),
    ]);
    const history: PatientHistoryResult = {
      patientName: 'Isut',
      rut: '1.000.122-6',
      totalDays: 4,
      firstSeen: '2026-04-07',
      lastSeen: '2026-04-11',
      movements: [
        {
          date: '2026-04-07',
          bedId: 'H1C1',
          bedName: 'H1C1',
          bedType: 'MEDIA',
          type: 'admission',
        },
        {
          date: '2026-04-11',
          bedId: 'H1C1',
          bedName: 'H1C1',
          bedType: 'MEDIA',
          type: 'stay',
        },
      ],
    };

    const reconciled = reconcileGroupedEpisodesWithHistory(episodes, history);

    expect(reconciled[0].discharge).toBeNull();
  });
});
