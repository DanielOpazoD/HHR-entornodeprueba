import { describe, expect, it } from 'vitest';
import {
  resolvePatientInputCellsLock,
  resolvePatientRutValidationError,
} from '@/features/census/controllers/patientInputCellsController';

describe('patientInputCellsController', () => {
  it('locks input cells when readOnly or edit rules are unavailable/denied', () => {
    expect(
      resolvePatientInputCellsLock({
        readOnly: true,
        canEditField: () => true,
      })
    ).toBe(true);

    expect(
      resolvePatientInputCellsLock({
        readOnly: false,
        canEditField: undefined,
      })
    ).toBe(true);

    expect(
      resolvePatientInputCellsLock({
        readOnly: false,
        canEditField: () => false,
      })
    ).toBe(true);
  });

  it('keeps input cells editable when rules allow editing', () => {
    expect(
      resolvePatientInputCellsLock({
        readOnly: false,
        canEditField: () => true,
      })
    ).toBe(false);
  });

  it('validates RUT only when document type is RUT and value exists', () => {
    expect(
      resolvePatientRutValidationError({
        documentType: 'RUT',
        rut: '11.111.111-1',
      })
    ).toBe(false);

    expect(
      resolvePatientRutValidationError({
        documentType: 'RUT',
        rut: 'invalid-rut',
      })
    ).toBe(true);

    expect(
      resolvePatientRutValidationError({
        documentType: 'Pasaporte',
        rut: 'invalid-rut',
      })
    ).toBe(false);
  });
});
