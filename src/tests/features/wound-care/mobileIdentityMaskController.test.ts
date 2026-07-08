import { describe, expect, it } from 'vitest';
import {
  buildMaskedPatientIdentity,
  maskPatientName,
  maskPatientRut,
} from '@/features/wound-care/controllers/mobileIdentityMaskController';

describe('maskPatientName', () => {
  it('reduces a multi-token name to its initials', () => {
    expect(maskPatientName('Juan Carlos Pérez Soto')).toBe('J. C. P. S.');
  });

  it('handles a single-token name', () => {
    expect(maskPatientName('Cristina')).toBe('C.');
  });

  it('collapses extra whitespace before tokenising', () => {
    expect(maskPatientName('  María  Eugenia   Rojas ')).toBe('M. E. R.');
  });

  it('returns a placeholder when the name is empty', () => {
    expect(maskPatientName('')).toBe('—');
    expect(maskPatientName('   ')).toBe('—');
  });
});

describe('maskPatientRut', () => {
  it('exposes only the last four digits with bullets prefix', () => {
    expect(maskPatientRut('11.111.111-1')).toBe('••••-1111');
    expect(maskPatientRut('22222222-K')).toBe('••••-222K');
  });

  it('handles RUTs already shorter than four chars by padding visibility', () => {
    expect(maskPatientRut('123')).toBe('••••-123');
  });

  it('returns a placeholder when the RUT is empty', () => {
    expect(maskPatientRut('')).toBe('—');
    expect(maskPatientRut('---')).toBe('—');
  });
});

describe('buildMaskedPatientIdentity', () => {
  it('packages name + RUT masking together', () => {
    expect(
      buildMaskedPatientIdentity({
        patientName: 'María Eugenia Rojas',
        patientRut: '12.345.678-9',
      })
    ).toEqual({
      maskedName: 'M. E. R.',
      maskedRut: '••••-6789',
    });
  });
});
