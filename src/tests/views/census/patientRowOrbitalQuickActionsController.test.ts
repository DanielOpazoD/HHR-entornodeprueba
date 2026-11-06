/**
 * Tests for the orbital quick actions controller.
 *
 * Validates action visibility, display order, and badge assignment.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  buildPatientRowOrbitalQuickActionItems,
  dispatchPatientRowOrbitalQuickAction,
  hasPatientRowOrbitalQuickActions,
} from '@/features/census/controllers/patientRowOrbitalQuickActionsController';

describe('patientRowOrbitalQuickActionsController', () => {
  describe('buildPatientRowOrbitalQuickActionItems', () => {
    it('builds visible quick action items in the configured display order', () => {
      const items = buildPatientRowOrbitalQuickActionItems({
        showClinicalDocumentsAction: true,
        showExamRequestAction: true,
        showImagingRequestAction: true,
      });

      expect(items.map(item => item.id)).toEqual([
        'clinical-documents',
        'exam-request',
        'imaging-request',
      ]);
      expect(items[0]).toMatchObject({
        label: 'Documentos',
        iconAsset: 'rongorongo',
      });
      expect(items[1]).toMatchObject({
        label: 'Laboratorio',
        iconAsset: 'mangai',
      });
      expect(items[2]).toMatchObject({
        label: 'Imágenes',
        iconAsset: 'ahutepitokura',
      });
    });

    it('excludes hidden actions', () => {
      const items = buildPatientRowOrbitalQuickActionItems({
        showClinicalDocumentsAction: true,
        showExamRequestAction: false,
        showImagingRequestAction: false,
      });

      expect(items).toHaveLength(1);
      expect(items[0].id).toBe('clinical-documents');
    });

    it('returns empty array when no actions are visible', () => {
      const items = buildPatientRowOrbitalQuickActionItems({
        showClinicalDocumentsAction: false,
        showExamRequestAction: false,
        showImagingRequestAction: false,
      });

      expect(items).toEqual([]);
    });
  });

  describe('badge assignment', () => {
    it('assigns clinicalDocumentCount badge to clinical-documents action', () => {
      const items = buildPatientRowOrbitalQuickActionItems(
        {
          showClinicalDocumentsAction: true,
          showExamRequestAction: true,
          showImagingRequestAction: false,
        },
        { clinicalDocumentCount: 3 }
      );

      const docItem = items.find(i => i.id === 'clinical-documents');
      expect(docItem?.badge).toBe(3);
    });

    it('does not assign badge to non-document actions', () => {
      const items = buildPatientRowOrbitalQuickActionItems(
        {
          showClinicalDocumentsAction: true,
          showExamRequestAction: true,
          showImagingRequestAction: true,
        },
        { clinicalDocumentCount: 5 }
      );

      const labItem = items.find(i => i.id === 'exam-request');
      const imgItem = items.find(i => i.id === 'imaging-request');
      expect(labItem?.badge).toBeUndefined();
      expect(imgItem?.badge).toBeUndefined();
    });

    it('does not assign badge when count is 0', () => {
      const items = buildPatientRowOrbitalQuickActionItems(
        {
          showClinicalDocumentsAction: true,
          showExamRequestAction: false,
          showImagingRequestAction: false,
        },
        { clinicalDocumentCount: 0 }
      );

      expect(items[0].badge).toBeUndefined();
    });

    it('does not assign badge when badges parameter is undefined', () => {
      const items = buildPatientRowOrbitalQuickActionItems({
        showClinicalDocumentsAction: true,
        showExamRequestAction: false,
        showImagingRequestAction: false,
      });

      expect(items[0].badge).toBeUndefined();
    });

    it('does not assign badge when clinical-documents action is hidden', () => {
      const items = buildPatientRowOrbitalQuickActionItems(
        {
          showClinicalDocumentsAction: false,
          showExamRequestAction: true,
          showImagingRequestAction: false,
        },
        { clinicalDocumentCount: 2 }
      );

      expect(items.every(i => i.badge === undefined)).toBe(true);
    });
  });

  describe('hasPatientRowOrbitalQuickActions', () => {
    it('returns true when any action is available', () => {
      expect(
        hasPatientRowOrbitalQuickActions({
          showClinicalDocumentsAction: true,
          showExamRequestAction: false,
          showImagingRequestAction: false,
        })
      ).toBe(true);
    });

    it('returns false when no actions are available', () => {
      expect(
        hasPatientRowOrbitalQuickActions({
          showClinicalDocumentsAction: false,
          showExamRequestAction: false,
          showImagingRequestAction: false,
        })
      ).toBe(false);
    });
  });

  describe('dispatchPatientRowOrbitalQuickAction', () => {
    it('dispatches to the matching callback for each action id', () => {
      const onViewClinicalDocuments = vi.fn();
      const onViewExamRequest = vi.fn();
      const onViewImagingRequest = vi.fn();

      dispatchPatientRowOrbitalQuickAction('clinical-documents', { onViewClinicalDocuments });
      dispatchPatientRowOrbitalQuickAction('exam-request', { onViewExamRequest });
      dispatchPatientRowOrbitalQuickAction('imaging-request', { onViewImagingRequest });

      expect(onViewClinicalDocuments).toHaveBeenCalledTimes(1);
      expect(onViewExamRequest).toHaveBeenCalledTimes(1);
      expect(onViewImagingRequest).toHaveBeenCalledTimes(1);
    });

    it('is a safe no-op when the matching callback is absent', () => {
      expect(() =>
        dispatchPatientRowOrbitalQuickAction('imaging-request', {
          onViewClinicalDocuments: vi.fn(),
        })
      ).not.toThrow();
    });
  });
});
