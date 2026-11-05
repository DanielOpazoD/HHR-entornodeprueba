import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MMRADExam, MMRADSearchResult } from '@/services/radiology/mmradService';
import { SESSION_OWNER_KEY } from '@/services/storage/sessionOwnerKey';
import { setSessionGeneration } from '@/services/storage/sessionStorageTransition';

const mmradMocks = vi.hoisted(() => ({ search: vi.fn(), checkDigit: vi.fn() }));
vi.mock('@/services/radiology/mmradService', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/radiology/mmradService')>();
  return {
    ...actual,
    searchMMRADExams: (...args: unknown[]) => mmradMocks.search(...args),
    searchMMRADCheckDigitExams: (...args: unknown[]) => mmradMocks.checkDigit(...args),
  };
});

import { searchMmradStudies } from '@/components/modals/controllers/mmradStudySearch';

const RUT = '12.345.678-5';
const exam = (name: string): MMRADExam => ({
  nombre_examen: name,
  fecha_examen: '02/11/2026 09:40',
  fecha_asignacion: '02/11/2026',
  mod: 'CR',
  estado: 'Validado',
  pdf_url: null,
  dicom_url: null,
  informe_html_url: `https://ris.synthetic/${encodeURIComponent(name)}`,
  report: null,
});
const reply = (examenes: MMRADExam[]): MMRADSearchResult => ({ rut: '12345678-5', examenes });
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('searchMmradStudies', () => {
  let generation = 0;
  beforeEach(() => {
    mmradMocks.search.mockReset();
    mmradMocks.checkDigit.mockReset();
    localStorage.setItem(SESSION_OWNER_KEY, 'user:synthetic');
    setSessionGeneration(`synthetic-${++generation}`);
  });
  afterEach(() => {
    setSessionGeneration(null);
    localStorage.removeItem(SESSION_OWNER_KEY);
  });

  it('shows the exact answer, merges the check-digit one, and remembers both for the session', async () => {
    mmradMocks.search.mockResolvedValue(reply([exam('Rx tórax')]));
    mmradMocks.checkDigit.mockResolvedValue(reply([exam('TC abdomen')]));
    const shown: Array<[string[], boolean]> = [];
    const settled = vi.fn();
    const first = searchMmradStudies(
      { rut: RUT, patientName: 'PACIENTE', dateFrom: '', dateTo: '' },
      { isCurrent: () => true, onShown: (r, exact) => shown.push([r.examenes.map(e => e.nombre_examen), exact]), onExactError: vi.fn(), onAlternateSettled: settled }
    );
    expect(first.remembered).toBeUndefined();
    await first.done;
    await flush();
    expect(shown.map(([names]) => names.sort())).toEqual(
      expect.arrayContaining([['Rx tórax', 'TC abdomen']])
    );
    expect(settled).toHaveBeenCalledTimes(1);
    const second = searchMmradStudies(
      { rut: RUT, dateFrom: '', dateTo: '' },
      { isCurrent: () => true, onShown: vi.fn(), onExactError: vi.fn() }
    );
    expect(second.remembered?.examenes.map(e => e.nombre_examen).sort()).toEqual(['Rx tórax', 'TC abdomen']);
    await second.done;
  });

  it('tells the exact failure apart from a refresh failure and keeps a failed alternate as partial', async () => {
    mmradMocks.search.mockRejectedValueOnce(new Error('Demasiadas solicitudes.'));
    mmradMocks.checkDigit.mockRejectedValue(new Error('timeout'));
    const errors: Array<[string, boolean]> = [];
    const shown: MMRADSearchResult[] = [];
    const first = searchMmradStudies(
      { rut: RUT, patientName: 'PACIENTE', dateFrom: '', dateTo: '' },
      { isCurrent: () => true, onShown: r => shown.push(r), onExactError: (m, remembered) => errors.push([m, remembered]) }
    );
    await first.done;
    await flush();
    expect(errors).toEqual([['Demasiadas solicitudes.', false]]);
    expect(shown.at(-1)?.check_digit_search).toBe('partial');

    mmradMocks.search.mockResolvedValueOnce(reply([exam('Rx tórax')]));
    await searchMmradStudies({ rut: RUT, dateFrom: '', dateTo: '' }, { isCurrent: () => true, onShown: vi.fn(), onExactError: vi.fn() }).done;
    mmradMocks.search.mockRejectedValueOnce(new Error('sin red'));
    const refresh = searchMmradStudies(
      { rut: RUT, dateFrom: '', dateTo: '' },
      { isCurrent: () => true, onShown: vi.fn(), onExactError: (m, remembered) => errors.push([m, remembered]) }
    );
    expect(refresh.remembered?.examenes).toHaveLength(1);
    await refresh.done;
    expect(errors.at(-1)).toEqual(['sin red', true]);
  });

  it('never shows a late answer once the caller moved on, and skips the alternate without a name', async () => {
    let current = true;
    let resolveExact: (value: MMRADSearchResult) => void = () => undefined;
    mmradMocks.search.mockReturnValueOnce(new Promise(resolve => { resolveExact = resolve; }));
    const onShown = vi.fn();
    const settled = vi.fn();
    const handle = searchMmradStudies(
      { rut: RUT, dateFrom: '', dateTo: '' },
      { isCurrent: () => current, onShown, onExactError: vi.fn(), onAlternateSettled: settled }
    );
    expect(mmradMocks.checkDigit).not.toHaveBeenCalled();
    expect(settled).toHaveBeenCalledTimes(1);
    current = false;
    resolveExact(reply([exam('Rx tórax')]));
    await handle.done;
    expect(onShown).not.toHaveBeenCalled();
  });
});
