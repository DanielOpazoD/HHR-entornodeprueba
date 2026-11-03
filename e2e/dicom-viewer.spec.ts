import { fetchDicomWorker } from './fixtures/dicomWorkerFetch';
import {
  installDicomGraphicsProbe,
  liveDicomContexts,
  loseDicomGraphics,
} from './fixtures/dicomGraphics';
import fs from 'node:fs';
import PizZip from 'pizzip';
import { Input, BufferSource, MP4 } from 'mediabunny';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { buildCanonicalE2ERecord, bootstrapSeededRecord } from './fixtures/auth';
import { installPreviewFirebaseRuntime } from './fixtures/previewFirebase';
import {
  syntheticDicom,
  SYNTHETIC_PATIENT_ID,
  SYNTHETIC_SERIES_UID,
  SYNTHETIC_STUDY_UID,
  syntheticSopUid,
} from '../src/tests/fixtures/syntheticDicom';
import { syntheticJpeg2000Base64 } from '../src/tests/fixtures/syntheticJpeg2000';

const DATE = '2026-10-16';
const link = 'https://ris.mmrad.cl/exam/synthetic';
const exam = {
  nombre_examen: 'TAC SINTÉTICO',
  fecha_examen: '16/10/2026',
  fecha_asignacion: '',
  mod: 'CT',
  estado: 'Validado',
  pdf_url: null,
  dicom_url: link,
  informe_html_url: null,
  report: null,
};
const study = {
  uid: SYNTHETIC_STUDY_UID,
  patientId: SYNTHETIC_PATIENT_ID,
  date: '20261016',
  series: [
    {
      uid: SYNTHETIC_SERIES_UID,
      number: 1,
      description: 'Volumen sintético',
      modality: 'CT',
      rows: 64,
      columns: 64,
      instances: Array.from({ length: 24 }, (_, i) => ({
        uid: syntheticSopUid(i),
        number: i + 1,
        frames: 1,
        ticket: `synthetic-${i}`,
      })),
    },
  ],
};

const setup = async (page: Page) => {
  const headers = fs.readFileSync('netlify.toml', 'utf8');
  const shellPolicy = headers.match(/for = "\/\*"[\s\S]*?Content-Security-Policy = "([^"]+)"/)?.[1];
  const workerPolicy = headers.match(
    /for = "\/assets\/decodeImageFrameWorker-\*\.js"[\s\S]*?Content-Security-Policy = "([^"]+)"/
  )?.[1];
  if (!shellPolicy || !workerPolicy) throw new Error('Missing production CSP');
  await page.route('**/?date=*', async route => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), 'content-security-policy': shellPolicy },
    });
  });
  await installPreviewFirebaseRuntime(page);
  const base = buildCanonicalE2ERecord(DATE) as Record<string, unknown>;
  const beds = base.beds as Record<string, Record<string, unknown>>;
  const record = buildCanonicalE2ERecord(DATE, {
    beds: {
      ...beds,
      R1: {
        ...beds.R1,
        patientName: 'PACIENTE SINTÉTICO',
        rut: '11.111.111-1',
        documentType: 'RUT',
        identityStatus: 'official',
        admissionDate: '2026-10-13',
      },
    },
  });
  await bootstrapSeededRecord(page, { date: DATE, record: record as Record<string, unknown> });
  await page.addInitScript(() =>
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
  );
  await page.route('**/.netlify/functions/mmrad-search*', route =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ rut: '11111111-1', examenes: [exam] }),
    })
  );
  await page.route('**/.netlify/functions/mmrad-dicom', route => {
    const body = route.request().postDataJSON();
    if (body.action === 'metadata')
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(study) });
    const index = Number(String(body.ticket).split('-')[1]);
    return route.fulfill({
      contentType: 'application/dicom',
      body: Buffer.from(
        syntheticDicom(
          index,
          24,
          SYNTHETIC_PATIENT_ID,
          index === 12 ? new Uint8Array(Buffer.from(syntheticJpeg2000Base64, 'base64')) : undefined
        )
      ),
    });
  });
  // Exercise the production worker's restricted CSP, including real WASM decoding.
  await page.route('**/assets/decodeImageFrameWorker-*.js', async route => {
    const response = await fetchDicomWorker(route);
    await route.fulfill({
      response,
      headers: {
        ...response.headers(),
        'content-security-policy': workerPolicy,
      },
    });
  });
  await page.goto(`/?date=${DATE}`);
  await expect(
    page.locator('[data-testid="patient-row"][data-bed-id="R1"] input[name="patientName"]')
  ).toHaveValue('PACIENTE SINTÉTICO', { timeout: 25000 });
};

const openSalvador = async (page: Page, manual = false) => {
  await page.getByTestId('clinical-library-quick-action').click({ timeout: 20000 });
  const drawer = page.getByTestId('clinical-library-drawer');
  await drawer
    .getByTestId('library-document-informe-traslado-hospital-salvador')
    .getByRole('button', { name: /^Completar/ })
    .click();
  const editor = drawer.getByTestId('library-tool-clinical-form');
  if (manual) {
    await editor.getByLabel('RUT', { exact: true }).fill('11.111.111-1');
    await editor.getByLabel('Nombre y apellidos').fill('PACIENTE MANUAL SINTÉTICO');
    return editor;
  }
  const source = editor.getByLabel('Origen de los datos');
  const key = await source
    .locator('option')
    .filter({ hasText: 'PACIENTE SINTÉTICO' })
    .getAttribute('value');
  await source.selectOption(key!);
  return editor;
};

/** Seeks each frame of the preview and waits until that exact frame is presented. */
const sampleVideoFrames = (video: Locator, count: number, fps: number) =>
  video.evaluate(
    async (node, { count, fps }) => {
      const movie = node as HTMLVideoElement;
      const canvas = document.createElement('canvas');
      canvas.width = movie.videoWidth;
      canvas.height = movie.videoHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      const seekToFrame = async (index: number) => {
        let callbackId = 0;
        let timer = 0;
        let observedTime: number | undefined;
        const seeked = new Promise<void>(resolve => {
          movie.addEventListener('seeked', () => resolve(), { once: true });
        });
        const presented = new Promise<void>(resolve => {
          callbackId = movie.requestVideoFrameCallback(function onFrame(_now, metadata) {
            observedTime = metadata.mediaTime;
            if (Math.round(metadata.mediaTime * fps) === index) resolve();
            else callbackId = movie.requestVideoFrameCallback(onFrame);
          });
        });
        const deadline = new Promise<never>((_, reject) => {
          timer = window.setTimeout(
            () =>
              reject(
                new Error(`Frame ${index} not presented; last mediaTime=${observedTime ?? 'none'}`)
              ),
            5000
          );
        });
        try {
          movie.currentTime = index / fps + 0.05;
          await Promise.race([Promise.all([seeked, presented]), deadline]);
        } finally {
          window.clearTimeout(timer);
          movie.cancelVideoFrameCallback(callbackId);
        }
      };
      const frames: Array<{ center: number; width: number; height: number }> = [];
      // Start elsewhere so sampling frame zero also waits for a new presentation.
      await seekToFrame(count - 1);
      for (let i = 0; i < count; i++) {
        await seekToFrame(i);
        ctx.drawImage(movie, 0, 0);
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let [left, top, right, bottom] = [canvas.width, canvas.height, -1, -1];
        // The bright extent skips a margin that holds the burned labels and edge letters.
        for (let y = 40; y < canvas.height - 40; y++)
          for (let x = 40; x < canvas.width - 40; x++)
            if (data[(y * canvas.width + x) * 4] > 40) {
              left = Math.min(left, x);
              right = Math.max(right, x);
              top = Math.min(top, y);
              bottom = Math.max(bottom, y);
            }
        const middle =
          (Math.floor(canvas.height / 2) * canvas.width + Math.floor(canvas.width / 2)) * 4;
        frames.push({ center: data[middle], width: right - left + 1, height: bottom - top + 1 });
      }
      return frames;
    },
    { count, fps }
  );

/** Movie, track and media headers carry zero as creation and modification time. */
const expectNoMp4Dates = (bytes: Buffer) => {
  for (const type of ['mvhd', 'tkhd', 'mdhd']) {
    const at = bytes.indexOf(type);
    expect(at, type).toBeGreaterThan(0);
    const width = bytes[at + 4] === 1 ? 8 : 4;
    expect([...bytes.subarray(at + 8, at + 8 + width * 2)], type).toEqual(
      new Array(width * 2).fill(0)
    );
  }
};

