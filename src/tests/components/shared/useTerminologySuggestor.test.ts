import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  searchDiagnoses,
  forceAISearch,
  type TerminologyConcept,
} from '@/services/terminology/terminologyService';
import { cacheAIResults } from '@/services/terminology/aiResultsCache';
import { checkAIAvailability } from '@/services/terminology/cie10AISearch';
import { useTerminologySuggestor } from '@/components/shared/hooks/useTerminologySuggestor';

vi.mock('@/services/terminology/terminologyService', () => ({
  searchDiagnoses: vi.fn().mockResolvedValue([]),
  forceAISearch: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/services/terminology/cie10AISearch', () => ({
  checkAIAvailability: vi.fn().mockResolvedValue(false),
}));

vi.mock('@/services/terminology/aiResultsCache', () => ({
  getCachedAIResults: vi.fn().mockReturnValue(null),
  cacheAIResults: vi.fn(),
}));

describe('useTerminologySuggestor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('checks availability again when reopening after a failed probe', async () => {
    vi.mocked(checkAIAvailability).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const { result } = renderHook(() => useTerminologySuggestor({ value: '', onChange: vi.fn() }));
    await act(async () => {
      result.current.actions.setIsModalOpen(true);
    });
    expect(result.current.state.aiEnabled).toBe(false);
    await act(async () => {
      result.current.actions.setIsModalOpen(false);
    });
    await act(async () => {
      result.current.actions.setIsModalOpen(true);
    });
    expect(result.current.state.aiEnabled).toBe(true);
    expect(checkAIAvailability).toHaveBeenCalledTimes(2);
  });

  it('preserves the selected cie10 text when reopening the modal', async () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useTerminologySuggestor({
        value: 'Taquicardia supraventricular [I47.1]',
        onChange,
        cie10Code: 'I47.1',
        freeTextValue: 'taquicardia',
      })
    );

    await act(async () => {
      result.current.actions.setQuery('Taquicardia supraventricular [I47.1]');
      result.current.actions.setIsModalOpen(true);
    });

    await waitFor(() => {
      expect(result.current.state.query).toBe('Taquicardia supraventricular [I47.1]');
    });
  });
});

const concept = (display: string): TerminologyConcept => ({
  code: 'Z00',
  display,
  system: 'http://hl7.org/fhir/sid/icd-10',
  fromAI: true,
});

function deferredResults() {
  let resolve!: (results: TerminologyConcept[]) => void;
  const promise = new Promise<TerminologyConcept[]>(finish => {
    resolve = finish;
  });
  return { promise, resolve };
}

describe('active terminology search', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(searchDiagnoses).mockReset().mockResolvedValue([]);
    vi.mocked(forceAISearch).mockReset().mockResolvedValue([]);
    vi.mocked(cacheAIResults).mockClear();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  const openSuggestor = async () => {
    const hook = renderHook(() => useTerminologySuggestor({ value: '', onChange: vi.fn() }));
    await act(async () => {
      hook.result.current.actions.setQuery('first');
      hook.result.current.actions.setIsModalOpen(true);
    });
    return hook;
  };

  it('keeps the newer query when the previous local search resolves late', async () => {
    const old = deferredResults();
    vi.mocked(searchDiagnoses)
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce([concept('new')]);
    const { result } = await openSuggestor();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    const oldSignal = vi.mocked(searchDiagnoses).mock.calls[0][1];
    await act(async () => {
      result.current.actions.setQuery('second');
    });
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    await act(async () => {
      old.resolve([concept('obsolete')]);
    });
    expect(result.current.state.suggestions).toEqual([concept('new')]);
    expect(result.current.state.isLoading).toBe(false);
  });

  it('clears loading and results when the query becomes too short', async () => {
    const old = deferredResults();
    vi.mocked(searchDiagnoses).mockReturnValueOnce(old.promise);
    const { result } = await openSuggestor();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(result.current.state.isLoading).toBe(true);
    await act(async () => {
      result.current.actions.setQuery('');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(result.current.state.isLoading).toBe(false);
    await act(async () => {
      old.resolve([concept('obsolete')]);
    });
    expect(result.current.state.suggestions).toEqual([]);
  });

  it('lets manual AI supersede a scheduled automatic search', async () => {
    const ai = deferredResults();
    vi.mocked(forceAISearch).mockReturnValueOnce(ai.promise);
    const { result } = await openSuggestor();
    let request!: Promise<void>;
    await act(async () => {
      request = result.current.actions.handleForceAI();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(searchDiagnoses).not.toHaveBeenCalled();
    await act(async () => {
      ai.resolve([concept('AI')]);
      await request;
    });
    expect(result.current.state.suggestions).toEqual([concept('AI')]);
  });

  it('cancels manual AI on close and ignores it after reopening', async () => {
    const ai = deferredResults();
    vi.mocked(forceAISearch).mockReturnValueOnce(ai.promise);
    const { result } = await openSuggestor();
    let request!: Promise<void>;
    await act(async () => {
      request = result.current.actions.handleForceAI();
    });
    const signal = vi.mocked(forceAISearch).mock.calls[0][1];
    await act(async () => {
      result.current.actions.setIsModalOpen(false);
    });
    expect(signal?.aborted).toBe(true);
    expect(result.current.state.isLoading).toBe(false);
    await act(async () => {
      result.current.actions.setIsModalOpen(true);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    await act(async () => {
      ai.resolve([concept('obsolete')]);
      await request;
    });
    expect(result.current.state.suggestions).toEqual([]);
    expect(cacheAIResults).not.toHaveBeenCalled();
  });

  it.each(['query', 'code'])(
    'invalidates manual AI on %s change without caching an obsolete alias',
    async field => {
      const ai = deferredResults();
      vi.mocked(forceAISearch).mockReturnValueOnce(ai.promise);
      const { result, rerender } = renderHook(
        ({ cie10Code }) =>
          useTerminologySuggestor({ value: 'initial text', cie10Code, onChange: vi.fn() }),
        { initialProps: { cie10Code: 'Z00' } }
      );
      await act(async () => {
        result.current.actions.setIsModalOpen(true);
      });
      let request!: Promise<void>;
      await act(async () => {
        request = result.current.actions.handleForceAI();
      });
      const signal = vi.mocked(forceAISearch).mock.calls[0][1];
      await act(async () => {
        if (field === 'query') result.current.actions.setQuery('new text');
        else rerender({ cie10Code: 'Z01' });
      });
      expect(signal?.aborted).toBe(true);
      await act(async () => {
        ai.resolve([concept('obsolete')]);
        await request;
      });
      expect(cacheAIResults).not.toHaveBeenCalled();
      expect(result.current.state.suggestions).toEqual([]);
    }
  );

  it('cancels manual AI when the hook unmounts', async () => {
    const ai = deferredResults();
    vi.mocked(forceAISearch).mockReturnValueOnce(ai.promise);
    const { result, unmount } = await openSuggestor();
    let request!: Promise<void>;
    await act(async () => {
      request = result.current.actions.handleForceAI();
    });
    const signal = vi.mocked(forceAISearch).mock.calls[0][1];
    unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      ai.resolve([concept('obsolete')]);
      await request;
    });
  });
});
