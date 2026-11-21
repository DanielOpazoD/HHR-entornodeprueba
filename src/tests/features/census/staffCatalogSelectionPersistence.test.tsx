import { captureAuthoringSession } from '@/services/storage/authoringSession';
import 'fake-indexeddb/auto';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { updatePartial } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { StaffProvider } from '@/context/StaffContext';
import { useNursesQuery, useTensQuery } from '@/hooks/useStaffQuery';
import { useShiftStaffManagement } from '@/hooks/useShiftStaffManagement';
import { StaffSelector } from '@/features/census/components/StaffSelector';
import { createQueryClientTestWrapper } from '@/tests/utils/queryClientTestUtils';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { DailyRecord } from '@/types/domain/dailyRecord';

vi.unmock('@/services/repositories/CatalogRepository');
vi.unmock('@/context/StaffContext');
const boundary = vi.hoisted(() => ({ enabled: true, read: vi.fn() }));
vi.mock('@/services/repositories/repositoryConfig', async original => ({
  ...(await original<typeof import('@/services/repositories/repositoryConfig')>()),
  isFirestoreEnabled: () => boundary.enabled,
}));
vi.mock('@/services/storage/firestore', () => ({
  getNurseCatalogFromFirestore: boundary.read,
  getTensCatalogFromFirestore: boundary.read,
  getProfessionalsCatalogFromFirestore: async () => [],
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ remoteSyncStatus: 'disabled' }) }));
vi.mock('@/hooks/useEloisaStaff', () => ({ useEloisaStaff: () => [] }));
const date = '2026-11-11';
const record: DailyRecord = {
  date,
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  nurses: [],
  activeExtraBeds: [],
  nursesDayShift: ['Asignada Sintética'],
  nursesNightShift: [],
  tensDayShift: ['Asignada Sintética'],
  tensNightShift: [],
  lastUpdated: '2026-11-11T10:00:00.000Z',
};
let pendingWrite: Promise<void> | undefined;
const persistPatch = (patch: DailyRecordPatch) => {
  pendingWrite = updatePartial(date, patch, { authoringSession: captureAuthoringSession() });
  return pendingWrite;
};
function Staffing({ role }: { role: 'nurses' | 'tens' }) {
  const nurses = useNursesQuery();
  const tens = useTensQuery();
  const { updateShiftStaff } = useShiftStaffManagement(record, persistPatch);
  const query = role === 'nurses' ? nurses : tens;
  return (
    <StaffProvider>
      <span>
        {query.isError ? 'Lectura fallida' : query.isSuccess ? 'Lectura correcta' : 'Leyendo'}
      </span>
      {role === 'nurses' ? (
        <StaffSelector
          role="nurse"
          catalog={query.data}
          dayShift={record.nursesDayShift ?? []}
          nightShift={[]}
          onUpdate={updateShiftStaff}
        />
      ) : (
        <StaffSelector
          role="tens"
          catalog={query.data}
          dayShift={record.tensDayShift ?? []}
          nightShift={[]}
          onUpdate={updateShiftStaff}
        />
      )}
    </StaffProvider>
  );
}
const revealNames = () => {
  for (const button of screen.queryAllByRole('button', { name: /Mostrar nombres menos usados/ }))
    fireEvent.click(button);
};
describe('catalog selection reaches durable daily staffing', () => {
  beforeEach(async () => {
    pendingWrite = undefined;
    boundary.enabled = true;
    boundary.read.mockReset().mockRejectedValue(new Error('Synthetic unavailable'));
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    await hospitalDB.open();
    await hospitalDB.catalogs.clear();
    await hospitalDB.syncQueue.clear();
    await hospitalDB.dailyRecords.clear();
    await hospitalDB.dailyRecords.put(record);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });
  for (const role of ['nurses', 'tens'] as const) {
    const placeholder = role === 'nurses' ? 'Enfermero/a 1' : 'TENS 1';
    it(`${role}: confirmed empty keeps legitimate defaults selectable`, async () => {
      boundary.read.mockResolvedValue([]);
      render(<Staffing role={role} />, { wrapper: createQueryClientTestWrapper().wrapper });
      await screen.findByText('Lectura correcta');
      revealNames();
      expect(screen.getAllByRole('option', { name: placeholder }).length).toBeGreaterThan(0);
    });
    it(`${role}: retry replaces error with the actual catalog`, async () => {
      render(<Staffing role={role} />, { wrapper: createQueryClientTestWrapper().wrapper });
      await screen.findByText(/Lectura (fallida|correcta)/);
      boundary.read.mockResolvedValue(['Recuperada Sintética']);
      fireEvent.click(
        screen.getAllByRole('button', { name: 'No se pudo leer la lista. Reintentar' })[0]
      );
      await screen.findByText('Lectura correcta');
      expect(
        screen.getAllByRole('option', { name: 'Recuperada Sintética' }).length
      ).toBeGreaterThan(0);
      expect(
        screen.queryByRole('button', { name: 'No se pudo leer la lista. Reintentar' })
      ).toBeNull();
    });
    it(`${role}: known local catalog remains selectable during remote failure`, async () => {
      await hospitalDB.catalogs.put({
        id: role,
        list: ['Personal Sintético'],
        lastUpdated: 'synthetic',
      });
      render(<Staffing role={role} />, { wrapper: createQueryClientTestWrapper().wrapper });
      await screen.findByText('Lectura correcta');
      expect(screen.getAllByRole('option', { name: 'Personal Sintético' }).length).toBeGreaterThan(
        0
      );
      revealNames();
      expect(screen.queryAllByRole('option', { name: placeholder })).toHaveLength(0);
      boundary.enabled = false;
      fireEvent.change(screen.getAllByRole('combobox')[0], {
        target: { value: 'Personal Sintético' },
      });
      expect(pendingWrite).toBeDefined();
      await pendingWrite;
      expect((await hospitalDB.dailyRecords.get(date))?.[`${role}DayShift`]).toContain(
        'Personal Sintético'
      );
      expect((await hospitalDB.syncQueue.toArray())[0].payload).toMatchObject({
        [`${role}DayShift`]: expect.arrayContaining(['Personal Sintético']),
      });
    });
    it(`${role}: selecting a grouped variant persists the accented spelling`, async () => {
      boundary.read.mockResolvedValue(['Ana Peña', 'Ana Pena']);
      render(<Staffing role={role} />, { wrapper: createQueryClientTestWrapper().wrapper });
      await screen.findByText('Lectura correcta');
      revealNames();
      const select = screen.getAllByRole('combobox')[0];
      expect(select.querySelectorAll('option[value="Ana Peña"]')).toHaveLength(1);
      expect(select.querySelector('option[value="Ana Pena"]')).toBeNull();
      expect(pendingWrite).toBeUndefined();
      boundary.enabled = false;
      fireEvent.change(select, { target: { value: 'Ana Peña' } });
      await pendingWrite;
      expect((await hospitalDB.dailyRecords.get(date))?.[`${role}DayShift`]).toContain('Ana Peña');
    });
    it(`${role}: failed read offers no placeholder and still permits removing assigned staff`, async () => {
      render(<Staffing role={role} />, { wrapper: createQueryClientTestWrapper().wrapper });
      await screen.findByText(/Lectura (fallida|correcta)/);
      revealNames();
      expect(screen.queryAllByRole('option', { name: placeholder })).toHaveLength(0);
      expect(screen.getAllByRole('option', { name: 'Asignada Sintética' }).length).toBeGreaterThan(
        0
      );
      boundary.enabled = false;
      fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'Vacante' } });
      expect(pendingWrite).toBeDefined();
      await pendingWrite;
      expect((await hospitalDB.dailyRecords.get(date))?.[`${role}DayShift`]).toContain('Vacante');
      const tasks = await hospitalDB.syncQueue.toArray();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].payload).toMatchObject({
        [`${role}DayShift`]: expect.arrayContaining(['Vacante']),
      });
    });
  }
});
