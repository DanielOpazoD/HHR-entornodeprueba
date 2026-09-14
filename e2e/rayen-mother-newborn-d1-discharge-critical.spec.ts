import { expect, test, type Page } from '@playwright/test';
import { resolveCurrentClinicalDay } from '../src/utils/clinicalDayAdmissionUtils';
import { getPreviousDay } from '../src/utils/clinicalDayScheduleUtils';
import {
  bootstrapSeededRecord,
  buildCanonicalE2ERecord,
  ensureAuthenticated,
  readIndexedDbDailyRecord,
} from './fixtures/auth';
import { installDailyRecordAuthorityRoute } from './fixtures/dailyRecordAuthorityRoute';

const CENSUS_DAY = resolveCurrentClinicalDay();
const DISCHARGE_DAY = getPreviousDay(CENSUS_DAY);
const BED_ID = 'H4C1';
const SHARED_RUN = '11.111.111-1';
const MOTHER_EPISODE = '910001';
const NEWBORN_EPISODE = '910080';

const buildMother = () => ({
  id: BED_ID,
  bedId: BED_ID,
  patientName: 'Paciente Materna Sintética',
  rut: SHARED_RUN,
  clinicalEpisodeId: MOTHER_EPISODE,
  admissionDate: DISCHARGE_DAY,
  admissionTime: '08:10',
  isBlocked: false,
  bedMode: 'Cama',
  hasCompanionCrib: false,
  devices: [],
  status: 'Estable',
  pathology: 'Diagnóstico obstétrico sintético',
  specialty: 'Ginecobstetricia',
  age: '31',
  hasWristband: true,
  surgicalComplication: false,
  isUPC: false,
  clinicalCrib: {
    id: BED_ID,
    bedId: BED_ID,
    patientName: 'RN de Paciente Materna Sintética',
    rut: '',
    clinicalEpisodeId: NEWBORN_EPISODE,
    admissionDate: DISCHARGE_DAY,
    admissionTime: '08:45',
    isBlocked: false,
    bedMode: 'Cuna',
    hasCompanionCrib: false,
    devices: [],
    status: 'Estable',
    pathology: 'Recién nacido sintético',
    specialty: 'Pediatría',
    age: '0',
    hasWristband: false,
    surgicalComplication: false,
    isUPC: false,
  },
});

const buildRecord = (date: string) => {
  const record = buildCanonicalE2ERecord(date);
  const beds = record.beds as Record<string, Record<string, unknown>>;
  Object.values(beds).forEach(bed => {
    bed.bedMode = 'Cama';
    bed.admissionDate = '';
  });
  beds[BED_ID] = { ...beds[BED_ID], ...buildMother() };
  return { ...record, beds };
};

const installSyntheticEloisa = async (page: Page) => {
  await page.addInitScript(
    ({ censusDay, dischargeDay, sharedRun, motherEpisode }) => {
      localStorage.setItem(
        'hhr_e2e_rayen_import_policy',
        JSON.stringify({ mode: 'preview', clinicalBatchMode: 'off', revision: 1 })
      );
      window.addEventListener('message', event => {
        if (event.origin !== window.location.origin || !event.data) return;
        const emptyResponses: Record<string, { type: string; payload: Record<string, unknown> }> = {
          HHR_RAYEN_EGRESO_LOOKUP_REQUEST: {
            type: 'HHR_RAYEN_EGRESO_LOOKUP_RESULT',
            payload: { results: [] },
          },
          HHR_RAYEN_PATIENT_FLOW_REQUEST: {
            type: 'HHR_RAYEN_PATIENT_FLOW_RESULT',
            payload: { base64: '', error: 'Sin evidencia adicional en el escenario E2E.' },
          },
          HHR_RAYEN_STATISTICAL_DISCHARGE_EVIDENCE_REQUEST: {
            type: 'HHR_RAYEN_STATISTICAL_DISCHARGE_EVIDENCE_RESULT',
            payload: { base64: '', error: 'Sin evidencia adicional en el escenario E2E.' },
          },
        };
        const emptyResponse = emptyResponses[event.data.type];
        if (emptyResponse) {
          window.postMessage(
            { type: emptyResponse.type, reqId: event.data.reqId, ...emptyResponse.payload },
            window.location.origin
          );
          return;
        }
        if (event.data.type === 'HHR_RAYEN_EXTENSION_HEALTH_REQUEST') {
          window.postMessage(
            {
              type: 'HHR_RAYEN_EXTENSION_HEALTH_RESULT',
              reqId: event.data.reqId,
              report: {
                version: 'e2e-mother-newborn-d1',
                protocolVersion: 5,
                checkedAt: new Date().toISOString(),
                fichaMedico: { status: 'ready', message: 'Ficha Médico disponible.' },
                gestionCamas: { status: 'ready', message: 'Gestión de Camas disponible.' },
              },
            },
            window.location.origin
          );
          return;
        }
        if (event.data.type !== 'HHR_RAYEN_REQUEST_SYNC_BUNDLE') return;
        const capturedAt = `${censusDay}T12:00:00-06:00`;
        window.postMessage(
          {
            type: 'HHR_RAYEN_CENSUS_SNAPSHOT',
            requestId: event.data.requestId,
            snapshot: {
              capturedAt,
              facilityId: 1342,
              encounters: [],
              isComplete: true,
            },
            bundle: {
              id: `e2e-bundle-${event.data.requestId}`,
              startedAt: `${censusDay}T11:59:58-06:00`,
              completedAt: `${censusDay}T12:00:02-06:00`,
              facilityId: 1342,
              dateStart: event.data.dateStart,
              dateEnd: event.data.dateEnd,
              fichaMedicoCapturedAt: capturedAt,
              gestionCamasCapturedAt: capturedAt,
              sourceSkewMs: 0,
              egresoRows: [
                {
                  run: sharedRun,
                  encounterId: motherEpisode,
                  patientName: 'Paciente Materna Sintética',
                  bedLabel: 'H4C1',
                  servicio: 'Hospitalización',
                  edad: '31',
                  destino: 'Domicilio',
                  motivo: 'Alta médica',
                  fechaEgreso: `${dischargeDay} 14:44`,
                  correctedDay: dischargeDay,
                  correctedTime: '14:44',
                },
              ],
            },
          },
          window.location.origin
        );
      });
    },
    {
      censusDay: CENSUS_DAY,
      dischargeDay: DISCHARGE_DAY,
      sharedRun: SHARED_RUN,
      motherEpisode: MOTHER_EPISODE,
    }
  );
};