/** Downloads the reviewed preview; checks identifiers and dates, and reads its track. */
const downloadReviewedMp4 = async (page: Page, viewer: Locator, filename: string) => {
  const downloading = page.waitForEvent('download');
  await viewer.getByRole('link', { name: 'Descargar MP4', exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(filename);
  const bytes = fs.readFileSync((await download.path())!);
  await test.info().attach(filename, { body: bytes, contentType: 'video/mp4' });
  expect(bytes.includes(Buffer.from(SYNTHETIC_PATIENT_ID))).toBe(false);
  expect(bytes.includes(Buffer.from(SYNTHETIC_STUDY_UID))).toBe(false);
  expectNoMp4Dates(bytes);
  const input = new Input({ source: new BufferSource(bytes), formats: [MP4] });
  try {
    const track = await input.getPrimaryVideoTrack();
    return {
      codec: track?.codec,
      packets: (await track!.computePacketStats()).packetCount,
      duration: await input.computeDuration(),
      audio: (await input.getAudioTracks()).length,
    };
  } finally {
    input.dispose();
  }
};

test.describe('DICOM viewer and Salvador annexes', () => {
  test.setTimeout(150000);
  test.use({ viewport: { width: 1440, height: 1000 } });
  // A test may pass while the viewer still loads its worker; closing the page
  // then aborts that route.fetch and would fail an already verified test.
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
  test('measures cold DICOM startup with controlled metadata and module latency', async ({
    page,
  }) => {
    await setup(page);
    const samples: Record<string, number> = {};
    let instances = 0;
    await page.route('**/assets/dicomRuntime-*.js', async route => {
      samples.moduleStart = performance.now();
      await new Promise(resolve => setTimeout(resolve, 1500));
      await route.continue();
    });
    await page.route('**/.netlify/functions/mmrad-dicom', async route => {
      if (route.request().postDataJSON().action === 'metadata') {
        samples.metadataStart = performance.now();
        await new Promise(resolve => setTimeout(resolve, 1500));
        samples.metadataEnd = performance.now();
      } else {
        instances++;
        samples.firstInstance ??= performance.now();
        expect(samples.metadataEnd).toBeDefined();
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      await route.fallback();
    });
    const editor = await openSalvador(page);
    await editor.getByRole('button', { name: 'Imágenes MMRAD' }).click();
    expect(instances).toBe(0);
    const start = performance.now();
    await page.getByRole('button', { name: 'Ver DICOM', exact: true }).click();
    const viewer = page.getByRole('dialog', { name: /Visor DICOM/ });
    await expect(viewer.getByRole('button', { name: 'PNG', exact: true })).toBeEnabled({
      timeout: 60000,
    });
    samples.usable = performance.now();
    await expect(viewer.getByRole('button', { name: 'MPR', exact: true })).toBeEnabled({
      timeout: 60000,
    });
    samples.complete = performance.now();
    expect(instances).toBe(24);
    expect(samples.moduleStart).toBeLessThan(samples.metadataEnd);
    if (process.env.DICOM_LOAD_BENCHMARK === '1')
      await test.info().attach('dicom-load-benchmark', {
        body: JSON.stringify(
          Object.fromEntries(
            Object.entries(samples).map(([key, value]) => [key, Math.round(value - start)])
          )
        ),
        contentType: 'application/json',
      });
  });
  test('compares verified series by physical position and reuses one series for independent windows', async ({
    page,
  }) => {
    await setup(page);
    const secondUid = '1.2.826.0.1.3680043.10.543.23';
    const second = {
      ...study.series[0],
      uid: secondUid,
      number: 2,
      description: 'Espaciado doble sintético',
      instances: Array.from({ length: 12 }, (_, i) => ({
        uid: syntheticSopUid(i * 2),
        number: i + 1,
        frames: 1,
        ticket: `compare-${i * 2}`,
      })),
    };
    const requests: string[] = [];
    await page.route('**/.netlify/functions/mmrad-dicom', route => {
      const body = route.request().postDataJSON();
      if (body.action === 'metadata')
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ ...study, series: [...study.series, second] }),
        });
      const ticket = String(body.ticket);
      requests.push(ticket);
      return route.fulfill({
        contentType: 'application/dicom',
        body: Buffer.from(
          syntheticDicom(
            Number(ticket.split('-')[1]),
            24,
            SYNTHETIC_PATIENT_ID,
            undefined,
            undefined,
            undefined,
            ticket.startsWith('compare') ? { seriesUid: secondUid } : undefined
          )
        ),
      });
    });
    const editor = await openSalvador(page);
    await editor.getByRole('button', { name: 'Imágenes MMRAD' }).click();
    await page.getByRole('button', { name: 'Ver DICOM', exact: true }).click();
    const viewer = page.getByRole('dialog', { name: /Visor DICOM/ });
    const compare = viewer.getByRole('button', { name: 'Comparar', exact: true });
    await expect(compare).toBeEnabled({ timeout: 60000 });
    await compare.click();
    const left = viewer.getByLabel('Corte panel 1', { exact: true });
    const right = viewer.getByLabel('Corte panel 2', { exact: true });
    await expect(viewer.getByText('Posición vinculada', { exact: true })).toBeVisible();
    await expect(left).toHaveValue('13');
    await expect(right).toHaveValue('13');
    const imageHashes = () =>
      viewer.locator('.dicom-canvas canvas').evaluateAll(canvases =>
        canvases.map(node => {
          const source = node as HTMLCanvasElement;
          const canvas = document.createElement('canvas');
          canvas.width = 64;
          canvas.height = 64;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(source, 0, 0, 64, 64);
          return Array.from(ctx.getImageData(0, 0, 64, 64).data).reduce(
            (sum, value, i) => (sum + value * (i % 97)) % 1000000007,
            0
          );
        })
      );
    await expect
      .poll(async () => {
        const hashes = await imageHashes();
        return hashes.length === 2 && hashes[0] !== hashes[1];
      })
      .toBe(true);
    await viewer.getByLabel('Comparación panel 1', { exact: true }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(left).toHaveValue('14');
    await expect(right).toHaveValue('14');
    expect(requests.filter(ticket => ticket.startsWith('synthetic'))).toHaveLength(24);
    await viewer.getByLabel('Vincular paneles', { exact: true }).click();
    await viewer.getByRole('checkbox', { name: 'Ventana', exact: true }).check();
    await viewer.getByLabel('Ventana del panel activo').selectOption('2000,500');
    await expect
      .poll(async () => {
        const hashes = await imageHashes();
        return hashes.length === 2 && hashes[0] === hashes[1];
      })
      .toBe(true);
    await viewer.getByRole('checkbox', { name: 'Zoom', exact: true }).check();
    await viewer.getByRole('button', { name: 'Zoom', exact: true }).click();
    const beforeZoom = await imageHashes();
    const firstCanvas = (await viewer
      .getByLabel('Comparación panel 1', { exact: true })
      .boundingBox())!;
    await page.mouse.move(
      firstCanvas.x + firstCanvas.width / 2,
      firstCanvas.y + firstCanvas.height / 2
    );
    await page.mouse.down();
    await page.mouse.move(
      firstCanvas.x + firstCanvas.width / 2,
      firstCanvas.y + firstCanvas.height / 2 + 65,
      { steps: 8 }
    );
    await page.mouse.up();
    await expect
      .poll(async () => {
        const hashes = await imageHashes();
        return hashes.length === 2 && hashes[0] === hashes[1] && hashes[0] !== beforeZoom[0];
      })
      .toBe(true);
    await viewer.getByRole('checkbox', { name: 'Posición', exact: true }).uncheck();
    await viewer.getByLabel('Vincular paneles', { exact: true }).click();
    await viewer.getByLabel('Comparación panel 1', { exact: true }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(left).toHaveValue('15');
    await expect(right).toHaveValue('14');
    await viewer.getByLabel('Segunda serie').selectOption(secondUid);
    await expect(viewer.getByText('Posición vinculada', { exact: true })).toBeVisible({
      timeout: 60000,
    });
    await expect(left).toHaveValue('13');
    await expect(right).toHaveValue('7');
    await viewer.getByLabel('Comparación panel 2', { exact: true }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(right).toHaveValue('8');
    await expect(left).toHaveValue('15');
    await viewer.screenshot({ path: test.info().outputPath('synthetic-series-comparison.png') });
    await viewer.getByRole('button', { name: 'Volver', exact: true }).click();
    await expect(viewer.getByRole('button', { name: 'MPR', exact: true })).toBeEnabled();
    expect(requests.filter(ticket => ticket.startsWith('synthetic'))).toHaveLength(24);
    await viewer.getByRole('button', { name: 'MPR', exact: true }).click();
    await expect(viewer.getByRole('button', { name: 'Comparar', exact: true })).toBeEnabled();
    await viewer.getByRole('button', { name: 'Comparar', exact: true }).click();
    await expect(viewer.getByText('Posición vinculada', { exact: true })).toBeVisible();
    await viewer.getByRole('button', { name: 'Volver', exact: true }).click();
    await expect(viewer.getByRole('button', { name: 'Axial', exact: true })).toBeVisible();
    await expect(viewer.locator('.dicom-canvas canvas')).toHaveCount(3);
  });
  for (const scenario of ['foreign frame', 'perpendicular', 'foreign patient'] as const) {
    test(`comparison safely handles ${scenario}`, async ({ page }) => {
      await setup(page);
      const secondUid = '1.2.826.0.1.3680043.10.543.24';
      const second = {
        ...study.series[0],
        uid: secondUid,
        number: 2,
        description: 'Geometría sintética',
        instances: study.series[0].instances
          .slice(0, 4)
          .map((instance, i) => ({ ...instance, ticket: `other-${i}` })),
      };
      await page.route('**/.netlify/functions/mmrad-dicom', route => {
        const body = route.request().postDataJSON();
        if (body.action === 'metadata')
          return route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({ ...study, series: [...study.series, second] }),
          });
        const ticket = String(body.ticket),
          other = ticket.startsWith('other');
        return route.fulfill({
          contentType: 'application/dicom',
          body: Buffer.from(
            syntheticDicom(
              Number(ticket.split('-')[1]),
              24,
              other && scenario === 'foreign patient' ? '222222222' : SYNTHETIC_PATIENT_ID,
              undefined,
              other && scenario === 'foreign frame' ? '1.2.3.999' : undefined,
              undefined,
              other
                ? {
                    seriesUid: secondUid,
                    ...(scenario === 'perpendicular' ? { orientation: [1, 0, 0, 0, 0, 1] } : {}),
                  }
                : undefined
            )
          ),
        });
      });
      const editor = await openSalvador(page);
      await editor.getByRole('button', { name: 'Imágenes MMRAD' }).click();
      await page.getByRole('button', { name: 'Ver DICOM', exact: true }).click();
      const viewer = page.getByRole('dialog', { name: /Visor DICOM/ });
      await expect(viewer.getByRole('button', { name: 'Comparar', exact: true })).toBeEnabled({
        timeout: 60000,
      });
      await viewer.getByRole('button', { name: 'Comparar', exact: true }).click();
      await viewer.getByLabel('Segunda serie').selectOption(secondUid);
      if (scenario === 'foreign patient') {
        await expect(viewer.getByRole('alert')).toContainText('No se pudo validar');
        await expect(viewer.getByLabel('Corte panel 2', { exact: true })).toBeDisabled();
        await expect(
          viewer.getByLabel('Comparación panel 2', { exact: true }).locator('canvas')
        ).toBeHidden();
      } else {
        await expect(
          viewer.getByText('Sin correspondencia geométrica', { exact: true })
        ).toBeVisible({ timeout: 60000 });
        const otherCut = await viewer.getByLabel('Corte panel 2', { exact: true }).inputValue();
        await viewer.getByLabel('Comparación panel 1', { exact: true }).focus();
        await page.keyboard.press('ArrowDown');
        await expect(viewer.getByLabel('Corte panel 1', { exact: true })).toHaveValue('14');
        await expect(viewer.getByLabel('Corte panel 2', { exact: true })).toHaveValue(otherCut);
        if (scenario === 'perpendicular')
          await expect(viewer.getByLabel('Línea de referencia')).toHaveCount(2);
        else await expect(viewer.getByLabel('Línea de referencia')).toHaveCount(0);
      }
      await viewer.getByRole('button', { name: 'Volver', exact: true }).click();
      await expect(viewer.getByRole('button', { name: 'MPR', exact: true })).toBeEnabled();
    });
  }
  test('comparison cancels secondary requests when leaving the viewer', async ({ page }) => {
    await setup(page);
    const secondUid = '1.2.826.0.1.3680043.10.543.25';
    const second = {
      ...study.series[0],
      uid: secondUid,
      number: 2,
      description: 'Descarga lenta sintética',
      instances: study.series[0].instances.map((instance, i) => ({
        ...instance,
        ticket: `slow-${i}`,
      })),
    };
    let requested = 0,
      aborted = 0;
    page.on('requestfailed', request => {
      if (request.url().includes('/mmrad-dicom') && String(request.postData()).includes('slow-'))
        aborted++;
    });
    await page.route('**/.netlify/functions/mmrad-dicom', async route => {
      const body = route.request().postDataJSON();
      if (body.action === 'metadata')
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ ...study, series: [...study.series, second] }),
        });
      const ticket = String(body.ticket),
        slow = ticket.startsWith('slow');
      if (slow) {
        requested++;
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      await route
        .fulfill({
          contentType: 'application/dicom',
          body: Buffer.from(
            syntheticDicom(
              Number(ticket.split('-')[1]),
              24,
              SYNTHETIC_PATIENT_ID,
              undefined,
              undefined,
              undefined,
              slow ? { seriesUid: secondUid } : undefined
            )
          ),
        })
        .catch(() => undefined);
    });
    const editor = await openSalvador(page);
    await editor.getByRole('button', { name: 'Imágenes MMRAD' }).click();
    await page.getByRole('button', { name: 'Ver DICOM', exact: true }).click();
    const viewer = page.getByRole('dialog', { name: /Visor DICOM/ });
    await expect(viewer.getByRole('button', { name: 'Comparar', exact: true })).toBeEnabled({
      timeout: 60000,
    });
    await viewer.getByRole('button', { name: 'Comparar', exact: true }).click();
    await viewer.getByLabel('Segunda serie').selectOption(secondUid);
    await expect.poll(() => requested).toBeGreaterThan(1);
    const started = requested,
      abortedBeforeClose = aborted;
    await viewer.getByRole('button', { name: 'Volver', exact: true }).click();
    await expect(viewer.getByRole('button', { name: 'MPR', exact: true })).toBeEnabled({
      timeout: 15000,
    });
    await expect.poll(() => aborted).toBeGreaterThan(abortedBeforeClose);
    expect(requested).toBe(started);
  });
  test('compacts controls, exposes keyboard navigation and reuses sequential prefetched series', async ({
    page,
  }) => {
    await setup(page);
    const secondUid = '1.2.826.0.1.3680043.10.543.22';
    const second = {
      ...study.series[0],
      uid: secondUid,
      number: 2,
      description: 'Segunda sintética',
      instances: study.series[0].instances
        .slice(0, 4)
        .map((item, i) => ({ ...item, ticket: `second-${i}` })),
    };
    const requests: string[] = [];
    await page.route('**/.netlify/functions/mmrad-dicom', route => {
      const body = route.request().postDataJSON();
      if (body.action === 'metadata')
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ ...study, series: [...study.series, second] }),
        });
      const ticket = String(body.ticket);
      requests.push(ticket);
      const index = Number(ticket.split('-')[1]);
      return route.fulfill({
        contentType: 'application/dicom',
        body: Buffer.from(
          syntheticDicom(
            index,
            24,
            SYNTHETIC_PATIENT_ID,
            undefined,
            undefined,
            undefined,
            ticket.startsWith('second') ? { seriesUid: secondUid } : undefined
          )
        ),
      });
    });
    const editor = await openSalvador(page);
    await editor.getByRole('button', { name: 'Imágenes MMRAD' }).click();
    await page.getByRole('button', { name: 'Ver DICOM', exact: true }).click();
    const viewer = page.getByRole('dialog', { name: /Visor DICOM/ });
    await expect(viewer.getByRole('button', { name: 'MPR', exact: true })).toBeEnabled({
      timeout: 60000,
    });
    await expect(viewer.getByText('PACIENTE SINTÉTICO', { exact: true })).toBeVisible();
    await expect(viewer.getByText('16/10/2026', { exact: true })).toBeVisible();
    await expect(viewer.getByText(/ya puedes navegar|Rueda o flechas/)).toHaveCount(0);
    const windowBox = (await viewer.getByLabel('Ventana predefinida').boundingBox())!;
    const invertBox = (await viewer
      .getByRole('button', { name: 'Invertir grises' })
      .boundingBox())!;
    const cineBox = (await viewer.getByLabel('Cine / MP4', { exact: true }).boundingBox())!;
    expect(Math.abs(windowBox.y - invertBox.y)).toBeLessThan(5);
    expect(Math.abs(windowBox.y - cineBox.y)).toBeLessThan(5);
    await viewer.getByLabel('Carga y conexión', { exact: true }).click();
    await expect(viewer.getByText('Velocidad media')).toBeVisible();
    await viewer.getByLabel('Carga y conexión', { exact: true }).click();
    const canvas = viewer.locator('.dicom-canvas').first();
    await canvas.focus();
    const initial = await viewer.getByLabel('Estado del corte').textContent();
    await page.keyboard.press('ArrowDown');
    await expect(viewer.getByLabel('Estado del corte')).not.toHaveText(initial!);
    await expect.poll(() => requests.length).toBe(28);
    expect(requests.slice(24)).toEqual(['second-0', 'second-1', 'second-2', 'second-3']);
    await viewer.getByLabel('Serie DICOM').selectOption(secondUid);
    await expect(viewer.getByRole('button', { name: 'MPR', exact: true })).toBeEnabled({
      timeout: 60000,
    });
    expect(requests.length).toBe(28);
    await viewer.screenshot({ path: test.info().outputPath('synthetic-compact-toolbar.png') });
  });
  test('reuses originals across verified studies and releases them when the patient review closes', async ({
    page,
  }) => {
    await setup(page);
    const secondStudy = {
      ...study,
      uid: '1.2.826.0.1.3680043.10.543.101',
      series: study.series.map(series => ({
        ...series,
        instances: series.instances.map((item, i) => ({ ...item, ticket: `other-${i}` })),
      })),
    };
    await page.route('**/.netlify/functions/mmrad-search*', route =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          rut: '11111111-1',
          examenes: [
            exam,
            { ...exam, nombre_examen: 'OTRO TAC SINTÉTICO', dicom_url: `${link}-other` },
          ],
        }),
      })
    );
    let downloads = 0,
      metadata = 0;
    await page.route('**/.netlify/functions/mmrad-dicom', route => {
      const body = route.request().postDataJSON();
      if (body.action === 'metadata') {
        metadata++;
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify(body.link === link ? study : secondStudy),
        });
      }
      downloads++;
      const ticket = String(body.ticket);
      return route.fulfill({
        contentType: 'application/dicom',
        body: Buffer.from(
          syntheticDicom(
            Number(ticket.split('-')[1]),
            24,
            SYNTHETIC_PATIENT_ID,
            undefined,
            undefined,
            undefined,
            { studyUid: ticket.startsWith('other-') ? secondStudy.uid : study.uid }
          )
        ),
      });
    });
    const editor = await openSalvador(page);
    await editor.getByRole('button', { name: 'Imágenes MMRAD' }).click();
    const viewer = page.getByRole('dialog', { name: /Visor DICOM/ });
    for (const index of [0, 1, 0]) {
      await page.getByRole('button', { name: 'Ver DICOM', exact: true }).nth(index).click();
      await expect(viewer.getByRole('button', { name: 'MPR', exact: true })).toBeEnabled({
        timeout: 60000,
      });
      await viewer.getByRole('button', { name: 'Cerrar modal', exact: true }).click();
    }
    expect(metadata).toBe(3);
    expect(downloads).toBe(48);
    await page
      .getByRole('dialog', { name: 'Radiología / Imagenología' })
      .getByRole('button', { name: 'Cerrar modal', exact: true })
      .click();
    await editor.getByRole('button', { name: 'Imágenes MMRAD' }).click();
    await page.getByRole('button', { name: 'Ver DICOM', exact: true }).first().click();
    await expect(viewer.getByRole('button', { name: 'MPR', exact: true })).toBeEnabled({
      timeout: 60000,
    });
    expect(downloads).toBe(72);
  });
  test('cine exports an ordered inclusive MP4 with privacy review and cancellation', async ({
    page,
  }) => {
    await setup(page);
    await page.route('**/.netlify/functions/mmrad-dicom', route => {
      const body = route.request().postDataJSON();
      if (body.action !== 'instance') return route.fallback();
      const index = Number(String(body.ticket).split('-')[1]);
      return route.fulfill({
        contentType: 'application/dicom',
        body: Buffer.from(
          syntheticDicom(
            index,
            24,
            SYNTHETIC_PATIENT_ID,
            undefined,
            undefined,
            undefined,
            undefined,
            { slope: '1', intercept: '0', unit: 'HU', pixelValue: 20 + index * 15 }
          )
        ),
      });
    });
    const editor = await openSalvador(page);
    await editor.getByRole('button', { name: 'Imágenes MMRAD' }).click();
    await page.getByRole('button', { name: 'Ver DICOM', exact: true }).click();
    const viewer = page.getByRole('dialog', { name: /Visor DICOM/ });
    await expect(viewer.getByRole('button', { name: 'PNG', exact: true })).toBeEnabled({
      timeout: 60000,
    });
    await viewer.locator('.dicom-cine summary').click();
    await viewer.getByLabel('Corte inicial', { exact: true }).fill('3');
    await viewer.getByLabel('Corte final', { exact: true }).fill('8');
    await viewer.getByLabel('Velocidad cine', { exact: true }).selectOption('5');
    await viewer.getByRole('button', { name: 'Reproducir', exact: true }).click();
    await expect(viewer.getByRole('button', { name: 'MPR', exact: true })).toBeDisabled();
    await viewer.getByRole('button', { name: 'Cancelar cine / MP4', exact: true }).click();
    await expect(viewer.getByText('Operación cancelada. No se guardó ningún video.')).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'Generar MP4', exact: true })).toBeEnabled();
    await viewer.getByRole('button', { name: 'Generar MP4', exact: true }).click();
    const video = viewer.getByLabel('Vista previa MP4', { exact: true });
    await expect(video).toBeVisible({ timeout: 60000 });
    await expect
      .poll(() => video.evaluate(node => (node as HTMLVideoElement).readyState))
      .toBeGreaterThanOrEqual(2);
    const info = await video.evaluate(node => {
      const video = node as HTMLVideoElement;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(video, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      return {
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
        nonblack: pixels.some((value, i) => i % 4 !== 3 && value > 20),
      };
    });
    expect(info.duration).toBeCloseTo(1.2, 2);
    expect(info.width % 2).toBe(0);
    expect(info.height % 2).toBe(0);
    expect(info.nonblack).toBe(true);
    const intensities = await video.evaluate(async node => {
      const movie = node as HTMLVideoElement;
      const canvas = document.createElement('canvas');
      canvas.width = movie.videoWidth;
      canvas.height = movie.videoHeight;
      const ctx = canvas.getContext('2d')!;
      const values: number[] = [];
      const seekToFrame = async (index: number) => {
        let callbackId = 0;
        let timer = 0;
        let observedTime: number | undefined;
        const seeked = new Promise<void>(resolve => {
          movie.addEventListener('seeked', () => resolve(), { once: true });
        });
        const presented = new Promise<void>(resolve => {
          callbackId = movie.requestVideoFrameCallback(function onFrame(_now, metadata) {
            observedTime = metadata.mediaTime;
            if (Math.round(metadata.mediaTime * 5) === index) resolve();
            else callbackId = movie.requestVideoFrameCallback(onFrame);
          });
        });
        const deadline = new Promise<never>((_, reject) => {
          timer = window.setTimeout(
            () =>
              reject(
                new Error(`Frame ${index} not presented; last mediaTime=${observedTime ?? 'none'}`)
              ),
            5000
          );
        });
        try {
          movie.currentTime = index / 5 + 0.05;
          await Promise.race([Promise.all([seeked, presented]), deadline]);
        } finally {
          window.clearTimeout(timer);
          movie.cancelVideoFrameCallback(callbackId);
        }
      };
      // Start elsewhere so sampling frame zero also waits for a new presentation.
      await seekToFrame(5);
      for (let i = 0; i < 6; i++) {
        await seekToFrame(i);
        ctx.drawImage(movie, 0, 0);
        values.push(
          ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1)
            .data[0]
        );
      }
      return values;
    });
    await expect(viewer.getByRole('link', { name: 'Descargar MP4', exact: true })).toHaveCount(0);
    await viewer.getByRole('checkbox', { name: /Revisé el video completo/ }).check();
    const downloading = page.waitForEvent('download');
    await viewer.getByRole('link', { name: 'Descargar MP4', exact: true }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe('secuencia-dicom.mp4');
    const bytes = fs.readFileSync((await download.path())!);
    await test.info().attach('synthetic-dicom-cine.mp4', { body: bytes, contentType: 'video/mp4' });
    for (let i = 1; i < intensities.length; i++)
      expect(intensities[i]).toBeGreaterThan(intensities[i - 1] + 3);
    const input = new Input({ source: new BufferSource(bytes), formats: [MP4] });
    try {
      const track = await input.getPrimaryVideoTrack();
      expect(track?.codec).toBe('avc');
      expect((await track!.computePacketStats()).packetCount).toBe(6);
      expect(await input.computeDuration()).toBeCloseTo(1.2, 2);
      expect(await input.getAudioTracks()).toHaveLength(0);
    } finally {
      input.dispose();
    }
    expect(bytes.includes(Buffer.from(SYNTHETIC_PATIENT_ID))).toBe(false);
    expect(bytes.includes(Buffer.from(SYNTHETIC_STUDY_UID))).toBe(false);
    expectNoMp4Dates(bytes);
    await viewer.getByRole('button', { name: 'Descartar video', exact: true }).click();
    await expect(video).toHaveCount(0);
    await viewer.getByLabel('Corte final', { exact: true }).fill('24');
    await viewer.getByRole('button', { name: 'Generar MP4', exact: true }).click();
    await viewer.getByRole('button', { name: 'Cancelar cine / MP4', exact: true }).click();
    await expect(viewer.getByText('Operación cancelada. No se guardó ningún video.')).toBeVisible();
    await expect(video).toHaveCount(0);
    await expect(viewer.getByRole('link', { name: 'Descargar MP4', exact: true })).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: 'PNG', exact: true })).toBeEnabled();
    await viewer.getByRole('button', { name: 'Reproducir', exact: true }).click();
    await viewer.getByRole('button', { name: 'Cerrar modal', exact: true }).click();
    await expect(viewer).toHaveCount(0);
    await page.getByRole('button', { name: 'Ver DICOM', exact: true }).click();
    await expect(viewer.getByRole('button', { name: 'PNG', exact: true })).toBeEnabled({
      timeout: 60000,
    });
    await expect(viewer.getByLabel('Vista previa MP4', { exact: true })).toHaveCount(0);
    await viewer.locator('.dicom-cine summary').click();
    await expect(viewer.getByLabel('Corte inicial', { exact: true })).toHaveValue('1');
    await expect(viewer.getByLabel('Corte final', { exact: true })).toHaveValue('24');
  });
  test('sweeps an MPR plane with its MIP slab into a back-and-forth MP4 and restores the view', async ({
    page,
  }) => {
    await setup(page);
    // One uniform value per axial cut, rising with the cut and inside the W400/L40 window.
    await page.route('**/.netlify/functions/mmrad-dicom', route => {
      const body = route.request().postDataJSON();
      if (body.action !== 'instance') return route.fallback();
      const index = Number(String(body.ticket).split('-')[1]);
      return route.fulfill({
        contentType: 'application/dicom',
        body: Buffer.from(
          syntheticDicom(
            index,
            24,
            SYNTHETIC_PATIENT_ID,
            undefined,
            undefined,
            undefined,
            undefined,
            { slope: '1', intercept: '0', unit: 'HU', pixelValue: 20 + index * 8 }
          )
        ),
      });
    });
    const editor = await openSalvador(page);
    await editor.getByRole('button', { name: 'Imágenes MMRAD' }).click();
    await page.getByRole('button', { name: 'Ver DICOM', exact: true }).click();
    const viewer = page.getByRole('dialog', { name: /Visor DICOM/ });
    await expect(viewer.getByRole('button', { name: 'MPR', exact: true })).toBeEnabled({
      timeout: 60000,
    });
    await viewer.getByRole('button', { name: 'MPR', exact: true }).click();
    await expect(viewer.getByRole('button', { name: 'PNG', exact: true })).toBeEnabled({
      timeout: 60000,
    });
    await viewer.getByLabel('Reconstrucción MPR', { exact: true }).click();
    await viewer.getByLabel('Espesor MPR en milímetros').fill('10');
    await viewer.getByLabel('Proyección MPR').selectOption('mip');
    await expect(viewer.getByLabel('Reconstrucción Axial', { exact: true })).toHaveText(
      'MIP · 10 mm'
    );
    await viewer.getByLabel('Reconstrucción MPR', { exact: true }).click();
    const coordinates = viewer.getByLabel('Coordenadas del punto LPS');
    await expect(coordinates).toContainText('mm');
    const centered = await coordinates.textContent();
    // Snap the axial plane to a whole cut, the way the sweep renders each cut, and give
    // Cornerstone two animation frames to draw it before reading the canvas.
    await viewer.getByRole('button', { name: 'Corte anterior Axial', exact: true }).click();
    await expect(coordinates).not.toHaveText(centered!);
    await page.evaluate(
      () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    );
    const axial = viewer.locator('.dicom-canvas canvas').first();
    const sample = () =>
      axial.evaluate(node => {
        const canvas = node as HTMLCanvasElement;
        const copy = document.createElement('canvas');
        copy.width = canvas.width;
        copy.height = canvas.height;
        const ctx = copy.getContext('2d')!;
        ctx.drawImage(canvas, 0, 0);
        const { data } = ctx.getImageData(0, 0, copy.width, copy.height);
        let hash = 2166136261;
        for (let i = 0; i < data.length; i += 4) hash = Math.imul(hash ^ data[i], 16777619);
        const middle = (Math.floor(copy.height / 2) * copy.width + Math.floor(copy.width / 2)) * 4;
        return { hash, center: data[middle] };
      });
    const before = await sample();
    const point = await coordinates.textContent();
    await viewer.getByLabel('Video MP4', { exact: true }).click();
    const plane = viewer.getByLabel('Plano del barrido', { exact: true });
    await expect(plane).toContainText('Axial · MIP · 10 mm · corte actual');
    const [current, total] = (await plane.textContent())!
      .match(/corte actual (\d+) de (\d+)/)!
      .slice(1)
      .map(Number);
    expect(total).toBe(24);
    await expect(viewer.getByLabel('Corte final', { exact: true })).toHaveValue('24');
    await expect(viewer.getByLabel('Perfil anónimo', { exact: true })).toBeChecked();
    await viewer.getByLabel('Corte inicial', { exact: true }).fill(String(current));
    await viewer.getByLabel('Corte final', { exact: true }).fill(String(current + 3));
    await viewer.getByLabel('Velocidad del video', { exact: true }).selectOption('5');
    await viewer.getByLabel('Secuencia del video', { exact: true }).selectOption('pingpong');
    await expect(viewer.getByLabel('Duración del video', { exact: true })).toHaveText(
      '6 cuadros · 1,2 s'
    );
    await viewer.getByRole('button', { name: 'Generar MP4', exact: true }).click();
    const video = viewer.getByLabel('Vista previa MP4', { exact: true });
    await expect(video).toBeVisible({ timeout: 60000 });
    await expect
      .poll(() => video.evaluate(node => (node as HTMLVideoElement).readyState))
      .toBeGreaterThanOrEqual(2);
    expect(await video.evaluate(node => (node as HTMLVideoElement).duration)).toBeCloseTo(1.2, 2);
    const frames = (await sampleVideoFrames(video, 6, 5)).map(frame => frame.center);
    // The first frame is the cut shown before, with the same MIP slab; a thin cut would
    // be two ramp steps away (about 10 grey levels).
    expect(Math.abs(frames[0] - before.center)).toBeLessThanOrEqual(3);
    const direction = Math.sign(frames[3] - frames[0]);
    expect(direction).not.toBe(0);
    for (let i = 1; i < 4; i++) expect((frames[i] - frames[i - 1]) * direction).toBeGreaterThan(2);
    expect(Math.abs(frames[4] - frames[2])).toBeLessThanOrEqual(2);
    expect(Math.abs(frames[5] - frames[1])).toBeLessThanOrEqual(2);
    await expect(viewer.getByText(/^\d+×\d+ · 6 cuadros · 1,2 s$/)).toBeVisible();
    await expect(viewer.getByRole('link', { name: 'Descargar MP4', exact: true })).toHaveCount(0);
    await viewer.getByRole('checkbox', { name: /Revisé el video completo y no contiene/ }).check();
    const mp4 = await downloadReviewedMp4(page, viewer, 'barrido-mpr-dicom.mp4');
    expect(mp4).toEqual({ codec: 'avc', packets: 6, duration: expect.closeTo(1.2, 2), audio: 0 });
    await viewer.getByRole('button', { name: 'Descartar video', exact: true }).click();
    await expect(video).toHaveCount(0);
    await expect(coordinates).toHaveText(point!);
    await expect.poll(async () => (await sample()).hash).toBe(before.hash);
    await expect(plane).toContainText(`corte actual ${current} de 24`);
    await expect(viewer.getByLabel('Reconstrucción Axial', { exact: true })).toHaveText(
      'MIP · 10 mm'
    );
  });
  test('turns the 3D view into an MP4 about a chosen axis, cancels and restores the camera', async ({
    page,
  }) => {
    await setup(page);
    const editor = await openSalvador(page);
    await editor.getByRole('button', { name: 'Imágenes MMRAD' }).click();
    await page.getByRole('button', { name: 'Ver DICOM', exact: true }).click();
    const viewer = page.getByRole('dialog', { name: /Visor DICOM/ });
    await expect(viewer.getByRole('button', { name: '3D', exact: true })).toBeEnabled({
      timeout: 60000,
    });
    await viewer.getByRole('button', { name: '3D', exact: true }).click();
    await expect(viewer.getByRole('button', { name: 'PNG', exact: true })).toBeEnabled({
      timeout: 60000,
    });
    const volume = viewer.locator('.dicom-canvas canvas').first();
    await expect
      .poll(() =>
        volume.evaluate(canvas => {
          const image = canvas as HTMLCanvasElement;
          const bounds = image.getBoundingClientRect();
          return (
            Math.abs(image.width - bounds.width * devicePixelRatio) <= 1 &&
            Math.abs(image.height - bounds.height * devicePixelRatio) <= 1
          );
        })
      )
      .toBe(true);
    const hash = () =>
      volume.evaluate(node => {
        const copy = document.createElement('canvas');
        copy.width = 64;
        copy.height = 64;
        const ctx = copy.getContext('2d')!;
        ctx.drawImage(node as HTMLCanvasElement, 0, 0, 64, 64);
        const data = ctx.getImageData(0, 0, 64, 64).data;
        let value = 2166136261;
        for (let i = 0; i < data.length; i++) value = Math.imul(value ^ data[i], 16777619);
        return value;
      });
    // Two animation frames give any pending Cornerstone render time to reach the canvas.
    const settled = async () => {
      let previous: number | undefined;
      for (let attempt = 0; attempt < 20; attempt++) {
        await page.evaluate(
          () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        );
        const value = await hash();
        if (value === previous) return value;
        previous = value;
      }
      throw new Error('The synthetic 3D view did not settle');
    };
    const initial = await settled();
    const initialCenter = await volume.evaluate(node => {
      const canvas = node as HTMLCanvasElement;
      const copy = document.createElement('canvas');
      copy.width = canvas.width;
      copy.height = canvas.height;
      const ctx = copy.getContext('2d')!;
      ctx.drawImage(canvas, 0, 0);
      return ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1)
        .data[0];
    });
    await viewer.getByLabel('Video MP4', { exact: true }).click();
    await viewer.getByLabel('Cuadros del giro 3D', { exact: true }).fill('120');
    await viewer.getByRole('button', { name: 'Generar MP4', exact: true }).click();
    await expect(viewer.getByRole('button', { name: 'MPR', exact: true })).toBeDisabled();
    const progress = viewer.getByRole('progressbar', { name: 'Progreso MP4' });
    // Cancel once the camera has turned, so restoring it is observable. Software WebGL
    // renders and encodes slowly, hence the generous waits.
    await expect
      .poll(() => progress.evaluate(node => (node as HTMLProgressElement).value), {
        timeout: 60000,
      })
      .toBeGreaterThan(1);
    await viewer.getByRole('button', { name: 'Cancelar MP4', exact: true }).click();
    await expect(viewer.getByText('Operación cancelada. No se guardó ningún video.')).toBeVisible();
    await expect(viewer.getByLabel('Vista previa MP4', { exact: true })).toHaveCount(0);
    await expect.poll(hash, { timeout: 30000 }).toBe(initial);
    await expect(viewer.getByRole('button', { name: 'MPR', exact: true })).toBeEnabled();
    await viewer.getByLabel('Eje de giro 3D', { exact: true }).selectOption('horizontal');
    await viewer.getByLabel('Cuadros del giro 3D', { exact: true }).fill('4');
    await viewer.getByLabel('Velocidad del video', { exact: true }).selectOption('5');
    await expect(viewer.getByLabel('Duración del video', { exact: true })).toHaveText(
      '4 cuadros · 0,8 s'
    );
    await viewer.getByLabel('Perfil anónimo', { exact: true }).uncheck();
    await viewer.getByRole('button', { name: 'Generar MP4', exact: true }).click();
    const video = viewer.getByLabel('Vista previa MP4', { exact: true });
    await expect(video).toBeVisible({ timeout: 60000 });
    await expect
      .poll(() => video.evaluate(node => (node as HTMLVideoElement).readyState))
      .toBeGreaterThanOrEqual(2);
    const frames = await sampleVideoFrames(video, 4, 5);
    // 0°, 90°, 180° and 270° about the screen's horizontal axis. The first frame is the
    // view itself; seen from either side, the synthetic volume is taller than from above
    // or below.
    expect(Math.abs(frames[0].center - initialCenter)).toBeLessThanOrEqual(8);
    expect(frames[1].height).toBeGreaterThan(frames[0].height * 1.08);
    expect(frames[3].height).toBeGreaterThan(frames[2].height * 1.08);
    await expect(viewer.getByRole('link', { name: 'Descargar MP4', exact: true })).toHaveCount(0);
    await viewer.getByRole('checkbox', { name: /Incluye nombre, RUT y fecha/ }).check();
    const mp4 = await downloadReviewedMp4(page, viewer, 'giro-3d-dicom.mp4');
    expect(mp4).toEqual({ codec: 'avc', packets: 4, duration: expect.closeTo(0.8, 2), audio: 0 });
    await viewer.getByRole('button', { name: 'Descartar video', exact: true }).click();
    await expect.poll(hash, { timeout: 30000 }).toBe(initial);
  });
  for (const calibrated of [true, false])
    test(`quantitative MPR ${calibrated ? 'measures calibrated HU and ROI' : 'blocks uncalibrated intensities'}`, async ({
      page,
    }) => {
      await setup(page);
      await page.route('**/.netlify/functions/mmrad-dicom', async route => {
        const body = route.request().postDataJSON();
        if (body.action !== 'instance') return route.fallback();
        const index = Number(String(body.ticket).split('-')[1]);
        await route.fulfill({
          contentType: 'application/dicom',
          body: Buffer.from(
            syntheticDicom(
              index,
              24,
              SYNTHETIC_PATIENT_ID,
              undefined,
              undefined,
              undefined,
              undefined,
              { slope: '2', intercept: '-1024', unit: calibrated ? 'HU' : 'US', pixelValue: 533 }
            )
          ),
        });
      });
      const editor = await openSalvador(page);
      await editor.getByRole('button', { name: 'Imágenes MMRAD' }).click();
      await page.getByRole('button', { name: 'Ver DICOM', exact: true }).click();
      const viewer = page.getByRole('dialog', { name: /Visor DICOM/ });
      await expect(viewer.getByRole('button', { name: 'MPR', exact: true })).toBeEnabled({
        timeout: 60000,
      });
      await viewer.getByRole('button', { name: 'MPR', exact: true }).click();
      await expect(viewer.getByRole('button', { name: 'PNG', exact: true })).toBeEnabled({
        timeout: 60000,
      });
      const contrast = viewer.getByRole('button', {
        name: 'Contraste (ventana y nivel)',
        exact: true,
      });
      await expect(contrast).toContainText('Contraste');
      await contrast.click();
      await expect(contrast).toHaveAttribute('aria-pressed', 'true');
      const probe = viewer.getByRole('button', { name: 'Lectura HU', exact: true });
      const roi = viewer.getByRole('button', { name: 'ROI elíptica', exact: true });
      if (!calibrated) {
        await expect(probe).toBeDisabled();
        await expect(roi).toBeDisabled();
        return;
      }
      await expect(probe).toBeEnabled();
      await viewer.getByLabel('Planos vinculados').uncheck();
      const canvas = viewer.locator('.dicom-canvas').first();
      const box = (await canvas.boundingBox())!;
      await probe.click();
      await canvas.click({ position: { x: box.width * 0.5, y: box.height * 0.5 } });
      await expect(canvas.locator('svg')).toContainText('42.0 HU');
      await viewer.getByRole('button', { name: 'Borrar medidas' }).click();
      await expect(canvas.locator('svg')).not.toContainText('42.0 HU');
      await roi.click();
      await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.45);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.58, { steps: 8 });
      await page.mouse.up();
      await expect(canvas.locator('svg')).toContainText('Promedio: 42.0 HU');
      await expect(canvas.locator('svg')).toContainText('DE: 0.0 HU');
      await expect(canvas.locator('svg')).toContainText(/Área: [1-9][0-9.]* mm²/);
      await viewer.getByRole('button', { name: 'Borrar medidas' }).click();
      await expect(canvas.locator('svg')).not.toContainText('Promedio');
    });

  test('recovers only failed cuts and plays a bounded available interval while incomplete', async ({
    page,
  }) => {
    await setup(page);
    const requests = new Map<number, number>();
    await page.route('**/.netlify/functions/mmrad-dicom', async route => {
      const body = route.request().postDataJSON();
      if (body.action === 'metadata') return route.fallback();
      const index = Number(String(body.ticket).split('-')[1]);
      const count = (requests.get(index) ?? 0) + 1;
      requests.set(index, count);
      if (index === 13 && count <= 3)
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          headers: { 'Retry-After': '1' },
          body: '{"error":"Synthetic temporary failure"}',
        });
      return route.fulfill({
        contentType: 'application/dicom',
        body: Buffer.from(syntheticDicom(index, 24)),
        headers: { 'Server-Timing': 'upstream;dur=25' },
      });
    });
    const editor = await openSalvador(page);
    await editor.getByRole('button', { name: 'Imágenes MMRAD' }).click();
    await page.getByRole('button', { name: 'Ver DICOM', exact: true }).click();
    const viewer = page.getByRole('dialog', { name: /Visor DICOM/ });
    await expect(viewer.getByRole('button', { name: 'Reintentar cortes fallidos' })).toBeVisible({
      timeout: 60000,
    });
    await expect(viewer.getByLabel('Descarga de la serie')).toHaveAttribute('value', '23', {
      timeout: 60000,
    });
    await expect(viewer.getByRole('button', { name: 'MPR', exact: true })).toBeDisabled();
    await viewer.locator('.dicom-load-detail > summary').click();
    await viewer.getByLabel('Descargas simultáneas').selectOption('2');
    await expect(viewer.locator('.dicom-load-detail')).toContainText('Preparación');
    await viewer.locator('.dicom-load-detail > summary').click();
    await viewer.locator('.dicom-cine summary').click();
    await expect(viewer.getByRole('button', { name: 'Generar MP4' })).toBeDisabled();
    await viewer.getByLabel('Intervalo cine parcial').selectOption('0,12');
    await expect(viewer.getByLabel('Corte inicial', { exact: true })).toHaveValue('1');
    await expect(viewer.getByLabel('Corte final', { exact: true })).toHaveValue('13');
    await viewer.getByLabel('Velocidad cine', { exact: true }).selectOption('30');
    await viewer.getByRole('button', { name: 'Reproducir', exact: true }).click();
    await expect(viewer.getByRole('button', { name: 'Cancelar cine / MP4' })).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'Cancelar cine / MP4' })).not.toBeVisible({
      timeout: 30000,
    });
    expect(requests.get(13)).toBe(3);
    await viewer.locator('.dicom-cine summary').click();
    await viewer.getByRole('button', { name: 'Reintentar cortes fallidos' }).click();
    await expect(viewer.getByRole('button', { name: 'MPR', exact: true })).toBeEnabled({
      timeout: 60000,
    });
    expect(requests.get(13)).toBe(4);
    expect([...requests].filter(([index]) => index !== 13).every(([, count]) => count === 1)).toBe(
      true
    );
  });

  test('renews expired study access silently and completes the series', async ({ page }) => {
    await setup(page);
    let served = 0;
    let expired = false;
    const metadata: string[] = [];
    await page.route('**/.netlify/functions/mmrad-dicom', async route => {
      const body = route.request().postDataJSON();
      if (body.action === 'metadata') {
        metadata.push(expired ? 'renewal' : 'open');
        if (!expired) return route.fallback();
        const renewed = {
          ...study,
          series: study.series.map(series => ({
            ...series,
            instances: series.instances.map(instance => ({
              ...instance,
              ticket: instance.ticket.replace('synthetic-', 'renewed-'),
            })),
          })),
        };
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(renewed) });
      }
      // The share access lapses mid-series: every original ticket now reads as expired.
      if (String(body.ticket).startsWith('synthetic-') && ++served > 8) {
        expired = true;
        return route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'El acceso al estudio no es válido o venció. Vuelve a abrir el visor.',
            code: 'ticket-expired',
          }),
        });
      }
      return route.fallback();
    });
    const editor = await openSalvador(page);
    await editor.getByRole('button', { name: 'Imágenes MMRAD' }).click();
    await page.getByRole('button', { name: 'Ver DICOM', exact: true }).click();
    const viewer = page.getByRole('dialog', { name: /Visor DICOM/ });
    await expect(viewer.getByRole('button', { name: 'MPR', exact: true })).toBeEnabled({
      timeout: 60000,
    });
    await expect(viewer.getByLabel('Descarga de la serie')).toHaveAttribute('value', '24');
    await expect(viewer.getByRole('alert')).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: 'Reintentar cortes fallidos' })).toHaveCount(0);
    expect(expired).toBe(true);
    expect(metadata).toEqual(['open', 'renewal']);
  });

  test('shows verified cuts progressively and prioritizes navigation before the volume is complete', async ({
    page,
  }) => {
    await setup(page);
    const waiting = new Map<number, () => void>();
    const requested: number[] = [];
    let releaseAll = false;
    await page.route('**/.netlify/functions/mmrad-dicom', async route => {
      const body = route.request().postDataJSON();
      if (body.action === 'metadata') return route.fallback();
      const index = Number(String(body.ticket).split('-')[1]);
      requested.push(index);
      if (index !== 12 && index !== 23 && !releaseAll)
        await new Promise<void>(resolve => waiting.set(index, resolve));
      await route.fulfill({
        contentType: 'application/dicom',
        body: Buffer.from(syntheticDicom(index, 24)),
      });
    });
    try {
      const editor = await openSalvador(page);
      await editor.getByRole('button', { name: 'Imágenes MMRAD' }).click();
      await page.getByRole('button', { name: 'Ver DICOM', exact: true }).click();
      const viewer = page.getByRole('dialog', { name: /Visor DICOM/ });
      await expect(viewer.getByRole('button', { name: 'PNG', exact: true })).toBeEnabled({
        timeout: 60000,
      });
      await expect(viewer.getByLabel('Estado del corte')).toHaveText('13/24');
      await expect(viewer.getByRole('button', { name: 'MPR', exact: true })).toBeDisabled();
      await expect(viewer.getByRole('button', { name: '3D', exact: true })).toBeDisabled();
      expect(requested.length).toBeLessThan(24);
      await viewer.getByLabel('Corte solicitado').fill('24');
      await expect(viewer.getByLabel('Estado del corte')).toContainText('Cargando 24/24');
      await expect(viewer.getByRole('button', { name: 'PNG', exact: true })).toBeDisabled();
      await expect(viewer.getByLabel('Ventana predefinida')).toBeDisabled();
      await expect(
        viewer.getByRole('button', { name: 'Restablecer vista', exact: true })
      ).toBeDisabled();
      await expect.poll(() => waiting.has(13)).toBe(true);
      const offset = requested.length;
      waiting.get(13)!();
      await expect(viewer.getByLabel('Estado del corte')).toHaveText('24/24');
      expect(requested[offset]).toBe(23);
      await expect(viewer.getByRole('button', { name: 'PNG', exact: true })).toBeEnabled();
      releaseAll = true;
      waiting.forEach(resolve => resolve());
      await expect(viewer.getByRole('button', { name: 'MPR', exact: true })).toBeEnabled({
        timeout: 60000,
      });
      await expect(viewer.getByLabel('Descarga de la serie')).toHaveAttribute('value', '24');
    } finally {
      releaseAll = true;
      waiting.forEach(resolve => resolve());
    }
  });
  // Tagged so CI runs this software-WebGL stress loop in its own preview lane.
  test(
    'recovers graphics at the same cut and bounds resources across repeated mode changes',
    { tag: '@graphics-stress' },
    async ({ page }) => {
      test.setTimeout(240000);
      // Software WebGL can delay even read-only browser queries after a 3D render.
      // Use the recovery deadline for graphics probes, preserving every predicate.
      const expectGraphics = expect.configure({ timeout: 30000 });
      await installDicomGraphicsProbe(page);
      await setup(page);
      let requests = 0;
      page.on('request', request => {
        if (request.url().endsWith('/mmrad-dicom') && request.postDataJSON()?.action === 'instance')
          requests++;
      });
      const editor = await openSalvador(page);
      await editor.getByRole('button', { name: 'Imágenes MMRAD' }).click();
      await page.getByRole('button', { name: 'Ver DICOM', exact: true }).click();
      const viewer = page.getByRole('dialog', { name: /Visor DICOM/ });
      const ready = () =>
        expect(viewer.getByRole('button', { name: 'PNG', exact: true })).toBeEnabled({
          timeout: 30000,
        });
      await expect(viewer.getByRole('button', { name: 'Comparar', exact: true })).toBeEnabled({
        timeout: 60000,
      });
      const countContexts = () => liveDicomContexts(page);
      const initialContexts = await countContexts();
      await page.evaluate(() => {
        document.addEventListener(
          'CORNERSTONE_CAMERA_MODIFIED',
          event => {
            Object.assign(window, { syntheticLastCamera: (event as CustomEvent).detail.camera });
          },
          true
        );
      });
      const hasPixels = () =>
        viewer
          .locator('.dicom-canvas canvas')
          .first()
          .evaluate(canvas => {
            const image = canvas as HTMLCanvasElement;
            return image
              .getContext('2d')!
              .getImageData(0, 0, image.width, image.height)
              .data.some((value, i) => i % 4 !== 3 && value > 0);
          });
      const lose = () => loseDicomGraphics(page);
      await viewer.locator('.dicom-canvas').first().focus();
      await page.keyboard.press('ArrowDown');
      await ready();
      await expect(viewer.getByLabel('Estado del corte')).toHaveText('14/24');
      await page.evaluate(
        () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      );
      const originalCamera = await page.evaluate(
        () => (window as unknown as { syntheticLastCamera: unknown }).syntheticLastCamera
      );
      await lose();
      await expectGraphics.poll(countContexts).toBe(initialContexts);
      await ready();
      await expect(viewer.getByLabel('Estado del corte')).toHaveText('14/24');
      expect(
        await page.evaluate(
          () => (window as unknown as { syntheticLastCamera: unknown }).syntheticLastCamera
        )
      ).toEqual(originalCamera);
      await viewer.getByRole('button', { name: 'MPR', exact: true }).click();
      await ready();
      await viewer.locator('.dicom-canvas').first().focus();
      await page.keyboard.press('ArrowDown');
      await viewer.getByLabel('Marcador de referencia').selectOption('point');
      const coordinates = viewer.getByLabel('Coordenadas del punto LPS');
      const point = await coordinates.textContent();
      await page.evaluate(
        () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      );

      await lose();
      await expectGraphics.poll(countContexts).toBe(initialContexts);
      await ready();
      await expect(coordinates).toHaveText(point!);
      await expect(viewer.getByLabel('Marcador de referencia')).toHaveValue('point');
      await expectGraphics.poll(hasPixels).toBe(true);

      const cdp = await page.context().newCDPSession(page);
      await cdp.send('HeapProfiler.collectGarbage');
      const before = await cdp.send('Runtime.getHeapUsage');
      const switchTimes: number[] = [];
      const heapSamples: number[] = [];
      for (let i = 0; i < 6; i++) {
        const start = Date.now();
        await viewer.getByRole('button', { name: '3D', exact: true }).click();
        await ready();
        await viewer.getByRole('button', { name: 'Original', exact: true }).click();
        await ready();
        await expect(viewer.getByLabel('Estado del corte')).toHaveText('14/24');
        await viewer.getByRole('button', { name: 'Comparar', exact: true }).click();
        await expect(viewer.getByText('Posición vinculada', { exact: true })).toBeVisible();
        if (i === 0) {
          const comparisonCut = await viewer
            .getByLabel('Corte panel 1', { exact: true })
            .inputValue();
          await lose();
          await expectGraphics.poll(countContexts).toBe(initialContexts + 1);
          await expect(viewer.getByLabel('Corte panel 1', { exact: true })).toHaveValue(
            comparisonCut
          );
          await expect(viewer.getByText('Recuperando imagen…')).toHaveCount(0);
        }
        await viewer.getByRole('button', { name: 'Volver', exact: true }).click();
        await ready();
        await viewer.getByRole('button', { name: 'MPR', exact: true }).click();
        await ready();
        await expect(coordinates).toHaveText(point!);
        await expectGraphics.poll(countContexts).toBe(initialContexts);
        expect(await viewer.locator('.dicom-canvas canvas').count()).toBe(3);
        switchTimes.push(Date.now() - start);
        await cdp.send('HeapProfiler.collectGarbage');
        heapSamples.push((await cdp.send('Runtime.getHeapUsage')).usedSize);
      }
      await cdp.send('HeapProfiler.collectGarbage');
      const after = await cdp.send('Runtime.getHeapUsage');
      expect(after.usedSize - before.usedSize).toBeLessThan(32 * 1024 * 1024);
      expect(requests).toBe(24);
      await loseDicomGraphics(page, false);
      await expect(viewer.getByRole('alert')).toHaveText(
        'No se pudo recuperar la imagen. Cierra y vuelve a abrir el visor.'
      );
      await expect(viewer.getByRole('button', { name: 'PNG', exact: true })).toBeDisabled();
      await expect(viewer.getByRole('button', { name: 'MPR', exact: true })).toBeDisabled();
      await expect(
        viewer.getByRole('button', { name: 'Volver a original', exact: true })
      ).toHaveCount(0);
      await viewer.getByRole('button', { name: 'Cerrar modal', exact: true }).click();
      await expectGraphics.poll(countContexts).toBe(0);
      // A fresh verified session exercises 3D loss independently of the two-attempt limit.
      await page.getByRole('button', { name: 'Ver DICOM', exact: true }).click();
      await expect(viewer.getByRole('button', { name: '3D', exact: true })).toBeEnabled({
        timeout: 60000,
      });
      await viewer.getByRole('button', { name: '3D', exact: true }).click();
      await ready();
      await page.evaluate(() => {
        Object.assign(window, { syntheticRenderedFrames: 0, syntheticDragStarted: false });
        document.addEventListener(
          'CORNERSTONE_TOOLS_MOUSE_DOWN',
          () => {
            Object.assign(window, { syntheticDragStarted: true });
          },
          { once: true, capture: true }
        );
        document.addEventListener(
          'CORNERSTONE_IMAGE_RENDERED',
          () => {
            const state = window as unknown as { syntheticRenderedFrames: number };
            state.syntheticRenderedFrames++;
          },
          true
        );
      });
      const box = (await viewer.locator('.dicom-canvas').boundingBox())!;
      const gestureStart = Date.now();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      // Cornerstone defers mouse-down to distinguish double-clicks from dragging.
      await page.waitForFunction(
        () => (window as unknown as { syntheticDragStarted: boolean }).syntheticDragStarted
      );
      await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 30, { steps: 12 });
      await page.mouse.up();
      await expectGraphics
        .poll(() =>
          page.evaluate(
            () => (window as unknown as { syntheticRenderedFrames: number }).syntheticRenderedFrames
          )
        )
        .toBeGreaterThan(1);
      const gestureMs = Date.now() - gestureStart;
      await expectGraphics.poll(hasPixels).toBe(true);
      const volumeCamera = await page.evaluate(
        () => (window as unknown as { syntheticLastCamera: unknown }).syntheticLastCamera
      );
      await lose();
      await expectGraphics.poll(countContexts).toBe(initialContexts);
      await ready();
      expect(
        await page.evaluate(
          () => (window as unknown as { syntheticLastCamera: unknown }).syntheticLastCamera
        )
      ).toEqual(volumeCamera);
      await expectGraphics.poll(hasPixels).toBe(true);
      // Reopening within the same patient review reuses the validated originals.
      expect(requests).toBe(24);
      await viewer.getByRole('button', { name: 'Cerrar modal', exact: true }).click();
      await expectGraphics.poll(countContexts).toBe(0);
      await test.info().attach('synthetic-stability-metrics', {
        contentType: 'application/json',
        body: JSON.stringify({
          heapGrowthBytes: after.usedSize - before.usedSize,
          activeContexts: await countContexts(),
          switchTimesMs: switchTimes,
          heapSamplesBytes: heapSamples,
          rotationGestureMs: gestureMs,
        }),
      });
    }
  );

  test('rotates MPR about a shared physical point and projects full-width slabs safely', async ({
    page,
  }) => {
    await setup(page);
    await page.evaluate(() => {
      const cameras: Record<string, { focalPoint: number[]; viewPlaneNormal: number[] }> = {};
      Object.assign(window, { syntheticMprCameras: cameras });
      document.addEventListener(
        'CORNERSTONE_CAMERA_MODIFIED',
        event => {
          const detail = (event as CustomEvent).detail;
          if (detail.viewportId.includes('-mpr-'))
            cameras[detail.viewportId.slice(-1)] = structuredClone(detail.camera);
        },
        true
      );
    });
    const editor = await openSalvador(page);
    await editor.getByRole('button', { name: 'Imágenes MMRAD' }).click();
    await page.getByRole('button', { name: 'Ver DICOM', exact: true }).click();
    const viewer = page.getByRole('dialog', { name: /Visor DICOM/ });
    await expect(viewer.getByRole('button', { name: 'MPR', exact: true })).toBeEnabled({
      timeout: 60000,
    });
    await viewer.getByRole('button', { name: 'MPR', exact: true }).click();
    await expect(viewer.getByRole('button', { name: 'PNG', exact: true })).toBeEnabled({
      timeout: 60000,
    });
    const coordinates = viewer.getByLabel('Coordenadas del punto LPS');
    const initialPoint = await coordinates.textContent();
    const hash = () =>
      viewer
        .locator('.dicom-canvas canvas')
        .first()
        .evaluate(node => {
          let value = 2166136261;
          for (const char of (node as HTMLCanvasElement).toDataURL())
            value = Math.imul(value ^ char.charCodeAt(0), 16777619);
          return value;
        });
    const initialHash = await hash();
    await viewer.getByLabel('Reconstrucción MPR', { exact: true }).click();
    await viewer.getByLabel('Espesor MPR en milímetros').fill('12');
    await expect(viewer.getByLabel('Reconstrucción Axial', { exact: true })).toHaveText(
      'Promedio · 12 mm'
    );
    await expect(viewer.getByRole('button', { name: 'Lectura HU', exact: true })).toBeDisabled();
    await expect.poll(hash).not.toBe(initialHash);
    const average = await hash();
    await viewer.getByLabel('Proyección MPR').selectOption('mip');
    await expect.poll(hash).not.toBe(average);
    const mip = await hash();
    await viewer.getByLabel('Proyección MPR').selectOption('minip');
    await expect.poll(hash).not.toBe(mip);
    await viewer.getByRole('button', { name: 'Restablecer MPR', exact: true }).click();
    await expect(viewer.getByLabel('Espesor MPR en milímetros')).toHaveValue('0');
    await expect(coordinates).toHaveText(initialPoint!);
    await expect.poll(hash).toBe(initialHash);
    await viewer.getByLabel('Marcador de referencia').selectOption('point');
    await viewer.getByLabel('Rotar planos', { exact: true }).check();
    await expect(viewer.getByLabel('Marcador de referencia')).toHaveValue('lines');
    await viewer.getByLabel('Reconstrucción MPR', { exact: true }).click();
    const axial = viewer.locator('.dicom-canvas').first();
    const box = (await axial.boundingBox())!;
    const handle = await axial.locator('svg line').evaluateAll(lines => {
      const line = lines
        .map(item => ({
          x1: Number(item.getAttribute('x1')),
          y1: Number(item.getAttribute('y1')),
          x2: Number(item.getAttribute('x2')),
          y2: Number(item.getAttribute('y2')),
        }))
        .find(item => Math.hypot(item.x2 - item.x1, item.y2 - item.y1) > 60);
      if (!line) throw new Error('Missing synthetic reference line');
      return { x: (line.x1 + line.x2) / 2, y: (line.y1 + line.y2) / 2 };
    });
    await page.mouse.move(box.x + handle.x, box.y + handle.y);
    await page.mouse.down();
    await page.mouse.move(box.x + handle.x + 45, box.y + handle.y + 55, { steps: 15 });
    await page.mouse.up();
    await expect(viewer.getByLabel('Reconstrucción Coronal', { exact: true })).toContainText(
      'Oblicuo'
    );
    await expect(coordinates).toHaveText(initialPoint!);
    await viewer.screenshot({ path: test.info().outputPath('synthetic-oblique-mpr.png') });
    const cameras = await page.evaluate(
      () =>
        (
          window as unknown as {
            syntheticMprCameras: Record<
              string,
              { focalPoint: number[]; viewPlaneNormal: number[] }
            >;
          }
        ).syntheticMprCameras
    );
    const point = initialPoint!.match(/-?\d+\.\d+/g)!.map(Number);
    const normals = Object.values(cameras).map(camera => camera.viewPlaneNormal);
    expect(normals).toHaveLength(3);
    Object.values(cameras).forEach(camera => {
      expect(
        Math.abs(
          camera.viewPlaneNormal.reduce(
            (sum, n, i) => sum + n * (point[i] - camera.focalPoint[i]),
            0
          )
        )
      ).toBeLessThan(0.1);
      expect(camera.viewPlaneNormal.reduce((sum, n) => sum + n * n, 0)).toBeCloseTo(1, 5);
    });
    expect(Math.abs(normals[0].reduce((sum, n, i) => sum + n * normals[1][i], 0))).toBeLessThan(
      1e-5
    );
    await viewer.getByRole('button', { name: 'Contraste (ventana y nivel)', exact: true }).click();
    await viewer.getByRole('button', { name: 'Corte siguiente Axial', exact: true }).click();
    await expect(coordinates).not.toHaveText(initialPoint!);
    await viewer.getByRole('button', { name: 'Distancia', exact: true }).click();
    await axial.click({ position: { x: box.width * 0.4, y: box.height * 0.4 } });
    await axial.click({ position: { x: box.width * 0.6, y: box.height * 0.6 } });
    await expect(axial.locator('svg')).toContainText('mm');
    await viewer.getByLabel('Reconstrucción MPR', { exact: true }).click();
    await viewer.getByRole('button', { name: 'Restablecer MPR', exact: true }).click();
    await expect(viewer.getByLabel('Reconstrucción Coronal', { exact: true })).toHaveText(
      'Corte fino'
    );
    await expect(viewer.getByRole('button', { name: 'Lectura HU', exact: true })).toBeEnabled();
  });

  test.describe('on a high-density display', () => {
    test.use({ deviceScaleFactor: 2 });
    test('draws the measurements, but not the crosshairs, into the PNG capture', async ({
      page,
    }) => {
      await setup(page);
      const editor = await openSalvador(page);
      await editor.getByRole('button', { name: 'Imágenes MMRAD' }).click();
      await page.getByRole('button', { name: 'Ver DICOM', exact: true }).click();
      const viewer = page.getByRole('dialog', { name: /Visor DICOM/ });
      const ready = () =>
        expect(viewer.getByRole('button', { name: 'PNG', exact: true })).toBeEnabled({
          timeout: 60000,
        });
      await ready();
      // Grayscale CT with white labels: strongly coloured pixels can only be overlays.
      const colouredPixels = async () => {
        const download = page.waitForEvent('download');
        await viewer.getByRole('button', { name: 'PNG', exact: true }).click();
        const bytes = fs.readFileSync((await (await download).path())!);
        return page.evaluate(async base64 => {
          // The app's CSP blocks fetching data: URLs; decode the bytes directly.
          const blob = new Blob([Uint8Array.from(atob(base64), char => char.charCodeAt(0))], {
            type: 'image/png',
          });
          const bitmap = await createImageBitmap(blob);
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          const context = canvas.getContext('2d')!;
          context.drawImage(bitmap, 0, 0);
          const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
          let count = 0;
          for (let i = 0; i < data.length; i += 4)
            if (
              Math.max(data[i], data[i + 1], data[i + 2]) -
                Math.min(data[i], data[i + 1], data[i + 2]) >
              80
            )
              count++;
          return count;
        }, bytes.toString('base64'));
      };
      const pane = viewer.locator('.dicom-canvas').first();
      const measureDistance = async () => {
        await viewer.getByRole('button', { name: 'Distancia', exact: true }).click();
        const box = (await pane.boundingBox())!;
        await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.35);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.6, { steps: 12 });
        await page.mouse.up();
        await expect(pane.locator('svg.svg-layer')).toContainText(/\d mm/);
      };
      // Original.
      expect(await colouredPixels()).toBe(0);
      await measureDistance();
      expect(await colouredPixels()).toBeGreaterThan(40);
      // MPR: the coloured crosshairs are on screen, yet stay out of the capture.
      await viewer.getByRole('button', { name: 'MPR', exact: true }).click();
      await ready();
      await expect(pane.locator('svg.svg-layer line').first()).toBeAttached();
      expect(await colouredPixels()).toBe(0);
      await measureDistance();
      expect(await colouredPixels()).toBeGreaterThan(40);
    });

    test('measures the dragged MPR distance even after a click left a pending line', async ({
      page,
    }) => {
      await setup(page);
      await page.evaluate(() => {
        const cameras: Record<string, { parallelScale: number }> = {};
        Object.assign(window, { syntheticMprCameras: cameras, syntheticToolClicks: 0 });
        document.addEventListener(
          'CORNERSTONE_CAMERA_MODIFIED',
          event => {
            const detail = (event as CustomEvent).detail;
            if (detail.viewportId.includes('-mpr-'))
              cameras[detail.viewportId.slice(-1)] = structuredClone(detail.camera);
          },
          true
        );
        document.addEventListener(
          'CORNERSTONE_TOOLS_MOUSE_CLICK',
          () => {
            (window as unknown as { syntheticToolClicks: number }).syntheticToolClicks++;
          },
          true
        );
      });
      const editor = await openSalvador(page);
      await editor.getByRole('button', { name: 'Imágenes MMRAD' }).click();
      await page.getByRole('button', { name: 'Ver DICOM', exact: true }).click();
      const viewer = page.getByRole('dialog', { name: /Visor DICOM/ });
      const ready = () =>
        expect(viewer.getByRole('button', { name: 'PNG', exact: true })).toBeEnabled({
          timeout: 60000,
        });
      await ready();
      await viewer.getByRole('button', { name: 'MPR', exact: true }).click();
      await ready();
      await viewer.getByRole('button', { name: 'Distancia', exact: true }).click();
      const panes = viewer.locator('.dicom-canvas');
      // Millimetre offsets (right, up) from a plane's centre, mapped with the plane's camera.
      const at = async (plane: number, [right, up]: [number, number]) => {
        const box = (await panes.nth(plane).boundingBox())!;
        const scale = await page.evaluate(
          index =>
            (
              window as unknown as {
                syntheticMprCameras: Record<string, { parallelScale: number }>;
              }
            ).syntheticMprCameras[index].parallelScale,
          String(plane)
        );
        const mmPerPixel = (2 * scale) / box.height;
        return {
          x: Math.round(box.x + box.width / 2 + right / mmPerPixel),
          y: Math.round(box.y + box.height / 2 - up / mmPerPixel),
        };
      };
      // Cornerstone holds a click for 400 ms to tell it from a double click.
      const click = async (plane: number, offset: [number, number]) => {
        const clicks = () =>
          page.evaluate(
            () => (window as unknown as { syntheticToolClicks: number }).syntheticToolClicks
          );
        const before = await clicks();
        const point = await at(plane, offset);
        await page.mouse.click(point.x, point.y);
        await expect.poll(clicks).toBe(before + 1);
        return point;
      };
      const drag = async (plane: number, from: [number, number], to: [number, number]) => {
        const [a, b] = [await at(plane, from), await at(plane, to)];
        await page.mouse.move(a.x, a.y);
        await page.mouse.down();
        await page.mouse.move(b.x, b.y, { steps: 12 });
        await page.mouse.up();
        return [a, b] as const;
      };
      // The distance line, without the reference lines or the dashed link to its label.
      const drawn = (plane: number) =>
        panes.nth(plane).evaluate(element => {
          const svg = element.querySelector('svg.svg-layer')!;
          const origin = svg.getBoundingClientRect();
          const lines = [...svg.querySelectorAll('line')].filter(
            line =>
              !line.getAttribute('stroke-dasharray') &&
              !['#fb7185', '#4ade80', '#60a5fa'].includes(line.getAttribute('stroke') ?? '')
          );
          const value = (name: string) => Number(lines[0].getAttribute(name));
          return {
            lines: lines.length,
            start: lines[0] && { x: origin.left + value('x1'), y: origin.top + value('y1') },
            end: lines[0] && { x: origin.left + value('x2'), y: origin.top + value('y2') },
            mm: Number(svg.textContent?.match(/(\d+(?:\.\d+)?) mm/)?.[1]),
          };
        });
      const expectMeasured = async (
        plane: number,
        [a, b]: readonly [{ x: number; y: number }, { x: number; y: number }],
        millimetres: number
      ) => {
        await expect.poll(async () => (await drawn(plane)).lines).toBe(1);
        // Cornerstone throttles the label, so it can show an intermediate length for 100 ms.
        await expect
          .poll(async () => Math.abs((await drawn(plane)).mm - millimetres))
          .toBeLessThan(0.3);
        const line = await drawn(plane);
        expect(Math.hypot(line.start.x - a.x, line.start.y - a.y)).toBeLessThanOrEqual(2);
        expect(Math.hypot(line.end.x - b.x, line.end.y - b.y)).toBeLessThanOrEqual(2);
      };
      const clear = async () => {
        await viewer.getByRole('button', { name: 'Borrar medidas' }).click();
        for (const plane of [0, 1, 2])
          await expect.poll(async () => (await drawn(plane)).lines).toBe(0);
      };

      // Offsets are physical, so each distance is the hypotenuse of its millimetre offsets.
      await expectMeasured(0, await drag(0, [-12, -8], [6, 10]), Math.hypot(18, 18));
      await clear();
      // A click on a plane leaves Cornerstone's two-click line pending. The next drag must
      // still measure from where it was pressed, on its own plane, and leave no other line.
      await click(0, [-18, 14]);
      await expectMeasured(0, await drag(0, [-10, 6], [14, -10]), Math.hypot(24, 16));
      await clear();
      await click(0, [16, 12]);
      await expectMeasured(1, await drag(1, [-12, 8], [10, -6]), Math.hypot(22, 14));
      expect((await drawn(0)).lines).toBe(0);
      await clear();
      // Two clicks still measure between them.
      const first = await click(0, [-14, -12]);
      const second = await click(0, [10, 4]);
      await expectMeasured(0, [first, second], Math.hypot(24, 16));
      await clear();
      await viewer.getByRole('button', { name: 'Ampliar Sagital', exact: true }).click();
      await expect
        .poll(() =>
          panes.nth(2).evaluate(element => {
            const canvas = element.querySelector('canvas')!;
            return Math.abs(canvas.width - canvas.clientWidth * devicePixelRatio) <= 1;
          })
        )
        .toBe(true);
      await click(2, [-20, 12]);
      await expectMeasured(2, await drag(2, [-16, 10], [18, -8]), Math.hypot(34, 18));
      await viewer.screenshot({ path: test.info().outputPath('synthetic-mpr-distance.png') });
    });
  });

  test('links MPR coordinates and renders reversible 3D tissue controls', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await setup(page);
    const editor = await openSalvador(page);
    await editor.getByRole('button', { name: 'Imágenes MMRAD' }).click();
    await page.getByRole('button', { name: 'Ver DICOM', exact: true }).click();
    const viewer = page.getByRole('dialog', { name: /Visor DICOM/ });
    const ready = () =>
      expect(viewer.getByRole('button', { name: 'PNG', exact: true })).toBeEnabled({
        timeout: 60000,
      });
    const hashes = () =>
      viewer.locator('.dicom-canvas canvas').evaluateAll(nodes =>
        nodes.map(node => {
          const canvas = node as HTMLCanvasElement;
          const copy = document.createElement('canvas');
          copy.width = 64;
          copy.height = 64;
          const ctx = copy.getContext('2d')!;
          ctx.drawImage(canvas, 0, 0, 64, 64);
          const data = ctx.getImageData(0, 0, 64, 64).data;
          let hash = 2166136261;
          for (let i = 0; i < data.length; i++) hash = Math.imul(hash ^ data[i], 16777619);
          return hash;
        })
      );
    await ready();
    await viewer.getByRole('button', { name: 'MPR', exact: true }).click();
    await ready();
    // The imaging area dominates the desktop workspace without clipping its footer.
    const workspace = (await viewer.boundingBox())!;
    const imageArea = (await viewer.locator('.dicom-grid').boundingBox())!;
    expect(imageArea.height / workspace.height).toBeGreaterThan(0.72);
    expect(imageArea.y + imageArea.height).toBeLessThanOrEqual(workspace.y + workspace.height);
    await viewer.getByLabel('Información de medidas').click();
    await expect(viewer.getByText('Medidas temporales:', { exact: false })).toBeVisible();
    await viewer.locator('.dicom-canvas').first().focus();
    await page.keyboard.press('Escape');
    await expect(viewer.getByText('Medidas temporales:', { exact: false })).not.toBeVisible();
    await expect(viewer).toBeVisible();
    await viewer.screenshot({ path: test.info().outputPath('synthetic-compact-mpr.png') });
    const coordinates = viewer.getByLabel('Coordenadas del punto LPS');
    await expect(coordinates).toContainText('mm');
    const initial = await coordinates.textContent();
    const originalPlanes = await hashes();
    await viewer.getByRole('button', { name: 'Ampliar Coronal', exact: true }).click();
    await expect(viewer.getByRole('button', { name: 'Axial', exact: true })).not.toBeVisible();
    await expect(viewer.getByRole('button', { name: 'Coronal', exact: true })).toBeVisible();
    const expandedBox = (await viewer.locator('.dicom-pane[data-expanded="true"]').boundingBox())!;
    expect(expandedBox.width).toBeGreaterThan(imageArea.width * 0.95);
    await expect(coordinates).toHaveText(initial!);
    await viewer.getByRole('button', { name: 'Volver a los tres planos' }).click();
    await expect(viewer.getByRole('button', { name: 'Axial', exact: true })).toBeVisible();
    await viewer.getByRole('button', { name: 'Pantalla completa', exact: true }).click();
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
    await viewer.getByRole('button', { name: 'Salir de pantalla completa' }).click();
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
    await expect(viewer).toBeVisible();

    const axial = viewer.locator('.dicom-canvas').nth(0);
    const box = (await axial.boundingBox())!;
    await axial.click({ position: { x: box.width * 0.58, y: box.height * 0.56 } });
    await expect(coordinates).not.toHaveText(initial!);
    await expect
      .poll(async () =>
        (await hashes()).slice(1).every((value, i) => value !== originalPlanes[i + 1])
      )
      .toBe(true);
    const beforeDrag = await coordinates.textContent();
    await page.mouse.move(box.x + box.width * 0.58, box.y + box.height * 0.56);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.6, { steps: 5 });
    await page.mouse.up();
    await expect(coordinates).not.toHaveText(beforeDrag!);
    await viewer.getByRole('button', { name: 'Zoom', exact: true }).click();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.65, { steps: 5 });
    await page.mouse.up();
    await viewer.getByRole('button', { name: 'Restablecer vista', exact: true }).click();
    await expect(coordinates).toHaveText(initial!);
    await expect.poll(hashes).toEqual(originalPlanes);
    const beforeScroll = await coordinates.textContent();
    await viewer.getByRole('button', { name: 'Corte siguiente Axial' }).click();
    await expect(coordinates).not.toHaveText(beforeScroll!);
    await viewer.getByLabel('Marcador de referencia').selectOption('point');
    await viewer.getByLabel('Planos vinculados').uncheck();
    await expect(coordinates).toContainText('desactivada');
    await viewer.getByLabel('Planos vinculados').check();
    await expect(coordinates).toContainText('mm');
    await viewer.getByRole('button', { name: 'Punto de referencia', exact: true }).click();
    const beforeInvert = await hashes();
    await viewer.getByRole('button', { name: 'Invertir grises' }).click();
    await expect.poll(async () => (await hashes())[0] !== beforeInvert[0]).toBe(true);
    await viewer.getByRole('button', { name: 'Invertir grises' }).click();
    await viewer.getByRole('button', { name: 'Distancia', exact: true }).click();
    await axial.click({ position: { x: box.width * 0.45, y: box.height * 0.45 } });
    await axial.click({ position: { x: box.width * 0.6, y: box.height * 0.6 } });
    await expect(viewer.locator('.dicom-canvas svg').first()).toContainText('mm');
    await axial.focus();
    await page.keyboard.press('Control+z');
    await expect(viewer.locator('.dicom-canvas svg').first()).not.toContainText('mm');
    await viewer.getByRole('button', { name: 'Ángulo', exact: true }).click();
    for (const [x, y] of [
      [0.45, 0.45],
      [0.55, 0.55],
      [0.45, 0.65],
    ])
      await axial.click({ position: { x: box.width * x, y: box.height * y } });
    await expect(viewer.locator('.dicom-canvas svg').first()).toContainText('°');
    await viewer.getByRole('button', { name: 'Borrar medidas' }).click();
    await expect(viewer.locator('.dicom-canvas svg').first()).not.toContainText('°');
    await viewer.getByRole('button', { name: '3D', exact: true }).click();
    await ready();
    // Wait for the canvas backing size to match its final CSS size before taking a
    // pixel baseline. A layout-triggered resize must not masquerade as a preset change.
    await expect
      .poll(() =>
        viewer
          .locator('.dicom-canvas canvas')
          .first()
          .evaluate(canvas => {
            const image = canvas as HTMLCanvasElement;
            const bounds = image.getBoundingClientRect();
            return (
              Math.abs(image.width - bounds.width * devicePixelRatio) <= 1 &&
              Math.abs(image.height - bounds.height * devicePixelRatio) <= 1
            );
          })
      )
      .toBe(true);
    const bone = await hashes();
    await viewer.getByText('Ajustes 3D', { exact: true }).click();
    const settingsBox = (await viewer
      .locator('.dicom-volume-settings .dicom-popover-body')
      .boundingBox())!;
    expect(settingsBox.y).toBeGreaterThan(workspace.y);
    expect(settingsBox.y + settingsBox.height).toBeLessThan(workspace.y + workspace.height);
    await viewer.getByLabel('Tejido 3D').selectOption('CT-Soft-Tissue');
    await expect.poll(async () => (await hashes())[0] !== bone[0]).toBe(true);
    await viewer.getByLabel('Tejido 3D').selectOption('CT-Bone');
    await expect.poll(async () => (await hashes())[0], { timeout: 30000 }).toBe(bone[0]);
    const beforeClip = await hashes();
    await viewer.getByLabel('Eje de recorte 3D').selectOption('x');
    await viewer.getByLabel('Profundidad de recorte 3D').fill('50');
    await expect
      .poll(async () => (await hashes())[0] !== beforeClip[0], { timeout: 30000 })
      .toBe(true);
    await viewer.getByLabel('Opacidad 3D').fill('40');
    await viewer.getByLabel('Desplazamiento del umbral 3D').fill('100');
    await viewer.getByLabel('Iluminación 3D').uncheck();
    await viewer.getByRole('button', { name: 'Restablecer 3D' }).click();
    await expect(viewer.getByLabel('Eje de recorte 3D')).toHaveValue('none');
    await expect(viewer.getByLabel('Opacidad 3D')).toHaveValue('100');
    await expect.poll(async () => (await hashes())[0]).toBe(bone[0]);
    await viewer.getByRole('button', { name: 'Original', exact: true }).first().click();
    await ready();
    await expect(viewer.getByRole('alert')).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await viewer.getByRole('button', { name: 'MPR', exact: true }).click();
    await ready();
    expect(await viewer.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await viewer.getByRole('button', { name: 'Sagital', exact: true }).scrollIntoViewIfNeeded();
    await expect(viewer.getByRole('button', { name: 'Sagital', exact: true })).toBeInViewport();
  });
  for (const scenario of ['localizer', 'unmarked', 'gap'] as const)
    test(`handles ${scenario} sources without losing Original or hiding selection`, async ({
      page,
    }) => {
      const marked = scenario !== 'unmarked';
      const valid = scenario === 'localizer';
      const localizerIndex = scenario === 'gap' ? 12 : 0;
      await setup(page);
      await page.route('**/.netlify/functions/mmrad-dicom', async route => {
        const body = route.request().postDataJSON();
        if (body.action !== 'instance') return route.fallback();
        const index = Number(String(body.ticket).split('-')[1]);
        await route.fulfill({
          contentType: 'application/dicom',
          body: Buffer.from(
            syntheticDicom(
              index,
              24,
              SYNTHETIC_PATIENT_ID,
              undefined,
              undefined,
              index === localizerIndex
                ? { rows: 32, columns: 16, spacing: [2, 4], position: [0, 0], padding: true }
                : undefined,
              index === localizerIndex
                ? {
                    imageType: marked ? 'ORIGINAL\\PRIMARY\\LOCALIZER' : 'ORIGINAL\\PRIMARY\\AXIAL',
                    orientation: [1, 0, 0, 0, 0, 1],
                  }
                : undefined
            )
          ),
        });
      });
      const editor = await openSalvador(page);
      await editor.getByRole('button', { name: 'Imágenes MMRAD' }).click();
      await page.getByRole('button', { name: 'Ver DICOM', exact: true }).click();
      const viewer = page.getByRole('dialog', { name: /Visor DICOM/ });
      const ready = () =>
        expect(viewer.getByRole('button', { name: 'PNG', exact: true })).toBeEnabled({
          timeout: 60000,
        });
      await ready();
      for (const mode of ['MPR', '3D']) {
        await viewer.getByRole('button', { name: mode, exact: true }).click();
        if (valid) {
          await ready();
          await expect(viewer.getByRole('alert')).toHaveCount(0);
          await expect(viewer.getByText(/Los localizadores de planificación/)).toHaveCount(0);
          const brightPixels = await viewer.locator('.dicom-canvas canvas').evaluateAll(canvases =>
            canvases.map(node => {
              const canvas = node as HTMLCanvasElement;
              const copy = document.createElement('canvas');
              copy.width = canvas.width;
              copy.height = canvas.height;
              const ctx = copy.getContext('2d')!;
              ctx.drawImage(canvas, 0, 0);
              const pixels = ctx.getImageData(0, 0, copy.width, copy.height).data;
              let bright = 0;
              for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 20) bright++;
              return bright;
            })
          );
          expect(brightPixels).toHaveLength(mode === 'MPR' ? 3 : 1);
          brightPixels.forEach(count => expect(count).toBeGreaterThan(500));
        } else {
          await expect(viewer.getByRole('alert')).toContainText(
            marked ? 'espaciado uniforme' : 'orientaciones'
          );
          await expect(viewer.getByRole('button', { name: 'PNG', exact: true })).toBeDisabled();
          await expect(viewer.getByText(/Los localizadores de planificación/)).toHaveCount(0);
        }
        await viewer
          .getByRole('button', { name: valid ? 'Original' : 'Volver a original', exact: true })
          .first()
          .click();
        await ready();
        await expect(viewer.getByRole('alert')).toHaveCount(0);
        await expect(viewer.getByText(/Los localizadores de planificación/)).toHaveCount(0);
        await viewer.getByRole('button', { name: 'Corte siguiente Original', exact: true }).click();
        await viewer.getByRole('button', { name: 'Corte anterior Original', exact: true }).click();
      }
    });

  test('explains incompatible reference frames in MPR and 3D and preserves the original view', async ({
    page,
  }) => {
    await setup(page);
    await page.route('**/.netlify/functions/mmrad-dicom', async route => {
      const body = route.request().postDataJSON();
      if (body.action !== 'instance') return route.fallback();
      const index = Number(String(body.ticket).split('-')[1]);
      await route.fulfill({
        contentType: 'application/dicom',
        body: Buffer.from(
          syntheticDicom(
            index,
            24,
            SYNTHETIC_PATIENT_ID,
            undefined,
            index === 1 ? '1.2.826.0.1.3680043.10.543.999' : undefined
          )
        ),
      });
    });
    const editor = await openSalvador(page);
    await editor.getByRole('button', { name: 'Imágenes MMRAD' }).click();
    await page.getByRole('button', { name: 'Ver DICOM', exact: true }).click();
    const viewer = page.getByRole('dialog', { name: /Visor DICOM/ });
    await expect(viewer.getByRole('button', { name: 'PNG', exact: true })).toBeEnabled({
      timeout: 60000,
    });
    for (const mode of ['MPR', '3D']) {
      await viewer.getByRole('button', { name: mode, exact: true }).click();
      await expect(viewer.getByRole('alert')).toContainText('distintos marcos de referencia');
      await expect(viewer.getByRole('alert')).not.toContainText('1.2.826');
      await expect(viewer.getByLabel('Reconstrucción MPR', { exact: true })).toHaveCount(0);
      await expect(viewer.getByRole('button', { name: 'PNG', exact: true })).toBeDisabled();
      await viewer.getByRole('button', { name: 'Volver a original', exact: true }).click();
      await expect(viewer.getByRole('alert')).toHaveCount(0);
      await expect(viewer.getByRole('button', { name: 'PNG', exact: true })).toBeEnabled();
      await expect(viewer.locator('.dicom-canvas canvas')).toBeVisible();
    }
  });

  test('reconstructs heterogeneous physical matrices with calibrated intensities and preserves originals', async ({
    page,
  }) => {
    await setup(page);
    await page.route('**/.netlify/functions/mmrad-dicom', async route => {
      const body = route.request().postDataJSON();
      if (body.action !== 'instance') return route.fallback();
      const index = Number(String(body.ticket).split('-')[1]);
      await route.fulfill({
        contentType: 'application/dicom',
        body: Buffer.from(
          syntheticDicom(
            index,
            24,
            SYNTHETIC_PATIENT_ID,
            undefined,
            undefined,
            index % 2 ? { rows: 32, columns: 16, spacing: [2, 4], position: [1.5, 0.5] } : undefined
          )
        ),
      });
    });
    const editor = await openSalvador(page);
    await editor.getByRole('button', { name: 'Imágenes MMRAD' }).click();
    await page.getByRole('button', { name: 'Ver DICOM', exact: true }).click();
    const viewer = page.getByRole('dialog', { name: /Visor DICOM/ });
    const ready = () =>
      expect(viewer.getByRole('button', { name: 'PNG', exact: true })).toBeEnabled({
        timeout: 60000,
      });
    await ready();
    for (const mode of ['MPR', '3D', 'Original', 'MPR']) {
      await viewer.getByRole('button', { name: mode, exact: true }).click();
      await ready();
      await expect(viewer.getByRole('alert')).toHaveCount(0);
      await expect(viewer.getByText(/Volumen remuestreado/)).toHaveCount(
        mode === 'Original' ? 0 : 1
      );
      if (mode === 'MPR') await viewer.getByLabel('Ventana predefinida').selectOption('400,40');
      const signatures = await viewer.locator('.dicom-canvas canvas').evaluateAll(canvases =>
        canvases.map(node => {
          const canvas = node as HTMLCanvasElement;
          const copy = document.createElement('canvas');
          copy.width = canvas.width;
          copy.height = canvas.height;
          const ctx = copy.getContext('2d')!;
          ctx.drawImage(canvas, 0, 0);
          const pixels = ctx.getImageData(0, 0, copy.width, copy.height).data;
          let bright = 0;
          const gray = new Uint32Array(256);
          for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i] > 20) bright++;
            if (pixels[i] > 40 && pixels[i] < 220) gray[pixels[i]]++;
          }
          return { bright, peak: gray.indexOf(Math.max(...gray)) };
        })
      );
      expect(signatures).toHaveLength(mode === 'MPR' ? 3 : 1);
      signatures.forEach(signature => {
        expect(signature.bright).toBeGreaterThan(500);
        if (mode === 'MPR') {
          expect(signature.peak).toBeGreaterThan(120);
          expect(signature.peak).toBeLessThan(165);
        }
      });
    }
  });

  for (const failure of ['coverage', 'padding'] as const)
    test(`rejects unsafe heterogeneous ${failure} and recovers original`, async ({ page }) => {
      await setup(page);
      await page.route('**/.netlify/functions/mmrad-dicom', async route => {
        const body = route.request().postDataJSON();
        if (body.action !== 'instance') return route.fallback();
        const index = Number(String(body.ticket).split('-')[1]);
        await route.fulfill({
          contentType: 'application/dicom',
          body: Buffer.from(
            syntheticDicom(
              index,
              24,
              SYNTHETIC_PATIENT_ID,
              undefined,
              undefined,
              index % 2
                ? {
                    rows: 32,
                    columns: failure === 'coverage' ? 33 : 32,
                    spacing: [2, 2],
                    position: [0.5, 0.5],
                    padding: failure === 'padding',
                  }
                : undefined
            )
          ),
        });
      });
      const editor = await openSalvador(page);
      await editor.getByRole('button', { name: 'Imágenes MMRAD' }).click();
      await page.getByRole('button', { name: 'Ver DICOM', exact: true }).click();
      const viewer = page.getByRole('dialog', { name: /Visor DICOM/ });
      await expect(viewer.getByRole('button', { name: 'PNG', exact: true })).toBeEnabled({
        timeout: 60000,
      });
      for (const mode of ['MPR', '3D']) {
        await viewer.getByRole('button', { name: mode, exact: true }).click();
        await expect(viewer.getByRole('alert')).toContainText(
          failure === 'coverage' ? 'campos físicos diferentes' : 'relleno'
        );
        await expect(viewer.getByRole('button', { name: 'PNG', exact: true })).toBeDisabled();
        await viewer.getByRole('button', { name: 'Volver a original', exact: true }).click();
        await expect(viewer.getByRole('button', { name: 'PNG', exact: true })).toBeEnabled();
        await expect(viewer.getByRole('alert')).toHaveCount(0);
      }
    });

  test('loads only on explicit open, renders original/MPR/3D, captures PNG and appends patient-bound Word annexes', async ({
    page,
  }) => {
    const requests: string[] = [];
    const errors: string[] = [];
    page.on('request', request => requests.push(request.url()));
    page.on('pageerror', error => errors.push(error.message));
    await setup(page);
    const editor = await openSalvador(page);
    const imagingRequests = () =>
      requests.filter(url =>
        /DicomViewer|vendor-dicom|dicomRuntime|decodeImageFrameWorker|computeWorker|\.wasm|mmrad-dicom/.test(
          url
        )
      );
    expect(imagingRequests()).toEqual([]);
    await editor.getByRole('button', { name: 'Imágenes MMRAD' }).click();
    await expect(page.getByRole('button', { name: 'Ver DICOM', exact: true })).toBeVisible({
      timeout: 20000,
    });
    expect(imagingRequests()).toEqual([]);
    await page.getByRole('button', { name: 'Ver DICOM', exact: true }).click();
    const viewer = page.getByRole('dialog', { name: /Visor DICOM/ });
    await Promise.race([
      expect(viewer.getByRole('button', { name: 'PNG', exact: true })).toBeEnabled({
        timeout: 60000,
      }),
      viewer
        .getByRole('alert')
        .waitFor({ state: 'visible', timeout: 60000 })
        .then(async () => {
          throw new Error(await viewer.getByRole('alert').innerText());
        }),
    ]);
    await expect(viewer.getByRole('alert')).toHaveCount(0);
    expect(imagingRequests().some(url => /vendor-dicom/.test(url))).toBe(true);
    expect(imagingRequests().some(url => /openjpeg.*\.wasm/.test(url))).toBe(true);
    await viewer.getByRole('button', { name: 'MPR', exact: true }).click();
    await expect(viewer.getByRole('button', { name: 'PNG', exact: true })).toBeEnabled({
      timeout: 30000,
    });
    await expect(viewer.locator('.dicom-canvas')).toHaveCount(3);
    const signatures = await viewer.locator('.dicom-canvas canvas').evaluateAll(canvases =>
      canvases.map(node => {
        const canvas = node as HTMLCanvasElement;
        const copy = document.createElement('canvas');
        copy.width = canvas.width;
        copy.height = canvas.height;
        const context = copy.getContext('2d')!;
        context.drawImage(canvas, 0, 0);
        const pixels = context.getImageData(0, 0, copy.width, copy.height).data;
        let bright = 0;
        const gray = new Uint32Array(256);
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i] > 20) bright++;
          if (pixels[i] > 40 && pixels[i] < 220) gray[pixels[i]]++;
        }
        const softTissuePeak = gray.indexOf(Math.max(...gray));
        return { bright, png: copy.toDataURL(), softTissuePeak };
      })
    );
    expect(signatures).toHaveLength(3);
    signatures.forEach(image => {
      expect(image.bright).toBeGreaterThan(500);
      // +60 HU at width 400 / center 40 remains gray for signed and JPEG2000 unsigned originals.
      expect(image.softTissuePeak).toBeGreaterThan(120);
      expect(image.softTissuePeak).toBeLessThan(165);
    });
    expect(new Set(signatures.map(image => image.png)).size).toBe(3);
    await page.screenshot({ path: test.info().outputPath('dicom-mpr.png') });
    await viewer.getByRole('button', { name: 'Añadir al informe' }).click();
    // Capture waits up to 15s for IMAGE_RENDERED before encoding. Software WebGL
    // can exceed the default 5s assertion window; retain the actual success check.
    await expect(viewer.getByRole('status').filter({ hasText: 'Captura añadida' })).toContainText(
      'Captura añadida',
      {
        timeout: 20_000,
      }
    );
    const pngDownload = page.waitForEvent('download');
    await viewer.getByRole('button', { name: 'PNG', exact: true }).click();
    const png = await pngDownload;
    expect(png.suggestedFilename()).toBe('captura-dicom.png');
    const bytes = fs.readFileSync((await png.path())!);
    expect(bytes.subarray(1, 4).toString()).toBe('PNG');
    expect(bytes.length).toBeGreaterThan(1000);
    await viewer.getByRole('button', { name: '3D', exact: true }).click();
    await expect(viewer.getByRole('button', { name: 'PNG', exact: true })).toBeEnabled({
      timeout: 30000,
    });
    await expect(viewer.getByRole('alert')).toHaveCount(0);
    await viewer.locator('.dicom-canvas').hover();
    await page.mouse.wheel(0, 120);
    await page.screenshot({ path: test.info().outputPath('dicom-3d.png') });
    await viewer.getByRole('button', { name: 'Añadir al informe' }).click();
    await expect(viewer.getByRole('status').filter({ hasText: 'Captura añadida' })).toContainText(
      'Captura añadida',
      {
        timeout: 20_000,
      }
    );
    await viewer.getByRole('button', { name: /Cerrar/ }).click();
    await page
      .getByRole('dialog', { name: 'Radiología / Imagenología' })
      .getByRole('button', { name: /Cerrar/ })
      .click();
    await expect(editor.getByLabel('Descripción anexo 1')).toBeVisible();
    await editor.getByLabel('Descripción anexo 2').fill('Volumen 3D sintético');
    const wordDownload = page.waitForEvent('download');
    await editor.getByRole('button', { name: 'Word (.docx)' }).click();
    const word = await wordDownload;
    const zip = new PizZip(fs.readFileSync((await word.path())!));
    expect(zip.file(/word\/media\/dicom-annex-\d+\.png/)).toHaveLength(2);
    expect(zip.file('word/document.xml')!.asText()).toContain('Volumen 3D sintético');
    await word.saveAs(test.info().outputPath('salvador-anexos.docx'));
    await editor
      .getByLabel('Formulario clínico')
      .selectOption('planilla-monitorizacion-ventilatoria');
    await editor
      .getByLabel('Formulario clínico')
      .selectOption('informe-traslado-hospital-salvador');
    await expect(editor.getByLabel('Descripción anexo 1')).toBeVisible();
    await editor.getByRole('button', { name: 'Imágenes MMRAD' }).click();
    await page.getByRole('button', { name: 'Ver DICOM', exact: true }).click();
    const reopened = page.getByRole('dialog', { name: /Visor DICOM/ });
    await expect(reopened.getByRole('button', { name: 'PNG', exact: true })).toBeEnabled({
      timeout: 30000,
    });
    await page.keyboard.press('Escape');
    await expect(reopened).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Radiología / Imagenología' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Radiología / Imagenología' })).toHaveCount(0);
    await expect(editor.getByLabel('Descripción anexo 1')).toBeVisible();
    await editor.getByLabel('RUT', { exact: true }).fill('22.222.222-2');
    await expect(editor.getByLabel('Descripción anexo 1')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
  test('supports manual entry at mobile width without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await setup(page);
    const editor = await openSalvador(page, true);
    await editor.getByRole('button', { name: 'Imágenes MMRAD' }).click();
    await page.getByRole('button', { name: 'Ver DICOM', exact: true }).click();
    const viewer = page.getByRole('dialog', { name: /Visor DICOM/ });
    await expect(viewer.getByRole('button', { name: 'PNG', exact: true })).toBeEnabled({
      timeout: 30000,
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      375
    );
    await page.screenshot({ path: test.info().outputPath('dicom-mobile.png') });
    await viewer.getByRole('button', { name: 'Añadir al informe' }).click();
    await expect(viewer.getByRole('status').filter({ hasText: 'Captura añadida' })).toContainText(
      'Captura añadida'
    );
    await viewer.getByRole('button', { name: 'Cerrar modal', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Radiología / Imagenología' })
      .getByRole('button', { name: 'Cerrar modal', exact: true })
      .click();
    await expect(editor.getByLabel('Descripción anexo 1')).toBeVisible();
    await expect(editor.getByLabel('Origen de los datos')).toHaveValue('');
  });
  test('blocks an original from another patient before rendering or allowing captures', async ({
    page,
  }) => {
    await setup(page);
    await page.route('**/.netlify/functions/mmrad-dicom', route => {
      const body = route.request().postDataJSON();
      if (body.action === 'metadata')
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(study) });
      return route.fulfill({
        contentType: 'application/dicom',
        body: Buffer.from(
          syntheticDicom(Number(String(body.ticket).split('-')[1]), 24, '222222222')
        ),
      });
    });
    const editor = await openSalvador(page);
    await editor.getByRole('button', { name: 'Imágenes MMRAD' }).click();
    await page.getByRole('button', { name: 'Ver DICOM', exact: true }).click();
    const viewer = page.getByRole('dialog', { name: /Visor DICOM/ });
    await expect(viewer.getByRole('alert')).toContainText('no corresponde', { timeout: 30000 });
    await expect(viewer.getByRole('button', { name: 'PNG', exact: true })).toBeDisabled();
    await expect(viewer.getByRole('button', { name: 'Añadir al informe' })).toBeDisabled();
    await expect(viewer.locator('.dicom-canvas canvas')).toHaveCount(0);
  });

  test.describe('measurements in Original and Comparar', () => {
    const calibration = (calibrated: boolean) => ({
      slope: '2',
      intercept: '-1024',
      unit: calibrated ? 'HU' : 'US',
      pixelValue: 533,
    });
    // Uniform synthetic CT: 533 × 2 − 1024 = 42 HU wherever the mapping is validated.
    const routeUniformCt = (page: Page, calibrated: boolean) =>
      page.route('**/.netlify/functions/mmrad-dicom', async route => {
        const body = route.request().postDataJSON();
        if (body.action !== 'instance') return route.fallback();
        const index = Number(String(body.ticket).split('-')[1]);
        await route.fulfill({
          contentType: 'application/dicom',
          body: Buffer.from(
            syntheticDicom(
              index,
              24,
              SYNTHETIC_PATIENT_ID,
              undefined,
              undefined,
              undefined,
              undefined,
              calibration(calibrated)
            )
          ),
        });
      });
    const recordCameras = (page: Page) =>
      page.evaluate(() => {
        // Newest last, so a reopened series or a new comparison wins over older viewports.
        const cameras: Array<{ viewportId: string; parallelScale: number }> = [];
        Object.assign(window, { syntheticStackCameras: cameras, syntheticToolClicks: 0 });
        document.addEventListener(
          'CORNERSTONE_CAMERA_MODIFIED',
          event => {
            const detail = (event as CustomEvent).detail;
            cameras.push({
              viewportId: detail.viewportId,
              parallelScale: detail.camera.parallelScale,
            });
          },
          true
        );
        document.addEventListener(
          'CORNERSTONE_TOOLS_MOUSE_CLICK',
          () => {
            (window as unknown as { syntheticToolClicks: number }).syntheticToolClicks++;
          },
          true
        );
      });
    const openViewer = async (page: Page) => {
      const editor = await openSalvador(page);
      await editor.getByRole('button', { name: 'Imágenes MMRAD' }).click();
      await page.getByRole('button', { name: 'Ver DICOM', exact: true }).click();
      const viewer = page.getByRole('dialog', { name: /Visor DICOM/ });
      await expect(viewer.getByRole('button', { name: 'PNG', exact: true })).toBeEnabled({
        timeout: 60000,
      });
      // A stack fits its image without a camera event; a reset reports the fitted camera.
      await viewer.getByRole('button', { name: 'Restablecer vista', exact: true }).click();
      return viewer;
    };
    /** Physical offsets (mm right, mm up) from a pane's centre, through its own camera. */
    const paneTools = (page: Page, viewer: ReturnType<Page['getByRole']>) => {
      const panes = viewer.locator('.dicom-canvas');
      const at = async (pane: number, [right, up]: [number, number]) => {
        const box = (await panes.nth(pane).boundingBox())!;
        const prefix = ['-original-', 'compare-', '-mpr-'][(await panes.count()) - 1];
        const scale = await page.evaluate(
          ([prefix, suffix]) =>
            (
              window as unknown as {
                syntheticStackCameras: Array<{ viewportId: string; parallelScale: number }>;
              }
            ).syntheticStackCameras
              .slice()
              .reverse()
              .find(
                camera => camera.viewportId.includes(prefix) && camera.viewportId.endsWith(suffix)
              )?.parallelScale ?? NaN,
          [prefix, `-${pane}`] as const
        );
        const mmPerPixel = (2 * scale) / box.height;
        return {
          x: Math.round(box.x + box.width / 2 + right / mmPerPixel),
          y: Math.round(box.y + box.height / 2 - up / mmPerPixel),
        };
      };
      const drag = async (pane: number, from: [number, number], to: [number, number]) => {
        const [a, b] = [await at(pane, from), await at(pane, to)];
        await page.mouse.move(a.x, a.y);
        await page.mouse.down();
        await page.mouse.move(b.x, b.y, { steps: 12 });
        await page.mouse.up();
        return [a, b] as const;
      };
      const click = async (pane: number, offset: [number, number]) => {
        const clicks = () =>
          page.evaluate(
            () => (window as unknown as { syntheticToolClicks: number }).syntheticToolClicks
          );
        const before = await clicks();
        const point = await at(pane, offset);
        await page.mouse.click(point.x, point.y);
        await expect.poll(clicks).toBe(before + 1);
        return point;
      };
      // Solid lines only: Cornerstone links each label to its drawing with a dashed line,
      // and MPR's reference lines use the plane colours.
      const drawn = (pane: number) =>
        panes.nth(pane).evaluate(element => {
          const svg = element.querySelector('svg.svg-layer');
          const origin = svg?.getBoundingClientRect();
          const lines = [...(svg?.querySelectorAll('line') ?? [])].filter(
            line =>
              !line.getAttribute('stroke-dasharray') &&
              !['#fb7185', '#4ade80', '#60a5fa'].includes(line.getAttribute('stroke') ?? '')
          );
          const value = (name: string) => Number(lines[0].getAttribute(name));
          return {
            lines: lines.length,
            start: lines[0] && { x: origin!.left + value('x1'), y: origin!.top + value('y1') },
            end: lines[0] && { x: origin!.left + value('x2'), y: origin!.top + value('y2') },
            text: svg?.textContent ?? '',
            mm: Number(svg?.textContent?.match(/(\d+(?:\.\d+)?) mm/)?.[1]),
          };
        });
      const expectLength = async (pane: number, millimetres: number) =>
        // Cornerstone throttles the label, so it can show an intermediate length for 100 ms.
        expect.poll(async () => Math.abs((await drawn(pane)).mm - millimetres)).toBeLessThan(0.3);
      return { panes, at, drag, click, drawn, expectLength };
    };

    test('measures dragged millimetres in Original and keeps them across views', async ({
      page,
    }) => {
      await setup(page);
      await recordCameras(page);
      const viewer = await openViewer(page);
      const { at, drag, click, drawn, expectLength, panes } = paneTools(page, viewer);
      await viewer.getByRole('button', { name: 'Distancia', exact: true }).click();
      const [a, b] = await drag(0, [-12, -8], [6, 10]);
      await expectLength(0, Math.hypot(18, 18));
      const line = await drawn(0);
      expect(line.lines).toBe(1);
      expect(Math.hypot(line.start.x - a.x, line.start.y - a.y)).toBeLessThanOrEqual(2);
      expect(Math.hypot(line.end.x - b.x, line.end.y - b.y)).toBeLessThanOrEqual(2);
      // CT has no projection calibration: the distance is plain millimetres.
      expect(line.text).not.toMatch(/detector|paciente|sin calibrar/);
      await viewer.getByRole('button', { name: 'Borrar medidas', exact: true }).click();
      await expect.poll(async () => (await drawn(0)).lines).toBe(0);

      // #1190 in Original: a click leaves a pending line; the next drag still measures itself.
      await click(0, [-18, 14]);
      await drag(0, [-10, 6], [14, -10]);
      await expectLength(0, Math.hypot(24, 16));
      await expect.poll(async () => (await drawn(0)).lines).toBe(1);

      await viewer.getByRole('button', { name: 'Ángulo de Cobb', exact: true }).click();
      await drag(0, [-14, 12], [14, 12]);
      await drag(0, [-14, -12], [14, -2]);
      await expect.poll(async () => (await drawn(0)).text).toMatch(/Cobb 19\.\d°|Cobb 2[0-1]\.\d°/);

      // Measurements outlive a view change while the viewer stays open.
      await viewer.getByRole('button', { name: 'MPR', exact: true }).click();
      await expect(viewer.getByRole('button', { name: 'Axial', exact: true })).toBeVisible({
        timeout: 60000,
      });
      await viewer.getByRole('button', { name: 'Original', exact: true }).click();
      await expect(viewer.getByRole('button', { name: 'Distancia', exact: true })).toBeEnabled({
        timeout: 60000,
      });
      await expectLength(0, Math.hypot(24, 16));
      await expect(viewer.getByLabel('Medidas (2)', { exact: true })).toBeVisible();
      // Ctrl/⌘ Z removes the newest one in this view: the Cobb angle.
      await panes.first().focus();
      await page.keyboard.press('ControlOrMeta+z');
      await expect(viewer.getByLabel('Medidas (1)', { exact: true })).toBeVisible();
      await expect.poll(async () => (await drawn(0)).text).not.toContain('Cobb');
      await expectLength(0, Math.hypot(24, 16));
      // With a half-drawn line, undo drops only that line.
      await viewer.getByRole('button', { name: 'Distancia', exact: true }).click();
      await click(0, [10, -14]);
      const follow = await at(0, [16, -10]);
      await page.mouse.move(follow.x, follow.y, { steps: 4 });
      await expect.poll(async () => (await drawn(0)).lines).toBe(2);
      await panes.first().focus();
      await page.keyboard.press('ControlOrMeta+z');
      await expect.poll(async () => (await drawn(0)).lines).toBe(1);
      await expect(viewer.getByLabel('Medidas (1)', { exact: true })).toBeVisible();
      await expectLength(0, Math.hypot(24, 16));

      // An MPR distance also survives a trip to Original and back.
      await viewer.getByRole('button', { name: 'MPR', exact: true }).click();
      await expect(viewer.getByRole('button', { name: 'Axial', exact: true })).toBeVisible({
        timeout: 60000,
      });
      await viewer.getByLabel('Planos vinculados').uncheck();
      await viewer.getByRole('button', { name: 'Distancia', exact: true }).click();
      await drag(0, [-8, 4], [8, 4]);
      await expectLength(0, 16);
      await viewer.getByRole('button', { name: 'Original', exact: true }).click();
      await expect(viewer.getByLabel('Medidas (2)', { exact: true })).toBeVisible({
        timeout: 60000,
      });
      await viewer.getByRole('button', { name: 'MPR', exact: true }).click();
      await expect(viewer.getByRole('button', { name: 'Axial', exact: true })).toBeVisible({
        timeout: 60000,
      });
      await expectLength(0, 16);
      await viewer.getByLabel('Medidas (2)', { exact: true }).click();
      await expect(viewer.getByRole('list', { name: 'Lista de medidas' })).toContainText(
        /serie 1, MPR axial, corte \d+: distancia (15,9|16,0|16,1) mm/
      );
    });

    for (const calibrated of [true, false])
      test(`Original ${calibrated ? 'reports HU on validated CT' : 'never shows HU on unvalidated CT'}`, async ({
        page,
      }) => {
        await setup(page);
        await routeUniformCt(page, calibrated);
        await recordCameras(page);
        const viewer = await openViewer(page);
        const { at, drag, drawn } = paneTools(page, viewer);
        const centre = await at(0, [0, 0]);
        await page.mouse.move(centre.x - 20, centre.y);
        await page.mouse.move(centre.x, centre.y, { steps: 5 });
        const cursor = viewer.getByLabel('HU bajo el cursor', { exact: true });
        if (calibrated) await expect(cursor).toHaveText('Cursor: 42 HU');
        else await expect(cursor).toHaveText('');

        await viewer.getByRole('button', { name: 'ROI elíptica', exact: true }).click();
        await drag(0, [0, 0], [10, -8]);
        const svg = viewer.locator('.dicom-canvas').first().locator('svg');
        await expect(svg).toContainText(/Área: [1-9][0-9.]* mm²/);
        if (calibrated) {
          await expect(svg).toContainText('Promedio: 42.0 HU');
          await expect(svg).toContainText('DE: 0.0 HU');
        } else {
          await expect(svg).toContainText('HU no disponible');
          await expect(svg).not.toContainText('Promedio');
        }
        await viewer.getByRole('button', { name: 'Borrar medidas', exact: true }).click();
        await expect.poll(async () => (await drawn(0)).text).toBe('');
        await viewer.getByRole('button', { name: 'ROI rectangular', exact: true }).click();
        await drag(0, [-10, 8], [8, -6]);
        if (calibrated) await expect(svg).toContainText('Mín/Máx: 42 / 42 HU');
        else await expect(svg).not.toContainText(/42(\.0)? HU/);
        await viewer.getByRole('button', { name: 'ROI circular', exact: true }).click();
        await drag(0, [14, 14], [18, 14]);
        await viewer.getByRole('button', { name: 'Densidad puntual', exact: true }).click();
        const probe = await at(0, [-16, -16]);
        await page.mouse.click(probe.x, probe.y);
        if (calibrated) await expect(svg).toContainText('42.0 HU');
        await expect(viewer.getByLabel('Medidas (3)', { exact: true })).toBeVisible();
        await viewer.getByLabel('Medidas (3)', { exact: true }).click();
        const list = viewer.getByRole('list', { name: 'Lista de medidas' });
        if (calibrated) {
          await expect(list).toContainText('ROI rectangular 42 UH (DE 0)');
          await expect(list).toContainText('densidad 42 UH');
        } else {
          await expect(list).not.toContainText('UH (DE');
          await expect(list).toContainText('densidad: UH no disponible');
        }
      });

    test('lists measurements by slice, jumps to them and copies plain text', async ({
      page,
      context,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await setup(page);
      await routeUniformCt(page, true);
      await recordCameras(page);
      const viewer = await openViewer(page);
      const { drag, drawn, expectLength, panes } = paneTools(page, viewer);
      const slice = viewer.getByLabel('Corte solicitado', { exact: true });
      await expect(slice).toHaveValue('13');
      await viewer.getByRole('button', { name: 'Distancia', exact: true }).click();
      await drag(0, [-10, 0], [14, 0]);
      await expectLength(0, 24);
      await panes.first().focus();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await expect(slice).toHaveValue('15');
      await expect.poll(async () => (await drawn(0)).lines).toBe(0);
      await viewer.getByRole('button', { name: 'ROI elíptica', exact: true }).click();
      await drag(0, [0, 0], [10, -8]);
      await expect(panes.first().locator('svg')).toContainText('Promedio: 42.0 HU');

      await viewer.getByLabel('Medidas (2)', { exact: true }).click();
      const items = viewer.getByRole('list', { name: 'Lista de medidas' }).getByRole('listitem');
      await expect(items).toHaveCount(2);
      await expect(items.nth(0)).toContainText('serie 1, corte 13');
      // 24 mm dragged; the pointer lands on whole pixels, so allow the last decimal to move.
      await expect(items.nth(0)).toContainText(/distancia (23,9|24,0|24,1) mm/);
      await expect(items.nth(1)).toContainText('serie 1, corte 15');
      await expect(items.nth(1)).toContainText(/ROI 42 UH \(DE 0\), área \d+,\d (mm|cm)²/);
      await items
        .nth(0)
        .getByRole('button', { name: /corte 13/ })
        .click();
      await expect(slice).toHaveValue('13');
      await expectLength(0, 24);

      await viewer.getByRole('button', { name: 'Copiar medidas', exact: true }).click();
      await expect(viewer.getByText('Medidas copiadas. Pégalas en la nota clínica.')).toBeVisible();
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      expect(copied).toMatch(
        /^TAC SINTÉTICO, serie 1, corte 13: distancia (23,9|24,0|24,1) mm\nTAC SINTÉTICO, serie 1, corte 15: ROI 42 UH \(DE 0\), área \d+,\d (mm|cm)²$/
      );
      // Plain clinical text: no patient name, RUT or synthetic patient ID.
      expect(copied).not.toMatch(/PACIENTE|11\.111\.111|111111111/);
      await viewer.getByText('Volumen estimado', { exact: true }).click();
      await viewer
        .getByLabel('A, diámetro mayor (mm): tomar de una distancia', { exact: true })
        .selectOption({ index: 1 });
      await viewer
        .getByLabel('B, perpendicular a A en el mismo corte (mm)', { exact: true })
        .fill('20');
      await viewer.getByLabel('Cortes con hemorragia', { exact: true }).fill('5');
      // Slice interval from the synthetic positions: 2 mm apart. C = 5 × 2 = 10 mm.
      await expect(viewer.getByLabel('Intervalo entre cortes (mm)', { exact: true })).toHaveValue(
        '2,0'
      );
      await expect(viewer.getByLabel('Resultado ABC/2', { exact: true })).toContainText(
        /C = 5 × 2,0 mm = 10,0 mm\. ABC\/2 = (23,9|24,0|24,1) × 20,0 × 10,0 \/ 2 = 2,4 mL \(estimado\)/
      );
      await viewer.screenshot({ path: test.info().outputPath('synthetic-measurements-panel.png') });

      await items.nth(1).getByRole('button', { name: 'Borrar medida 2', exact: true }).click();
      await expect(items).toHaveCount(1);
      await panes.first().focus();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await expect(slice).toHaveValue('15');
      await expect.poll(async () => (await drawn(0)).text).toBe('');

      // Comparar draws the same measurement in its panel and adds its own to the list.
      await viewer.getByRole('button', { name: 'Comparar', exact: true }).click();
      await expect(viewer.getByText('Posición vinculada', { exact: true })).toBeVisible();
      await viewer.getByLabel('Medidas (1)', { exact: true }).click();
      await viewer.getByRole('button', { name: /corte 13/ }).click();
      await expect(viewer.getByLabel('Corte panel 1', { exact: true })).toHaveValue('13');
      await expectLength(0, 24);
      await viewer.getByLabel('Medidas (1)', { exact: true }).click();
      // Both panels show this series; a slice without drawings keeps the new line alone.
      await viewer.getByLabel('Corte panel 2', { exact: true }).fill('10');
      await expect(viewer.getByLabel('Corte panel 1', { exact: true })).toHaveValue('10');
      await viewer.getByRole('button', { name: 'Restablecer panel', exact: true }).click();
      await viewer.getByRole('button', { name: 'Distancia', exact: true }).click();
      await drag(1, [-6, 6], [6, 6]);
      await expectLength(1, 12);
      await expect(viewer.getByLabel('Medidas (2)', { exact: true })).toBeVisible();
      await viewer.getByRole('button', { name: 'Volver', exact: true }).click();
      await expect(viewer.getByRole('button', { name: 'Distancia', exact: true })).toBeEnabled({
        timeout: 60000,
      });
      await expect(viewer.getByLabel('Medidas (2)', { exact: true })).toBeVisible();

      // Closing the viewer drops every measurement.
      await viewer.getByRole('button', { name: 'Cerrar modal', exact: true }).click();
      await page.getByRole('button', { name: 'Ver DICOM', exact: true }).click();
      await expect(viewer.getByRole('button', { name: 'PNG', exact: true })).toBeEnabled({
        timeout: 60000,
      });
      await expect(viewer.getByLabel('Medidas (0)', { exact: true })).toBeVisible();
    });

    test('labels radiograph distances by where they were calibrated', async ({ page }) => {
      await setup(page);
      const DX = '1.2.840.10008.5.1.4.1.1.1.1';
      const kinds = {
        detector: { imagerSpacing: [0.2, 0.2] as [number, number], omitPixelSpacing: true },
        patient: {
          imagerSpacing: [0.2, 0.2] as [number, number],
          magnification: '1.25',
          omitPixelSpacing: true,
        },
        none: { omitPixelSpacing: true },
      };
      const radiographs = Object.keys(kinds).map((kind, i) => ({
        uid: `1.2.826.0.1.3680043.10.543.7${i}`,
        number: i + 2,
        description: `Radiografía sintética ${kind}`,
        modality: 'DX',
        rows: 64,
        columns: 64,
        instances: [{ uid: syntheticSopUid(0), number: 1, frames: 1, ticket: `rx-${kind}-0` }],
      }));
      await page.route('**/.netlify/functions/mmrad-dicom', route => {
        const body = route.request().postDataJSON();
        if (body.action === 'metadata')
          return route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({ ...study, series: radiographs }),
          });
        const kind = String(body.ticket).split('-')[1] as keyof typeof kinds;
        const series = radiographs[Object.keys(kinds).indexOf(kind)];
        return route.fulfill({
          contentType: 'application/dicom',
          body: Buffer.from(
            syntheticDicom(
              0,
              1,
              SYNTHETIC_PATIENT_ID,
              undefined,
              undefined,
              undefined,
              { modality: 'DX', sopClass: DX, seriesUid: series.uid },
              undefined,
              kinds[kind]
            )
          ),
        });
      });
      await recordCameras(page);
      const viewer = await openViewer(page);
      const { drawn } = paneTools(page, viewer);
      const measure = async () => {
        await viewer.getByRole('button', { name: 'Distancia', exact: true }).click();
        // The same fraction of each 64 × 64 radiograph, whatever its spacing.
        const box = (await viewer.locator('.dicom-canvas').first().boundingBox())!;
        const side = Math.min(box.width, box.height);
        await page.mouse.move(box.x + box.width / 2 - side / 4, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 + side / 4, box.y + box.height / 2, {
          steps: 12,
        });
        await page.mouse.up();
        // Cornerstone throttles the label: wait until two reads 300 ms apart agree.
        let settled = '';
        await expect
          .poll(async () => {
            const before = (await drawn(0)).text;
            await page.waitForTimeout(300);
            settled = (await drawn(0)).text;
            return /\d/.test(settled) && settled === before;
          })
          .toBe(true);
        return settled;
      };
      const select = async (kind: keyof typeof kinds) => {
        await viewer
          .getByLabel('Serie DICOM')
          .selectOption(radiographs[Object.keys(kinds).indexOf(kind)].uid);
        await expect(viewer.getByRole('button', { name: 'PNG', exact: true })).toBeEnabled({
          timeout: 60000,
        });
      };
      const value = (text: string) => Number(text.match(/(\d+(?:\.\d+)?) (mm|px)/)![1]);
      const detector = await measure();
      expect(detector).toMatch(/^\d+\.\d mm \(en detector\)$/);
      await select('patient');
      const patient = await measure();
      expect(patient).toMatch(/^\d+\.\d mm \(en paciente, ERMF\)$/);
      await select('none');
      const pixels = await measure();
      expect(pixels).toMatch(/^\d+\.\d px \(sin calibrar\)$/);
      expect(pixels).not.toContain('mm');
      // Imager Pixel Spacing 0.2 mm, corrected by ERMF 1.25 to 0.16 mm at the patient.
      expect(value(patient) / value(detector)).toBeCloseTo(0.8, 1);
      expect(value(detector) / value(pixels)).toBeCloseTo(0.2, 1);
      // The first radiograph's distance returns with its series.
      await select('detector');
      await expect.poll(async () => (await drawn(0)).text).toBe(detector);
      await viewer.getByLabel('Medidas (3)', { exact: true }).click();
      await expect(viewer.getByRole('list', { name: 'Lista de medidas' })).toContainText(
        /serie 4, corte 1.*px \(sin calibrar\)/
      );
    });
  });
});
