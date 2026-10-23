import { describe, expect, it } from 'vitest';
import { resolveSpecialtyRoundRule } from '@/features/census/components/specialty-round/specialtyRoundModel';
import type { SpecialtyCatalogRule } from '@/services/specialty/specialtyJevClient';
const assign = (id: string, specialty: string): SpecialtyCatalogRule => ({
  id,
  kind: 'assign',
  cie10Code: 'J18.9',
  specialty,
  scope: 'all',
  revision: 1,
});
describe('round preview matches server specialty precedence', () => {
  it('normalizes codes, uses active memory and preserves explicit manual-review decisions', () => {
    const explicit = [assign('base', 'Med Interna')];
    const memory = [assign('memory', 'Cirugía')];
    expect(resolveSpecialtyRoundRule(explicit, ' j18.9 ', memory)).toBe('Cirugía');
    expect(resolveSpecialtyRoundRule(explicit, 'J18.9')).toBe('Med Interna');
    expect(
      resolveSpecialtyRoundRule(
        [{ id: 'review', kind: 'review', cie10Code: 'J18.9', scope: 'all', revision: 1 }],
        'J18.9',
        memory
      )
    ).toBeNull();
    expect(
      resolveSpecialtyRoundRule(explicit, 'J18.9', [
        assign('a', 'Cirugía'),
        assign('b', 'Psiquiatría'),
      ])
    ).toBeNull();
  });
});
