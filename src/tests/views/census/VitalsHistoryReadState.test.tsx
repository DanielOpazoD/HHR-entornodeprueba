import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PatientVitalSigns } from '@/types/domain/vitalSigns';
import type { ClinicalDerivedEpisodeDoc } from '@/types/domain/clinicalDerived';
import type { ClinicalDerivedEpisodeDocReadResult } from '@/services/storage/firestore/clinicalDerivedEpisodeReader';
import { DataFactory } from '@/tests/factories/DataFactory';
import { splitEpisode } from '@/tests/factories/splitEpisode';

const reader = vi.hoisted(() => ({ readDoc: vi.fn(), enabled: vi.fn(() => true) }));
vi.mock('@/services/repositories/repositoryConfig', () => ({ isFirestoreEnabled: reader.enabled }));
vi.mock('@/services/storage/firestore/clinicalDerivedEpisodeReader', () => ({
  readClinicalDerivedEpisodeDoc: reader.readDoc,
  readClinicalDerivedEpisodeDocs: vi.fn(),
}));

import { VitalsCell } from '@/features/census/components/patient-row/VitalsCell';
import {
  ClinicalDerivedDayProvider,
  useCensusClinicalDerivedDay,
} from '@/features/census/components/patient-row/clinicalDerivedDayContext';
import '@/features/census/components/patient-row/VitalsDetailModal';
import '@/services/repositories/dailyRecordClinicalDerivedReadService';

const DATE = '2026-11-02';
const GENERATION = 'gen_synthetic_a';
const vital = (hour: number): PatientVitalSigns => ({
  recordedDate: DATE,
  recordedAt: `${DATE} ${hour}:00`,
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
const resolved = (hours: number[]): ClinicalDerivedEpisodeDocReadResult => ({
  status: 'resolved',
  fromCache: false,
  doc: {
    schemaVersion: 1,
    date: DATE,
    clinicalEpisodeId: 'ep_synthetic',
    layoutGeneration: GENERATION,
    dayRevision: 4,
    vitalSignsHistory: hours.map(vital),
  },
});
const deferred = () => {
  let resolve!: (result: ClinicalDerivedEpisodeDocReadResult) => void;
  const promise = new Promise<ClinicalDerivedEpisodeDocReadResult>(done => {
    resolve = done;
  });
  return { promise, resolve };
};

const CensusDay = ({ revision = 4 }: { revision?: number }) => {
  const patient = splitEpisode({ vitalSigns: vital(9) });
  const record = {
    ...DataFactory.createMockDailyRecord(DATE, {
      clinicalDerivedLayout: { version: 1, generation: GENERATION },
      beds: { R1: patient },
    }),
    meta: { revision },
  };
  const day = useCensusClinicalDerivedDay(record, DATE);
  return (
    <ClinicalDerivedDayProvider value={day}>
      <table>
        <tbody>
          <tr>
            <VitalsCell
              data={patient}
              date={DATE}
              clinicalEpisodeId={patient.clinicalEpisodeId}
              layoutGeneration={GENERATION}
            />
          </tr>
        </tbody>
      </table>
    </ClinicalDerivedDayProvider>
  );
};
const open = () => fireEvent.click(screen.getByRole('button', { name: 'Ver signos vitales' }));

describe('split episode vitals history read state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reader.enabled.mockReturnValue(true);
  });

  it('shows loading beside the latest reading until the history arrives', async () => {
    const pending = deferred();
    reader.readDoc.mockReturnValue(pending.promise);
    render(<CensusDay />);
    open();

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Cargando historial'));
    expect(screen.getByText('Última toma')).toBeInTheDocument();
    await act(async () => pending.resolve(resolved([9, 8])));
    expect(await screen.findByText('Historial · 2 tomas')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it.each(['offline', 'denied', 'rejected', 'skipped'])(
    'shows unavailable history for %s and recovers with retry',
    async failure => {
      if (failure === 'rejected') reader.readDoc.mockRejectedValueOnce(new Error('synthetic'));
      else if (failure === 'skipped') reader.enabled.mockReturnValue(false);
      else
        reader.readDoc.mockResolvedValueOnce(
          failure === 'denied'
            ? { status: 'permission_denied', code: 'permission-denied' }
            : { status: 'failed', code: 'unavailable' }
        );
      render(<CensusDay />);
      open();

      expect(await screen.findByRole('alert')).toHaveTextContent('Historial no disponible');
      expect(screen.getByText('Última toma')).toBeInTheDocument();
      reader.enabled.mockReturnValue(true);
      reader.readDoc.mockResolvedValueOnce(resolved([9, 8, 7]));
      fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
      expect(await screen.findByText('Historial · 3 tomas')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    }
  );

  it.each([null, {}, { vitalSignsHistory: null }])(
    'keeps a successful absent history distinct from a failed read (%j)',
    async fields => {
      const doc: ClinicalDerivedEpisodeDoc | null =
        fields === null
          ? null
          : {
              schemaVersion: 1,
              date: DATE,
              clinicalEpisodeId: 'ep_synthetic',
              layoutGeneration: GENERATION,
              dayRevision: 4,
              ...fields,
            };
      reader.readDoc.mockResolvedValueOnce({ status: 'resolved', doc, fromCache: false });
      render(<CensusDay />);
      open();
      await screen.findByText('Última toma');
      await waitFor(() => expect(reader.readDoc).toHaveBeenCalledOnce());
      await vi.dynamicImportSettled();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    }
  );

  it('refreshes history on a day revision change even when the latest reading is unchanged', async () => {
    reader.readDoc.mockResolvedValueOnce(resolved([9, 8]));
    const view = render(<CensusDay />);
    open();
    expect(await screen.findByText('Historial · 2 tomas')).toBeInTheDocument();

    const pending = deferred();
    reader.readDoc.mockReturnValueOnce(pending.promise);
    view.rerender(<CensusDay revision={5} />);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Cargando historial'));
    expect(screen.queryByText('Historial · 2 tomas')).not.toBeInTheDocument();
    await act(async () => pending.resolve(resolved([9, 8, 7])));
    expect(await screen.findByText('Historial · 3 tomas')).toBeInTheDocument();
  });

  it('ignores an older response while reading the new day revision', async () => {
    const older = deferred();
    const newer = deferred();
    reader.readDoc.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const view = render(<CensusDay />);
    open();
    await waitFor(() => expect(reader.readDoc).toHaveBeenCalledOnce());
    view.rerender(<CensusDay revision={5} />);
    await waitFor(() => expect(reader.readDoc).toHaveBeenCalledTimes(2));

    await act(async () => older.resolve(resolved([9, 8])));
    expect(screen.getByRole('status')).toHaveTextContent('Cargando historial');
    expect(screen.queryByText('Historial · 2 tomas')).not.toBeInTheDocument();
    await act(async () => newer.resolve(resolved([9, 8, 7])));
    expect(await screen.findByText('Historial · 3 tomas')).toBeInTheDocument();
  });
});
