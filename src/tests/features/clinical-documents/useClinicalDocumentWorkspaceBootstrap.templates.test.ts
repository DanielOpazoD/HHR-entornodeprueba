import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useClinicalDocumentWorkspaceBootstrap } from '@/features/clinical-documents/hooks/useClinicalDocumentWorkspaceBootstrap';
import * as templateUseCases from '@/application/clinical-documents/clinicalDocumentTemplateUseCases';
import * as clinicalDocumentUseCases from '@/application/clinical-documents/clinicalDocumentUseCases';

import {
  buildDocument,
  localTemplate,
  patient,
  remoteTemplate,
} from './useClinicalDocumentWorkspaceBootstrap.fixtures';

const controllerMocks = vi.hoisted(() => ({
  listActiveClinicalDocumentTemplates: vi.fn(),
  buildClinicalDocumentEpisodeContext: vi.fn(),
  hydrateClinicalDocumentWorkspaceRecord: vi.fn(),
}));

vi.mock('@/features/clinical-documents/controllers/clinicalDocumentTemplateController', () => ({
  listActiveClinicalDocumentTemplates: controllerMocks.listActiveClinicalDocumentTemplates,
}));

vi.mock('@/features/clinical-documents/controllers/clinicalDocumentEpisodeController', () => ({
  buildClinicalDocumentEpisodeContext: controllerMocks.buildClinicalDocumentEpisodeContext,
}));

vi.mock('@/features/clinical-documents/controllers/clinicalDocumentWorkspaceController', () => ({
  hydrateClinicalDocumentWorkspaceRecord: controllerMocks.hydrateClinicalDocumentWorkspaceRecord,
}));

vi.mock('@/application/clinical-documents/clinicalDocumentTemplateUseCases', async () => {
  const actual = await vi.importActual<
    typeof import('@/application/clinical-documents/clinicalDocumentTemplateUseCases')
  >('@/application/clinical-documents/clinicalDocumentTemplateUseCases');
  return {
    ...actual,
    executeListActiveClinicalDocumentTemplates: vi.fn(),
    executeSeedClinicalDocumentTemplates: vi.fn(),
  };
});

vi.mock('@/application/clinical-documents/clinicalDocumentUseCases', async () => {
  const actual = await vi.importActual<
    typeof import('@/application/clinical-documents/clinicalDocumentUseCases')
  >('@/application/clinical-documents/clinicalDocumentUseCases');
  return {
    ...actual,
    subscribeClinicalDocumentsByEpisodeKeys: vi.fn(),
  };
});

vi.mock('@/services/observability/operationalTelemetryService', () => ({
  recordOperationalOutcome: vi.fn(),
}));

type BootstrapParams = Parameters<typeof useClinicalDocumentWorkspaceBootstrap>[0];
type TemplatesOutcome = Awaited<
  ReturnType<typeof templateUseCases.executeListActiveClinicalDocumentTemplates>
>;

const bootstrapParams: BootstrapParams = {
  patient,
  currentDateString: '2026-03-06',
  bedId: 'R1',
  isActive: true,
  canRead: true,
  hospitalId: 'hospital-a',
  role: 'admin',
};

const renderBootstrap = (overrides: Partial<BootstrapParams> = {}) =>
  renderHook(useClinicalDocumentWorkspaceBootstrap, {
    initialProps: { ...bootstrapParams, ...overrides },
  });

const deferredTemplatesOutcome = () => {
  let resolve: (outcome: TemplatesOutcome) => void = () => undefined;
  const promise = new Promise<TemplatesOutcome>(complete => {
    resolve = complete;
  });

  return { promise, resolve };
};

const contextChanges: Array<{ name: string; change: Partial<BootstrapParams> }> = [
  { name: 'hospital', change: { hospitalId: 'hospital-b' } },
  { name: 'role', change: { role: 'doctor_urgency' } },
  { name: 'activity', change: { isActive: false } },
  { name: 'read permission', change: { canRead: false } },
];

describe('useClinicalDocumentWorkspaceBootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(templateUseCases.executeListActiveClinicalDocumentTemplates).mockReset();
    vi.mocked(templateUseCases.executeSeedClinicalDocumentTemplates).mockReset();
    controllerMocks.listActiveClinicalDocumentTemplates.mockReturnValue([localTemplate]);
    controllerMocks.buildClinicalDocumentEpisodeContext.mockReturnValue({
      episodeKey: '11.111.111-1__2026-03-06',
      documentLookupEpisodeKeys: ['11111111-1__2026-03-06'],
      sourceDailyRecordDate: '2026-03-06',
      specialty: 'Medicina',
    });
    controllerMocks.hydrateClinicalDocumentWorkspaceRecord.mockImplementation(document => document);
    vi.mocked(templateUseCases.executeListActiveClinicalDocumentTemplates).mockResolvedValue({
      status: 'success',
      data: [remoteTemplate],
      issues: [],
    });
    vi.mocked(templateUseCases.executeSeedClinicalDocumentTemplates).mockResolvedValue({
      status: 'success',
      data: [localTemplate],
      issues: [],
    });
    vi.mocked(clinicalDocumentUseCases.subscribeClinicalDocumentsByEpisodeKeys).mockImplementation(
      (_episodeKeys, callback) => {
        callback([buildDocument()]);
        return vi.fn();
      }
    );
  });

  it('seeds templates for admin when remote catalog is empty', async () => {
    vi.mocked(templateUseCases.executeListActiveClinicalDocumentTemplates).mockResolvedValue({
      status: 'success',
      data: [],
      issues: [],
    });

    const { result } = renderHook(() =>
      useClinicalDocumentWorkspaceBootstrap({
        patient: patient as never,
        currentDateString: '2026-03-06',
        bedId: 'R1',
        isActive: true,
        canRead: true,
        hospitalId: 'hhr',
        role: 'admin',
      })
    );

    await waitFor(() => {
      expect(templateUseCases.executeSeedClinicalDocumentTemplates).toHaveBeenCalledWith('hhr');
      expect(result.current.templates).toEqual([localTemplate]);
    });
  });

  it('falls back to local templates when admin seeding fails', async () => {
    vi.mocked(templateUseCases.executeListActiveClinicalDocumentTemplates).mockResolvedValue({
      status: 'success',
      data: [],
      issues: [],
    });
    vi.mocked(templateUseCases.executeSeedClinicalDocumentTemplates).mockResolvedValue({
      status: 'failed',
      data: [],
      issues: [{ kind: 'unknown', message: 'seed failed' }],
    });

    const { result } = renderHook(() =>
      useClinicalDocumentWorkspaceBootstrap({
        patient: patient as never,
        currentDateString: '2026-03-06',
        bedId: 'R1',
        isActive: true,
        canRead: true,
        hospitalId: 'hhr',
        role: 'admin',
      })
    );

    await waitFor(() => {
      expect(templateUseCases.executeSeedClinicalDocumentTemplates).toHaveBeenCalledWith('hhr');
      expect(result.current.templates).toEqual([localTemplate]);
    });
  });

  it.each<TemplatesOutcome['status']>(['failed', 'partial', 'degraded'])(
    'does not seed or replace local templates after a %s catalog read',
    async status => {
      vi.mocked(templateUseCases.executeListActiveClinicalDocumentTemplates).mockResolvedValue({
        status,
        data: [],
        issues: [{ kind: 'unknown', message: 'catalog unavailable' }],
      });

      const { result } = renderBootstrap();
      await act(async () => Promise.resolve());

      expect(templateUseCases.executeListActiveClinicalDocumentTemplates).toHaveBeenCalledWith(
        'hospital-a'
      );
      expect(templateUseCases.executeSeedClinicalDocumentTemplates).not.toHaveBeenCalled();
      expect(result.current.templates).toEqual([localTemplate]);
    }
  );

  it('uses local templates when the new hospital catalog read fails', async () => {
    vi.mocked(templateUseCases.executeListActiveClinicalDocumentTemplates)
      .mockResolvedValueOnce({ status: 'success', data: [remoteTemplate], issues: [] })
      .mockResolvedValueOnce({
        status: 'failed',
        data: [],
        issues: [{ kind: 'unknown', message: 'catalog unavailable' }],
      });
    const { result, rerender } = renderBootstrap();
    await waitFor(() => expect(result.current.templates).toEqual([remoteTemplate]));

    rerender({ ...bootstrapParams, hospitalId: 'hospital-b' });
    await act(async () => Promise.resolve());

    expect(result.current.templates).toEqual([localTemplate]);
    expect(templateUseCases.executeSeedClinicalDocumentTemplates).not.toHaveBeenCalled();
  });

  it('waits for the new hospital catalog before deciding whether to seed it', async () => {
    const hospitalBRead = deferredTemplatesOutcome();
    vi.mocked(templateUseCases.executeListActiveClinicalDocumentTemplates)
      .mockResolvedValueOnce({ status: 'success', data: [], issues: [] })
      .mockReturnValueOnce(hospitalBRead.promise);

    const { result, rerender } = renderBootstrap();
    await waitFor(() => {
      expect(templateUseCases.executeSeedClinicalDocumentTemplates).toHaveBeenCalledWith(
        'hospital-a'
      );
    });

    rerender({ ...bootstrapParams, hospitalId: 'hospital-b' });
    await act(async () => Promise.resolve());

    expect(templateUseCases.executeListActiveClinicalDocumentTemplates).toHaveBeenCalledWith(
      'hospital-b'
    );
    expect(templateUseCases.executeSeedClinicalDocumentTemplates).toHaveBeenCalledTimes(1);

    await act(async () => {
      hospitalBRead.resolve({ status: 'success', data: [remoteTemplate], issues: [] });
    });

    expect(result.current.templates).toEqual([remoteTemplate]);
    expect(templateUseCases.executeSeedClinicalDocumentTemplates).toHaveBeenCalledTimes(1);
  });

  describe.each(contextChanges)('when $name changes', ({ change }) => {
    it('ignores the previous catalog read before publishing or seeding', async () => {
      const previousRead = deferredTemplatesOutcome();
      vi.mocked(templateUseCases.executeListActiveClinicalDocumentTemplates).mockReturnValueOnce(
        previousRead.promise
      );

      const { result, rerender } = renderBootstrap();
      rerender({ ...bootstrapParams, ...change });
      await act(async () => Promise.resolve());
      const currentTemplates = result.current.templates;

      await act(async () => {
        previousRead.resolve({ status: 'success', data: [], issues: [] });
      });

      expect(result.current.templates).toEqual(currentTemplates);
      expect(templateUseCases.executeSeedClinicalDocumentTemplates).not.toHaveBeenCalled();
    });

    it.each<TemplatesOutcome['status']>(['success', 'failed'])(
      'ignores a late %s seed response for the previous context',
      async status => {
        const previousSeed = deferredTemplatesOutcome();
        vi.mocked(
          templateUseCases.executeListActiveClinicalDocumentTemplates
        ).mockResolvedValueOnce({
          status: 'success',
          data: [],
          issues: [],
        });
        vi.mocked(templateUseCases.executeSeedClinicalDocumentTemplates).mockReturnValueOnce(
          previousSeed.promise
        );

        const { result, rerender } = renderBootstrap();
        await waitFor(() => {
          expect(templateUseCases.executeSeedClinicalDocumentTemplates).toHaveBeenCalledWith(
            'hospital-a'
          );
        });
        rerender({ ...bootstrapParams, ...change });
        await act(async () => Promise.resolve());
        const currentTemplates = result.current.templates;

        await act(async () => {
          previousSeed.resolve({
            status,
            data:
              status === 'success'
                ? [{ ...localTemplate, id: 'previous-seed', name: 'Previous context seed' }]
                : [],
            issues: [],
          });
        });

        expect(result.current.templates).toEqual(currentTemplates);
        expect(templateUseCases.executeSeedClinicalDocumentTemplates).toHaveBeenCalledTimes(1);
      }
    );
  });
});
