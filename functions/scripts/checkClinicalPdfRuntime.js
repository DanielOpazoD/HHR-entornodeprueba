#!/usr/bin/env node

const assert = require('node:assert/strict');

const chromiumModule = require('@sparticuz/chromium');
const chromium = chromiumModule.default || chromiumModule;
const puppeteer = require('puppeteer-core');

const main = async () => {
  assert.equal(typeof chromium.executablePath, 'function');
  assert.ok(Array.isArray(chromium.args) && chromium.args.length > 0);
  assert.equal(typeof puppeteer.defaultArgs, 'function');

  const executablePath = await chromium.executablePath();
  const launchArgs = await puppeteer.defaultArgs({ args: chromium.args, headless: 'shell' });
  assert.ok(Array.isArray(launchArgs) && launchArgs.length > 0);

  const browser = await puppeteer.launch({
    args: launchArgs,
    executablePath,
    headless: 'shell',
  });
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><html><body>HHR PDF runtime</body></html>');
    const pdf = await page.pdf({ format: 'letter' });
    assert.equal(Buffer.from(pdf).subarray(0, 4).toString('ascii'), '%PDF');
  } finally {
    await browser.close();
  }

  console.log(
    `[clinical-pdf-runtime] OK (Chromium launched and rendered PDF on ${process.version})`
  );
};

main().catch(error => {
  console.error(`[clinical-pdf-runtime] ${error.message}`);
  process.exit(1);
});
