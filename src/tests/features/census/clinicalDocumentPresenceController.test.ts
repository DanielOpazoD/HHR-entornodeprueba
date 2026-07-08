/**
 * Tests for clinical document presence controller.
 *
 * Validates that document counts are correctly aggregated per
 * episode key and mapped to bed IDs for badge display.
 */

import { describe, it, expect } from 'vitest';
import {
  buildActiveClinicalDocumentEpisodeKeys,
  buildBedEpisodeBindings,
  buildClinicalDocumentPresenceByBed,
  buildClinicalDocumentPresenceInfoByBed,
  type BedEpisodeBinding,
} from '@/features/census/controllers/clinicalDocumentPresenceController';
import { BedType } from '@/types/domain/beds';
import { DataFactory } from '@/tests/factories/DataFactory';

const bindings: BedEpisodeBinding[] = [
  {
    bedId: 'R1',
    episodeKey: 'episode-canonical-r1',
    episodeKeys: ['episode-canonical-r1', '12345678-9__2026-01-10'],
  },
  { bedId: 'R2', episodeKey: '98765432-1__2026-02-15' },
  { bedId: 'NEO1', episodeKey: '11111111-1__2026-03-01' },
];

const records = [
  { status: 'published', episodeKey: '12345678-9__2026-01-10' },
  { status: 'draft', episodeKey: '12345678-9__2026-01-10' },
  { status: 'published', episodeKey: '98765432-1__2026-02-15' },
  { status: 'archived', episodeKey: '12345678-9__2026-01-10' },
  { status: 'archived', episodeKey: '11111111-1__2026-03-01' },
];

describe('clinicalDocumentPresenceController', () => {
  describe('buildBedEpisodeBindings', () => {
    it('does not bind canonical patients to legacy episode keys from prior bed occupants', () => {
      const result = buildBedEpisodeBindings([
        {
          kind: 'occupied',
          id: 'row-r1',
          bed: { id: 'R1', name: 'R1', type: BedType.MEDIA, isCuna: false },
          data: DataFactory.createMockPatient('R1', {
            patientName: 'Paciente nuevo',
            rut: '11.111.111-1',
            admissionDate: '2026-03-06',
            admissionTime: '15:00',
            clinicalEpisodeId: 'ep_current_admission',
          }),
          isSubRow: false,
        },
      ]);

      expect(result).toEqual([
        {
          bedId: 'R1',
          currentPatientRut: '11.111.111-1',
          episodeKey: 'ep_current_admission',
          episodeKeys: ['ep_current_admission'],
        },
      ]);
    });
  });

  describe('buildActiveClinicalDocumentEpisodeKeys', () => {
    it('returns only episode keys with non-archived documents', () => {
      const keys = buildActiveClinicalDocumentEpisodeKeys(records);

      expect(keys.has('12345678-9__2026-01-10')).toBe(true);
      expect(keys.has('98765432-1__2026-02-15')).toBe(true);
      expect(keys.has('11111111-1__2026-03-01')).toBe(false);
    });

    it('returns empty set for undefined records', () => {
      expect(buildActiveClinicalDocumentEpisodeKeys(undefined).size).toBe(0);
    });

    it('returns empty set for empty array', () => {
      expect(buildActiveClinicalDocumentEpisodeKeys([]).size).toBe(0);
    });
  });

  describe('buildClinicalDocumentPresenceByBed', () => {
    it('maps bed IDs to boolean presence', () => {
      const activeKeys = buildActiveClinicalDocumentEpisodeKeys(records);
      const result = buildClinicalDocumentPresenceByBed(bindings, activeKeys);

      expect(result).toEqual({
        R1: true,
        R2: true,
        NEO1: false,
      });
    });

    it('does not show presence for documents that belong to another patient rut', () => {
      const contaminatedBindings: BedEpisodeBinding[] = [
        {
          bedId: 'R1',
          episodeKey: 'ep_stale_bed_episode',
          episodeKeys: ['ep_stale_bed_episode'],
          currentPatientRut: '14.161.042-2',
        },
      ];
      const contaminatedRecords = [
        {
          status: 'draft',
          episodeKey: 'ep_stale_bed_episode',
          patientRut: '17.444.506-0',
        },
      ];
      const activeKeys = buildActiveClinicalDocumentEpisodeKeys(contaminatedRecords);

      expect(
        buildClinicalDocumentPresenceByBed(contaminatedBindings, activeKeys, contaminatedRecords)
      ).toEqual({ R1: false });
    });
  });

  describe('buildClinicalDocumentPresenceInfoByBed', () => {
    it('counts total and draft documents per bed', () => {
      const result = buildClinicalDocumentPresenceInfoByBed(bindings, records);

      expect(result.R1).toEqual({
        present: true,
        totalCount: 2,
        draftCount: 1,
      });
    });

    it('excludes mismatched-rut documents from presence counts', () => {
      const contaminatedBindings: BedEpisodeBinding[] = [
        {
          bedId: 'R1',
          episodeKey: 'ep_stale_bed_episode',
          episodeKeys: ['ep_stale_bed_episode'],
          currentPatientRut: '14.161.042-2',
        },
      ];
      const contaminatedRecords = [
        {
          status: 'draft',
          episodeKey: 'ep_stale_bed_episode',
          patientRut: '17.444.506-0',
        },
        {
          status: 'published',
          episodeKey: 'ep_stale_bed_episode',
          patientRut: '14.161.042-2',
        },
      ];

      expect(
        buildClinicalDocumentPresenceInfoByBed(contaminatedBindings, contaminatedRecords).R1
      ).toEqual({
        present: true,
        totalCount: 1,
        draftCount: 0,
      });
    });

    it('counts published documents correctly', () => {
      const result = buildClinicalDocumentPresenceInfoByBed(bindings, records);

      expect(result.R2).toEqual({
        present: true,
        totalCount: 1,
        draftCount: 0,
      });
    });

    it('returns zero counts for beds with only archived documents', () => {
      const result = buildClinicalDocumentPresenceInfoByBed(bindings, records);

      expect(result.NEO1).toEqual({
        present: false,
        totalCount: 0,
        draftCount: 0,
      });
    });

    it('handles undefined records', () => {
      const result = buildClinicalDocumentPresenceInfoByBed(bindings, undefined);

      expect(result.R1.totalCount).toBe(0);
      expect(result.R1.present).toBe(false);
    });

    it('handles empty bindings', () => {
      const result = buildClinicalDocumentPresenceInfoByBed([], records);

      expect(Object.keys(result)).toHaveLength(0);
    });
  });
});
