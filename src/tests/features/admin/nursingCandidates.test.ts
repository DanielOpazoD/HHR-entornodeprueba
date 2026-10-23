import { describe, expect, it } from 'vitest';
import { parseNursingCandidates } from '@/features/admin/domain/nursingCandidates';
describe('nursing candidate review', () => {
  it('only accepts a valid RUT and explicit source, independently of similar names', () => {
    const rows = parseNursingCandidates(
      'Persona Uno;11.111.111-1;Mantenedor A\nPersona Uno;22.222.222-2;Mantenedor B\nPersona Mal;11.111.111-2;Mantenedor C',
      []
    );
    expect(rows.slice(0, 2).every(row => !row.issue)).toBe(true);
    expect(rows[2].issue).toBe('RUT inválido');
  });
  it('blocks both duplicate candidates and identities that already have an account', () => {
    const rows = parseNursingCandidates(
      'Persona Uno;11.111.111-1;Origen A\nPersona Variante;11111111-1;Origen B\nOtra Persona;22.222.222-2;Origen C',
      ['22222222-2']
    );
    expect(rows.every(row => row.issue)).toBe(true);
  });
  it('bounds input and refuses incomplete source references without creating anything', () => {
    expect(() => parseNursingCandidates('x'.repeat(20001), [])).toThrow();
    expect(parseNursingCandidates('Persona Uno;11.111.111-1', [])[0].issue).toBeTruthy();
  });
});
