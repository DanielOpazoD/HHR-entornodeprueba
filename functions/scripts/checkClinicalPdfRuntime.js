#!/usr/bin/env node

const assert = require('node:assert/strict');

const chromiumModule = require('@sparticuz/chromium');
const chromium = chromiumModule.default || chromiumModule;
const puppeteer = require('puppeteer-core');
const { renderPdfFromHtml } = require('../lib/clinicalDocumentPdfRenderFunctions');

const main = async () => {
  assert.equal(typeof chromium.executablePath, 'function');
  assert.ok(Array.isArray(chromium.args) && chromium.args.length > 0);
  assert.equal(typeof puppeteer.defaultArgs, 'function');

  const executablePath = await chromium.executablePath();
  assert.equal(typeof executablePath, 'string');
  assert.ok(executablePath.length > 0);
  const launchArgs = await puppeteer.defaultArgs({ args: chromium.args, headless: 'shell' });
  assert.ok(Array.isArray(launchArgs) && launchArgs.length > 0);

  const pdf = await renderPdfFromHtml(
    '<!doctype html><html><head><style>@page{size:letter;margin:10mm}body{font-family:Arial}</style></head>' +
      '<body><img alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" onerror="document.title=1">HHR PDF runtime</body></html>'
  );
  assert.equal(Buffer.from(pdf).subarray(0, 4).toString('ascii'), '%PDF');

  console.log(
    `[clinical-pdf-runtime] OK (Chromium launched and rendered PDF on ${process.version})`
  );
};

main().catch(error => {
  console.error(`[clinical-pdf-runtime] ${error.message}`);
  process.exit(1);
});
