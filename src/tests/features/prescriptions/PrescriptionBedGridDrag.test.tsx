import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { UIProvider } from '@/context/UIContext';

vi.mock('@/services/storage/firestore/firestoreRecordQueries', () => ({
  getRecordFromFirestore: vi.fn(),
}));

vi.mock('@/features/prescriptions/services/prescriptionStorageImageService', () => ({
  resolvePrescriptionImageDownloadUrl: vi.fn(async (path: string) => `https://stub/${path}`),
}));

import { getRecordFromFirestore } from '@/services/storage/firestore/firestoreRecordQueries';
import { PrescriptionBedGridView } from '@/features/prescriptions/components/PrescriptionBedGridView';
import type { PrescriptionRecord } from '@/types/prescriptionTypes';
import type { DailyRecord } from '@/types/domain/dailyRecord';

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
        patientName: 'Actual Sintetico',
        rut: '11.111.111-1',
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

const loose = buildRecord('loose');
const previous = buildRecord('previous', {
  assignmentScope: 'patient',
  bedId: 'H1C2',
  patientName: 'Anterior Sintetico',
  patientRut: '10.000.013-K',
});
const transfer = () => ({ effectAllowed: '', dropEffect: '', setData: vi.fn() });
const cellFor = (name: string) =>
  within(screen.getByText(name).closest('tr')!).getAllByRole('cell')[2];

const setup = async (records = [previous, loose]) => {
  const onAssign = vi.fn(async () => undefined);
  const onAssignStock = vi.fn(async () => undefined);
  const result = render(
    <UIProvider>
      <PrescriptionBedGridView
        records={records}
        dayIso="2026-05-04"
        onAssign={onAssign}
        onAssignStock={onAssignStock}
      />
    </UIProvider>
  );
  await screen.findByText('Actual Sintetico');
  const card = screen.getByTestId('prescription-unassigned-card-loose');
  return { ...result, card, onAssign, onAssignStock };
};

describe('prescription row drag identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRecordFromFirestore).mockResolvedValue(buildDailyRecord());
  });

  it.each(['Actual Sintetico', 'Anterior Sintetico'])(
    'highlights only %s and clears on leave',
    async name => {
      const { card, container } = await setup();
      const target = cellFor(name);
      const other = cellFor(
        name === 'Actual Sintetico' ? 'Anterior Sintetico' : 'Actual Sintetico'
      );
      const dataTransfer = transfer();
      fireEvent.dragStart(card, { dataTransfer });
      fireEvent.dragOver(other, { dataTransfer });
      fireEvent.dragOver(target, { dataTransfer });
      expect(target).toHaveClass('ring-2');
      expect(other).not.toHaveClass('ring-2');
      expect(container.querySelectorAll('td.ring-2')).toHaveLength(1);
      fireEvent.dragLeave(other, { dataTransfer });
      expect(target).toHaveClass('ring-2');
      fireEvent.dragLeave(target, { dataTransfer });
      expect(container.querySelectorAll('td.ring-2')).toHaveLength(0);
    }
  );

  it('has unique cell and picker identifiers across current and multiple discharged rows', async () => {
    const { container, card } = await setup([
      previous,
      loose,
      buildRecord('older', {
        ...previous,
        id: 'older',
        patientName: 'Otra Sintetica',
        patientRut: '22.222.222-2',
      }),
    ]);
    fireEvent.click(within(card).getByRole('button', { name: 'Asignar' }));
    for (const prefix of ['prescription-bed-cell-', 'prescription-assign-here-']) {
      const ids = Array.from(container.querySelectorAll('[data-testid]'))
        .map(el => el.getAttribute('data-testid')!)
        .filter(id => id.startsWith(prefix));
      expect(ids).toHaveLength(prefix.includes('bed-cell') ? 9 : 3);
      expect(new Set(ids).size).toBe(ids.length);
    }
    expect(screen.getByTestId('prescription-bed-cell-H1C2-comun')).toBe(
      cellFor('Actual Sintetico')
    );
    expect(screen.getByTestId('prescription-assign-here-H1C2-comun')).toBeInTheDocument();
  });

  it.each([
    ['Actual Sintetico', '11.111.111-1'],
    ['Anterior Sintetico', '10.000.013-K'],
  ])('preserves drop assignment to %s', async (patientName, patientRut) => {
    const { card, onAssign } = await setup();
    const dataTransfer = transfer();
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.dragOver(cellFor(patientName), { dataTransfer });
    fireEvent.drop(cellFor(patientName), { dataTransfer });
    await waitFor(() =>
      expect(onAssign).toHaveBeenCalledExactlyOnceWith(loose, {
        bedId: 'H1C2',
        patientName,
        patientRut,
      })
    );
  });

  it('preserves single-row highlight, identifiers and assignment', async () => {
    const { card, onAssign } = await setup([loose]);
    const target = screen.getByTestId('prescription-bed-cell-H1C2-comun');
    const dataTransfer = transfer();
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer });
    expect(target).toHaveClass('ring-2');
    fireEvent.drop(target, { dataTransfer });
    await waitFor(() =>
      expect(onAssign).toHaveBeenCalledExactlyOnceWith(loose, {
        bedId: 'H1C2',
        patientName: 'Actual Sintetico',
        patientRut: '11.111.111-1',
      })
    );
    await waitFor(() => expect(target).not.toHaveClass('ring-2'));
  });

  it('offers no empty-bed target and dropping on trays makes no assignment', async () => {
    const daily = buildDailyRecord();
    daily.beds.H2C1 = { ...daily.beds.H1C2, bedId: 'H2C1', patientName: '', rut: '' };
    vi.mocked(getRecordFromFirestore).mockResolvedValue(daily);
    const { card, onAssign, onAssignStock } = await setup([
      loose,
      buildRecord('stock', {
        assignmentScope: 'hospitalized_stock',
      }),
    ]);
    expect(screen.queryByText('H2C1')).not.toBeInTheDocument();
    const dataTransfer = transfer();
    fireEvent.dragStart(card, { dataTransfer });
    for (const id of ['prescription-unassigned-tray', 'prescription-stock-tray']) {
      fireEvent.dragOver(screen.getByTestId(id), { dataTransfer });
      fireEvent.drop(screen.getByTestId(id), { dataTransfer });
    }
    expect(onAssign).not.toHaveBeenCalled();
    expect(onAssignStock).not.toHaveBeenCalled();
  });
});
