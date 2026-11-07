import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import { AdmissionAuditView } from '@/features/admin/admission-audit/AdmissionAuditView';
import { setSessionGeneration } from '@/services/storage/sessionStorageTransition';
import { canAccessAppModuleRoute } from '@/shared/access/operationalAccessPolicy';
const mocks = vi.hoisted(() => ({
  user: { uid: 'synthetic-admin', role: 'admin' },
  history: vi.fn(),
  forms: vi.fn(),
  read: vi.fn(),
  download: vi.fn(),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ currentUser: mocks.user }) }));
vi.mock('@/services/admin/admissionAuditCensus', () => ({
  readAdmissionAuditCensus: (...args: unknown[]) => mocks.read(...args),
}));
vi.mock('@/services/exporters/exportDownload', () => ({
  downloadBlob: (...args: unknown[]) => mocks.download(...args),
}));
vi.mock('@/features/rayen-import/admission-audit', async original => ({
  ...(await original<typeof import('@/features/rayen-import/admission-audit')>()),
  requestClinicalPanel: (...args: unknown[]) => mocks.history(...args),
}));
const DATE = '2026-07-13';
const record = () =>
  DataFactory.createMockDailyRecord(DATE, {
    beds: {
      R1: DataFactory.createMockPatient('R1', {
        patientName: 'Paciente Uno',
        rut: '12.345.678-5',
        clinicalEpisodeId: '101',
        admissionDate: DATE,
        admissionTime: '08:00',
      }),
      R2: DataFactory.createMockPatient('R2', {
        patientName: 'Paciente Dos',
        rut: '5.844.865-6',
        clinicalEpisodeId: '102',
        admissionDate: DATE,
        admissionTime: '08:00',
      }),
    },
  });
