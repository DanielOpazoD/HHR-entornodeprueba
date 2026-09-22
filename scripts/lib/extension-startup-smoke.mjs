import assert from 'node:assert/strict';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** Exercise failed importScripts in a real, isolated MV3 worker without clinical traffic. */
export async function assertExtensionStartupFailure(chromium, sourcePath) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hhr-startup-boundary-'));
  let context;
  try {
    const extensionPath = path.join(root, 'extension');
    await cp(sourcePath, extensionPath, { recursive: true });
    await writeFile(
      path.join(extensionPath, 'background.js'),
      "throw new Error('synthetic private startup detail');\n"
    );
    context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    const worker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent('serviceworker', { timeout: 30_000 }));
    const page = await context.newPage();
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/extension-status.html`);
    const reply = await page.evaluate(() =>
      chrome.runtime.sendMessage({
        type: 'RAYEN_EXTENSION_HEALTH_REQUEST',
      })
    );
    assert.equal(reply.errorCode, 'EXTENSION_STARTUP_FAILED');
    assert.equal(reply.ok, false);
    assert.equal(reply.runtimeGeneration, undefined);
    assert.ok(!JSON.stringify(reply).includes('synthetic private'));
    console.log('MV3 startup failure remains observable without exposing module error details.');
  } finally {
    await context?.close();
    await rm(root, { recursive: true, force: true });
  }
}
