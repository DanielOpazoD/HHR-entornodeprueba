import fs from 'node:fs';
import PizZip from 'pizzip';
import { test, expect, type Page } from '@playwright/test';
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
    const response = await route.fetch();
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

test.describe('DICOM viewer and Salvador annexes', () => {
  test.setTimeout(150000);
  test.use({ viewport: { width: 1440, height: 1000 } });
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
    await viewer.getByRole('button', { name: 'Borrar medidas' }).click();
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
          await expect(viewer.getByText(/Los localizadores de planificación/)).toBeVisible();
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
          await expect(viewer.getByText(/Los localizadores de planificación/)).toHaveCount(
            marked ? 1 : 0
          );
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
});
