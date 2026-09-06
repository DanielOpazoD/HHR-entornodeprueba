import { describe, expect, it, vi } from 'vitest';
vi.mock('@/services/storage/firestore/firestoreServiceRuntime', () => ({
  defaultFirestoreServiceRuntime: { ready: Promise.resolve(), getDb: vi.fn() },
}));
import { planSharedStaffCatalog } from '@/services/staff/sharedEloisaStaffCatalog';
import { mergeEloisaStaff } from '@/services/staff/eloisaStaffDiscovery';
const discover = (author: string, role = 'Enfermera', practitionerId?: string) =>
  mergeEloisaStaff(
    [],
    [
      {
        author,
        role,
        practitionerId,
        recordedAt: '2026-09-01T12:00:00',
        authorIdentity: { firstGivenName: 'Ana', firstSurname: 'Soto' },
      },
    ]
  );
describe('shared additive staff catalog', () => {
  it('preserves existing staff, canonicalizes verified aliases and separates roles', () => {
    const result = planSharedStaffCatalog(
      [],
      [...discover('Ana Soto Rojas', 'Enfermera', '1'), ...discover('Berta Perez', 'TENS', '2')],
      ['Ana Soto', 'Otra Persona'],
      ['Tens Anterior']
    );
    expect(result.nurseNames).toEqual(['Ana Soto Rojas', 'Otra Persona']);
    expect(result.tensNames).toEqual(['Tens Anterior', 'Berta Perez']);
    expect(result.entries.find(entry => entry.role === 'nurse')?.manuallyCatalogued).toBe(true);
    expect(result.entries.find(entry => entry.role === 'tens')?.manuallyCatalogued).toBe(false);
  });
  it('does not promote an automatically added name to curated evidence on the next device or retry', () => {
    const first = planSharedStaffCatalog([], discover('Ana Soto Rojas'), [], []);
    const again = planSharedStaffCatalog(
      first.entries,
      discover('Ana Soto Rojas'),
      first.nurseNames,
      first.tensNames
    );
    expect(again).toEqual(first);
    expect(again.entries[0].manuallyCatalogued).toBe(false);
  });
  it('retains a fuller incoming spelling even when the shared ID already exists', () => {
    const first = planSharedStaffCatalog([], discover('Ana Soto', 'Enfermera', '1'), [], []);
    const next = planSharedStaffCatalog(
      first.entries,
      discover('Ana Soto Rojas', 'Enfermera', '1'),
      first.nurseNames,
      []
    );
    expect(next.nurseNames).toEqual(['Ana Soto Rojas']);
    expect(next.entries).toHaveLength(1);
    expect(next.entries[0].manuallyCatalogued).toBe(false);
  });
});
