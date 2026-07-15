import { describe, expect, it } from 'vitest';
import {
  buildDischargeRowActions,
  DISCHARGES_TABLE_HEADERS,
  getDischargeStatusBadgeClassName,
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

  it('maps discharge status to badge classes', () => {
    expect(getDischargeStatusBadgeClassName('Fallecido')).toBe('bg-black text-white');
    expect(getDischargeStatusBadgeClassName('Vivo')).toBe('bg-green-100 text-green-700');
  });

  it('builds row action descriptors that invoke typed handlers', () => {
    const discharge = DataFactory.createMockDischarge({
      id: 'd-2',
      status: 'Vivo',
      dischargeType: 'Domicilio (Habitual)',
    });
    let undoCalledWith = '';
    let viewedId = '';
    let editedId = '';
    let deleteCalledWith = '';
    let convertedId = '';
    let convertedTransferId = '';

    const actions = buildDischargeRowActions(discharge, {
      undoDischarge: id => {
        undoCalledWith = id;
      },
      editDischarge: entry => {
        editedId = entry.id;
      },
      viewClinicalDocuments: entry => {
        viewedId = entry.id;
      },
      deleteDischarge: id => {
        deleteCalledWith = id;
      },
      convertDischargeToCma: id => {
        convertedId = id;
      },
      convertDischargeToTransfer: id => {
        convertedTransferId = id;
      },
    });
    expect(actions.map(action => action.kind)).toEqual([
      'undo',
      'viewDocuments',
      'edit',
      'convert',
      'convert',
      'delete',
    ]);
    expect(actions.map(action => action.title)).toContain('Convertir a traslado');
    expect(actions.map(action => action.title)).toContain('Convertir a CMA');

    actions[0].onClick();
    actions[1].onClick();
    actions[2].onClick();
    actions[3].onClick();
    actions[4].onClick();
    actions[5].onClick();

    expect(undoCalledWith).toBe('d-2');
    expect(viewedId).toBe('d-2');
    expect(editedId).toBe('d-2');
    expect(deleteCalledWith).toBe('d-2');
    expect(convertedId).toBe('d-2');
    expect(convertedTransferId).toBe('d-2');
  });

  it('does not expose CMA conversion for non-home discharges', () => {
    const actions = buildDischargeRowActions(
      DataFactory.createMockDischarge({ id: 'd-fuga', status: 'Vivo', dischargeType: 'Fuga' }),
      {
        undoDischarge: () => undefined,
        editDischarge: () => undefined,
        viewClinicalDocuments: () => undefined,
        deleteDischarge: () => undefined,
        convertDischargeToCma: () => undefined,
      }
    );

    expect(actions.map(action => action.kind)).toEqual(['undo', 'viewDocuments', 'edit', 'delete']);
  });
});
