import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useUpcChecklistState,
  type UseUpcChecklistStateParams,
} from '@/features/census/components/patient-row/useUpcChecklistState';
import type { UpcChecklistRecord } from '@/domain/upc/upcContracts';

const previous: UpcChecklistRecord = {
  uciCriteria: ['uci_vmi', 'obsolete'],
  utiCriteria: ['uti_mon_cardiaca'],
  classification: 'UPC_UCI',
  evaluatedAt: '2026-09-03T12:00:00Z',
};
const setup = (overrides: Partial<UseUpcChecklistStateParams> = {}) => {
  const onSave = vi.fn().mockResolvedValue(true);
  const props: UseUpcChecklistStateParams = {
    checklist: undefined,
    onSave,
    uciAllowed: true,
    actor: { uid: 'test-account', displayName: 'Cuenta de prueba' },
    evaluationContext: {
      date: '2026-09-04',
      bedId: 'R1',
      nursesDayShift: ['Enfermera A', 'Enfermero B'],
      nursesNightShift: [],
    },
    ...overrides,
  };
  const hook = renderHook((p: UseUpcChecklistStateParams) => useUpcChecklistState(p), {
    initialProps: props,
  });
  return { ...hook, onSave, props };
};
const responsible = (result: ReturnType<typeof setup>['result']) => {
  act(() => result.current.setNurseName('Enfermera A'));
};

