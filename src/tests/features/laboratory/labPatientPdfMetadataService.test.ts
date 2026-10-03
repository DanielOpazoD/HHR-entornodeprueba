import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseLabPatientBirthDateFromPdfText } from '@/features/laboratory/services/labPatientPdfMetadataService';

describe.each(['UTC', 'America/Santiago', 'Pacific/Auckland'])(
  'labPatientPdfMetadataService in %s',
  timezone => {
    beforeEach(() => vi.stubEnv('TZ', timezone));
    afterEach(() => vi.unstubAllEnvs());

    it.each([
      ['Fecha de Nacimiento: 12/04/1980', '1980-04-12'],
      ['F. Nac.: 03-11-1975', '1975-11-03'],
      ['Nacimiento: 2000-02-29', '2000-02-29'],
      ['Fecha Nac.: 1/2/80', '1980-02-01'],
      ['FECHA DE NACIMIENTO: 29/02/2004', '2004-02-29'],
    ])('preserves the calendar date in %s', (text, expected) => {
      expect(parseLabPatientBirthDateFromPdfText(text)).toBe(expected);
    });

    it.each([
      'Fecha de Nacimiento: 29/02/1900',
      'Fecha de Nacimiento: 29/02/2001',
      'Fecha de Nacimiento: 31/04/1980',
      'Fecha de Nacimiento: 00/04/1980',
      'Fecha de Nacimiento: 12/13/1980',
      'Nacimiento: 2000-02-30',
      'Fecha de examen: 12/04/1980',
    ])('rejects an invalid or unrelated date in %s', text => {
      expect(parseLabPatientBirthDateFromPdfText(text)).toBeNull();
    });
  }
);
