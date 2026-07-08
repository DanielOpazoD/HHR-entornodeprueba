/**
 * Tests for the bed-grid view. Mocks the daily-record loader and the
 * Storage URL resolver so the component renders deterministically, then
 * exercises the drag-and-drop assignment flow (drop into a matching
 * column triggers `onAssign` with the row's bed/patient).
 */

import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UIProvider } from '@/context/UIContext';

vi.mock('@/services/storage/firestore/firestoreRecordQueries', () => ({
  getRecordFromFirestore: vi.fn(),
}));

vi.mock('@/features/prescriptions/services/prescriptionStorageImageService', () => ({
  resolvePrescriptionImageDownloadUrl: vi.fn(async (path: string) => `https://stub/${path}`),
}));

import { getRecordFromFirestore } from '@/services/storage/firestore/firestoreRecordQueries';
import { PrescriptionBedGridView } from '@/features/prescriptions/components/PrescriptionBedGridView';
import { resolvePrescriptionImageDownloadUrl } from '@/features/prescriptions/services/prescriptionStorageImageService';
import type { PrescriptionRecord } from '@/types/prescriptionTypes';
import type { DailyRecord } from '@/services/storage/storageDailyRecordContracts';

const buildRecord = (
  id: string,
  overrides: Partial<PrescriptionRecord> = {}
): PrescriptionRecord => ({
  id,
  hospitalId: 'hhr',
  prescriptionType: 'comun',
  image: {
    storagePath: `prescriptions/hhr/${id}/full.jpg`,
    thumbnailStoragePath: `prescriptions/hhr/${id}/thumb.jpg`,
    byteSize: 200_000,
    width: 1200,
    height: 900,
    contentType: 'image/jpeg',
  },
  uploader: { source: 'qr_pin' },
  createdAt: '2026-05-04T10:00:00.000Z',
  expiresAt: '2026-06-03T10:00:00.000Z',
  ...overrides,
});

const buildDailyRecord = (): DailyRecord =>
  ({
    date: '2026-05-04',
    beds: {
      H1C2: {
        bedId: 'H1C2',
        isBlocked: false,
        bedMode: 'Cama',
        hasCompanionCrib: false,
        patientName: 'Carina Pate Lillo',
        rut: '14.470.055-4',
        age: '60',
        pathology: '—',
      },
    },
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: '2026-05-04T10:00:00.000Z',
    activeExtraBeds: [],
  }) as unknown as DailyRecord;

const buildEmptyDailyRecord = (date: string): DailyRecord =>
  ({
    date,
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: `${date}T10:00:00.000Z`,
    activeExtraBeds: [],
  }) as unknown as DailyRecord;

const renderGrid = (ui: React.ReactElement) => render(<UIProvider>{ui}</UIProvider>);

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(next => {
    resolve = next;
  });
  return { promise, resolve };
};

