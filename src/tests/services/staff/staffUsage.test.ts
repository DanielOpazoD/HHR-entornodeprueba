import { describe, expect, it } from 'vitest';
import { countStaffUsage, partitionStaffOptions } from '@/services/staff/staffUsage';

describe('staff usage disclosure', () => {
  it('counts a professional once per census and role, resolving confirmed aliases', () => {
    expect(
      countStaffUsage(
        [
          {
            nursesDayShift: ['Ana Soto', 'Vacante'],
            nursesNightShift: ['Ana Soto Diaz'],
            tensDayShift: ['Ana Soto'],
          },
          { nurses: ['Ana Soto'] },
        ],
        [{ key: 'nurse:a', role: 'nurse', name: 'Ana Soto Diaz', aliases: ['Ana Soto'] }]
      )
    ).toEqual({
      nurse: { 'ana soto diaz': 2 },
      tens: { 'ana soto': 1 },
    });
  });

  it('hides a quarter deterministically, but never vacancy or a current selection', () => {
    const options = [
      'Vacante',
      'Ana',
      'Berta',
      'Carla',
      'Dora',
      'Elena',
      'Fabiola',
      'Gloria',
      'Hilda',
    ];
    const groups = partitionStaffOptions(options, ['Berta'], { ana: 5 });
    expect(groups.hidden).toEqual(['Carla', 'Dora']);
    expect(groups.visible).toContain('Berta');
    expect(groups.visible).toContain('Vacante');
    expect(groups.visible).toContain('Ana');
  });

  it('does not invent a ranking without evidence or hide everyone in small lists', () => {
    expect(partitionStaffOptions(['Ana', 'Berta', 'Carla', 'Dora'], [], {}).hidden).toEqual([]);
    expect(partitionStaffOptions(['Ana', 'Berta', 'Carla'], [], { ana: 2 }).hidden).toEqual([]);
    expect(
      partitionStaffOptions(['Ana', 'Berta', 'Carla', 'Dora'], ['Ana', 'Berta', 'Carla', 'Dora'], {
        ana: 2,
      }).hidden
    ).toEqual([]);
  });
});
