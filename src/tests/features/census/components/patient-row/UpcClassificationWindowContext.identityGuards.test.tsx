import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { DataFactory } from '@/tests/factories/DataFactory';
import { resolveUpcEpisodeIdentity } from '@/domain/upc/upcRoundSubject';
import type { PatientData } from '@/types/domain/patient';
import {
  createUpcBedsHarness,
  loadFreshUpcContext,
  mockDeferredUpcWindow,
  type MockUpcWindowProps,
  UPC_WINDOW_MODULE_PATH,
} from './upcClassificationWindowTestSupport';

describe('UpcClassificationWindowProvider · episode and identity guards', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock(UPC_WINDOW_MODULE_PATH);
    vi.restoreAllMocks();
  });

  it('cancels a pending open when the clicked bed changes episode on the same census day', async () => {
    const { resolveDialog } = mockDeferredUpcWindow();
    const ctx = await loadFreshUpcContext();
    const patientA = DataFactory.createMockPatient('R2', {
      patientName: 'Paciente Original',
      rut: '11.111.111-1',
      clinicalEpisodeId: 'ep-original',
    });
    const patientB = DataFactory.createMockPatient('R2', {
      patientName: 'Reemplazo Mismo Dia',
      rut: '22.222.222-2',
      clinicalEpisodeId: 'ep-reemplazo',
    });
    const harness = createUpcBedsHarness(ctx, {
      bedId: 'R2',
      buttonLabel: 'Abrir UPC R2',
      resolveIdentity: resolveUpcEpisodeIdentity,
    });

    harness.renderBeds({ R2: patientA }, patientA);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir UPC R2' }));
    expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

    // Same-day census re-read replaces the occupant in R2 while the chunk is still loading.
    harness.rerenderBeds({ R2: patientB }, patientB);
    expect(screen.queryByTestId('upc-window-module-loading')).toBeNull();

    await resolveDialog();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('cancels a pending open for an unnamed bed with document and episode ID when replaced during load', async () => {
    const { resolveDialog } = mockDeferredUpcWindow();
    const ctx = await loadFreshUpcContext();
    const unnamedOriginal = DataFactory.createMockPatient('R2', {
      patientName: '',
      rut: '11.111.111-1',
      clinicalEpisodeId: 'ep-unnamed-1',
    });
    const replacement = DataFactory.createMockPatient('R2', {
      patientName: 'Paciente Reemplazo',
      rut: '22.222.222-2',
      clinicalEpisodeId: 'ep-replacement-2',
    });

    expect(resolveUpcEpisodeIdentity(unnamedOriginal)).toBeNull();
    expect(ctx.resolveUpcCellSubjectIdentity(unnamedOriginal)).not.toBeNull();

    const harness = createUpcBedsHarness(ctx, {
      bedId: 'R2',
      buttonLabel: 'Abrir UPC R2 sin nombre',
    });

    harness.renderBeds({ R2: unnamedOriginal }, unnamedOriginal);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir UPC R2 sin nombre' }));
    expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

    harness.rerenderBeds({ R2: replacement }, replacement);
    expect(screen.queryByTestId('upc-window-module-loading')).toBeNull();

    await resolveDialog();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('cancels a pending open for an unnamed crib when replaced during a 503 retry', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { resolveDialog } = mockDeferredUpcWindow({ failFirstWith: '503 Service Unavailable' });
    const ctx = await loadFreshUpcContext();

    const unnamedCrib = DataFactory.createMockPatient('R1', {
      patientName: '',
      rut: '33.333.333-3',
      clinicalEpisodeId: 'ep-crib-unnamed-1',
    });
    const replacementCrib = DataFactory.createMockPatient('R1', {
      patientName: 'RN Reemplazo',
      rut: '44.444.444-4',
      clinicalEpisodeId: 'ep-crib-replacement-2',
    });
    const motherWith = (crib: PatientData) =>
      DataFactory.createMockPatient('R1', { patientName: 'Madre R1', clinicalCrib: crib });

    const harness = createUpcBedsHarness(ctx, {
      bedId: 'R1',
      crib: true,
      buttonLabel: 'Abrir cuna R1 sin nombre',
    });

    harness.renderBeds({ R1: motherWith(unnamedCrib) }, unnamedCrib);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir cuna R1 sin nombre' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudo abrir este panel/);

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

    harness.rerenderBeds({ R1: motherWith(replacementCrib) }, replacementCrib);
    expect(screen.queryByTestId('upc-window-module-loading')).toBeNull();

    await resolveDialog();
    expect(screen.queryByRole('dialog')).toBeNull();
    consoleErrorSpy.mockRestore();
  });

  it('keeps the pending open alive when only patientName is filled in for the same bed or crib episode', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    // 1) Bed with accredited episode ID: completing patientName during deferred download keeps open.
    const bedChunk = mockDeferredUpcWindow();
    const bedCtx = await loadFreshUpcContext();
    const unnamedBed = DataFactory.createMockPatient('R2', {
      patientName: '',
      rut: '11.111.111-1',
      clinicalEpisodeId: 'ep-same-bed',
      admissionDate: '2026-11-24',
      admissionTime: '08:00',
    });
    const namedSameBed = { ...unnamedBed, patientName: 'Paciente Completado' };
    expect(bedCtx.resolveUpcCellSubjectIdentity(unnamedBed)).toBe('ep-same-bed');
    expect(bedCtx.resolveUpcCellSubjectIdentity(namedSameBed)).toBe('ep-same-bed');

    const bedHarness = createUpcBedsHarness(bedCtx, { bedId: 'R2', buttonLabel: 'Abrir R2' });
    bedHarness.renderBeds({ R2: unnamedBed }, unnamedBed);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir R2' }));
    expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

    bedHarness.rerenderBeds({ R2: namedSameBed }, namedSameBed);
    expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

    await bedChunk.resolveDialog();
    expect(screen.getByRole('dialog', { name: 'Clasificación UPC' })).toHaveTextContent('R2');
    bedHarness.unmount();

    // 2) Legacy crib (no accredited episode ID) completing patientName during a 503 retry keeps open.
    vi.resetModules();
    const retryChunk = mockDeferredUpcWindow({ failFirstWith: '503 Service Unavailable' });
    const cribCtx = await loadFreshUpcContext();
    const unnamedLegacyCrib = DataFactory.createMockPatient('R1', {
      patientName: '',
      rut: '33.333.333-3',
      clinicalEpisodeId: '',
      admissionDate: '2026-11-24',
      admissionTime: '09:30',
    });
    const namedLegacyCrib = { ...unnamedLegacyCrib, patientName: 'RN Completado' };
    const motherWith = (crib: PatientData) =>
      DataFactory.createMockPatient('R1', { patientName: 'Madre R1', clinicalCrib: crib });

    const cribHarness = createUpcBedsHarness(cribCtx, {
      bedId: 'R1',
      crib: true,
      buttonLabel: 'Abrir cuna R1 legacy',
    });
    cribHarness.renderBeds({ R1: motherWith(unnamedLegacyCrib) }, unnamedLegacyCrib);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir cuna R1 legacy' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudo abrir este panel/);

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

    cribHarness.rerenderBeds({ R1: motherWith(namedLegacyCrib) }, namedLegacyCrib);
    expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

    await retryChunk.resolveDialog();
    expect(screen.getByRole('dialog', { name: 'Clasificación UPC' })).toHaveTextContent('R1:crib');
    consoleErrorSpy.mockRestore();
  });

  it('cancels a pending crib open when the mother episode changes even if both newborns share a legacy ID', async () => {
    const { resolveDialog } = mockDeferredUpcWindow();
    const ctx = await loadFreshUpcContext();

    const cribA = DataFactory.createMockPatient('R1', {
      patientName: '',
      rut: '',
      clinicalEpisodeId: 'legacy_ep_shared_crib',
      admissionDate: '2026-11-24',
      admissionTime: '08:00',
    });
    const cribB = DataFactory.createMockPatient('R1', {
      patientName: 'RN Familia B',
      rut: '',
      clinicalEpisodeId: 'legacy_ep_shared_crib',
      admissionDate: '2026-11-24',
      admissionTime: '08:00',
    });
    const motherA = DataFactory.createMockPatient('R1', {
      patientName: 'Madre Familia A',
      rut: '11.111.111-1',
      clinicalEpisodeId: 'ep-mother-A',
      clinicalCrib: cribA,
    });
    const motherB = DataFactory.createMockPatient('R1', {
      patientName: 'Madre Familia B',
      rut: '22.222.222-2',
      clinicalEpisodeId: 'ep-mother-B',
      clinicalCrib: cribB,
    });

    const harness = createUpcBedsHarness(ctx, {
      bedId: 'R1',
      crib: true,
      buttonLabel: 'Abrir cuna familia A',
    });
    harness.renderBeds({ R1: motherA }, cribA);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir cuna familia A' }));
    expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

    harness.rerenderBeds({ R1: motherB }, cribB);
    expect(screen.queryByTestId('upc-window-module-loading')).toBeNull();

    await resolveDialog();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('latches the first completed name on an unnamed legacy crib so a second replacement cancels', async () => {
    const { resolveDialog } = mockDeferredUpcWindow();
    const ctx = await loadFreshUpcContext();

    const unnamedCrib = DataFactory.createMockPatient('R1', {
      patientName: '',
      rut: '',
      clinicalEpisodeId: 'legacy_ep_shared_crib',
      admissionDate: '2026-11-24',
      admissionTime: '08:00',
    });
    const cribNamedA = { ...unnamedCrib, patientName: 'RN A' };
    const cribReplacedByB = { ...unnamedCrib, patientName: 'RN B' };
    const motherWith = (crib: PatientData) =>
      DataFactory.createMockPatient('R1', {
        patientName: 'Madre Misma',
        clinicalEpisodeId: 'ep-mother-same',
        clinicalCrib: crib,
      });

    const harness = createUpcBedsHarness(ctx, {
      bedId: 'R1',
      crib: true,
      buttonLabel: 'Abrir cuna R1',
    });
    harness.renderBeds({ R1: motherWith(unnamedCrib) }, unnamedCrib);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir cuna R1' }));
    expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

    // First naming (unnamed -> RN A) keeps pending open alive and latches RN A.
    harness.rerenderBeds({ R1: motherWith(cribNamedA) }, cribNamedA);
    expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

    // Second change (RN A -> RN B) must cancel instead of passing through the empty-name allowance.
    harness.rerenderBeds({ R1: motherWith(cribReplacedByB) }, cribReplacedByB);
    expect(screen.queryByTestId('upc-window-module-loading')).toBeNull();

    await resolveDialog();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('cancels a pending legacy open when documentType switches between RUT and Pasaporte or admissionDate changes despite firstSeenDate', async () => {
    const runScenario = async (mutate: (base: PatientData) => PatientData) => {
      vi.resetModules();
      const { resolveDialog } = mockDeferredUpcWindow();
      const ctx = await loadFreshUpcContext();
      const base = DataFactory.createMockPatient('R2', {
        patientName: '',
        documentType: 'RUT',
        rut: '12345678',
        clinicalEpisodeId: '',
        firstSeenDate: '2026-11-23',
        admissionDate: '2026-11-23',
        admissionTime: '08:00',
      });
      const updated = mutate(base);
      const harness = createUpcBedsHarness(ctx, { bedId: 'R2', buttonLabel: 'Abrir R2 legado' });

      harness.renderBeds({ R2: base }, base);
      fireEvent.click(screen.getByRole('button', { name: 'Abrir R2 legado' }));
      expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

      harness.rerenderBeds({ R2: updated }, updated);
      expect(screen.queryByTestId('upc-window-module-loading')).toBeNull();

      await resolveDialog();
      expect(screen.queryByRole('dialog')).toBeNull();
      harness.unmount();
    };

    // 1) Switching RUT -> Pasaporte with the same document number cancels even when naming.
    await runScenario(base => ({
      ...base,
      patientName: 'Visitante Extranjero',
      documentType: 'Pasaporte',
    }));

    // 2) Changing admissionDate cancels even when firstSeenDate stays unchanged.
    await runScenario(base => ({
      ...base,
      patientName: 'Paciente Nuevo Ingreso',
      admissionDate: '2026-11-24',
    }));
  });

  it('keeps a pending legacy mother bed open when her own paired crib completes patientName (alone or together with the mother)', async () => {
    const runMotherNamingCase = async (mode: 'crib-only' | 'both-names' | 'both-names-retry') => {
      vi.resetModules();
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const isRetry = mode === 'both-names-retry';
      const { resolveDialog } = mockDeferredUpcWindow(
        isRetry ? { failFirstWith: '503 Service Unavailable' } : undefined
      );
      const ctx = await loadFreshUpcContext();

      const unnamedCrib = DataFactory.createMockPatient('R1', {
        patientName: '',
        rut: '11.111.111-1',
        clinicalEpisodeId: 'legacy_ep_shared_maternal',
        admissionDate: '2026-11-24',
        admissionTime: '08:00',
      });
      const initialMother = DataFactory.createMockPatient('R1', {
        patientName: mode === 'crib-only' ? 'Maria Lopez' : '',
        rut: '11.111.111-1',
        clinicalEpisodeId: 'legacy_ep_shared_maternal',
        admissionDate: '2026-11-24',
        admissionTime: '08:00',
        clinicalCrib: unnamedCrib,
      });

      const harness = createUpcBedsHarness(ctx, { bedId: 'R1', buttonLabel: 'Abrir cama materna' });
      harness.renderBeds({ R1: initialMother }, initialMother);
      fireEvent.click(screen.getByRole('button', { name: 'Abrir cama materna' }));
      if (isRetry) {
        expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudo abrir este panel/);
        fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
      }
      expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

      const updatedMother: PatientData = {
        ...initialMother,
        patientName: 'Maria Lopez',
        clinicalCrib: { ...unnamedCrib, patientName: 'RN de Maria' },
      };
      harness.rerenderBeds({ R1: updatedMother }, updatedMother);
      expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

      await resolveDialog();
      expect(screen.getByRole('dialog', { name: 'Clasificación UPC' })).toHaveTextContent('R1');
      harness.unmount();
      consoleErrorSpy.mockRestore();
    };

    await runMotherNamingCase('crib-only');
    await runMotherNamingCase('both-names');
    await runMotherNamingCase('both-names-retry');
  });

  it('cancels on resolve if the clicked bed still has no patientName, and rejects same-name collision between mother and crib regardless of update order', async () => {
    const runEdge = async (
      mode:
        | 'unnamed-mother-crib-named-only'
        | 'same-name-single-update'
        | 'same-name-mother-then-crib'
        | 'same-name-crib-then-mother'
    ) => {
      vi.resetModules();
      const { resolveDialog } = mockDeferredUpcWindow();
      const ctx = await loadFreshUpcContext();

      const unnamedCrib = DataFactory.createMockPatient('R1', {
        patientName: '',
        rut: '11.111.111-1',
        clinicalEpisodeId: 'legacy_ep_order_check',
        admissionDate: '2026-11-24',
        admissionTime: '08:00',
      });
      const initialMother = DataFactory.createMockPatient('R1', {
        patientName: '',
        firstName: mode === 'unnamed-mother-crib-named-only' ? 'Maria' : '',
        rut: '11.111.111-1',
        clinicalEpisodeId: 'legacy_ep_order_check',
        admissionDate: '2026-11-24',
        admissionTime: '08:00',
        clinicalCrib: unnamedCrib,
      });
      const bedR2 = DataFactory.createMockPatient('R2', {
        patientName: 'Paciente R2',
        rut: '22.222.222-2',
        clinicalEpisodeId: 'ep-r2-other',
      });

      const harness = createUpcBedsHarness(ctx, { bedId: 'R1', buttonLabel: 'Abrir R1 borde' });
      harness.renderBeds({ R1: initialMother, R2: bedR2 }, initialMother);
      fireEvent.click(screen.getByRole('button', { name: 'Abrir R1 borde' }));
      expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

      if (mode === 'unnamed-mother-crib-named-only') {
        const motherStillUnnamed: PatientData = {
          ...initialMother,
          clinicalCrib: { ...unnamedCrib, patientName: 'RN de Maria' },
        };
        harness.rerenderBeds({ R1: motherStillUnnamed, R2: bedR2 }, motherStillUnnamed);
        expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();
      } else if (mode === 'same-name-single-update') {
        const colliding: PatientData = {
          ...initialMother,
          patientName: 'Maria Lopez',
          clinicalCrib: { ...unnamedCrib, patientName: 'Maria Lopez' },
        };
        harness.rerenderBeds({ R1: colliding, R2: bedR2 }, colliding);
        expect(screen.queryByTestId('upc-window-module-loading')).toBeNull();
      } else if (mode === 'same-name-mother-then-crib') {
        const motherFirst: PatientData = { ...initialMother, patientName: 'Maria Lopez' };
        harness.rerenderBeds({ R1: motherFirst, R2: bedR2 }, motherFirst);
        expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

        const cribSameName: PatientData = {
          ...motherFirst,
          clinicalCrib: { ...unnamedCrib, patientName: 'Maria Lopez' },
        };
        harness.rerenderBeds({ R1: cribSameName, R2: bedR2 }, cribSameName);
        expect(screen.queryByTestId('upc-window-module-loading')).toBeNull();
      } else {
        const cribFirst: PatientData = {
          ...initialMother,
          clinicalCrib: { ...unnamedCrib, patientName: 'Maria Lopez' },
        };
        harness.rerenderBeds({ R1: cribFirst, R2: bedR2 }, cribFirst);
        expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

        const motherSameName: PatientData = { ...cribFirst, patientName: 'Maria Lopez' };
        harness.rerenderBeds({ R1: motherSameName, R2: bedR2 }, motherSameName);
        expect(screen.queryByTestId('upc-window-module-loading')).toBeNull();
      }

      await resolveDialog();
      expect(screen.queryByRole('dialog')).toBeNull();
      harness.unmount();
    };

    await runEdge('unnamed-mother-crib-named-only');
    await runEdge('same-name-single-update');
    await runEdge('same-name-mother-then-crib');
    await runEdge('same-name-crib-then-mother');
  });

  it('keeps opening R1 when mother and crib already share the same name before click (with distinct RUTs and accredited newborn, or unchanged legacy)', async () => {
    const runPreExistingSameName = async (accreditedCrib: boolean) => {
      vi.resetModules();
      vi.doMock(UPC_WINDOW_MODULE_PATH, () => ({
        UpcClassificationWindow: ({ initialBedId }: MockUpcWindowProps) => (
          <div role="dialog" aria-label="Clasificación UPC">
            {initialBedId}
          </div>
        ),
      }));

      const ctx = await loadFreshUpcContext();
      const crib = DataFactory.createMockPatient('R1', {
        patientName: 'Maria Lopez',
        rut: accreditedCrib ? '28.000.001-1' : '11.111.111-1',
        clinicalEpisodeId: accreditedCrib ? 'ep-rn-homonym' : 'legacy_ep_homonym',
        admissionDate: '2026-11-24',
        admissionTime: '08:00',
      });
      const mother = DataFactory.createMockPatient('R1', {
        patientName: 'Maria Lopez',
        rut: '11.111.111-1',
        clinicalEpisodeId: 'legacy_ep_homonym',
        admissionDate: '2026-11-24',
        admissionTime: '08:00',
        clinicalCrib: crib,
      });

      const harness = createUpcBedsHarness(ctx, { bedId: 'R1', buttonLabel: 'Abrir R1 homonimos' });
      harness.renderBeds({ R1: mother }, mother);
      fireEvent.click(screen.getByRole('button', { name: 'Abrir R1 homonimos' }));
      expect(await screen.findByRole('dialog', { name: 'Clasificación UPC' })).toHaveTextContent(
        'R1'
      );
      harness.unmount();
    };

    await runPreExistingSameName(true);
    await runPreExistingSameName(false);
  });

  it('normalizes RUTs, passports, and absent-document markers before treating paired mother and crib documents as distinct', async () => {
    const runDocComparisonCase = async (params: {
      motherDocType: 'RUT' | 'Pasaporte';
      motherRut: string;
      cribDocType: 'RUT' | 'Pasaporte';
      cribRut: string;
      shouldCancel: boolean;
    }) => {
      vi.resetModules();
      const { resolveDialog } = mockDeferredUpcWindow();
      const ctx = await loadFreshUpcContext();

      const unnamedCrib = DataFactory.createMockPatient('R1', {
        patientName: '',
        documentType: params.cribDocType,
        rut: params.cribRut,
        clinicalEpisodeId: 'legacy_ep_doc_norm',
        admissionDate: '2026-11-24',
        admissionTime: '08:00',
      });
      const initialMother = DataFactory.createMockPatient('R1', {
        patientName: '',
        documentType: params.motherDocType,
        rut: params.motherRut,
        clinicalEpisodeId: 'legacy_ep_doc_norm',
        admissionDate: '2026-11-24',
        admissionTime: '08:00',
        clinicalCrib: unnamedCrib,
      });

      const harness = createUpcBedsHarness(ctx, { bedId: 'R1', buttonLabel: 'Abrir R1 doc' });
      harness.renderBeds({ R1: initialMother }, initialMother);
      fireEvent.click(screen.getByRole('button', { name: 'Abrir R1 doc' }));
      expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

      const bothNamedSame: PatientData = {
        ...initialMother,
        patientName: 'Maria Lopez',
        clinicalCrib: { ...unnamedCrib, patientName: 'Maria Lopez' },
      };
      harness.rerenderBeds({ R1: bothNamedSame }, bothNamedSame);

      if (params.shouldCancel) {
        expect(screen.queryByTestId('upc-window-module-loading')).toBeNull();
      } else {
        expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();
      }

      await resolveDialog();
      if (params.shouldCancel) {
        expect(screen.queryByRole('dialog')).toBeNull();
      } else {
        expect(screen.getByRole('dialog', { name: 'Clasificación UPC' })).toHaveTextContent('R1');
      }
      harness.unmount();
    };

    // Same RUT formatted differently -> must cancel.
    await runDocComparisonCase({
      motherDocType: 'RUT',
      motherRut: '11.111.111-1',
      cribDocType: 'RUT',
      cribRut: '111111111',
      shouldCancel: true,
    });
    // Same RUN with and without leading zero -> must cancel.
    await runDocComparisonCase({
      motherDocType: 'RUT',
      motherRut: '1.234.567-4',
      cribDocType: 'RUT',
      cribRut: '01.234.567-4',
      shouldCancel: true,
    });
    // Same RUN body with invalid check digit on crib -> must cancel.
    await runDocComparisonCase({
      motherDocType: 'RUT',
      motherRut: '1.234.567-4',
      cribDocType: 'RUT',
      cribRut: '1.234.567-9',
      shouldCancel: true,
    });
    // Same passport in different case/separators -> must cancel.
    await runDocComparisonCase({
      motherDocType: 'Pasaporte',
      motherRut: 'ab-12345',
      cribDocType: 'Pasaporte',
      cribRut: 'AB 12345',
      shouldCancel: true,
    });
    // Two absent-document markers -> must cancel.
    await runDocComparisonCase({
      motherDocType: 'RUT',
      motherRut: 'SIN RUT',
      cribDocType: 'RUT',
      cribRut: 'S/N',
      shouldCancel: true,
    });
    // All-zero placeholder RUTs -> must cancel.
    await runDocComparisonCase({
      motherDocType: 'RUT',
      motherRut: '0-0',
      cribDocType: 'RUT',
      cribRut: '00.000.000-0',
      shouldCancel: true,
    });
    // Genuine distinct valid normalized RUTs -> keeps open.
    await runDocComparisonCase({
      motherDocType: 'RUT',
      motherRut: '11.111.111-1',
      cribDocType: 'RUT',
      cribRut: '28.000.001-9',
      shouldCancel: false,
    });
  });
});
