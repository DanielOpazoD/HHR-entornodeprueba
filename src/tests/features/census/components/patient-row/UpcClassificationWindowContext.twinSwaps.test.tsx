import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { PatientData } from '@/types/domain/patient';
import { PatientStatus } from '@/types/domain/patientClassification';
import {
  createUpcBedsHarness,
  loadFreshUpcContext,
  mockDeferredUpcWindow,
  UPC_WINDOW_MODULE_PATH,
} from './upcClassificationWindowTestSupport';

describe('UpcClassificationWindowProvider · twin swaps and paired legacy disambiguation', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock(UPC_WINDOW_MODULE_PATH);
    vi.restoreAllMocks();
  });

  it('cancels a pending unnamed crib open when twins sharing a legacy ID swap beds, while keeping non-swapped twin naming alive', async () => {
    const runTwinScenario = async (mode: 'swap-initial' | 'swap-retry' | 'control-no-swap') => {
      vi.resetModules();
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const { resolveDialog } = mockDeferredUpcWindow(
        mode === 'swap-retry' ? { failFirstWith: '503 Service Unavailable' } : undefined
      );
      const ctx = await loadFreshUpcContext();

      const unnamedTwinInCrib = DataFactory.createMockPatient('R1', {
        patientName: '',
        rut: '',
        biologicalSex: 'Femenino',
        clinicalEpisodeId: 'legacy_ep_twins',
        admissionDate: '2026-11-24',
        admissionTime: '08:00',
      });
      const namedTwinInNeo = DataFactory.createMockPatient('Neo1', {
        patientName: 'RN Gemelo Dos',
        rut: '',
        biologicalSex: 'Femenino',
        clinicalEpisodeId: 'legacy_ep_twins',
        admissionDate: '2026-11-24',
        admissionTime: '08:00',
      });
      const motherWith = (crib: PatientData) =>
        DataFactory.createMockPatient('R1', {
          patientName: 'Madre Gemelos',
          clinicalEpisodeId: 'ep-mother-twins',
          clinicalCrib: crib,
        });

      const harness = createUpcBedsHarness(ctx, {
        bedId: 'R1',
        crib: true,
        buttonLabel: 'Abrir cuna gemelo',
      });
      harness.renderBeds(
        { R1: motherWith(unnamedTwinInCrib), Neo1: namedTwinInNeo },
        unnamedTwinInCrib
      );

      fireEvent.click(screen.getByRole('button', { name: 'Abrir cuna gemelo' }));
      if (mode === 'swap-retry') {
        expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudo abrir este panel/);
        fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
      }
      expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

      const nextBeds =
        mode === 'control-no-swap'
          ? {
              R1: motherWith({ ...unnamedTwinInCrib, patientName: 'RN Gemelo Uno' }),
              Neo1: namedTwinInNeo,
            }
          : {
              R1: motherWith({ ...unnamedTwinInCrib, patientName: 'RN Gemelo Dos' }),
              Neo1: { ...namedTwinInNeo, patientName: '' },
            };
      harness.rerenderBeds(nextBeds, nextBeds.R1.clinicalCrib!);

      if (mode === 'control-no-swap') {
        expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();
      } else {
        expect(screen.queryByTestId('upc-window-module-loading')).toBeNull();
      }

      await resolveDialog();
      if (mode === 'control-no-swap') {
        expect(screen.getByRole('dialog', { name: 'Clasificación UPC' })).toHaveTextContent(
          'R1:crib'
        );
      } else {
        expect(screen.queryByRole('dialog')).toBeNull();
      }

      harness.unmount();
      consoleErrorSpy.mockRestore();
    };

    await runTwinScenario('swap-initial');
    await runTwinScenario('swap-retry');
    await runTwinScenario('control-no-swap');
  });

  it('cancels when twins with identical provisional names swap or when a second twin arrives in Neo1 after click and then swaps', async () => {
    const runVariant = async (
      variant:
        | 'same-provisional-initial'
        | 'same-provisional-retry'
        | 'late-neo1-initial'
        | 'late-neo1-retry'
    ) => {
      vi.resetModules();
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const isRetry = variant.endsWith('-retry');
      const { resolveDialog } = mockDeferredUpcWindow(
        isRetry ? { failFirstWith: '503 Service Unavailable' } : undefined
      );
      const ctx = await loadFreshUpcContext();

      const motherWith = (crib: PatientData) =>
        DataFactory.createMockPatient('R1', {
          patientName: 'Madre Gemelos',
          clinicalEpisodeId: 'ep-mother-twins',
          clinicalCrib: crib,
        });
      const harness = createUpcBedsHarness(ctx, {
        bedId: 'R1',
        crib: true,
        buttonLabel: 'Abrir cuna variante',
      });

      if (variant.startsWith('same-provisional')) {
        const cribA = DataFactory.createMockPatient('R1', {
          patientName: 'RN de Madre Gemelos',
          rut: '',
          clinicalEpisodeId: 'legacy_ep_twins',
          admissionDate: '2026-11-24',
          admissionTime: '08:00',
          isUPC: false,
          upcChecklist: undefined,
        });
        const neoB = DataFactory.createMockPatient('Neo1', {
          patientName: 'RN de Madre Gemelos',
          rut: '',
          clinicalEpisodeId: 'legacy_ep_twins',
          admissionDate: '2026-11-24',
          admissionTime: '08:00',
          isUPC: true,
          upcChecklist: {
            uciCriteria: [],
            utiCriteria: ['uti_mon_cardio'],
            classification: 'UPC_UTI',
            evaluatedAt: '2026-11-24T09:00:00Z',
            evaluatedBedId: 'Neo1',
          },
        });

        harness.renderBeds({ R1: motherWith(cribA), Neo1: neoB }, cribA);
        fireEvent.click(screen.getByRole('button', { name: 'Abrir cuna variante' }));
        if (isRetry) {
          expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudo abrir este panel/);
          fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
        }
        expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

        harness.rerenderBeds({ R1: motherWith(neoB), Neo1: cribA }, neoB);
        expect(screen.queryByTestId('upc-window-module-loading')).toBeNull();
        harness.unmount();
      } else {
        const unnamedCrib = DataFactory.createMockPatient('R1', {
          patientName: '',
          rut: '',
          clinicalEpisodeId: 'legacy_ep_twins',
          admissionDate: '2026-11-24',
          admissionTime: '08:00',
        });
        const lateTwinNeo1 = DataFactory.createMockPatient('Neo1', {
          patientName: 'RN Gemelo Tardio',
          rut: '',
          clinicalEpisodeId: 'legacy_ep_twins',
          admissionDate: '2026-11-24',
          admissionTime: '08:00',
        });

        // At click time Neo1 is still empty.
        harness.renderBeds({ R1: motherWith(unnamedCrib) }, unnamedCrib);
        fireEvent.click(screen.getByRole('button', { name: 'Abrir cuna variante' }));
        if (isRetry) {
          expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudo abrir este panel/);
          fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
        }
        expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

        // A new occupant arrives in previously empty Neo1 while the legacy crib open is pending.
        harness.rerenderBeds({ R1: motherWith(unnamedCrib), Neo1: lateTwinNeo1 }, unnamedCrib);
        expect(screen.queryByTestId('upc-window-module-loading')).toBeNull();
        harness.unmount();
      }

      await resolveDialog();
      expect(screen.queryByRole('dialog')).toBeNull();
      consoleErrorSpy.mockRestore();
    };

    await runVariant('same-provisional-initial');
    await runVariant('same-provisional-retry');
    await runVariant('late-neo1-initial');
    await runVariant('late-neo1-retry');
  });

  it('cancels before the first UPC evaluation when twins with identical provisional name, legacy ID, and diagnosis differ in clinical status and swap', async () => {
    const runFirstEvalSwap = async (mode: 'initial' | 'retry' | 'control-no-swap') => {
      vi.resetModules();
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const { resolveDialog } = mockDeferredUpcWindow(
        mode === 'retry' ? { failFirstWith: '503 Service Unavailable' } : undefined
      );
      const ctx = await loadFreshUpcContext();

      const stableTwin = DataFactory.createMockPatient('R1', {
        patientName: 'RN de Madre Gemelos',
        rut: '',
        clinicalEpisodeId: 'legacy_ep_twins_first_eval',
        pathology: 'Prematurez moderada',
        status: PatientStatus.ESTABLE,
        admissionDate: '2026-11-24',
        admissionTime: '08:00',
        isUPC: false,
        upcChecklist: undefined,
      });
      const severeTwin = DataFactory.createMockPatient('Neo1', {
        patientName: 'RN de Madre Gemelos',
        rut: '',
        clinicalEpisodeId: 'legacy_ep_twins_first_eval',
        pathology: 'Prematurez moderada',
        status: PatientStatus.GRAVE,
        admissionDate: '2026-11-24',
        admissionTime: '08:00',
        isUPC: false,
        upcChecklist: undefined,
      });
      const motherWith = (crib: PatientData) =>
        DataFactory.createMockPatient('R1', {
          patientName: 'Madre Gemelos',
          clinicalEpisodeId: 'ep-mother-twins-first-eval',
          clinicalCrib: crib,
        });

      const harness = createUpcBedsHarness(ctx, {
        bedId: 'R1',
        crib: true,
        buttonLabel: 'Abrir cuna primera evaluacion',
      });
      harness.renderBeds({ R1: motherWith(stableTwin), Neo1: severeTwin }, stableTwin);

      fireEvent.click(screen.getByRole('button', { name: 'Abrir cuna primera evaluacion' }));
      if (mode === 'retry') {
        expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudo abrir este panel/);
        fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
      }
      expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

      if (mode !== 'control-no-swap') {
        const swappedCrib = { ...severeTwin, bedId: 'R1' };
        harness.rerenderBeds(
          { R1: motherWith(swappedCrib), Neo1: { ...stableTwin, bedId: 'Neo1' } },
          swappedCrib
        );
        expect(screen.queryByTestId('upc-window-module-loading')).toBeNull();
      }

      await resolveDialog();
      if (mode === 'control-no-swap') {
        expect(screen.getByRole('dialog', { name: 'Clasificación UPC' })).toHaveTextContent(
          'R1:crib'
        );
      } else {
        expect(screen.queryByRole('dialog')).toBeNull();
      }

      harness.unmount();
      consoleErrorSpy.mockRestore();
    };

    await runFirstEvalSwap('initial');
    await runFirstEvalSwap('retry');
    await runFirstEvalSwap('control-no-swap');
  });

  it('cancels on a single-update move of twin Alfa into empty Neo1 with Beta arriving in R1:crib (with or without prior firstName) and keeps matching firstName completion alive', async () => {
    const runSingleUpdateMove = async (
      mode:
        | 'atomic-with-firstname-initial'
        | 'atomic-with-firstname-retry'
        | 'atomic-blank-initial'
        | 'atomic-blank-retry'
        | 'control-matching-firstname'
    ) => {
      vi.resetModules();
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const isRetry = mode.endsWith('-retry');
      const { resolveDialog } = mockDeferredUpcWindow(
        isRetry ? { failFirstWith: '503 Service Unavailable' } : undefined
      );
      const ctx = await loadFreshUpcContext();

      const hasPriorFirstName = mode.includes('firstname');
      const initialCrib = DataFactory.createMockPatient('R1', {
        patientName: '',
        firstName: hasPriorFirstName ? 'Alfa' : '',
        rut: '',
        clinicalEpisodeId: 'legacy_ep_atomic_twins',
        pathology: 'Prematurez',
        status: PatientStatus.ESTABLE,
        admissionDate: '2026-11-24',
        admissionTime: '08:00',
      });
      const motherWith = (crib: PatientData) =>
        DataFactory.createMockPatient('R1', {
          patientName: 'Madre Gemelos Atomico',
          clinicalEpisodeId: 'ep-mother-atomic',
          clinicalCrib: crib,
        });
      // Neo1 is explicitly present as an empty bed (with default Indeterminado biologicalSex) at click time.
      const emptyNeo1 = DataFactory.createMockPatient('Neo1', {
        patientName: '',
        rut: '',
        clinicalEpisodeId: '',
        pathology: '',
        admissionDate: '',
        admissionTime: '',
        birthDate: '',
        biologicalSex: 'Indeterminado',
        status: PatientStatus.EMPTY,
        isUPC: false,
        upcChecklist: undefined,
        devices: [],
      });
      expect(ctx.resolveUpcCellSubjectIdentity(emptyNeo1)).toBeNull();

      const harness = createUpcBedsHarness(ctx, {
        bedId: 'R1',
        crib: true,
        buttonLabel: 'Abrir cuna atomica',
      });
      harness.renderBeds({ R1: motherWith(initialCrib), Neo1: emptyNeo1 }, initialCrib);

      fireEvent.click(screen.getByRole('button', { name: 'Abrir cuna atomica' }));
      if (isRetry) {
        expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudo abrir este panel/);
        fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
      }
      expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

      if (mode === 'control-matching-firstname') {
        const namedAlfa = { ...initialCrib, patientName: 'Alfa Soto', firstName: 'Alfa' };
        harness.rerenderBeds({ R1: motherWith(namedAlfa), Neo1: { ...emptyNeo1 } }, namedAlfa);
        expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();
      } else {
        // Single update moves Alfa to previously empty Neo1 and places Beta in R1:crib.
        const betaInCrib = { ...initialCrib, patientName: 'RN Beta', firstName: 'Beta' };
        const alfaInNeo1 = {
          ...initialCrib,
          bedId: 'Neo1',
          patientName: 'RN Alfa',
          firstName: 'Alfa',
        };
        harness.rerenderBeds({ R1: motherWith(betaInCrib), Neo1: alfaInNeo1 }, betaInCrib);
        expect(screen.queryByTestId('upc-window-module-loading')).toBeNull();
      }

      await resolveDialog();
      if (mode === 'control-matching-firstname') {
        expect(screen.getByRole('dialog', { name: 'Clasificación UPC' })).toHaveTextContent(
          'R1:crib'
        );
      } else {
        expect(screen.queryByRole('dialog')).toBeNull();
      }

      harness.unmount();
      consoleErrorSpy.mockRestore();
    };

    await runSingleUpdateMove('atomic-with-firstname-initial');
    await runSingleUpdateMove('atomic-with-firstname-retry');
    await runSingleUpdateMove('atomic-blank-initial');
    await runSingleUpdateMove('atomic-blank-retry');
    await runSingleUpdateMove('control-matching-firstname');
  });

  it('rejects partial substring firstName matches and allows paired legacy mother/crib naming without false cancellation', async () => {
    const { resolveDialog } = mockDeferredUpcWindow();
    const ctx = await loadFreshUpcContext();

    // 1) Token-boundary check: prior firstName "Ana" must not match "RN de Mariana".
    const expectedAna = ctx.resolveUpcCellSubjectIdentity(
      DataFactory.createMockPatient('R1', {
        patientName: '',
        firstName: 'Ana',
        rut: '',
        clinicalEpisodeId: 'legacy_ep_token',
      })
    );
    const currentMariana = ctx.resolveUpcCellSubjectIdentity(
      DataFactory.createMockPatient('R1', {
        patientName: 'RN de Mariana',
        firstName: '',
        rut: '',
        clinicalEpisodeId: 'legacy_ep_token',
      })
    );
    expect(ctx.isSameUpcCellSubjectIdentity(expectedAna, currentMariana)).toBe(false);

    // 2) Legacy mother + legacy crib sharing maternal RUT: completing crib patientName keeps open.
    const unnamedCrib = DataFactory.createMockPatient('R1', {
      patientName: '',
      rut: '11.111.111-1',
      clinicalEpisodeId: 'legacy_ep_shared_family',
      admissionDate: '2026-11-24',
      admissionTime: '08:00',
    });
    const namedCrib = { ...unnamedCrib, patientName: 'RN de Maria' };
    const legacyMother = (crib: PatientData) =>
      DataFactory.createMockPatient('R1', {
        patientName: 'Maria Lopez',
        rut: '11.111.111-1',
        clinicalEpisodeId: 'legacy_ep_shared_family',
        admissionDate: '2026-11-24',
        admissionTime: '08:00',
        clinicalCrib: crib,
      });

    const harness = createUpcBedsHarness(ctx, {
      bedId: 'R1',
      crib: true,
      buttonLabel: 'Abrir cuna madre legado',
    });
    harness.renderBeds({ R1: legacyMother(unnamedCrib) }, unnamedCrib);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir cuna madre legado' }));
    expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

    harness.rerenderBeds({ R1: legacyMother(namedCrib) }, namedCrib);
    expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

    await resolveDialog();
    expect(screen.getByRole('dialog', { name: 'Clasificación UPC' })).toHaveTextContent('R1:crib');
    harness.unmount();
  });

  it('cancels when two unnamed legacy twins in R1:crib and Neo1 swap and get named simultaneously, keeps an accredited crib open on unrelated Neo1 admission despite a legacy mother, and opens a no-ID/no-RUT crib when consistent firstName completes', async () => {
    const runCase = async (
      mode:
        | 'dual-unnamed-swap-initial'
        | 'dual-unnamed-swap-retry'
        | 'accredited-crib-legacy-mother-neo1-admission'
        | 'no-id-no-rut-consistent-firstname'
    ) => {
      vi.resetModules();
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const isRetry = mode === 'dual-unnamed-swap-retry';
      const { resolveDialog } = mockDeferredUpcWindow(
        isRetry ? { failFirstWith: '503 Service Unavailable' } : undefined
      );
      const ctx = await loadFreshUpcContext();
      const harness = createUpcBedsHarness(ctx, {
        bedId: 'R1',
        crib: true,
        buttonLabel: 'Abrir cuna caso',
      });

      if (mode.startsWith('dual-unnamed-swap')) {
        const twinAlfa = DataFactory.createMockPatient('R1', {
          patientName: '',
          rut: '11.111.111-1',
          clinicalEpisodeId: 'legacy_ep_dual_unnamed',
          admissionDate: '2026-11-24',
          admissionTime: '08:00',
        });
        const twinBeta = DataFactory.createMockPatient('Neo1', {
          patientName: '',
          rut: '11.111.111-1',
          clinicalEpisodeId: 'legacy_ep_dual_unnamed',
          admissionDate: '2026-11-24',
          admissionTime: '08:00',
        });
        const motherWith = (crib: PatientData) =>
          DataFactory.createMockPatient('R1', {
            patientName: 'Madre Gemelos',
            clinicalEpisodeId: 'ep-mother-dual',
            clinicalCrib: crib,
          });

        harness.renderBeds({ R1: motherWith(twinAlfa), Neo1: twinBeta }, twinAlfa);
        fireEvent.click(screen.getByRole('button', { name: 'Abrir cuna caso' }));
        if (isRetry) {
          expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudo abrir este panel/);
          fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
        }
        expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

        // Single update swaps both unnamed twins and assigns their names simultaneously.
        const betaNamedInCrib = { ...twinBeta, bedId: 'R1', patientName: 'RN Beta' };
        const alfaNamedInNeo1 = { ...twinAlfa, bedId: 'Neo1', patientName: 'RN Alfa' };
        harness.rerenderBeds(
          { R1: motherWith(betaNamedInCrib), Neo1: alfaNamedInNeo1 },
          betaNamedInCrib
        );
        expect(screen.queryByTestId('upc-window-module-loading')).toBeNull();

        await resolveDialog();
        expect(screen.queryByRole('dialog')).toBeNull();
        harness.unmount();
      } else if (mode === 'accredited-crib-legacy-mother-neo1-admission') {
        const accreditedCrib = DataFactory.createMockPatient('R1', {
          patientName: 'RN Acreditado',
          rut: '28.000.001-1',
          clinicalEpisodeId: 'ep-rn-accredited-1',
        });
        const legacyMother = DataFactory.createMockPatient('R1', {
          patientName: 'Madre Legada',
          rut: '11.111.111-1',
          clinicalEpisodeId: 'legacy_ep_mother_only',
          clinicalCrib: accreditedCrib,
        });
        const unrelatedNeo1 = DataFactory.createMockPatient('Neo1', {
          patientName: 'RN Ajeno',
          rut: '28.000.009-7',
          clinicalEpisodeId: 'ep-rn-unrelated-9',
        });

        harness.renderBeds({ R1: legacyMother }, accreditedCrib);
        fireEvent.click(screen.getByRole('button', { name: 'Abrir cuna caso' }));
        expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

        // Unrelated admission to Neo1 must not cancel an accredited newborn open.
        harness.rerenderBeds({ R1: legacyMother, Neo1: unrelatedNeo1 }, accreditedCrib);
        expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

        await resolveDialog();
        expect(screen.getByRole('dialog', { name: 'Clasificación UPC' })).toHaveTextContent(
          'R1:crib'
        );
        harness.unmount();
      } else {
        const cribNoIdNoRut = DataFactory.createMockPatient('R1', {
          patientName: '',
          firstName: 'Alfa',
          rut: '',
          clinicalEpisodeId: '',
          admissionDate: '2026-11-24',
          admissionTime: '08:00',
        });
        const cribNamedAlfa = { ...cribNoIdNoRut, patientName: 'Alfa Soto', firstName: 'Alfa' };
        const motherWith = (crib: PatientData) =>
          DataFactory.createMockPatient('R1', {
            patientName: 'Madre Sin Doc',
            clinicalEpisodeId: 'ep-mother-nodoc',
            clinicalCrib: crib,
          });

        harness.renderBeds({ R1: motherWith(cribNoIdNoRut) }, cribNoIdNoRut);
        fireEvent.click(screen.getByRole('button', { name: 'Abrir cuna caso' }));
        expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

        harness.rerenderBeds({ R1: motherWith(cribNamedAlfa) }, cribNamedAlfa);
        expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

        await resolveDialog();
        expect(screen.getByRole('dialog', { name: 'Clasificación UPC' })).toHaveTextContent(
          'R1:crib'
        );
        harness.unmount();
      }

      consoleErrorSpy.mockRestore();
    };

    await runCase('dual-unnamed-swap-initial');
    await runCase('dual-unnamed-swap-retry');
    await runCase('accredited-crib-legacy-mother-neo1-admission');
    await runCase('no-id-no-rut-consistent-firstname');
  });
});