describe('PrescriptionBedGridView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRecordFromFirestore).mockResolvedValue(buildDailyRecord());
    vi.mocked(resolvePrescriptionImageDownloadUrl).mockImplementation(
      async (path: string) => `https://stub/${path}`
    );
  });

  it('lists pending unassigned prescriptions in the tray', async () => {
    const unassigned = buildRecord('rx-pending', { bedId: undefined, patientName: undefined });
    renderGrid(<PrescriptionBedGridView records={[unassigned]} dayIso="2026-05-04" />);

    await waitFor(() => expect(screen.getByTestId('prescription-unassigned-tray')).toBeTruthy());
    expect(screen.getByTestId('prescription-unassigned-card-rx-pending')).toBeTruthy();
  });

  it('uses previous-day census rows when the selected day has no patients', async () => {
    vi.mocked(getRecordFromFirestore).mockImplementation(async (date: string) => {
      if (date === '2026-05-05') return buildEmptyDailyRecord('2026-05-05');
      if (date === '2026-05-04') return buildDailyRecord();
      return null;
    });

    renderGrid(<PrescriptionBedGridView records={[]} dayIso="2026-05-05" />);

    expect(await screen.findByText('Carina Pate Lillo')).toBeInTheDocument();
    expect(screen.getByText(/censo del día previo/i)).toBeInTheDocument();
    expect(getRecordFromFirestore).toHaveBeenCalledWith('2026-05-05');
    expect(getRecordFromFirestore).toHaveBeenCalledWith('2026-05-04');
  });

  it('shows Stock de Hospitalizados separately from unassigned prescriptions', async () => {
    const stock = buildRecord('rx-stock', {
      assignmentScope: 'hospitalized_stock',
      bedId: undefined,
      patientName: undefined,
    });
    const unassigned = buildRecord('rx-pending', { bedId: undefined, patientName: undefined });

    renderGrid(<PrescriptionBedGridView records={[stock, unassigned]} dayIso="2026-05-04" />);

    await screen.findByTestId('prescription-stock-tray');
    expect(screen.getByTestId('prescription-stock-card-rx-stock')).toBeInTheDocument();
    expect(screen.getByTestId('prescription-unassigned-card-rx-pending')).toBeInTheDocument();
    expect(screen.queryByTestId('prescription-unassigned-card-rx-stock')).not.toBeInTheDocument();
    expect(
      screen
        .getByRole('table')
        .compareDocumentPosition(screen.getByTestId('prescription-stock-tray')) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      screen
        .getByTestId('prescription-stock-tray')
        .compareDocumentPosition(screen.getByTestId('prescription-unassigned-tray')) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('sends an unassigned prescription to hospitalized stock from the tray', async () => {
    const unassigned = buildRecord('rx-stock-target', {
      bedId: undefined,
      patientName: undefined,
      patientRut: undefined,
    });
    const onAssignStock = vi.fn(async () => undefined);

    renderGrid(
      <PrescriptionBedGridView
        records={[unassigned]}
        dayIso="2026-05-04"
        onAssignStock={onAssignStock}
      />
    );

    await screen.findByTestId('prescription-unassigned-card-rx-stock-target');
    fireEvent.click(screen.getByRole('button', { name: /enviar a stock de hospitalizados/i }));

    await waitFor(() => expect(onAssignStock).toHaveBeenCalledTimes(1));
    expect(onAssignStock).toHaveBeenCalledWith(expect.objectContaining({ id: 'rx-stock-target' }));
  });

  it('keeps today prescriptions visible when the patient is no longer active in the census', async () => {
    const dischargedPrescription = buildRecord('rx-discharged', {
      assignmentScope: 'patient',
      bedId: 'H2C3',
      patientName: 'Paciente Alta Hoy',
      patientRut: '12.345.678-9',
      prescriptionType: 'comun',
    });

    renderGrid(<PrescriptionBedGridView records={[dischargedPrescription]} dayIso="2026-05-04" />);

    expect(await screen.findByText('Paciente Alta Hoy')).toBeInTheDocument();
    expect(screen.getByText('Egreso')).toBeInTheDocument();
    expect(screen.getByText('12.345.678-9')).toBeInTheDocument();
    expect(screen.getByTestId('prescription-bed-cell-H2C3-comun')).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: /comun · h2c3/i })).toBeInTheDocument();
  });

  it('moves prescriptions from a previous bed to the current active bed for the same patient', async () => {
    vi.mocked(getRecordFromFirestore).mockResolvedValue({
      ...buildDailyRecord(),
      beds: {
        H6C1: {
          bedId: 'H6C1',
          isBlocked: false,
          bedMode: 'Cama',
          hasCompanionCrib: false,
          patientName: 'Luis Pate Tuki',
          rut: '6.451.632-9',
          age: '55',
          pathology: '—',
        },
      },
    } as unknown as DailyRecord);
    const movedPatientPrescription = buildRecord('rx-moved-bed', {
      assignmentScope: 'patient',
      bedId: 'R1',
      patientName: 'Luis Pate Tuki',
      patientRut: '6.451.632-9',
      prescriptionType: 'comun',
    });

    renderGrid(
      <PrescriptionBedGridView records={[movedPatientPrescription]} dayIso="2026-05-04" />
    );

    expect(await screen.findByText('Luis Pate Tuki')).toBeInTheDocument();
    expect(screen.queryByText('Egreso')).not.toBeInTheDocument();
    expect(screen.getByTestId('prescription-bed-cell-H6C1-comun')).toBeInTheDocument();
    expect(screen.queryByTestId('prescription-bed-cell-R1-comun')).not.toBeInTheDocument();
    expect(await screen.findByRole('img', { name: /comun · h6c1/i })).toBeInTheDocument();
  });

  it('opens a bed reassignment action for an already assigned prescription in the bed grid', async () => {
    const assigned = buildRecord('rx-change-bed', {
      assignmentScope: 'patient',
      bedId: 'H2C3',
      patientName: 'Paciente Alta Hoy',
      patientRut: '12.345.678-9',
      prescriptionType: 'comun',
    });
    const onReassign = vi.fn(async () => undefined);

    renderGrid(
      <PrescriptionBedGridView records={[assigned]} dayIso="2026-05-04" onReassign={onReassign} />
    );

    fireEvent.click(await screen.findByRole('button', { name: /cambiar cama de receta/i }));
    const select = (await screen.findByRole('combobox')) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'H1C2' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }));

    await waitFor(() => expect(onReassign).toHaveBeenCalledTimes(1));
    expect(onReassign).toHaveBeenCalledWith(expect.objectContaining({ id: 'rx-change-bed' }), {
      bedId: 'H1C2',
      patientName: 'Carina Pate Lillo',
      patientRut: '14.470.055-4',
      clear: false,
    });
  });

  it('shows an inline error when bed reassignment fails from the bed grid', async () => {
    const assigned = buildRecord('rx-change-bed-error', {
      assignmentScope: 'patient',
      bedId: 'H2C3',
      patientName: 'Paciente Alta Hoy',
      patientRut: '12.345.678-9',
      prescriptionType: 'comun',
    });
    const onReassign = vi.fn(async () => {
      throw new Error('No se pudo cambiar la cama de la receta.');
    });

    renderGrid(
      <PrescriptionBedGridView records={[assigned]} dayIso="2026-05-04" onReassign={onReassign} />
    );

    fireEvent.click(await screen.findByRole('button', { name: /cambiar cama de receta/i }));
    const select = (await screen.findByRole('combobox')) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'H1C2' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /no se pudo cambiar la cama de la receta/i
    );
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('drops a matching-type unassigned prescription onto a bed cell and calls onAssign', async () => {
    const unassigned = buildRecord('rx-drag', {
      bedId: undefined,
      patientName: undefined,
      prescriptionType: 'comun',
    });
    const onAssign = vi.fn(async () => undefined);

    renderGrid(
      <PrescriptionBedGridView records={[unassigned]} dayIso="2026-05-04" onAssign={onAssign} />
    );

    const card = await screen.findByTestId('prescription-unassigned-card-rx-drag');
    const cell = await screen.findByTestId('prescription-bed-cell-H1C2-comun');

    const dataTransfer = {
      effectAllowed: '',
      dropEffect: '',
      setData: vi.fn(),
      getData: vi.fn(() => 'rx-drag'),
      types: ['text/plain'],
    };

    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.dragOver(cell, { dataTransfer });
    fireEvent.drop(cell, { dataTransfer });

    await waitFor(() => expect(onAssign).toHaveBeenCalledTimes(1));
    expect(onAssign).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'rx-drag' }),
      expect.objectContaining({
        bedId: 'H1C2',
        patientName: 'Carina Pate Lillo',
        patientRut: '14.470.055-4',
      })
    );
  });

  it('does not call onAssign when dropping onto a non-matching type column', async () => {
    const unassigned = buildRecord('rx-mismatch', {
      bedId: undefined,
      patientName: undefined,
      prescriptionType: 'comun',
    });
    const onAssign = vi.fn(async () => undefined);

    renderGrid(
      <PrescriptionBedGridView records={[unassigned]} dayIso="2026-05-04" onAssign={onAssign} />
    );

    const card = await screen.findByTestId('prescription-unassigned-card-rx-mismatch');
    const wrongCell = await screen.findByTestId('prescription-bed-cell-H1C2-psicotropicos');

    const dataTransfer = {
      effectAllowed: '',
      dropEffect: '',
      setData: vi.fn(),
      getData: vi.fn(() => 'rx-mismatch'),
      types: ['text/plain'],
    };

    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.dragOver(wrongCell, { dataTransfer });
    fireEvent.drop(wrongCell, { dataTransfer });

    expect(onAssign).not.toHaveBeenCalled();
  });

  it('navigates between prescriptions for the same patient in the image viewer', async () => {
    const user = userEvent.setup();
    const first = buildRecord('rx-first', {
      bedId: 'H1C2',
      patientName: 'Carina Pate Lillo',
      patientRut: '14.470.055-4',
      prescriptionType: 'comun',
    });
    const second = buildRecord('rx-second', {
      bedId: 'H1C2',
      patientName: 'Carina Pate Lillo',
      patientRut: '14.470.055-4',
      prescriptionType: 'psicotropicos',
    });

    renderGrid(<PrescriptionBedGridView records={[first, second]} dayIso="2026-05-04" />);

    const thumbnail = await screen.findByRole('img', { name: /comun · h1c2/i });
    await user.click(thumbnail.closest('button')!);

    const dialogImage = await screen.findByRole('img', { name: /receta 1 de 2/i });
    expect(dialogImage).toHaveAttribute('src', 'https://stub/prescriptions/hhr/rx-first/full.jpg');

    await user.click(screen.getByRole('button', { name: /receta siguiente/i }));

    expect(
      await screen.findByRole('img', { name: /receta 2 de 2/i }, { timeout: 4000 })
    ).toHaveAttribute('src', 'https://stub/prescriptions/hhr/rx-second/full.jpg');
  });

  it('keeps the image viewer mounted while the next prescription image loads', async () => {
    const user = userEvent.setup();
    const first = buildRecord('rx-first', {
      bedId: 'H1C2',
      patientName: 'Carina Pate Lillo',
      patientRut: '14.470.055-4',
      prescriptionType: 'comun',
    });
    const second = buildRecord('rx-second', {
      bedId: 'H1C2',
      patientName: 'Carina Pate Lillo',
      patientRut: '14.470.055-4',
      prescriptionType: 'psicotropicos',
    });
    const secondImage = createDeferred<string>();
    vi.mocked(resolvePrescriptionImageDownloadUrl).mockImplementation((path: string) => {
      if (path === second.image.storagePath) return secondImage.promise;
      return Promise.resolve(`https://stub/${path}`);
    });

    renderGrid(<PrescriptionBedGridView records={[first, second]} dayIso="2026-05-04" />);

    const thumbnail = await screen.findByRole('img', { name: /comun · h1c2/i });
    await user.click(thumbnail.closest('button')!);
    expect(await screen.findByRole('img', { name: /receta 1 de 2/i })).toHaveAttribute(
      'src',
      'https://stub/prescriptions/hhr/rx-first/full.jpg'
    );

    await user.click(screen.getByRole('button', { name: /receta siguiente/i }));

    expect(screen.getByRole('dialog', { name: /vista ampliada/i })).toBeInTheDocument();
    expect(await screen.findByRole('status', { name: /cargando receta/i })).toBeInTheDocument();

    await act(async () => {
      secondImage.resolve('https://stub/prescriptions/hhr/rx-second/full.jpg');
    });

    expect(
      await screen.findByRole('img', { name: /receta 2 de 2/i }, { timeout: 4000 })
    ).toHaveAttribute('src', 'https://stub/prescriptions/hhr/rx-second/full.jpg');
  });

  it('confirms and deletes the selected prescription from the image viewer', async () => {
    const record = buildRecord('rx-delete', {
      bedId: 'H1C2',
      patientName: 'Carina Pate Lillo',
      patientRut: '14.470.055-4',
    });
    const onDelete = vi.fn(async () => undefined);

    renderGrid(
      <PrescriptionBedGridView records={[record]} dayIso="2026-05-04" onDelete={onDelete} />
    );

    const thumbnail = await screen.findByRole('img', { name: /comun · h1c2/i });
    fireEvent.click(thumbnail.closest('button')!);
    await screen.findByRole('dialog', { name: /vista ampliada/i });

    fireEvent.click(screen.getByRole('button', { name: /eliminar receta/i }));
    fireEvent.click(await screen.findByRole('button', { name: /eliminar respaldo/i }));

    await waitFor(() =>
      expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: record.id }))
    );
  });
});
