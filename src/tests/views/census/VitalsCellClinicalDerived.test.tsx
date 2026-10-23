import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ClinicalDerivedEpisodeDoc } from '@/types/domain/clinicalDerived';
import type { PatientData } from '@/types/domain/patient';
import type { PatientVitalSigns } from '@/types/domain/vitalSigns';

const mocks = vi.hoisted(() => ({
  isFirestoreEnabled: vi.fn(() => true),
  readDoc: vi.fn(),
  readDocs: vi.fn(),
}));

vi.mock('@/services/repositories/repositoryConfig', () => ({
  isFirestoreEnabled: mocks.isFirestoreEnabled,
}));
vi.mock('@/services/storage/firestore/clinicalDerivedEpisodeReader', () => ({
  readClinicalDerivedEpisodeDoc: mocks.readDoc,
  readClinicalDerivedEpisodeDocs: mocks.readDocs,
}));

import { VitalsCell } from '@/features/census/components/patient-row/VitalsCell';
import { PatientInputFlowSection } from '@/features/census/components/patient-row/PatientInputCellSections';
import {
  ClinicalDerivedDayGenerationProvider,
  resolveClinicalDerivedDayGeneration,
} from '@/features/census/components/patient-row/clinicalDerivedDayContext';
import type { PatientInputFlowSectionBindings } from '@/features/census/components/patient-row/patientInputSectionContracts';
import { DataFactory } from '@/tests/factories/DataFactory';
// Warm the lazy modal and the read path so a loaded machine does not time the window out.
import '@/features/census/components/patient-row/VitalsDetailModal';
import '@/services/repositories/dailyRecordClinicalDerivedReadService';

const DATE = '2026-11-02';
const GENERATION = 'gen_synthetic_a';

const vital = (hour: number): PatientVitalSigns => ({
  recordedDate: DATE,
  recordedAt: `02-11-2026 ${String(hour).padStart(2, '0')}:00`,
  systolic: 120,
  diastolic: 80,
  heartRate: 70 + hour,
  spo2: 97,
  temperature: 36.6,
  respiratoryRate: 16,
  painEva: null,
  hgt: null,
  insulinUnits: null,
  insulinQuadrant: null,
  observations: null,
  author: '',
  authorRole: '',
});
const latest = vital(9);
const embedded = [latest, vital(8), vital(7)];

const patient = (extra: Partial<PatientData> = {}) =>
  DataFactory.createMockPatient('R1', {
    patientName: 'Paciente Sintético',
    age: '40',
    clinicalEpisodeId: 'ep_synthetic',
    vitalSigns: latest,
    vitalSignsHistory: embedded,
    ...extra,
  });

const episodeDoc = (extra: Partial<ClinicalDerivedEpisodeDoc>) => ({
  schemaVersion: 1,
  date: DATE,
  clinicalEpisodeId: 'ep_synthetic',
  layoutGeneration: GENERATION,
  dayRevision: 4,
  ...extra,
});

const openWindow = (layoutGeneration?: string) => {
  render(
    <table>
      <tbody>
        <tr>
          <VitalsCell
            data={patient()}
            date={DATE}
            clinicalEpisodeId="ep_synthetic"
            layoutGeneration={layoutGeneration}
          />
        </tr>
      </tbody>
    </table>
  );
  fireEvent.click(screen.getByRole('button', { name: 'Ver signos vitales' }));
};

const resolvedWith = (doc: unknown) => ({ status: 'resolved', doc, fromCache: false });

describe('vitals window on a split day (D10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isFirestoreEnabled.mockReturnValue(true);
  });

  it("shows the episode document's history, read once from the SDK default source", async () => {
    mocks.readDoc.mockResolvedValue(
      resolvedWith(episodeDoc({ vitalSignsHistory: [latest, vital(5), vital(4), vital(3)] }))
    );
    openWindow(GENERATION);

    expect(await screen.findByText('Historial · 4 tomas')).toBeInTheDocument();
    expect(mocks.readDoc).toHaveBeenCalledTimes(1);
    expect(mocks.readDoc).toHaveBeenCalledWith(DATE, GENERATION, 'ep_synthetic', {
      source: 'default',
    });
  });

  it('a document that clears the history wins over the embedded copy', async () => {
    mocks.readDoc.mockResolvedValue(resolvedWith(episodeDoc({ vitalSignsHistory: null })));
    openWindow(GENERATION);

    await screen.findByText('Última toma');
    await waitFor(() => expect(screen.queryByText(/Historial/)).not.toBeInTheDocument());
  });

  it.each([
    ['a document without the field', resolvedWith(episodeDoc({}))],
    ['no document', resolvedWith(null)],
    ['an offline read without a cached copy', { status: 'failed', code: 'unavailable' }],
    ['a denied read', { status: 'permission_denied', code: 'permission-denied' }],
  ])('keeps the embedded history with %s', async (_label, result) => {
    mocks.readDoc.mockResolvedValue(result);
    openWindow(GENERATION);

    expect(await screen.findByText('Historial · 3 tomas')).toBeInTheDocument();
    await waitFor(() => expect(mocks.readDoc).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Historial · 3 tomas')).toBeInTheDocument();
  });

  it('keeps the embedded history when the read throws', async () => {
    mocks.readDoc.mockRejectedValue(new Error('synthetic failure'));
    openWindow(GENERATION);

    expect(await screen.findByText('Historial · 3 tomas')).toBeInTheDocument();
  });

  it('reads nothing on an unmarked day', async () => {
    openWindow();

    expect(await screen.findByText('Historial · 3 tomas')).toBeInTheDocument();
    expect(mocks.readDoc).not.toHaveBeenCalled();
  });

  it('gets the date, the episode and the marker from the census row', async () => {
    mocks.readDoc.mockResolvedValue(resolvedWith(episodeDoc({ vitalSignsHistory: [latest] })));
    const bindings = {
      shared: {
        data: patient(),
        currentDateString: DATE,
        isSubRow: false,
        isEmpty: false,
        isLocked: false,
      },
      handleDebouncedText: () => () => undefined,
      onChange: {},
    } as unknown as PatientInputFlowSectionBindings;
    render(
      <ClinicalDerivedDayGenerationProvider value={GENERATION}>
        <table>
          <tbody>
            <tr>
              <PatientInputFlowSection {...bindings} accessProfile="specialist" />
            </tr>
          </tbody>
        </table>
      </ClinicalDerivedDayGenerationProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ver signos vitales' }));

    await screen.findByText('Última toma');
    await waitFor(() =>
      expect(mocks.readDoc).toHaveBeenCalledWith(DATE, GENERATION, 'ep_synthetic', {
        source: 'default',
      })
    );
    await waitFor(() => expect(screen.queryByText(/Historial/)).not.toBeInTheDocument());
  });

  it('passes only the generation of a marker this client understands', () => {
    expect(resolveClinicalDerivedDayGeneration({ version: 1, generation: GENERATION })).toBe(
      GENERATION
    );
    expect(resolveClinicalDerivedDayGeneration({ version: 2, generation: GENERATION })).toBe(
      undefined
    );
    expect(resolveClinicalDerivedDayGeneration(undefined)).toBe(undefined);
    expect(resolveClinicalDerivedDayGeneration({ version: 1 })).toBe(undefined);
  });
});
