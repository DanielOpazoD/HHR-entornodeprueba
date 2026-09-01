import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  UPC_SAVE_COALESCE_MS,
  useUpcChecklistState,
} from '@/features/census/components/patient-row/useUpcChecklistState';
import type { UpcChecklistRecord, UpcChecklistAuditActor } from '@/domain/upc/upcContracts';

const ACTOR: UpcChecklistAuditActor = { uid: 'u1', displayName: 'Dr. Test' };

const makeChecklist = (
  uci: string[] = [],
  uti: string[] = [],
  classification: UpcChecklistRecord['classification'] = null
): UpcChecklistRecord => ({
  uciCriteria: uci,
  utiCriteria: uti,
  classification,
  evaluatedAt: '2026-04-14T00:00:00Z',
});

describe('useUpcChecklistState', () => {
  const createSaveMock = () =>
    vi.fn() as unknown as ((record: UpcChecklistRecord) => void) & {
      mock: { calls: [UpcChecklistRecord][] };
    };
  let onSave: ReturnType<typeof createSaveMock>;

  beforeEach(() => {
    onSave = createSaveMock();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const flushCoalescedSave = () => act(() => vi.advanceTimersByTime(UPC_SAVE_COALESCE_MS));

  // ── Initial state ──────────────────────────────────────────────

  it('starts with empty draft', () => {
    const { result } = renderHook(() =>
      useUpcChecklistState({ checklist: undefined, onSave, uciAllowed: true, actor: ACTOR })
    );
    expect(result.current.draftUci.size).toBe(0);
    expect(result.current.draftUti.size).toBe(0);
    expect(result.current.draftClassification).toBeNull();
    expect(result.current.hasDraftCriteria).toBe(false);
  });

  // ── resetFromPersisted ─────────────────────────────────────────

  it('hydrates draft from persisted checklist', () => {
    const checklist = makeChecklist(['uci_vmi'], ['uti_mon_cardiaca'], 'UPC_UCI');
    const { result } = renderHook(() =>
      useUpcChecklistState({ checklist, onSave, uciAllowed: true, actor: ACTOR })
    );

    act(() => result.current.resetFromPersisted());

    expect(result.current.draftUci.has('uci_vmi')).toBe(true);
    expect(result.current.draftUti.has('uti_mon_cardiaca')).toBe(true);
    expect(result.current.draftClassification).toBe('UPC_UCI');
  });

  it('strips invalid/stale criterion IDs on reset', () => {
    const checklist = makeChecklist(['uci_vmi', 'stale_id'], ['bad_uti'], 'UPC_UCI');
    const { result } = renderHook(() =>
      useUpcChecklistState({ checklist, onSave, uciAllowed: true, actor: ACTOR })
    );

    act(() => result.current.resetFromPersisted());

    expect(result.current.draftUci.size).toBe(1);
    expect(result.current.draftUci.has('uci_vmi')).toBe(true);
    expect(result.current.draftUti.size).toBe(0);
  });

  it('clears UCI criteria when uciAllowed is false (Neo beds)', () => {
    const checklist = makeChecklist(['uci_vmi'], ['uti_mon_cardiaca'], 'UPC_UCI');
    const { result } = renderHook(() =>
      useUpcChecklistState({ checklist, onSave, uciAllowed: false, actor: ACTOR })
    );

    act(() => result.current.resetFromPersisted());

    expect(result.current.draftUci.size).toBe(0);
    expect(result.current.draftUti.has('uti_mon_cardiaca')).toBe(true);
    expect(result.current.draftClassification).toBe('UPC_UTI');
  });

  // ── Toggle criteria ────────────────────────────────────────────

  it('toggles UCI criterion on and off', () => {
    const { result } = renderHook(() =>
      useUpcChecklistState({ checklist: undefined, onSave, uciAllowed: true, actor: ACTOR })
    );

    act(() => result.current.toggleUciCriterion('uci_vmi'));
    expect(result.current.draftUci.has('uci_vmi')).toBe(true);
    expect(result.current.draftClassification).toBe('UPC_UCI');

    act(() => result.current.toggleUciCriterion('uci_vmi'));
    expect(result.current.draftUci.has('uci_vmi')).toBe(false);
    expect(result.current.draftClassification).toBeNull();
  });

  it('toggles UTI criterion and computes UTI classification', () => {
    const { result } = renderHook(() =>
      useUpcChecklistState({ checklist: undefined, onSave, uciAllowed: true, actor: ACTOR })
    );

    act(() => result.current.toggleUtiCriterion('uti_mon_cardiaca'));
    expect(result.current.draftClassification).toBe('UPC_UTI');
    expect(result.current.hasDraftCriteria).toBe(true);
  });

  it('UCI takes precedence over UTI', () => {
    const { result } = renderHook(() =>
      useUpcChecklistState({ checklist: undefined, onSave, uciAllowed: true, actor: ACTOR })
    );

    act(() => {
      result.current.toggleUtiCriterion('uti_mon_cardiaca');
      result.current.toggleUciCriterion('uci_vasoactivos');
    });

    expect(result.current.draftClassification).toBe('UPC_UCI');
  });

  // ── Auto-save ───────────────────────────────────────────────────

  it('saves current draft with classification and actor on selection', () => {
    const { result } = renderHook(() =>
      useUpcChecklistState({ checklist: undefined, onSave, uciAllowed: true, actor: ACTOR })
    );

    act(() => result.current.toggleUtiCriterion('uti_materno_fetal'));
    flushCoalescedSave();

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0] as UpcChecklistRecord;
    expect(saved.utiCriteria).toEqual(['uti_materno_fetal']);
    expect(saved.uciCriteria).toEqual([]);
    expect(saved.classification).toBe('UPC_UTI');
    expect(saved.evaluatedAt).toBeTruthy();
    expect(saved.evaluatedBy).toEqual({ uid: 'u1', displayName: 'Dr. Test' });
  });

  it('reopens with the last saved draft even before the external checklist prop roundtrip completes', () => {
    const { result } = renderHook(() =>
      useUpcChecklistState({ checklist: undefined, onSave, uciAllowed: true, actor: ACTOR })
    );

    act(() => result.current.toggleUtiCriterion('uti_materno_fetal'));

    act(() => result.current.resetFromPersisted());

    expect(result.current.draftUti.has('uti_materno_fetal')).toBe(true);
    expect(result.current.draftClassification).toBe('UPC_UTI');
  });

  it('saves without evaluatedBy when actor is null', () => {
    const { result } = renderHook(() =>
      useUpcChecklistState({ checklist: undefined, onSave, uciAllowed: true, actor: null })
    );

    act(() => result.current.toggleUciCriterion('uci_vmi'));
    flushCoalescedSave();

    const saved = onSave.mock.calls[0][0] as UpcChecklistRecord;
    expect(saved.evaluatedBy).toBeUndefined();
  });

  it('saves a No UPC state when the last selected criterion is removed', () => {
    const checklist = makeChecklist([], ['uti_mon_cardiaca'], 'UPC_UTI');
    const { result } = renderHook(() =>
      useUpcChecklistState({ checklist, onSave, uciAllowed: true, actor: ACTOR })
    );

    act(() => result.current.resetFromPersisted());
    (onSave as unknown as { mockClear: () => void }).mockClear();

    act(() => result.current.toggleUtiCriterion('uti_mon_cardiaca'));
    flushCoalescedSave();

    expect(result.current.draftUti.size).toBe(0);
    const saved = onSave.mock.calls[0][0] as UpcChecklistRecord;
    expect(saved.classification).toBeNull();
    expect(saved.uciCriteria).toEqual([]);
    expect(saved.utiCriteria).toEqual([]);
  });

  it('coalesce la ráfaga de toggles en UNA escritura con el estado final', () => {
    // Antes: una escritura por checkbox → dos writes al callable clínico se
    // pisaban por versión y el segundo criterio se perdía («seleccionar dos
    // veces»). La UI sigue optimista al instante; el write viaja coalescido.
    const { result } = renderHook(() =>
      useUpcChecklistState({ checklist: undefined, onSave, uciAllowed: true, actor: ACTOR })
    );

    act(() => {
      result.current.toggleUciCriterion('uci_vmi');
      result.current.toggleUtiCriterion('uti_mon_cardiaca');
      result.current.toggleUciCriterion('uci_vmi'); // untoggle
    });
    expect(onSave).toHaveBeenCalledTimes(0);
    flushCoalescedSave();

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0] as UpcChecklistRecord;
    expect(saved.uciCriteria).toEqual([]);
    expect(saved.utiCriteria).toEqual(['uti_mon_cardiaca']);
    expect(saved.classification).toBe('UPC_UTI');
  });

  it('al desmontar descarga la escritura pendiente sin esperar el timer', () => {
    const { result, unmount } = renderHook(() =>
      useUpcChecklistState({ checklist: undefined, onSave, uciAllowed: true, actor: ACTOR })
    );

    act(() => result.current.toggleUciCriterion('uci_vmi'));
    expect(onSave).toHaveBeenCalledTimes(0);
    unmount();

    expect(onSave).toHaveBeenCalledTimes(1);
    expect((onSave.mock.calls[0][0] as UpcChecklistRecord).uciCriteria).toEqual(['uci_vmi']);
  });
});
