import { describe, expect, it } from 'vitest';
import {
  CMA_TABLE_HEADERS,
  resolveCmaUndoButtonTitle,
} from '@/features/census/controllers/censusCmaTableController';

describe('censusCmaTableController', () => {
  it('defines expected cma table headers', () => {
    expect(CMA_TABLE_HEADERS.map(header => header.label)).toEqual([
      'Cama',
      'Tipo Intervención',
      'Paciente',
      'RUT',
      'Edad',
      'Diagnóstico',
      'Especialidad',
      'Hora Alta',
      'Acciones',
    ]);
  });

  it('builds undo title depending on original bed presence', () => {
    expect(resolveCmaUndoButtonTitle({ originalBedId: 'R1' })).toBe(
      'Deshacer: Restaurar paciente a la cama'
    );
    expect(resolveCmaUndoButtonTitle({ originalBedId: undefined })).toBe(
      'Deshacer (sin datos originales)'
    );
  });
});
