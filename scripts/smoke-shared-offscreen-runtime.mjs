/** Real MV3 integration, not mocks. Never launches a clinical/user browser. */
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startFixtureProxy } from './fixtures/shared-offscreen/fixture-proxy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = path.join(root, 'scripts/fixtures/shared-offscreen');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'hhr-offscreen-smoke-'));
const extensionPath = path.join(temporary, 'extension');
const checks = [];
let network;
let proxy;
let context;
let phase = 'prepare';
let result;
const deadline = setTimeout(() => {
  console.error(JSON.stringify({ status: 'failed', phase, code: 'SMOKE_DEADLINE' }));
  // Closing Chromium unblocks pending evaluations; finally removes the profile.
  void context?.close().catch(() => {});
}, 75_000);

try {
  await cp(path.join(root, 'extension'), extensionPath, { recursive: true });
  const htmlPath = path.join(extensionPath, 'syslab-offscreen.html');
  const html = await readFile(htmlPath, 'utf8');
  const bootstrap = '<script src="syslab-offscreen.js"></script>';
  assert.equal(html.split(bootstrap).length, 2, 'Expected exactly one offscreen bootstrap');
  await cp(path.join(fixtures, 'router-fixture.js'), path.join(extensionPath, 'smoke-router-fixture.js'));
  await writeFile(htmlPath, html.replace(bootstrap,
    `<script src="smoke-router-fixture.js"></script>\n    ${bootstrap}`));
  const fixtureHtml = await readFile(path.join(fixtures, 'syslab.html'), 'utf8');
  const manifest = JSON.parse(await readFile(path.join(extensionPath, 'manifest.json'), 'utf8'));
  phase = 'fixture-proxy';
  proxy = await startFixtureProxy({ fixtureHtml });
  network = proxy.network;
  phase = 'launch';
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    channel: 'chromium', headless: true, timeout: 20_000,
    args: [
      `--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`,
      // Offscreen targets are not Playwright Pages. Route all HTTP through a
      // loopback fixture proxy that never forwards anything (including CONNECT).
      `--proxy-server=${proxy.url}`, '--proxy-bypass-list=<-loopback>',
      '--disable-quic',
      '--disable-background-networking',
    ],
  });
  // Model a session already established in a first-party Syslab tab. A cross-site
  // HTTP iframe cannot reliably establish a new SameSite=Lax cookie itself.
  await context.addCookies([{ name: 'hhr_smoke_session', value: 'synthetic-only',
    url: 'http://10.4.69.90/syslab/', sameSite: 'Lax' }]);
  const cookiesBefore = await context.cookies('http://10.4.69.90/syslab/');
  assert.equal(cookiesBefore.length, 1, 'Expected exactly one seeded synthetic cookie');
  assert.equal(cookiesBefore[0].name, 'hhr_smoke_session');
  assert.equal(cookiesBefore[0].value, 'synthetic-only');
  const worker = context.serviceWorkers()[0] ||
    await context.waitForEvent('serviceworker', { timeout: 15_000 });
  assert.equal(new URL(worker.url()).pathname, `/${manifest.background.service_worker}`);
  phase = 'native-api';
  const initial = await worker.evaluate(async () => ({
    contract: self.HhrOffscreenContract,
    coordinator: typeof offscreenCoordinator?.request,
    contexts: await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }),
    create: typeof chrome.offscreen.createDocument,
    close: typeof chrome.offscreen.closeDocument,
  }));
  assert.equal(initial.coordinator, 'function');
  assert.equal(initial.create, 'function');
  assert.equal(initial.close, 'function');
  assert.equal(initial.contract.version, 1);
  assert.equal(initial.contract.target, 'hhr-shared-offscreen');
  assert.equal(initial.contract.documentPath, 'syslab-offscreen.html');
  assert.equal(initial.contexts.length, 0);
  checks.push('native-api-empty-start');

  phase = 'shared-creation-correlation';
  const simultaneous = await worker.evaluate(async () => {
    const order = [];
    const values = await Promise.all([600, 300, 0].map((delayMs, i) =>
      offscreenCoordinator.request('fixture', { token: `parallel-${i}`, delayMs })
        .then(value => { order.push(value.token); return value; })));
    return { values, order, ready: await offscreenCoordinator.ensure(),
      contexts: await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }) };
  });
  assert.deepEqual(simultaneous.values.map(value => value.token), ['parallel-0', 'parallel-1', 'parallel-2']);
  assert.deepEqual(simultaneous.order, ['parallel-2', 'parallel-1', 'parallel-0']);
  assert.equal(simultaneous.contexts.length, 1);
  assert.equal(new URL(simultaneous.contexts[0].documentUrl).pathname, '/syslab-offscreen.html');
  checks.push('simultaneous-creation-single-document', 'reversed-response-correlation');

  const request = (channel, payload, timeoutMs = 5000) => worker.evaluate(
    ({ channel, payload, timeoutMs }) => offscreenCoordinator.request(channel, payload, { timeoutMs }),
    { channel, payload, timeoutMs });
  const inspect = () => request('fixture', { op: 'diagnostics' });
  async function until(predicate, label, timeoutMs = 7000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (await predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.fail(label);
  }
  phase = 'syslab-real-content-bridge';
  let status;
  await until(async () => {
    try { status = await request('syslab', { type: 'RAYEN_SYSLAB_STATUS' }, 800); }
    catch { return false; }
    return status?.ok && typeof status.bridgeId === 'string';
  }, 'Real Syslab content bridge did not become ready');
  assert.equal(status.loginRequired, false, 'Synthetic status unexpectedly requires login');
  assert.equal(status.url, 'http://10.4.69.90/syslab/', 'Real content bridge reported another location');
  assert.ok(network.fixtureDocuments > 0, 'Syslab HTTP was not intercepted');
  const sessionBefore = await request('fixture', { op: 'session' });
  // Cross-site HTTP cookie visibility is Chrome policy, not coordinator state.
  // Assert storage conservation independently instead of disabling that policy.
  assert.equal(typeof sessionBefore.cookiePresent, 'boolean');
  assert.match(sessionBefore.sessionId, /^synthetic-/);
  checks.push('syslab-status-real-manifest-content-bridge');

  phase = 'timeout-cancellation-late-completion';
  await worker.evaluate(() => {
    const outcome = promise => promise.then(value => ({ value }), error => ({ code: error.code }));
    self.smokeAbort = new AbortController();
    self.smokeTimed = outcome(offscreenCoordinator.request('fixture',
      { token: 'late-timeout', delayMs: 1300 }, { timeoutMs: 500 }));
    self.smokeCancelled = outcome(offscreenCoordinator.request('fixture',
      { token: 'late-cancel', delayMs: 1300 }, { signal: self.smokeAbort.signal }));
  });
  await until(async () => {
    const { events } = await inspect();
    return events.includes('started:late-timeout') && events.includes('started:late-cancel');
  }, 'Cancellation requests were not dispatched');
  const outcomes = await worker.evaluate(async () => {
    self.smokeAbort.abort();
    return Promise.all([self.smokeTimed, self.smokeCancelled]);
  });
  assert.deepEqual(outcomes, [{ code: 'OFFSCREEN_TIMEOUT' }, { code: 'OFFSCREEN_ABORTED' }]);
  const unaffected = await request('fixture', { token: 'unaffected', delayMs: 1500 });
  assert.equal(unaffected.token, 'unaffected');
  const late = await inspect();
  for (const token of ['late-timeout', 'late-cancel']) {
    assert.ok(late.events.includes(`aborted:${token}`));
    assert.ok(late.events.includes(`completed:${token}`));
  }
  assert.equal(late.router.inflight, 1, 'Only the diagnostics request should be active');
  const handlerError = await worker.evaluate(async () => {
    try { await offscreenCoordinator.request('fixture', { op: 'error', token: 'error' }); }
    catch (error) { return error.code; }
  });
  assert.equal(handlerError, 'HANDLER_ERROR');
  checks.push('timeout-cancel-late-no-cross-talk', 'handler-error-propagation');

  phase = 'session-and-independent-adoption';
  const adopted = await worker.evaluate(async () => {
    self.smokeAdopted = self.HhrOffscreenCoordinator.create({ chrome });
    const ready = await self.smokeAdopted.ensure();
    const echo = await self.smokeAdopted.request('fixture', { token: 'adopted' });
    const original = await offscreenCoordinator.ensure();
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    return { ready, original, echo, contexts };
  });
  assert.equal(adopted.ready.documentId, simultaneous.ready.documentId);
  assert.equal(adopted.original.documentId, simultaneous.ready.documentId);
  assert.equal(adopted.contexts.length, 1);
  assert.equal(adopted.contexts[0].contextId, simultaneous.contexts[0].contextId);
  assert.equal(adopted.echo.token, 'adopted');
  assert.deepEqual(await request('fixture', { op: 'session' }), sessionBefore);
  assert.deepEqual(await context.cookies('http://10.4.69.90/syslab/'), cookiesBefore,
    'Adoption and concurrent work must preserve the existing browser cookie');
  const statusAfter = await request('syslab', { type: 'RAYEN_SYSLAB_STATUS' });
  assert.equal(statusAfter.bridgeId, status.bridgeId);
  assert.equal(statusAfter.loginRequired, false);
  assert.equal(network.fixtureDocuments, 1, 'Reinitialization must not navigate or create another iframe');
  checks.push('cookie-store-iframe-session-bridge-preserved', 'independent-coordinator-adoption-not-worker-restart');

  phase = 'active-close-force-recreate';
  await worker.evaluate(() => {
    self.smokeActive = offscreenCoordinator.request('fixture', { token: 'force-active', delayMs: 5000 })
      .then(() => ({ unexpectedSuccess: true }), error => ({ code: error.code }));
  });
  await until(async () => (await inspect()).events.includes('started:force-active'), 'Active request not dispatched');
  const normalClose = await worker.evaluate(async () => {
    try { await offscreenCoordinator.close(); }
    catch (error) { return { code: error.code,
      contexts: await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }) }; }
  });
  assert.equal(normalClose.code, 'OFFSCREEN_ACTIVE_REQUESTS');
  assert.equal(normalClose.contexts.length, 1);
  const forced = await worker.evaluate(async () => {
    await offscreenCoordinator.close({ force: true });
    return { outcome: await self.smokeActive,
      contexts: await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }),
      diagnostics: offscreenCoordinator.getDiagnostics() };
  });
  assert.deepEqual(forced.outcome, { code: 'OFFSCREEN_CLOSED' });
  assert.equal(forced.contexts.length, 0);
  assert.equal(forced.diagnostics.pending, 0);
  const recreated = await worker.evaluate(async () => {
    const ready = await offscreenCoordinator.ensure();
    const echo = await offscreenCoordinator.request('fixture', { token: 'recreated' });
    return { ready, echo,
      contexts: await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }) };
  });
  assert.notEqual(recreated.ready.documentId, simultaneous.ready.documentId);
  assert.notEqual(recreated.contexts[0].contextId, simultaneous.contexts[0].contextId);
  assert.equal(recreated.contexts.length, 1);
  assert.equal(recreated.echo.token, 'recreated');
  const closed = await worker.evaluate(async () => {
    await offscreenCoordinator.close();
    return { contexts: await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }),
      diagnostics: offscreenCoordinator.getDiagnostics() };
  });
  assert.equal(closed.contexts.length, 0);
  assert.equal(closed.diagnostics.pending, 0);
  assert.equal(network.unexpectedSyslab, 0, 'Unexpected Syslab request was blocked');
  checks.push('normal-close-refuses-active', 'forced-close-cancels', 'recreate-new-document', 'native-close-empty');
  result = { status: 'passed', chromium: context.browser()?.version(), mv3: manifest.version,
    checks, network, diagnostics: closed.diagnostics,
    sessionCoverage: { cookieStorePreserved: true,
      iframeCookieVisible: sessionBefore.cookiePresent, authenticatedHospitalSession: false },
    restartCoverage: 'new coordinator instance in same worker, not an actual worker restart' };
} catch (error) {
  const launchBlocked = phase === 'launch' && /Executable doesn't exist|EACCES|EPERM|Operation not permitted|Permission denied|bootstrap_check_in|Target page, context or browser has been closed/.test(String(error));
  const launchReason = phase === 'launch' ? String(error).match(
    /Executable doesn't exist[^\n]*|EACCES[^\n]*|EPERM[^\n]*|Operation not permitted[^\n]*|Permission denied[^\n]*|bootstrap_check_in[^\n]*/
  )?.[0] : undefined;
  result = { status: launchBlocked ? 'blocked' : 'failed', phase,
    code: error.code || error.name, message: String(error.message).split('\n')[0],
    ...(error.code === 'ERR_ASSERTION' ? {
      actual: typeof error.actual === 'boolean' ? error.actual : typeof error.actual,
      expected: typeof error.expected === 'boolean' ? error.expected : typeof error.expected,
    } : {}),
    ...(launchReason ? { launchReason } : {}), checks, network };
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  try {
    try { await context?.close(); }
    finally {
      try { await proxy?.close(); }
      finally { await rm(temporary, { recursive: true, force: true }); }
    }
    result.cleanup = 'complete';
  } catch {
    result.status = 'failed';
    result.cleanup = 'failed';
    process.exitCode = 1;
  }
}
console.log(JSON.stringify(result));
