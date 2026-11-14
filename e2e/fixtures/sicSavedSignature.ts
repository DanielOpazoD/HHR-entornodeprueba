import fs from 'node:fs';
import { expect, type Locator, type Page } from '@playwright/test';
import PizZip from 'pizzip';
import {
  decodePDFRawStream,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
} from 'pdf-lib';

// A geometric blue zigzag, not a real person's signature. No storage writes in this fixture.
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAQCAIAAAD4YuoOAAAAZ0lEQVR4nGP8//8/Ay0BE01NH2gLRC2aKZci4APK7cBnwesTtbgMIiiFAP9hQMS86T82IGLeRIYUHKD4gDzH4gkrBuQgoiRA8NiB4gNa2IEeyVS3A0sqoq4d2JMpelKjQIpxtLAjBAAFHpk3ohUZ5wAAAABJRU5ErkJggg==';
const signatureRgb = () =>
  Uint8Array.from(
    Array.from({ length: 32 * 16 }, (_, i) => {
      const x = i % 32,
        y = Math.floor(i / 32);
      return x >= 3 && x < 29 && (y === 3 + (x % 9) || y === 4 + (x % 9))
        ? [20, 55, 130]
        : [255, 255, 255];
    }).flat()
  );

export const installSavedSicSignature = async (page: Page, owner: string | null) => {
  const reads: string[] = [];
  // Intercept the SDK's getBlob request, not the React hook or either document generator.
  // Reject every other storage read; never contact the configured bucket with this fixture.
  await page.route('https://firebasestorage.googleapis.com/**', async route => {
    const url = decodeURIComponent(route.request().url());
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET',
          'Access-Control-Allow-Headers': '*',
        },
      });
      return;
    }
    if (url.includes('/o/user-signatures/')) reads.push(url);
    expect(route.request().method()).toBe('GET');
    if (owner && url.includes(`/o/user-signatures/${owner}/signature?alt=media`)) {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(PNG_BASE64, 'base64'),
        headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' },
      });
    } else {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 404, message: 'Not Found' } }),
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    }
  });
  return reads;
};

export const assertSavedSicSignatureExports = async (
  page: Page,
  pdfPath: string,
  docxPath: string,
  included = true
) => {
  const pdf = await PDFDocument.load(new Uint8Array(fs.readFileSync(pdfPath)));
  const objects = pdf.getPage(0).node.Resources()?.lookup(PDFName.of('XObject'), PDFDict);
  expect(objects).toBeDefined();
  const images = objects!
    .values()
    .map(ref => pdf.context.lookup(ref))
    .filter(
      (item): item is PDFRawStream =>
        item instanceof PDFRawStream &&
        item.dict.get(PDFName.of('Subtype'))?.toString() === '/Image'
    );
  const signature = images.find(
    item =>
      item.dict.lookup(PDFName.of('Width'), PDFNumber).asNumber() === 32 &&
      item.dict.lookup(PDFName.of('Height'), PDFNumber).asNumber() === 16
  );
  const zip = new PizZip(fs.readFileSync(docxPath));
  const embedded = zip.file('word/media/sic-signature.png');
  if (!included) {
    expect(signature, 'PDF opt-out must omit the signature image').toBeUndefined();
    expect(embedded, 'Word opt-out must omit the signature image').toBeNull();
    return;
  }
  expect(signature, 'PDF contains the saved signature image').toBeDefined();
  expect(Buffer.from(decodePDFRawStream(signature!).decode())).toEqual(Buffer.from(signatureRgb()));
  expect(embedded, 'Word contains the saved signature image').not.toBeNull();
  const decoded = await page.evaluate(async bytes => {
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable');
      ctx.drawImage(image, 0, 0);
      return {
        width: canvas.width,
        height: canvas.height,
        rgba: Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data),
      };
    } finally {
      URL.revokeObjectURL(url);
    }
  }, Array.from(embedded!.asUint8Array()));
  expect([decoded.width, decoded.height]).toEqual([32, 16]);
  expect(decoded.rgba.filter((_, i) => i % 4 !== 3)).toEqual(Array.from(signatureRgb()));
  expect(decoded.rgba.filter((_, i) => i % 4 === 3).every(alpha => alpha === 255)).toBe(true);
  expect(zip.file('word/_rels/document.xml.rels')!.asText()).toContain('media/sic-signature.png');
};

export const logoutDuringSignedSicExport = async (page: Page, editor: Locator) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  let requested!: () => void;
  const requestStarted = new Promise<void>(resolve => {
    requested = resolve;
  });
  const url = '**/docs/biblioteca/solicitud-interconsulta-hhr.docx';
  await page.route(url, async route => {
    requested();
    await gate;
    await route.fulfill({
      status: 200,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      body: fs.readFileSync('public/docs/biblioteca/solicitud-interconsulta-hhr.docx'),
    });
  });
  const lateDownloads: string[] = [];
  page.on('download', file => lateDownloads.push(file.suggestedFilename()));
  await editor.getByRole('button', { name: 'Word (.docx)', exact: true }).click();
  await requestStarted;
  await page.evaluate(() => {
    const channel = new BroadcastChannel('hhr_auth_channel');
    channel.postMessage({ type: 'LOGOUT', reason: 'manual', tabId: 'sic-synthetic-second-tab' });
    channel.close();
  });
  await expect(page.getByTestId('login-google-button')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Firma seleccionada para esta SIC' })).toHaveCount(0);
  const completed = page.waitForResponse(response =>
    response.url().endsWith('/solicitud-interconsulta-hhr.docx')
  );
  release();
  await completed;
  // The template response was released after unmount. Allow the real ZIP generation to finish.
  const downloaded = await page.waitForEvent('download', { timeout: 2000 }).then(
    () => true,
    (error: unknown) => {
      if (error instanceof Error && error.name === 'TimeoutError') return false;
      throw error;
    }
  );
  expect(downloaded).toBe(false);
  expect(lateDownloads).toEqual([]);
};
