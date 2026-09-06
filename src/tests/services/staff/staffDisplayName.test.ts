import { describe, expect, it } from 'vitest';
import { formatStaffDisplayName } from '@/services/staff/staffDisplayName';
import type { EloisaStaffIdentity } from '@/services/staff/eloisaStaffIdentity';

const nurse: EloisaStaffIdentity = {
  key: 'nurse:id:a',
  role: 'nurse',
  practitionerId: 'a',
  name: 'Ana Maria Soto Rojas',
  aliases: ['Ana Maria Soto Rojas', 'Ana Soto'],
};

describe('staff display names', () => {
  it('uses the evidenced first name and surname without mutating canonical identity', () => {
    const original = structuredClone(nurse);
    expect(formatStaffDisplayName(nurse.name, [nurse], 'nurse')).toBe('Ana Soto');
    expect(formatStaffDisplayName('Ana Soto', [nurse], 'nurse')).toBe('Ana Soto');
    expect(nurse).toEqual(original);
  });

  it('does not guess a surname from an unstructured full name', () => {
    expect(formatStaffDisplayName('Ana Maria Roman', [], 'tens')).toBe('Ana Maria Roman');
    expect(formatStaffDisplayName('Vacante', [nurse], 'nurse')).toBe('Vacante');
  });

  it('keeps homonyms distinguishable and roles independent', () => {
    const other: EloisaStaffIdentity = {
      ...nurse,
      key: 'nurse:id:b',
      practitionerId: 'b',
      name: 'Ana Sofia Soto Diaz',
      aliases: ['Ana Sofia Soto Diaz', 'Ana Soto'],
    };
    expect(formatStaffDisplayName(nurse.name, [nurse, other], 'nurse')).toBe(nurse.name);
    expect(formatStaffDisplayName('Ana Soto', [nurse, other], 'nurse')).toBe('Ana Soto');
    expect(
      formatStaffDisplayName(
        nurse.name,
        [nurse, { ...other, key: 'tens:id:b', role: 'tens' }],
        'nurse'
      )
    ).toBe('Ana Soto');
  });
});
