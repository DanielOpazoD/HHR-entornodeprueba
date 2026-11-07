/**
 * Tests for the orbital quick actions controller.
 *
 * Validates topic visibility, display order, badge assignment and dispatch.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  buildPatientRowOrbitalQuickActionItems,
  dispatchPatientRowOrbitalQuickAction,
  hasPatientRowOrbitalQuickActions,
  type PatientRowOrbitalQuickActionsAvailability,
} from '@/features/census/controllers/patientRowOrbitalQuickActionsController';

const NONE: PatientRowOrbitalQuickActionsAvailability = {
  showClinicalPanelAction: false,
  showLaboratoryAction: false,
  showImagingAction: false,
  showClinicalDocumentsAction: false,
  showClinicalExplorerAction: false,
};

const ALL: PatientRowOrbitalQuickActionsAvailability = {
  showClinicalPanelAction: true,
  showLaboratoryAction: true,
  showImagingAction: true,
  showClinicalDocumentsAction: true,
  showClinicalExplorerAction: true,
};

describe('patientRowOrbitalQuickActionsController', () => {
  describe('buildPatientRowOrbitalQuickActionItems', () => {
    it('lists one topic each, in the order ficha, laboratorio, imágenes, documentos, vista integrada', () => {
      const items = buildPatientRowOrbitalQuickActionItems(ALL);

      expect(items.map(item => [item.id, item.label, item.iconAsset])).toEqual([
        ['clinical-panel', 'Ficha clínica', 'manutara'],
        ['laboratory', 'Laboratorio', 'mangai'],
        ['imaging', 'Imágenes', 'ahutepitokura'],
        ['clinical-documents', 'Documentos', 'rongorongo'],
        ['clinical-explorer', 'Vista integrada', 'rapa'],
      ]);
    });

    it('names both reading and requesting in the laboratory and imaging tooltips', () => {
      const items = buildPatientRowOrbitalQuickActionItems(ALL);

      expect(items.find(item => item.id === 'laboratory')?.tooltip).toMatch(
        /resultados y solicitud/
      );
      expect(items.find(item => item.id === 'imaging')?.tooltip).toMatch(/estudios y solicitud/);
    });

    it('excludes hidden topics', () => {
      const items = buildPatientRowOrbitalQuickActionItems({
        ...NONE,
        showClinicalDocumentsAction: true,
        showImagingAction: true,
      });

      expect(items.map(item => item.id)).toEqual(['imaging', 'clinical-documents']);
    });

    it('returns an empty list when no topic is visible', () => {
      expect(buildPatientRowOrbitalQuickActionItems(NONE)).toEqual([]);
    });
  });

  describe('badge assignment', () => {
    it('puts the document count on Documentos only', () => {
      const items = buildPatientRowOrbitalQuickActionItems(ALL, { clinicalDocumentCount: 3 });

      expect(items.map(item => [item.id, item.badge])).toEqual([
        ['clinical-panel', undefined],
        ['laboratory', undefined],
        ['imaging', undefined],
        ['clinical-documents', 3],
        ['clinical-explorer', undefined],
      ]);
    });

    it('shows no badge for a zero or missing count', () => {
      const withDocuments = { ...NONE, showClinicalDocumentsAction: true };

      expect(
        buildPatientRowOrbitalQuickActionItems(withDocuments, { clinicalDocumentCount: 0 })[0].badge
      ).toBeUndefined();
      expect(buildPatientRowOrbitalQuickActionItems(withDocuments)[0].badge).toBeUndefined();
    });
  });

  describe('hasPatientRowOrbitalQuickActions', () => {
    it.each(Object.keys(NONE) as Array<keyof PatientRowOrbitalQuickActionsAvailability>)(
      'is true when only %s is available',
      key => {
        expect(hasPatientRowOrbitalQuickActions({ ...NONE, [key]: true })).toBe(true);
      }
    );

    it('is false when no topic is available', () => {
      expect(hasPatientRowOrbitalQuickActions(NONE)).toBe(false);
    });
  });

  describe('dispatchPatientRowOrbitalQuickAction', () => {
    it('dispatches each topic to its own callback', () => {
      const callbacks = {
        onViewClinicalPanel: vi.fn(),
        onViewLaboratory: vi.fn(),
        onViewImaging: vi.fn(),
        onViewClinicalDocuments: vi.fn(),
        onOpenClinicalExplorer: vi.fn(),
      };

      for (const item of buildPatientRowOrbitalQuickActionItems(ALL)) {
        dispatchPatientRowOrbitalQuickAction(item.id, callbacks);
      }

      for (const callback of Object.values(callbacks)) {
        expect(callback).toHaveBeenCalledTimes(1);
      }
    });

    it('is a safe no-op when the matching callback is absent', () => {
      expect(() =>
        dispatchPatientRowOrbitalQuickAction('imaging', { onViewClinicalDocuments: vi.fn() })
      ).not.toThrow();
    });
  });
});
