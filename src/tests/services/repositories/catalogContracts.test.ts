import {
  normalizeProfessionalCatalog,
  normalizeStringCatalog,
} from '@/services/repositories/contracts/catalogContracts';
import { describe, expect, it } from 'vitest';

describe('catalogContracts', () => {
  it('normalizes string catalogs removing empty/duplicates', () => {
    const result = normalizeStringCatalog([' Ana ', '', 'Pedro', 'Ana', null]);

    expect(result).toEqual(['Ana', 'Pedro']);
  });

  it('normalizes professionals, preserves pending specialties and prefers stable Rayen ids', () => {
    const result = normalizeProfessionalCatalog([
      { name: ' Dra. Ana ', phone: ' 123 ', specialty: 'medico', period: ' Semanal ' },
      { name: 'Dra. Ana', phone: '123', specialty: 'medicina interna' },
      { name: 'Sin Especialidad', phone: '999' },
      { name: 'Subespecialista', phone: '', specialty: 'Infectología' },
      {
        name: 'Dr. Rayen',
        phone: '',
        rayenPractitionerId: '7947',
        source: 'rayen',
      },
      {
        name: 'Nombre duplicado actualizado',
        phone: '',
        specialty: 'cirugia',
        rayenPractitionerId: '7947',
        source: 'rayen',
      },
      { name: '', specialty: 'ginecobstetricia', phone: '777' },
      null,
    ]);

    expect(result).toEqual([
      {
        name: 'Dra. Ana',
        phone: '123',
        specialty: 'Medicina Interna',
        rayenPractitionerId: undefined,
        source: undefined,
        period: 'Semanal',
        lastUsed: undefined,
      },
      {
        name: 'Sin Especialidad',
        phone: '999',
        specialty: undefined,
        rayenPractitionerId: undefined,
        source: undefined,
        period: undefined,
        lastUsed: undefined,
      },
      {
        name: 'Subespecialista',
        phone: '',
        specialty: 'Infectología',
        rayenPractitionerId: undefined,
        source: undefined,
        period: undefined,
        lastUsed: undefined,
      },
      {
        name: 'Dr. Rayen',
        phone: '',
        specialty: undefined,
        rayenPractitionerId: '7947',
        source: 'rayen',
        period: undefined,
        lastUsed: undefined,
      },
    ]);
  });
});
