import { describe, expect, it } from 'vitest';

import {
  buildCensusHeaderCellModels,
  resolveVisibleHeaderColumns,
} from '@/features/census/controllers/censusTableHeaderController';

describe('censusTableHeaderController', () => {
  it('keeps visible census columns in default access profile', () => {
    const cells = buildCensusHeaderCellModels(undefined, 'default');
    const keys = cells.map(cell => cell.key);

    expect(keys).toContain('status');
    expect(keys).toContain('dmi');
    expect(keys).toContain('upc');
  });

  it('hides rut, age and cqx columns and unifies identity under "Paciente"', () => {
    const cells = buildCensusHeaderCellModels(undefined, 'default');
    const keys = cells.map(cell => cell.key);

    expect(keys).not.toContain('rut');
    expect(keys).not.toContain('age');
    expect(keys).not.toContain('cqx');

    const nameCell = cells.find(cell => cell.key === 'name');
    expect(nameCell?.label).toBe('Paciente');
  });

  it('hides specialist-restricted census columns', () => {
    const cells = buildCensusHeaderCellModels(undefined, 'specialist');
    const keys = cells.map(cell => cell.key);

    expect(keys).not.toContain('status');
    expect(keys).not.toContain('dmi');
    expect(keys).not.toContain('cqx');
    expect(keys).not.toContain('upc');
    expect(keys).not.toContain('specialty'); // especialidad ahora es texto en la celda Paciente
    expect(keys).toContain('diagnosis');
  });

  it('exposes visible header column definitions before projecting cells', () => {
    const columns = resolveVisibleHeaderColumns(undefined, 'specialist');

    expect(columns.map(column => column.key)).not.toContain('status');
    expect(columns.map(column => column.key)).toContain('diagnosis');
  });
});
