import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAppState } from '@/hooks/useAppState';
import { useDateNavigation } from '@/hooks/useDateNavigation';

const useClinicalNavigation = () => {
  const dateNav = useDateNavigation();
  const ui = useAppState({ date: dateNav.currentDateString });
  return { dateNav, ui };
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-02-20T12:59:00.000Z'));
  window.history.replaceState({}, '', '/');
});
afterEach(() => vi.useRealTimers());

it.each(['/censo', '/medical-handoff', '/nursing-handoff', '/cudyr'])(
  'keeps the selected clinical date on %s after changing days and remounting',
  path => {
    window.history.replaceState(
      { synthetic: 'keep' },
      '',
      `${path}?date=2026-02-20&scope=all#detail`
    );
    const view = renderHook(useClinicalNavigation);
    const module = view.result.current.ui.currentModule;
    expect(view.result.current.dateNav.currentDateString).toBe('2026-02-20');
    expect(new URL(window.location.href).searchParams.get('date')).toBe('2026-02-20');
    act(() => view.result.current.dateNav.navigateDays(1));
    expect(new URL(window.location.href).searchParams.get('date')).toBe('2026-02-21');
    expect(new URL(window.location.href).searchParams.get('scope')).toBe('all');
    expect(window.location.hash).toBe('#detail');
    expect(window.history.state).toEqual({ synthetic: 'keep' });
    view.unmount();
    const reopened = renderHook(useClinicalNavigation);
    expect(reopened.result.current.dateNav.currentDateString).toBe('2026-02-21');
    expect(reopened.result.current.ui.currentModule).toBe(module);
  }
);

it('keeps the clinical clock for a fresh landing and then records the selected date', () => {
  window.history.replaceState({}, '', '/medical-handoff');
  const view = renderHook(useClinicalNavigation);
  // 07:59 hospital time: still the previous clinical day.
  expect(view.result.current.dateNav.currentDateString).toBe('2026-02-19');
  expect(new URL(window.location.href).searchParams.get('date')).toBe('2026-02-19');
});

it('updates the same date across month/year boundaries and clinical module changes', () => {
  window.history.replaceState({}, '', '/medical-handoff?date=2026-12-31');
  const view = renderHook(useClinicalNavigation);
  act(() => view.result.current.dateNav.navigateDays(1));
  act(() => view.result.current.ui.setCurrentModule('NURSING_HANDOFF'));
  expect(window.location.pathname).toBe('/nursing-handoff');
  expect(new URL(window.location.href).searchParams.get('date')).toBe('2027-01-01');
  act(() => view.result.current.ui.setCurrentModule('AUDIT'));
  expect(new URL(window.location.href).searchParams.has('date')).toBe(false);
  act(() => view.result.current.ui.setCurrentModule('CENSUS'));
  expect(new URL(window.location.href).searchParams.get('date')).toBe('2027-01-01');
});

it('leaves embedded signature URLs intact when URL synchronization is disabled', () => {
  const original = '/admin?date=2026-02-20&scope=all&token=redacted';
  window.history.replaceState({}, '', original);
  const view = renderHook(
    ({ date }) => useAppState({ initialModule: 'MEDICAL_HANDOFF', syncUrl: false, date }),
    {
      initialProps: { date: '2026-02-20' },
    }
  );
  view.rerender({ date: '2026-02-21' });
  act(() => view.result.current.setCurrentModule('CENSUS'));
  expect(window.location.pathname + window.location.search).toBe(original);
});
