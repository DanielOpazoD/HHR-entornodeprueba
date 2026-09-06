import { describe, expect, it } from 'vitest';
import {
  mergeStaffCatalog,
  resolveEloisaStaffName,
  type StaffObservation,
} from '@/services/staff/eloisaStaffIdentity';
import { mergeEloisaStaff } from '@/services/staff/eloisaStaffDiscovery';
const observation = (over: Partial<StaffObservation> = {}): StaffObservation => ({
  author: 'Ana Soto Rojas',
  role: 'Enfermera(o)',
  recordedAt: '2026-09-05T12:00:00',
  authorIdentity: { firstGivenName: 'Ana', firstSurname: 'Soto' },
  ...over,
});
describe('Eloisa staff identity', () => {
  it('discovers without a manual catalog and resolves only source-supported aliases', () => {
    const entries = mergeEloisaStaff(
      [],
      [observation(), observation({ author: 'Ana Soto', authorIdentity: undefined })]
    );
    expect(entries).toHaveLength(1);
    expect(resolveEloisaStaffName('Ana Soto', entries)).toBe('Ana Soto Rojas');
    expect(mergeStaffCatalog(['Ana Soto', 'Otro Profesional'], entries, 'nurse')).toEqual([
      'Ana Soto Rojas',
      'Otro Profesional',
    ]);
    expect(mergeEloisaStaff(entries, [observation()])).toEqual(entries);
  });
  it('preserves IDs, prefers a full name and does not guess a surname from tokens', () => {
    const entries = mergeEloisaStaff(
      [],
      [
        observation({ author: 'Ana Soto', practitionerId: '8' }),
        observation({ practitionerId: '8' }),
      ]
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('Ana Soto Rojas');
    const unstructured = mergeEloisaStaff([], [observation({ authorIdentity: undefined })]);
    expect(resolveEloisaStaffName('Ana Soto', unstructured)).toBe('Ana Soto');
  });
  it('does not collapse homonyms or cross nurse/TENS roles', () => {
    const entries = mergeEloisaStaff(
      [],
      [
        observation({ practitionerId: '1' }),
        observation({ author: 'Ana Soto Perez', practitionerId: '2' }),
        observation({ author: 'Ana Soto', authorIdentity: undefined }),
        observation({ role: 'Paramédico', practitionerId: '3' }),
      ]
    );
    expect(entries).toHaveLength(4);
    expect(resolveEloisaStaffName('Ana Soto', entries, 'nurse')).toBe('Ana Soto');
    expect(resolveEloisaStaffName('Ana Soto', entries, 'tens')).toBe('Ana Soto Rojas');
  });
  it.each([
    { crossedOut: true },
    { archived: true },
    { role: 'Médico' },
    { author: 'No informado' },
    { author: '2026-09-05 - profesional' },
    { recordedAt: '' },
  ])('rejects ineligible discovery %j', over => {
    expect(mergeEloisaStaff([], [observation(over)])).toEqual([]);
  });
});
