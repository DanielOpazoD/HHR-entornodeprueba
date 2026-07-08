import { describe, expect, it } from 'vitest';

import {
  buildComparisonGroups,
  filterComparisonVariableNames,
  resolveInitialPinnedVariables,
  resolveQualitativeComparisonAlert,
} from '@/features/laboratory/controllers/labComparisonTableController';

describe('labComparisonTableController', () => {
  it('retains only default pinned variables that exist in the dataset', () => {
    const pinned = resolveInitialPinnedVariables(['Hemoglobina', 'Sodio', 'Creatinina']);

    expect([...pinned]).toEqual(['Creatinina', 'Hemoglobina']);
  });

  it('groups rows by clinical section and keeps pinned rows first inside a group', () => {
    const groups = buildComparisonGroups(
      ['Calcio', 'Creatinina', 'Hemoglobina', 'TSH'],
      ['Hemoglobina', 'Calcio', 'TSH', 'Creatinina'],
      new Set(['Creatinina'])
    );

    expect(groups).toEqual([
      { label: 'Hemograma', rows: ['Hemoglobina'] },
      { label: 'Función renal / electrolitos', rows: ['Creatinina', 'Calcio'] },
      { label: 'Metabólico', rows: ['TSH'] },
    ]);
  });

  it('groups Hb glicosilada as metabolic variable', () => {
    const groups = buildComparisonGroups(['Hb glicosilada'], ['Hb glicosilada'], new Set());

    expect(groups).toEqual([{ label: 'Metabólico', rows: ['Hb glicosilada'] }]);
  });

  it('filters variable names case-insensitively', () => {
    const filtered = filterComparisonVariableNames(
      ['Hemoglobina', 'Creatinina', 'Proteina C Reactiva'],
      'crea'
    );

    expect(filtered).toEqual(['Creatinina']);
  });

  it('detects clinically relevant qualitative alerts', () => {
    expect(resolveQualitativeComparisonAlert('POSITIVO')).toBe(true);
    expect(resolveQualitativeComparisonAlert('No reactivo')).toBe(true);
    expect(resolveQualitativeComparisonAlert('Negativo')).toBe(false);
  });
});