test.describe('Eloísa · egreso madre y RN en D−1', () => {
  test('persiste ambos episodios históricos tras la revisión explícita', async ({ page }) => {
    test.setTimeout(90_000);
    const currentRecord = buildRecord(CENSUS_DAY);
    const historicalRecord = buildRecord(DISCHARGE_DAY);
    const authority = await installDailyRecordAuthorityRoute(page, {
      [CENSUS_DAY]: currentRecord,
      [DISCHARGE_DAY]: historicalRecord,
    });
    await installSyntheticEloisa(page);
    await bootstrapSeededRecord(page, {
      role: 'admin',
      date: CENSUS_DAY,
      record: currentRecord,
      useRuntimeOverride: true,
      forceEditableRecord: true,
      forceLocalOnlySync: false,
      seedRemoteAuthority: true,
      forceAuthorityCallable: true,
    });
    await page.goto(`/censo?date=${CENSUS_DAY}`);
    await ensureAuthenticated(page);
    await page.evaluate(
      ({ date, record }) => {
        const records = JSON.parse(localStorage.getItem('hanga_roa_hospital_data') || '{}');
        records[date] = record;
        localStorage.setItem('hanga_roa_hospital_data', JSON.stringify(records));
        const runtime = window as Window & {
          __HHR_E2E_OVERRIDE__?: Record<string, unknown>;
          __HHR_E2E_SET_REMOTE_AUTHORITY__?: (date: string, record: unknown) => void;
        };
        runtime.__HHR_E2E_OVERRIDE__ = {
          ...(runtime.__HHR_E2E_OVERRIDE__ || {}),
          [date]: record,
        };
      },
      { date: DISCHARGE_DAY, record: historicalRecord }
    );

    await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20_000 });
    const syncButton = page.getByTestId('rayen-import-button');
    await expect(syncButton).toBeEnabled({ timeout: 30_000 });
    await syncButton.click();

    const preview = page.getByTestId('rayen-import-preview');
    await expect(preview).toBeVisible({ timeout: 10_000 });
    await expect(preview).toContainText('Modificar días previos (1)');
    await expect(preview).toContainText('Paciente Materna Sintética');
    await preview.getByLabel('Acepto modificar los días previos indicados').check();
    await preview.getByRole('button', { name: 'Confirmar e importar' }).click();

    const currentWrite = await authority.nextCall();
    expect(currentWrite.payload.date).toBe(CENSUS_DAY);
    await currentWrite.succeed();

    const historicalWrite = await authority.nextCall();
    expect(historicalWrite.payload.date).toBe(DISCHARGE_DAY);
    const historicalDischarges = historicalWrite.payload.patch.discharges as Array<{
      clinicalEpisodeId?: string;
      isNested?: boolean;
    }>;
    expect(historicalDischarges.map(entry => entry.clinicalEpisodeId).sort()).toEqual([
      MOTHER_EPISODE,
      NEWBORN_EPISODE,
    ]);
    expect(historicalDischarges.filter(entry => entry.isNested)).toHaveLength(1);
    await historicalWrite.succeed();

    await expect(preview).not.toBeVisible({ timeout: 20_000 });
    await expect
      .poll(async () => {
        const stored = (await readIndexedDbDailyRecord(page, DISCHARGE_DAY)) as {
          discharges?: Array<{ clinicalEpisodeId?: string; isNested?: boolean }>;
        } | null;
        return {
          episodes: (stored?.discharges ?? []).map(entry => entry.clinicalEpisodeId).sort(),
          nested: (stored?.discharges ?? []).filter(entry => entry.isNested).length,
        };
      })
      .toEqual({ episodes: [MOTHER_EPISODE, NEWBORN_EPISODE], nested: 1 });
  });
});
