import { describe, expect, it } from 'vitest';
import {
  formatClinicalDocumentDate,
  formatClinicalDocumentDateTime,
  getClinicalDocumentStatusClassName,
  getClinicalDocumentStatusLabel,
  resolveClinicalDocumentSourceDateLabel,
} from '@/shared/clinical-documents/clinicalDocumentPresentation';

describe('clinicalDocumentPresentation', () => {
  it('formatea fechas clinicas para modal y sidebar', () => {
    expect(formatClinicalDocumentDate('2026-03-15')).toBe('15-03-2026');
    expect(formatClinicalDocumentDateTime('2026-03-15T10:45:00.000Z')).not.toBe('—');
  });

  it('centraliza labels y estilos de estado', () => {
    expect(getClinicalDocumentStatusLabel('ready_for_signature')).toBe('Borrador');
    expect(getClinicalDocumentStatusClassName('signed')).toContain('slate');
  });

  it('resolves source daily-record dates with the same shared formatter', () => {
    expect(resolveClinicalDocumentSourceDateLabel('2026-03-15')).toBe('15-03-2026');
    expect(resolveClinicalDocumentSourceDateLabel()).toBe('Sin fecha');
  });
});
