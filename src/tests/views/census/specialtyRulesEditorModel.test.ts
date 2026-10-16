import { describe, expect, it } from 'vitest';
import { upsertSpecialtyRule } from '@/features/census/components/specialty-round/specialtyRulesEditorModel';
describe('diagnosis rule staging', () => {
  it('uses one normalized code across repeated clicks and increments only changed decisions', () => {
    const first = upsertSpecialtyRule([], ' j18.9 ', 'Med Interna');
    const repeated = upsertSpecialtyRule(first, 'J18.9', 'Med Interna');
    expect(repeated).toEqual(first);
    const changed = upsertSpecialtyRule(repeated, 'J18.9', 'Cirugía');
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({ cie10Code: 'J18.9', specialty: 'Cirugía', revision: 2 });
    expect(upsertSpecialtyRule(changed, 'J18.9', 'review')[0]).not.toHaveProperty('specialty');
  });
});
