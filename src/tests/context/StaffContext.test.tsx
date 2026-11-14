import { memo, useLayoutEffect } from 'react';
import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StaffProvider, useStaffContext, type StaffContextType } from '@/context/StaffContext';
import type { ProfessionalCatalogItem } from '@/types/domain/professionals';
import type { EloisaStaffIdentity } from '@/services/staff/eloisaStaffIdentity';
import type { StaffUsage } from '@/services/staff/staffUsage';

vi.unmock('@/context/StaffContext');

const hooks = vi.hoisted(() => ({
  nurses: vi.fn(),
  tens: vi.fn(),
  professionals: vi.fn(),
  saveNurses: vi.fn(),
  saveTens: vi.fn(),
  saveProfessionals: vi.fn(),
  usage: vi.fn(),
}));
vi.mock('@/hooks/useStaffQuery', () => ({
  useNursesQuery: hooks.nurses,
  useTensQuery: hooks.tens,
  useProfessionalsQuery: hooks.professionals,
  useSaveNursesMutation: hooks.saveNurses,
  useSaveTensMutation: hooks.saveTens,
  useSaveProfessionalsMutation: hooks.saveProfessionals,
}));
vi.mock('@/hooks/useStaffUsage', () => ({ useStaffUsage: hooks.usage }));

let state: {
  nurses: string[] | undefined;
  tens: string[] | undefined;
  professionals: ProfessionalCatalogItem[] | undefined;
  identities: EloisaStaffIdentity[] | undefined;
  nursesLoading: boolean;
  tensLoading: boolean;
  professionalsLoading: boolean;
  usage: StaffUsage;
  saveNurses: ReturnType<typeof vi.fn>;
  saveTens: ReturnType<typeof vi.fn>;
  saveProfessionals: ReturnType<typeof vi.fn>;
};

const harness = (count = 1) => {
  let value: StaffContextType | undefined;
  const renders = Array<number>(count).fill(0);
  const Consumer = memo(function StaffConsumer({ index }: { index: number }) {
    const current = useStaffContext();
    useLayoutEffect(() => {
      renders[index]++;
      value = current;
    });
    return <span>{current.nursesList.join(',')}</span>;
  });
  const children = Array.from({ length: count }, (_, index) => (
    <Consumer key={index} index={index} />
  ));
  const root = render(<StaffProvider>{children}</StaffProvider>);
  return {
    current: () => {
      if (!value) throw new Error('Provider did not publish');
      return value;
    },
    renders,
    rerender: () => root.rerender(<StaffProvider>{children}</StaffProvider>),
    unmount: root.unmount,
  };
};