const source = (encId: string) => ({
  historyFrom: DATE,
  forms: [],
  events: [
    {
      publishDatetime: `${DATE}T08:10`,
      evolutionResume: [
        {
          id: encId,
          OBE_NOTES: `Ingreso de ${encId}`,
          HCPR_NAME: 'Médico',
          HCP_FGN: encId === '101' ? 'Ana' : 'Luis',
          HCP_FFN: 'Prueba',
          OBE_PUBLISH_DATETIME: `${DATE}T08:10`,
        },
      ],
      shiftChangeResume: [],
      patientPharmaIndicationResume: [],
      patientFreeIndicationResume: [],
      nutritionOrderResume: [],
      restResume: [],
    },
  ],
  carePlan: { carePlanHeaders: [], medicationStates: [] },
});
const query = () => {
  fireEvent.change(screen.getByLabelText('Desde'), { target: { value: DATE } });
  fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: DATE } });
  fireEvent.click(screen.getByRole('button', { name: 'Consultar ingresos' }));
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { uid: 'synthetic-admin', role: 'admin' };
  mocks.read.mockImplementation(async function* () {
    yield [record()];
  });
  mocks.history.mockImplementation(async (encId: string) => {
    const forms = await mocks.forms();
    return { ...source(encId), forms: forms.forms, formError: forms.error };
  });
  mocks.forms.mockResolvedValue({ forms: [] });
});
describe('admission audit administrator panel', () => {
  it('rejects an unsupported historical period before any server read', () => {
    render(<AdmissionAuditView />);
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '1980-01-01' } });
    expect(screen.getByRole('button', { name: 'Consultar ingresos' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('4000 días');
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it.each([
    'nurse_hospital',
    'doctor_urgency',
    'doctor_specialist',
    'viewer',
    'editor',
    'unauthorized',
  ])('denies %s including direct route access', role => {
    expect(
      canAccessAppModuleRoute({
        role,
        module: 'ADMISSION_AUDIT',
        visibleModules: ['ADMISSION_AUDIT'],
      })
    ).toBe(false);
    mocks.user = { uid: 'other', role };
    render(<AdmissionAuditView />);
    expect(screen.getByRole('alert')).toHaveTextContent('sólo para administrador');
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it('groups first-note authors, filters admissions and downloads the selected indexed book', async () => {
    render(<AdmissionAuditView />);
    query();
    await screen.findByRole('button', { name: /Ana Prueba/ });
    fireEvent.click(screen.getByRole('button', { name: /Luis Prueba/ }));
    expect(screen.getByRole('heading', { name: 'Paciente Dos' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Paciente Uno' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Descargar libro HTML' }));
    expect(mocks.download).toHaveBeenCalledTimes(1);
    expect(mocks.download.mock.calls[0][0]).toBeInstanceOf(Blob);
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-07-14' } });
    expect(screen.getByRole('button', { name: 'Descargar libro HTML' })).toBeDisabled();
  });
  it('fails closed with an old extension that cannot confirm history coverage', async () => {
    mocks.history.mockResolvedValue({ ...source('101'), historyFrom: undefined });
    render(<AdmissionAuditView />);
    query();
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Actualiza la extensión')
    );
    expect(screen.queryByRole('region', { name: 'Primera evolución médica' })).toBeNull();
    expect(mocks.history).toHaveBeenCalledTimes(1);
    expect(mocks.forms).not.toHaveBeenCalled();
  });
  it('preserves the last known content on a failed refresh and labels incomplete reads', async () => {
    render(<AdmissionAuditView />);
    query();
    await screen.findByRole('button', { name: /Ana Prueba/ });
    mocks.history.mockResolvedValue({ error: 'Fuente temporalmente inaccesible' });
    query();
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Fuente temporalmente inaccesible')
    );
    expect(screen.getByText('Ingreso de 102')).toBeVisible();
    expect(screen.getByText(/Se muestra la última lectura/)).toBeVisible();
    expect(screen.getByRole('button', { name: /Descargar libro HTML/ })).toHaveTextContent(
      'lectura parcial'
    );
    expect(screen.getByRole('button', { name: /Descargar libro HTML/ })).toBeDisabled();
  });
  it('does not promote a dated vital past an undated competing source take', async () => {
    const form = { formCodigo: 'VITAL_SIGNS', metaCampList: [{ id: 'global_Pulso', value: '82' }] };
    mocks.forms.mockResolvedValue({
      forms: [form, { ...form, createDateTime: '13-07-2026 08:02:00 -06:00' }],
    });
    render(<AdmissionAuditView />);
    query();
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('No se pudieron leer los signos vitales')
    );
    expect(screen.queryByText('82 lpm')).toBeNull();
    expect(screen.getByRole('button', { name: /Descargar libro HTML/ })).toHaveTextContent(
      'lectura parcial'
    );
  });
  it('allows a mixed report but blocks exporting a selected subset with no successful read', async () => {
    mocks.history.mockImplementation(async (id: string) =>
      id === '101' ? source(id) : { error: 'Fallo sintético' }
    );
    render(<AdmissionAuditView />);
    query();
    await screen.findByRole('button', { name: /Sin atribuir/ });
    expect(screen.getByRole('button', { name: /Descargar libro HTML/ })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /Sin atribuir/ }));
    expect(screen.getByRole('button', { name: /Descargar libro HTML/ })).toBeDisabled();
  });
  it('preserves the previous report but prevents export if the cohort server read fails', async () => {
    render(<AdmissionAuditView />);
    query();
    await screen.findByText('Ingreso de 102');
    mocks.read.mockImplementation(async function* () {
      yield await Promise.reject(new Error('Fallo sintético'));
    });
    query();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('servidor'));
    expect(screen.getByText('Ingreso de 102')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Descargar libro HTML' })).toBeDisabled();
  });
  it('discards a late response after the administrator role is removed', async () => {
    let resolveHistory: ((value: ReturnType<typeof source>) => void) | undefined;
    mocks.history.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveHistory = resolve;
        })
    );
    const view = render(<AdmissionAuditView />);
    query();
    await waitFor(() => expect(mocks.history).toHaveBeenCalledTimes(1));
    mocks.user = { uid: 'synthetic-admin', role: 'viewer' };
    view.rerender(<AdmissionAuditView />);
    resolveHistory?.(source('101'));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('sólo para administrador')
    );
    expect(screen.queryByText('Ingreso de 101')).toBeNull();
    expect(mocks.forms).not.toHaveBeenCalled();
  });
  it('clears a completed report when a role is removed, including when admin access returns', async () => {
    const view = render(<AdmissionAuditView />);
    query();
    await screen.findByRole('button', { name: /Ana Prueba/ });
    mocks.user = { uid: 'synthetic-admin', role: 'viewer' };
    view.rerender(<AdmissionAuditView />);
    mocks.user = { uid: 'synthetic-admin', role: 'admin' };
    view.rerender(<AdmissionAuditView />);
    expect(screen.queryByText('Ingreso de 102')).toBeNull();
    expect(screen.getByRole('button', { name: 'Descargar libro HTML' })).toBeDisabled();
  });
  it('preserves initial vitals if only the forms source fails on refresh', async () => {
    mocks.forms.mockResolvedValue({
      forms: [
        {
          formCodigo: 'VITAL_SIGNS',
          createDateTime: '13-07-2026 08:02:00 -06:00',
          metaCampList: [{ id: 'global_Pulso', value: '82' }],
        },
      ],
    });
    render(<AdmissionAuditView />);
    query();
    await screen.findByText('82 lpm');
    mocks.forms.mockResolvedValue({ forms: [], error: 'Fallo sintético' });
    query();
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('última lectura disponible')
    );
    expect(screen.getByText('82 lpm')).toBeVisible();
    expect(
      screen.queryByText('No hay toma de signos vitales verificable desde el ingreso.')
    ).toBeNull();
    expect(screen.getByRole('button', { name: /Descargar libro HTML/ })).toHaveTextContent(
      'lectura parcial'
    );
  });
  it('clears private clinical content and disables export on an Eloísa session change', async () => {
    render(<AdmissionAuditView />);
    query();
    await screen.findByRole('button', { name: /Ana Prueba/ });
    setSessionGeneration('synthetic-audit-session-changed');
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Paciente Uno' })).toBeNull());
    expect(screen.getByRole('button', { name: 'Descargar libro HTML' })).toBeDisabled();
  });
});
