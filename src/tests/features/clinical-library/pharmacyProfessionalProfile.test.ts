import { beforeEach, describe, expect, it } from 'vitest';
import {
  loadPharmacyProfessional,
  pharmacyProfileStorageKey,
  savePharmacyProfessional,
} from '@/features/clinical-library/components/tools/pharmacy/pharmacyProfessionalProfile';

const professional = {
  name: 'Profesional de prueba',
  rut: '12.345.678-5',
  role: 'Enfermero/a',
  unit: 'Hospitalizados',
};

describe('pharmacy professional profile', () => {
  beforeEach(() => localStorage.clear());

  it('only restores the profile owned by the current UID and never invents a RUT or role', () => {
    expect(savePharmacyProfessional('user-a', professional)).toBeNull();
    expect(loadPharmacyProfessional('user-a', 'Nombre de sesión')).toEqual(professional);
    expect(loadPharmacyProfessional('user-b', 'Nombre B')).toEqual({
      name: 'Nombre B',
      rut: '',
      role: '',
      unit: 'Hospitalizados',
    });
    expect(loadPharmacyProfessional(null, null).name).toBe('');
    const saved = localStorage.getItem(pharmacyProfileStorageKey('user-a'));
    localStorage.setItem(pharmacyProfileStorageKey('user-b'), saved ?? '');
    expect(loadPharmacyProfessional('user-b', 'Nombre B').name).toBe('Nombre B');
  });

  it('rejects malformed profiles, unexpected clinical data and an invalid RUT', () => {
    expect(savePharmacyProfessional('user-a', { ...professional, rut: '12.345.678-9' })).toMatch(
      /RUT/
    );
    expect(localStorage.length).toBe(0);
    localStorage.setItem(
      pharmacyProfileStorageKey('user-a'),
      JSON.stringify({
        version: 1,
        uid: 'user-a',
        professional: { ...professional, patient: 'Dato ajeno' },
      })
    );
    expect(loadPharmacyProfessional('user-a', 'Sesión').name).toBe('Sesión');
    localStorage.setItem(pharmacyProfileStorageKey('user-a'), '{broken');
    expect(loadPharmacyProfessional('user-a', 'Sesión').name).toBe('Sesión');
  });

  it('leaves the document usable when local storage is unavailable', () => {
    expect(loadPharmacyProfessional('user-a', 'Sesión', null).name).toBe('Sesión');
    expect(savePharmacyProfessional('user-a', professional, null)).toMatch(/navegador/);
    expect(savePharmacyProfessional(null, professional)).toMatch(/sesión/);
  });

  it('uses session defaults for missing fields while preserving the manually saved profile', () => {
    const defaults = { rut: '12.345.678-5', role: 'Enfermero/a' };
    expect(loadPharmacyProfessional('user-a', 'Nombre de sesión', null, defaults)).toEqual({
      name: 'Nombre de sesión',
      ...defaults,
      unit: 'Hospitalizados',
    });
    expect(
      savePharmacyProfessional('user-a', {
        ...professional,
        name: 'Nombre declarado',
        role: 'Médico/a',
        rut: '',
      })
    ).toBeNull();
    expect(loadPharmacyProfessional('user-a', 'Sesión', undefined, defaults)).toEqual({
      ...professional,
      name: 'Nombre declarado',
      role: 'Médico/a',
    });
    expect(pharmacyProfileStorageKey('user-a')).toMatch(/^hhr_/);
  });
});