describe('UPC explicit evaluation', () => {
  it.each([['uci_inotropicos'], ['uci_vasoactivos'], ['uci_inotropicos', 'uci_vasoactivos']])(
    'hydrates legacy vasoactive/inotrope IDs %j as one selected criterion without auto-writing',
    (...ids) => {
      const { result, onSave } = setup({
        checklist: { ...previous, uciCriteria: ids, utiCriteria: [] },
      });
      act(() => result.current.resetFromPersisted());
      expect([...result.current.draftUci]).toEqual(['uci_vasoactivos']);
      expect(result.current.draftClassification).toBe('UPC_UCI');
      expect(onSave).not.toHaveBeenCalled();
      act(() => result.current.toggleUciCriterion('uci_vasoactivos'));
      expect(result.current.draftUci.size).toBe(0);
      expect(result.current.draftClassification).toBeNull();
    }
  );
  it('keeps selection as draft without timers or writes on unmount', () => {
    const { result, onSave, unmount } = setup();
    act(() => result.current.toggleUtiCriterion('uti_mon_cardiaca'));
    expect(result.current.draftClassification).toBe('UPC_UTI');
    expect(result.current.persistedChecklist).toBeUndefined();
    unmount();
    expect(onSave).not.toHaveBeenCalled();
  });
  it('hydrates valid criteria, with UCI forbidden on Neo', () => {
    const { result } = setup({ checklist: previous, uciAllowed: false });
    act(() => result.current.resetFromPersisted());
    expect([...result.current.draftUci]).toEqual([]);
    expect([...result.current.draftUti]).toEqual(['uti_mon_cardiaca']);
    act(() => result.current.toggleUciCriterion('uci_vmi'));
    act(() => result.current.toggleUtiCriterion('invalid'));
    expect(result.current.draftClassification).toBe('UPC_UTI');
  });
  it('sanitizes obsolete UCI IDs and supports deselection', () => {
    const { result } = setup({ checklist: previous });
    act(() => result.current.resetFromPersisted());
    expect([...result.current.draftUci]).toEqual(['uci_vmi']);
    act(() => result.current.toggleUciCriterion('uci_vmi'));
    act(() => result.current.toggleUtiCriterion('uti_mon_cardiaca'));
    expect(result.current.draftClassification).toBeNull();
  });
  it('requires a chosen responsible nurse and an authenticated audit account', async () => {
    const { result, onSave } = setup();
    await act(() => result.current.saveEvaluation());
    expect(onSave).not.toHaveBeenCalled();
    act(() => result.current.setNurseName('No asignada'));
    expect(result.current.canSave).toBe(false);
    responsible(result);
    expect(result.current.canSave).toBe(true);
    const unauthenticated = setup({ actor: null });
    responsible(unauthenticated.result);
    await act(() => unauthenticated.result.current.saveEvaluation());
    expect(unauthenticated.onSave).not.toHaveBeenCalled();
  });
  it('sends every final criterion and the complete audit in ONE awaited record', async () => {
    const { result, onSave } = setup();
    responsible(result);
    act(() => {
      result.current.toggleUciCriterion('uci_vmi');
      result.current.toggleUtiCriterion('uti_mon_cardiaca');
    });
    await act(() => result.current.saveEvaluation());
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        uciCriteria: ['uci_vmi'],
        utiCriteria: ['uti_mon_cardiaca'],
        classification: 'UPC_UCI',
        evaluatedForDate: '2026-09-04',
        evaluatedBedId: 'R1',
        reviewRequired: false,
        evaluatedBy: { uid: 'test-account', displayName: 'Cuenta de prueba' },
        responsibleNurse: { name: 'Enfermera A', source: 'assigned' },
      })
    );
    expect(Number.isFinite(Date.parse(onSave.mock.calls[0][0].evaluatedAt))).toBe(true);
    expect(onSave.mock.calls[0][0].evaluationId).toBeTruthy();
    expect(onSave.mock.calls[0][0].history).toHaveLength(1);
    expect(onSave.mock.calls[0][0].criterionLabels).toContain(
      'Ventilación mecánica invasiva (VMI)'
    );
    expect(result.current.saved).toBe(true);
    // The row reads the authoritative prop, not an optimistic copy.
    expect(result.current.persistedChecklist).toBeUndefined();
  });
  it('can explicitly confirm No UPC and use a typed nurse when no staff is assigned', async () => {
    const { result, onSave } = setup({
      evaluationContext: {
        date: '2026-09-04',
        bedId: 'R1',
        nursesDayShift: [],
        nursesNightShift: [],
      },
    });
    act(() => result.current.setNurseName('  Enfermera nocturna  '));
    await act(() => result.current.saveEvaluation());
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        classification: null,
        uciCriteria: [],
        utiCriteria: [],
        responsibleNurse: { name: 'Enfermera nocturna', source: 'manual' },
      })
    );
  });
  it('offers all assigned nurses once without requiring or storing a shift', async () => {
    const { result, onSave } = setup({
      evaluationContext: {
        date: '2026-09-04',
        bedId: 'R1',
        nursesDayShift: ['Enfermera A'],
        nursesNightShift: ['Enfermera A', 'Enfermera C'],
      },
    });
    expect(result.current.assignedNurseOptions).toEqual(['Enfermera A', 'Enfermera C']);
    act(() => result.current.setNurseName('Enfermera C'));
    await act(() => result.current.saveEvaluation());
    expect(onSave.mock.calls[0][0].responsibleNurse).toEqual({
      name: 'Enfermera C',
      source: 'assigned',
    });
  });
  it.each(['reject', 'false', 'undefined'])(
    'retains draft and supports retry after %s',
    async failure => {
      const { result, onSave } = setup();
      responsible(result);
      act(() => result.current.toggleUtiCriterion('uti_mon_cardiaca'));
      if (failure === 'reject') onSave.mockRejectedValueOnce(new Error('offline'));
      else onSave.mockResolvedValueOnce(failure === 'false' ? false : undefined);
      await act(() => result.current.saveEvaluation());
      expect(result.current.saved).toBe(false);
      expect(result.current.saveError).toMatch(/No se pudo confirmar/);
      expect(result.current.draftUti.has('uti_mon_cardiaca')).toBe(true);
      await act(() => result.current.saveEvaluation());
      expect(result.current.saved).toBe(true);
      expect(onSave).toHaveBeenCalledTimes(2);
      expect(onSave.mock.calls[1][0]).toEqual(onSave.mock.calls[0][0]);
    }
  );
  it('prevents double submits and criteria changes while confirming', async () => {
    let finish!: (value: boolean) => void;
    const pending = new Promise<boolean>(resolve => {
      finish = resolve;
    });
    const { result, onSave } = setup();
    onSave.mockReturnValue(pending);
    responsible(result);
    let saving!: Promise<void>;
    act(() => {
      saving = result.current.saveEvaluation();
    });
    act(() => {
      void result.current.saveEvaluation();
      result.current.toggleUciCriterion('uci_vmi');
    });
    expect(result.current.isSaving).toBe(true);
    expect(result.current.draftUci.size).toBe(0);
    expect(onSave).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish(true);
      await saving;
    });
    expect(result.current.isSaving).toBe(false);
  });
  it('rejects a draft after a remote review or a bed move invalidates it', async () => {
    const { result, props, rerender, onSave } = setup({ checklist: previous });
    act(() => result.current.resetFromPersisted());
    responsible(result);
    rerender({ ...props, checklist: { ...previous, reviewRequired: true } });
    await act(() => result.current.saveEvaluation());
    expect(onSave).not.toHaveBeenCalled();
    expect(result.current.saveError).toMatch(/otra sesión/);
    act(() => result.current.resetFromPersisted());
    responsible(result);
    await act(() => result.current.saveEvaluation());
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
