import { describe, expect, it } from 'vitest';
import {
  buildDischargeRowActions,
  DISCHARGES_TABLE_HEADERS,
  getDischargeStatusBadgeClassName,
  resolveDischargeTimeUpdateCommand,
} from '@/features/census/controllers/censusDischargesTableController';
import { DataFactory } from '@/tests/factories/DataFactory';

describe('censusDischargesTableController', () => {
  it('defines stable table headers for discharges section', () => {
    expect(DISCHARGES_TABLE_HEADERS.map(header => header.label)).toEqual([
      'Cama Origen',
      'Paciente',
      'RUT / ID',
      'Diagnóstico',
      'Tipo Alta',
      'Estado',
      'Fecha / Hora Alta',
      'Acciones',
    ]);
  });

  it('resolves discharge time update command by id', () => {
    const discharge = DataFactory.createMockDischarge({
      id: 'd-1',
      status: 'Vivo',
      dischargeType: 'Voluntaria',
      dischargeTypeOther: 'N/A',
    });

    const command = resolveDischargeTimeUpdateCommand([discharge], 'd-1', '15:30');

    expect(command).toEqual({
      id: 'd-1',
      status: 'Vivo',
      dischargeType: 'Voluntaria',
      dischargeTypeOther: 'N/A',
      movementDate: undefined,
      time: '15:30',
    });
  });

  it('returns null when discharge id is not found', () => {
    const command = resolveDischargeTimeUpdateCommand([], 'missing', '10:00');
    expect(command).toBeNull();
  });

  it('maps discharge status to badge classes', () => {
    expect(getDischargeStatusBadgeClassName('Fallecido')).toBe('bg-black text-white');
    expect(getDischargeStatusBadgeClassName('Vivo')).toBe('bg-green-100 text-green-700');
  });

  it('builds row action descriptors that invoke typed handlers', () => {
    const discharge = DataFactory.createMockDischarge({ id: 'd-2' });
    let undoCalledWith = '';
    let editedId = '';
    let deleteCalledWith = '';

    const actions = buildDischargeRowActions(discharge, {
      undoDischarge: id => {
        undoCalledWith = id;
      },
      editDischarge: entry => {
        editedId = entry.id;
      },
      deleteDischarge: id => {
        deleteCalledWith = id;
      },
    });
    expect(actions.map(action => action.kind)).toEqual(['undo', 'edit', 'delete']);

    actions[0].onClick();
    actions[1].onClick();
    actions[2].onClick();

    expect(undoCalledWith).toBe('d-2');
    expect(editedId).toBe('d-2');
    expect(deleteCalledWith).toBe('d-2');
  });
});
