import React from 'react';
import { vi } from 'vitest';
import { act, render, type RenderResult } from '@testing-library/react';
import type { PatientData } from '@/types/domain/patient';

export interface MockUpcWindowProps {
  currentDateString: string;
  readOnly?: boolean;
  initialBedId?: string | null;
  onClose: () => void;
}

export const UPC_WINDOW_MODULE_PATH =
  '@/features/census/components/patient-row/UpcClassificationWindow';
const UPC_CONTEXT_MODULE_PATH =
  '@/features/census/components/patient-row/UpcClassificationWindowContext';

export const loadFreshUpcContext = async () => {
  const [mod, identityMod, providerTree] = await Promise.all([
    import(UPC_CONTEXT_MODULE_PATH),
    import('@/features/census/components/patient-row/upcCellSubjectIdentity'),
    import('@/context/dailyRecordProviderTree'),
  ]);
  return {
    DailyRecordBedsContext: providerTree.DailyRecordBedsContext,
    isSameUpcCellSubjectIdentity: identityMod.isSameUpcCellSubjectIdentity as (
      expected: string | null | undefined,
      current: string | null | undefined
    ) => boolean,
    resolveUpcCellSubjectIdentity: identityMod.resolveUpcCellSubjectIdentity as (
      subject?: Partial<PatientData> | null
    ) => string | null,
    UpcClassificationWindowProvider: mod.UpcClassificationWindowProvider as React.FC<{
      currentDateString: string;
      readOnly?: boolean;
      children: React.ReactNode;
    }>,
    useUpcClassificationWindowOpener: mod.useUpcClassificationWindowOpener as () => {
      openUpcWindow: (
        bedId?: string,
        options?: {
          crib?: boolean;
          episodeIdentity?: string | null;
          triggerElement?: HTMLElement | null;
        }
      ) => void;
    },
  };
};

export type FreshUpcContext = Awaited<ReturnType<typeof loadFreshUpcContext>>;

export const mockDeferredUpcWindow = (options?: { failFirstWith?: string }) => {
  let attempts = 0;
  let resolveChunk:
    | ((value: { UpcClassificationWindow: React.FC<MockUpcWindowProps> }) => void)
    | null = null;
  const chunkPromise = new Promise<{
    UpcClassificationWindow: React.FC<MockUpcWindowProps>;
  }>(resolve => {
    resolveChunk = resolve;
  });

  vi.doMock(UPC_WINDOW_MODULE_PATH, () => {
    attempts += 1;
    if (options?.failFirstWith && attempts === 1) {
      throw new Error(options.failFirstWith);
    }
    return chunkPromise;
  });

  return {
    resolveDialog: async (
      Component: React.FC<MockUpcWindowProps> = ({ initialBedId }) => (
        <div role="dialog" aria-label="Clasificación UPC">
          {initialBedId}
        </div>
      )
    ) => {
      await act(async () => {
        resolveChunk?.({ UpcClassificationWindow: Component });
        await chunkPromise;
      });
    },
  };
};

export const createUpcBedsHarness = (
  ctx: FreshUpcContext,
  options: {
    date?: string;
    bedId: string;
    crib?: boolean;
    buttonLabel: string;
    resolveIdentity?: (subject: PatientData) => string | null;
  }
) => {
  const {
    date = '2026-11-24',
    bedId,
    crib,
    buttonLabel,
    resolveIdentity = ctx.resolveUpcCellSubjectIdentity,
  } = options;

  const Trigger = ({ subject }: { subject: PatientData }) => {
    const { openUpcWindow } = ctx.useUpcClassificationWindowOpener();
    return (
      <button
        type="button"
        onClick={event =>
          openUpcWindow(bedId, {
            ...(crib ? { crib: true } : {}),
            episodeIdentity: resolveIdentity(subject),
            triggerElement: event.currentTarget,
          })
        }
      >
        {buttonLabel}
      </button>
    );
  };

  const buildTree = (beds: Record<string, PatientData>, subject: PatientData) => (
    <ctx.DailyRecordBedsContext.Provider value={beds}>
      <ctx.UpcClassificationWindowProvider currentDateString={date}>
        <Trigger subject={subject} />
      </ctx.UpcClassificationWindowProvider>
    </ctx.DailyRecordBedsContext.Provider>
  );

  let view: RenderResult | null = null;
  return {
    renderBeds: (beds: Record<string, PatientData>, subject: PatientData) => {
      view = render(buildTree(beds, subject));
      return view;
    },
    rerenderBeds: (beds: Record<string, PatientData>, subject: PatientData) => {
      view?.rerender(buildTree(beds, subject));
    },
    unmount: () => {
      view?.unmount();
    },
  };
};
