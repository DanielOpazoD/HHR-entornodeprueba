import { describe, expect, it } from 'vitest';
import { buildPatientEpisodeTimelineState } from '@/features/census/components/global-search/patientEpisodeTimelineController';
import type { MasterPatient } from '@/types/domain/patientMaster';
import type { PatientHistoryResult } from '@/services/patient/patientHistoryService';

const basePatient: MasterPatient = {
  rut: '8.932.066-6',
  fullName: 'Ines Riroroko Leiva',
  forecast: 'Fonasa',
  gender: 'Femenino',
  birthDate: '1966-09-03',
  createdAt: 1,
  updatedAt: 1,
  hospitalizations: [
    {
      id: 'ing-1',
      type: 'Ingreso',
      date: '2026-04-07',
      diagnosis: 'ICC',
      bedName: 'H1C1',
    },
  ],
};

describe('buildPatientEpisodeTimelineState', () => {
  it('returns grouped episodes and count for an open episode without history', () => {
    const state = buildPatientEpisodeTimelineState(basePatient, null);

    expect(state.hasEpisodes).toBe(true);
    expect(state.episodeCount).toBe(1);
    expect(state.groupedEpisodes[0].discharge).toBeNull();
  });

  it('reconciles grouped episodes with history before returning timeline state', () => {
    const history: PatientHistoryResult = {
      patientName: basePatient.fullName,
      rut: basePatient.rut,
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

    const state = buildPatientEpisodeTimelineState(basePatient, history);

    expect(state.episodeCount).toBe(1);
    expect(state.groupedEpisodes[0].discharge?.type).toBe('Egreso');
    expect(state.groupedEpisodes[0].discharge?.date).toBe('2026-04-15');
  });

  it('reconstructs episodes from movement history when the master index lacks hospitalizations', () => {
    const patientWithoutIndexedEpisodes: MasterPatient = {
      ...basePatient,
      hospitalizations: [],
      lastAdmission: undefined,
      lastDischarge: undefined,
    };
    const history: PatientHistoryResult = {
      patientName: 'Tipanie Carossi Pakomio',
      rut: '18.781.542-8',
      totalDays: 3,
      firstSeen: '2026-02-02',
      lastSeen: '2026-02-05',
      movements: [
        {
          date: '2026-02-02',
          bedId: 'R3',
          bedName: 'R3',
          bedType: 'MEDIA',
          type: 'admission',
          details: 'Urgencias',
          time: '14:00',
        },
        {
          date: '2026-02-05',
          bedId: 'R3',
          bedName: 'R3',
          bedType: 'MEDIA',
          type: 'discharge',
          details: 'Domicilio (Habitual)',
          time: '10:00',
        },
      ],
    };

    const state = buildPatientEpisodeTimelineState(patientWithoutIndexedEpisodes, history);

    expect(state.hasEpisodes).toBe(true);
    expect(state.episodeCount).toBe(1);
    expect(state.groupedEpisodes[0].admission).toEqual(
      expect.objectContaining({
        type: 'Ingreso',
        date: '2026-02-02',
        bedName: 'R3',
      })
    );
    expect(state.groupedEpisodes[0].discharge).toEqual(
      expect.objectContaining({
        type: 'Egreso',
        date: '2026-02-05',
        bedName: 'R3',
      })
    );
  });

  it('uses movement history as truth when the master index only has the latest hospitalization', () => {
    const patientWithPartialIndex: MasterPatient = {
      ...basePatient,
      rut: '18.781.542-8',
      fullName: 'Tipanie Carossi Pakomio',
      hospitalizations: [
        {
          id: 'latest',
          type: 'Ingreso',
          date: '2026-04-12',
          diagnosis: 'ACV',
          bedName: 'H2C2',
        },
      ],
      lastAdmission: '2026-04-12',
      lastDischarge: '2026-04-24',
    };
    const history: PatientHistoryResult = {
      patientName: patientWithPartialIndex.fullName,
      rut: patientWithPartialIndex.rut,
      totalDays: 29,
      firstSeen: '2026-03-26',
      lastSeen: '2026-04-24',
      movements: [
        {
          date: '2026-03-26',
          bedId: 'H3C1',
          bedName: 'H3C1',
          bedType: 'MEDIA',
          type: 'admission',
        },
        {
          date: '2026-04-06',
          bedId: 'H4C1',
          bedName: 'H4C1',
          bedType: 'MEDIA',
          type: 'discharge',
          details: 'Domicilio (Habitual)',
        },
        {
          date: '2026-04-12',
          bedId: 'H2C2',
          bedName: 'H2C2',
          bedType: 'MEDIA',
          type: 'admission',
        },
        {
          date: '2026-04-24',
          bedId: 'H2C2',
          bedName: 'H2C2',
          bedType: 'MEDIA',
          type: 'discharge',
          details: 'Domicilio (Habitual)',
        },
      ],
    };

    const state = buildPatientEpisodeTimelineState(patientWithPartialIndex, history);

    expect(state.episodeCount).toBe(2);
    expect(state.groupedEpisodes.map(episode => episode.admission.date)).toEqual([
      '2026-04-12',
      '2026-03-26',
    ]);
    expect(state.groupedEpisodes.map(episode => episode.discharge?.date)).toEqual([
      '2026-04-24',
      '2026-04-06',
    ]);
  });
});
