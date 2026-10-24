import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PatientData } from '@/types/domain/patient';
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
const resolved = (
  hours: number[]
): Extract<ClinicalDerivedEpisodeDocReadResult, { status: 'resolved' }> => ({
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
  let reject!: (error: unknown) => void;
  let resolve!: (result: ClinicalDerivedEpisodeDocReadResult) => void;
  const promise = new Promise<ClinicalDerivedEpisodeDocReadResult>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};

const CensusDay = ({
  revision = 4,
  patient = splitEpisode({ vitalSigns: vital(9) }),
}: {
  revision?: number;
  patient?: PatientData;
}) => {
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
    reader.readDoc.mockReset();
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
    await waitFor(() => expect(reader.readDoc).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Historial · 2 tomas')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
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

  it.each(['success', 'failure', 'rejection'])(
    'ignores an older late %s after the newer revision has resolved',
    async outcome => {
      const older = deferred();
      const newer = deferred();
      reader.readDoc.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
      const view = render(<CensusDay />);
      open();
      await waitFor(() => expect(reader.readDoc).toHaveBeenCalledOnce());
      view.rerender(<CensusDay revision={5} />);
      await waitFor(() => expect(reader.readDoc).toHaveBeenCalledTimes(2));
      await act(async () => newer.resolve(resolved([9, 8, 7])));
      expect(await screen.findByText('Historial · 3 tomas')).toBeInTheDocument();
      await act(async () => {
        if (outcome === 'rejection') older.reject(new Error('synthetic late failure'));
        else
          older.resolve(
            outcome === 'success' ? resolved([9, 8]) : { status: 'failed', code: 'unavailable' }
          );
      });
      expect(screen.getByText('Historial · 3 tomas')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    }
  );

  it('ignores a late retry failure after the newer revision has resolved', async () => {
    reader.readDoc.mockRejectedValueOnce(new Error('synthetic first failure'));
    const view = render(<CensusDay />);
    open();
    await screen.findByRole('alert');
    const retry = deferred();
    const newer = deferred();
    reader.readDoc.mockReturnValueOnce(retry.promise).mockReturnValueOnce(newer.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(reader.readDoc).toHaveBeenCalledTimes(2));
    view.rerender(<CensusDay revision={5} />);
    await waitFor(() => expect(reader.readDoc).toHaveBeenCalledTimes(3));
    await act(async () => newer.resolve(resolved([9, 8, 7])));
    expect(await screen.findByText('Historial · 3 tomas')).toBeInTheDocument();
    await act(async () => retry.resolve({ status: 'failed', code: 'unavailable' }));
    expect(screen.getByText('Historial · 3 tomas')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each(['failed', 'rejected'])(
    'keeps the last resolved table through a %s refresh and retry',
    async outcome => {
      reader.readDoc.mockResolvedValueOnce(resolved([9, 8, 7]));
      const view = render(<CensusDay />);
      open();
      expect(await screen.findByText('Historial · 3 tomas')).toBeInTheDocument();
      if (outcome === 'rejected')
        reader.readDoc.mockRejectedValueOnce(new Error('synthetic transient failure'));
      else reader.readDoc.mockResolvedValueOnce({ status: 'failed', code: 'unavailable' });
      view.rerender(<CensusDay revision={5} />);
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'No se pudo actualizar el historial'
      );
      expect(screen.getByText('Historial · 3 tomas')).toBeInTheDocument();
      const retry = deferred();
      reader.readDoc.mockReturnValueOnce(retry.promise);
      fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
      await waitFor(() => expect(reader.readDoc).toHaveBeenCalledTimes(3));
      expect(screen.getByText('Historial · 3 tomas')).toBeInTheDocument();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      await act(async () => retry.resolve(resolved([9, 8, 7, 6])));
      expect(await screen.findByText('Historial · 4 tomas')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    }
  );

  it('does not show another episode history while its first read is pending or failed', async () => {
    reader.readDoc.mockResolvedValueOnce(resolved([9, 8, 7]));
    const view = render(<CensusDay />);
    open();
    expect(await screen.findByText('Historial · 3 tomas')).toBeInTheDocument();
    const pending = deferred();
    reader.readDoc.mockReturnValueOnce(pending.promise);
    view.rerender(
      <CensusDay
        patient={splitEpisode({ clinicalEpisodeId: 'ep_other_synthetic', vitalSigns: vital(9) })}
      />
    );
    await waitFor(() => expect(reader.readDoc).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Historial · 3 tomas')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Cargando historial');
    await act(async () => pending.reject(new Error('synthetic other failure')));
    expect(await screen.findByRole('alert')).toHaveTextContent('Historial no disponible');
  });

  // D6: marked days may still contain episodes before their first split write.
  const unsplit = (clinicalEpisodeId = 'ep_synthetic') =>
    DataFactory.createMockPatient('R1', {
      patientName: 'Paciente Sintético',
      rut: '00000000-0',
      age: '40',
      clinicalEpisodeId,
      vitalSigns: vital(9),
      vitalSignsHistory: [vital(9), vital(8), vital(7)],
    });

  it.each(['rejected', 'offline', 'denied', 'disabled'])(
    'preserves embedded history without an unavailable notice on %s (verifier regression)',
    async outcome => {
      if (outcome === 'rejected') reader.readDoc.mockRejectedValueOnce(new Error('synthetic'));
      else if (outcome === 'disabled') reader.enabled.mockReturnValue(false);
      else
        reader.readDoc.mockResolvedValueOnce(
          outcome === 'denied'
            ? { status: 'permission_denied', code: 'permission-denied' }
            : { status: 'failed', code: 'unavailable' }
        );
      render(<CensusDay patient={unsplit()} />);
      open();
      await vi.dynamicImportSettled();
      expect(screen.getByText('Historial · 3 tomas')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    }
  );

  it('shows embedded history while the first read is pending (verifier regression)', async () => {
    const pending = deferred();
    reader.readDoc.mockReturnValueOnce(pending.promise);
    render(<CensusDay patient={unsplit()} />);
    open();
    await waitFor(() => expect(reader.readDoc).toHaveBeenCalledOnce());
    expect(screen.getByText('Historial · 3 tomas')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await act(async () => pending.resolve({ status: 'resolved', doc: null, fromCache: false }));
    expect(screen.getByText('Historial · 3 tomas')).toBeInTheDocument();
  });

  it('keeps embedded history for an invalid episode id without a read or retry notice', async () => {
    render(<CensusDay patient={unsplit('ep/invalid')} />);
    open();
    await vi.dynamicImportSettled();
    expect(screen.getByText('Historial · 3 tomas')).toBeInTheDocument();
    expect(reader.readDoc).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it.each(['no document', 'no field', 'null', 'empty', 'history'])(
    'applies D4 with an embedded copy and a resolved %s',
    async outcome => {
      const pending = deferred();
      reader.readDoc.mockReturnValueOnce(pending.promise);
      render(<CensusDay patient={unsplit()} />);
      open();
      await waitFor(() => expect(reader.readDoc).toHaveBeenCalledOnce());
      const doc = resolved([9, 8, 7, 6]);
      if (outcome === 'no document') doc.doc = null;
      else if (doc.doc) {
        if (outcome === 'no field') delete doc.doc.vitalSignsHistory;
        else if (outcome === 'null') doc.doc.vitalSignsHistory = null;
        else if (outcome === 'empty') doc.doc.vitalSignsHistory = [];
      }
      await act(async () => pending.resolve(doc));
      if (outcome === 'null' || outcome === 'empty') {
        expect(screen.queryByText(/Historial ·/)).not.toBeInTheDocument();
      } else {
        expect(
          screen.getByText(`Historial · ${outcome === 'history' ? 4 : 3} tomas`)
        ).toBeInTheDocument();
      }
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    }
  );
});