describe('StaffProvider publication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state = {
      nurses: ['Synthetic Nurse'],
      tens: ['Synthetic TENS'],
      professionals: [],
      identities: [],
      nursesLoading: false,
      tensLoading: false,
      professionalsLoading: false,
      usage: { nurse: {}, tens: {} },
      saveNurses: vi.fn(),
      saveTens: vi.fn(),
      saveProfessionals: vi.fn(),
    };
    hooks.nurses.mockImplementation(() => ({
      data: state.nurses,
      identities: state.identities,
      isLoading: state.nursesLoading,
    }));
    hooks.tens.mockImplementation(() => ({
      data: state.tens,
      isLoading: state.tensLoading,
    }));
    hooks.professionals.mockImplementation(() => ({
      data: state.professionals,
      isLoading: state.professionalsLoading,
    }));
    // Mutation wrappers intentionally change on each render, as query bookkeeping can do.
    hooks.saveNurses.mockImplementation(() => ({ mutate: state.saveNurses }));
    hooks.saveTens.mockImplementation(() => ({ mutate: state.saveTens }));
    hooks.saveProfessionals.mockImplementation(() => ({ mutate: state.saveProfessionals }));
    hooks.usage.mockImplementation(() => state.usage);
  });

  it.each(['loaded', 'loading'] as const)(
    'does not broadcast unchanged %s data on 50 parent renders',
    mode => {
      if (mode === 'loading') {
        state.nurses = state.tens = undefined;
        state.professionals = undefined;
        state.identities = undefined;
        state.nursesLoading = state.tensLoading = state.professionalsLoading = true;
      }
      const view = harness(20);
      const initial = view.current();
      for (let i = 0; i < 50; i++) view.rerender();
      expect(view.renders.reduce((sum, count) => sum + count, 0) - 20).toBe(0);
      expect(view.current()).toBe(initial);
      view.unmount();
    }
  );

  const identity: EloisaStaffIdentity = {
    key: 'synthetic',
    role: 'nurse',
    name: 'Synthetic Nurse Two',
    aliases: [],
  };
  const changes: [string, () => void, Partial<StaffContextType>][] = [
    [
      'nurse catalog',
      () => {
        state.nurses = ['  SYNTHETIC NURSE TWO ', 'Synthetic Nurse Two'];
      },
      { nursesList: ['Synthetic Nurse Two'] },
    ],
    [
      'TENS catalog',
      () => {
        state.tens = ['Synthetic TENS Two'];
      },
      { tensList: ['Synthetic TENS Two'] },
    ],
    [
      'professionals',
      () => {
        state.professionals = [{ name: 'Synthetic Professional', phone: '' }];
      },
      { professionalsCatalog: [{ name: 'Synthetic Professional', phone: '' }] },
    ],
    [
      'identities',
      () => {
        state.identities = [identity];
      },
      { staffIdentities: [identity] },
    ],
    [
      'usage',
      () => {
        state.usage = { nurse: { synthetic: 3 }, tens: {} };
      },
      { staffUsage: { nurse: { synthetic: 3 }, tens: {} } },
    ],
    [
      'nurse loading',
      () => {
        state.nursesLoading = true;
      },
      { nursesLoading: true },
    ],
    [
      'TENS loading',
      () => {
        state.tensLoading = true;
      },
      { tensLoading: true },
    ],
    [
      'professional loading',
      () => {
        state.professionalsLoading = true;
      },
      { professionalsLoading: true },
    ],
  ];
  it.each(changes)(
    'publishes a change to %s without depending on another field',
    (_name, change, expected) => {
      const view = harness();
      const initial = view.current();
      change();
      view.rerender();
      expect(view.current()).not.toBe(initial);
      expect(view.current()).toMatchObject(expected);
      expect(hooks.usage).toHaveBeenLastCalledWith(state.identities);
      view.unmount();
    }
  );

  it('publishes independent manager visibility changes', () => {
    const view = harness();
    act(() => view.current().setShowNurseManager(true));
    expect(view.current().showNurseManager).toBe(true);
    act(() => view.current().setShowTensManager(true));
    expect(view.current().showTensManager).toBe(true);
    act(() => {
      view.current().setShowNurseManager(false);
      view.current().setShowTensManager(false);
    });
    expect(view.current()).toMatchObject({ showNurseManager: false, showTensManager: false });
    view.unmount();
  });

  it('forwards normalized commands to the current mutation owner', () => {
    const view = harness();
    const old = state.saveNurses;
    state.saveNurses = vi.fn();
    state.saveTens = vi.fn();
    state.saveProfessionals = vi.fn();
    view.rerender();
    const professionals = [{ name: 'Synthetic Professional', phone: '' }];
    act(() => {
      view.current().setNursesList(['  SYNTHETIC  NURSE ', 'Synthetic Nurse']);
      view.current().setTensList(['Synthetic TENS']);
      view.current().setProfessionalsCatalog(professionals);
    });
    expect(old).not.toHaveBeenCalled();
    expect(state.saveNurses).toHaveBeenCalledExactlyOnceWith({
      next: ['Synthetic Nurse'],
      base: state.nurses,
    });
    expect(state.saveTens).toHaveBeenCalledExactlyOnceWith({
      next: ['Synthetic TENS'],
      base: state.tens,
    });
    expect(state.saveProfessionals).toHaveBeenCalledExactlyOnceWith({
      next: professionals,
      base: state.professionals,
    });
    view.unmount();
  });

  it('setters change exactly the saved texts behind each shown row', () => {
    state.nurses = ['Synthetic Canonical', 'Synthetic Eloisa'];
    state.tens = ['Synthetic TENS', 'Synthetic TENS Eloisa'];
    const savedTexts: Record<string, string[]> = {
      'Synthetic Canonical': ['Synthetic Alias'],
      'Synthetic TENS': ['Synthetic TENS'],
    };
    const textsOf = (name: string) => savedTexts[name] ?? [];
    const nursesSaved = { list: ['Synthetic Alias'], textsOf };
    const tensSaved = { list: ['Synthetic TENS'], textsOf };
    hooks.nurses.mockImplementation(() => ({
      data: state.nurses,
      saved: nursesSaved,
      identities: state.identities,
      isLoading: false,
    }));
    hooks.tens.mockImplementation(() => ({ data: state.tens, saved: tensSaved, isLoading: false }));
    const view = harness();
    expect(view.current()).toMatchObject({ nursesSaved, tensSaved });
    act(() => {
      view.current().setNursesList(['Synthetic Eloisa']);
      view.current().setTensList(['Synthetic TENS', 'Synthetic TENS Renamed']);
    });
    expect(state.saveNurses).toHaveBeenCalledExactlyOnceWith({
      next: [],
      base: ['Synthetic Alias'],
    });
    expect(state.saveTens).toHaveBeenCalledExactlyOnceWith({
      next: ['Synthetic TENS', 'Synthetic TENS Renamed'],
      base: ['Synthetic TENS'],
    });
    view.unmount();
  });
});
