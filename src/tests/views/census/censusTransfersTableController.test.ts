import { describe, expect, it } from 'vitest';
import {
  buildTransferRowActions,
  getTransferCenterLabel,
  getTransferEscortLabel,
  TRANSFERS_TABLE_HEADERS,
} from '@/features/census/controllers/censusTransfersTableController';
import { DataFactory } from '@/tests/factories/DataFactory';

describe('censusTransfersTableController', () => {
  it('defines stable table headers for transfers section', () => {
    expect(TRANSFERS_TABLE_HEADERS.map(header => header.label)).toEqual([
      'Cama Origen',
      'Paciente',
      'RUT / ID',
      'Diagnóstico',
      'Medio',
      'Centro Destino',
      'Fecha / Hora',
      'Acciones',
    ]);
  });

  it('formats transfer center and escort display labels', () => {
    const customCenter = DataFactory.createMockTransfer({
      receivingCenter: 'Otro',
      receivingCenterOther: 'Centro X',
      transferEscort: 'Enfermera A',
      evacuationMethod: 'Ambulancia',
    });
    const aerocardal = DataFactory.createMockTransfer({
      receivingCenter: 'Hospital Y',
      transferEscort: 'Enfermera B',
      evacuationMethod: 'Aerocardal',
    });

    expect(getTransferCenterLabel(customCenter)).toBe('Centro X');
    expect(getTransferCenterLabel(aerocardal)).toBe('Hospital Y');
    expect(getTransferEscortLabel(customCenter)).toBe('Acompaña: Enfermera A');
    expect(getTransferEscortLabel(aerocardal)).toBeNull();
  });

  it('builds transfer row action descriptors that invoke handlers', () => {
    const transfer = DataFactory.createMockTransfer({ id: 't-2' });
    let undoCalledWith = '';
    let editedId = '';
    let deleteCalledWith = '';
    let homeCalledWith = '';
    let cmaCalledWith = '';

    const actions = buildTransferRowActions(transfer, {
      undoTransfer: id => {
        undoCalledWith = id;
      },
      editTransfer: entry => {
        editedId = entry.id;
      },
      deleteTransfer: id => {
        deleteCalledWith = id;
      },
      convertTransferToHomeDischarge: id => {
        homeCalledWith = id;
      },
      convertTransferToCma: id => {
        cmaCalledWith = id;
      },
    });

    expect(actions.map(action => action.kind)).toEqual([
      'undo',
      'edit',
      'convert',
      'convert',
      'delete',
    ]);
    expect(actions.map(action => action.title)).toContain('Convertir a alta domicilio');
    expect(actions.map(action => action.title)).toContain('Convertir a CMA');

    actions[0].onClick();
    actions[1].onClick();
    actions[2].onClick();
    actions[3].onClick();
    actions[4].onClick();

    expect(undoCalledWith).toBe('t-2');
    expect(editedId).toBe('t-2');
    expect(deleteCalledWith).toBe('t-2');
    expect(homeCalledWith).toBe('t-2');
    expect(cmaCalledWith).toBe('t-2');
  });
});
