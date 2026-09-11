// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred, fixture, flush } from './offscreenCoordinatorTestHarness';

describe('shared offscreen coordinator', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('single-flights concurrent creation and demultiplexes out-of-order channel results', async () => {
    const f = fixture();
    const first = f.coordinator.request('syslab', { secret: 'one' });
    const second = f.coordinator.request('pdf', { secret: 'two' });
    expect(f.coordinator.getDiagnostics().pending).toBe(2);
    await flush();
    expect(f.chrome.offscreen.createDocument).toHaveBeenCalledExactlyOnceWith({
      url: 'syslab-offscreen.html',
      reasons: ['IFRAME_SCRIPTING'],
      justification: expect.any(String),
    });
    expect(f.chrome.runtime.getContexts).toHaveBeenCalledWith({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
    });
    const [a, b] = f.requests;
    expect(a.message).toMatchObject({
      target: 'hhr-shared-offscreen',
      version: 1,
      documentId: 'document-1',
      channel: 'syslab',
    });
    b.result.resolve(f.reply(b.message, 'B'));
    await expect(second).resolves.toBe('B');
    a.result.resolve(f.reply(a.message, 'A'));
    await expect(first).resolves.toBe('A');
    expect(f.coordinator.getDiagnostics()).toMatchObject({ pending: 0, completed: 2 });
    expect(JSON.stringify(f.coordinator.getDiagnostics())).not.toMatch(
      /secret|one|two|payload|document-1/
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['requestId', 'documentId', 'version'])(
    'rejects a mismatched %s without redispatch',
    async key => {
      const f = fixture();
      const result = f.coordinator.request('pdf', {});
      const assertion = expect(result).rejects.toMatchObject({
        code: 'OFFSCREEN_INVALID_RESPONSE',
      });
      await flush();
      const request = f.requests[0];
      request.result.resolve({ ...f.reply(request.message), [key]: 'wrong' });
      await assertion;
      expect(f.requests).toHaveLength(1);
      expect(f.coordinator.getDiagnostics().pending).toBe(0);
    }
  );

  it('propagates remote structured failures and does not replay ambiguous transport errors', async () => {
    const f = fixture();
    const remote = f.coordinator.request('pdf', {});
    const failed = expect(remote).rejects.toMatchObject({
      code: 'PDF_INVALID',
      message: 'Invalid PDF',
    });
    await flush();
    f.requests[0].result.resolve({
      ...f.reply(f.requests[0].message),
      ok: false,
      error: { code: 'PDF_INVALID', message: 'Invalid PDF' },
    });
    await failed;
    const transport = f.coordinator.request('syslab', {});
    const lost = expect(transport).rejects.toMatchObject({ code: 'OFFSCREEN_TRANSPORT_FAILED' });
    await flush();
    f.requests[1].result.reject(new Error('sensitive transport text'));
    await lost;
    expect(f.requests).toHaveLength(2);
  });

  it('aborts before admission without creating a document', async () => {
    const f = fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(
      f.coordinator.request('pdf', {}, { signal: controller.signal })
    ).rejects.toMatchObject({ code: 'OFFSCREEN_ABORTED' });
    expect(f.chrome.offscreen.createDocument).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['abort', 'timeout'])(
    'cleans up %s and ignores late and duplicate settlement',
    async mode => {
      const f = fixture();
      const controller = new AbortController();
      const remove = vi.spyOn(controller.signal, 'removeEventListener');
      const result = f.coordinator.request(
        'pdf',
        {},
        { signal: controller.signal, timeoutMs: 250 }
      );
      const assertion = expect(result).rejects.toMatchObject({
        code: mode === 'abort' ? 'OFFSCREEN_ABORTED' : 'OFFSCREEN_TIMEOUT',
      });
      await flush();
      if (mode === 'abort') controller.abort();
      else await vi.advanceTimersByTimeAsync(250);
      await assertion;
      await flush();
      expect(f.chrome.runtime.sendMessage).toHaveBeenCalledWith({
        target: 'hhr-shared-offscreen',
        version: 1,
        action: 'cancel',
        requestId: f.requests[0].message.requestId,
        documentId: 'document-1',
      });
      f.requests[0].result.resolve(f.reply(f.requests[0].message, 'late'));
      f.requests[0].result.resolve(f.reply(f.requests[0].message, 'duplicate'));
      await flush();
      expect(f.coordinator.getDiagnostics()).toMatchObject({ pending: 0, completed: 0, failed: 1 });
      expect(remove).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it('limits admission to 32 including requests waiting for a stuck discovery', async () => {
    const f = fixture();
    f.chrome.runtime.getContexts.mockImplementation(() => new Promise(() => {}));
    const all = Array.from({ length: 32 }, () =>
      f.coordinator.request('pdf', {}, { timeoutMs: 250 }).catch(error => error.code)
    );
    await expect(f.coordinator.request('pdf', {})).rejects.toMatchObject({
      code: 'OFFSCREEN_BUSY',
    });
    expect(f.coordinator.getDiagnostics().pending).toBe(32);
    await vi.advanceTimersByTimeAsync(250);
    expect(await Promise.all(all)).toEqual(Array(32).fill('OFFSCREEN_TIMEOUT'));
    expect(f.coordinator.getDiagnostics().pending).toBe(0);
    expect(f.requests).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('counts ensure time in the deadline and never dispatches an expired request', async () => {
    const f = fixture();
    const creation = deferred<void>();
    const original = f.chrome.offscreen.createDocument.getMockImplementation()!;
    f.chrome.offscreen.createDocument.mockImplementation(async () => {
      await creation.promise;
      await original();
    });
    const result = f.coordinator.request('pdf', {}, { timeoutMs: 250 });
    const assertion = expect(result).rejects.toMatchObject({ code: 'OFFSCREEN_TIMEOUT' });
    await flush();
    await vi.advanceTimersByTimeAsync(250);
    await assertion;
    creation.resolve();
    await flush();
    expect(f.requests).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('adopts the existing shared document across coordinator restarts without closing', async () => {
    const f = fixture(true);
    await f.coordinator.ensure();
    await f.create().ensure();
    expect(f.chrome.offscreen.createDocument).not.toHaveBeenCalled();
    expect(f.chrome.offscreen.closeDocument).not.toHaveBeenCalled();
    expect(f.chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('never creates over or destroys a foreign document', async () => {
    const f = fixture();
    f.setContexts([{ contextId: 'other', documentUrl: 'chrome-extension://test/foreign.html' }]);
    await expect(f.coordinator.ensure()).rejects.toMatchObject({
      code: 'OFFSCREEN_FOREIGN_DOCUMENT',
    });
    await expect(f.coordinator.close({ force: true })).rejects.toMatchObject({
      code: 'OFFSCREEN_FOREIGN_DOCUMENT',
    });
    expect(f.chrome.offscreen.createDocument).not.toHaveBeenCalled();
    expect(f.chrome.offscreen.closeDocument).not.toHaveBeenCalled();
  });

  it('rejects normal close from entry and force closes after creation finishes', async () => {
    const f = fixture();
    const creation = deferred<void>();
    const original = f.chrome.offscreen.createDocument.getMockImplementation()!;
    f.chrome.offscreen.createDocument.mockImplementation(async () => {
      await creation.promise;
      await original();
    });
    const result = f.coordinator.request('pdf', {});
    const assertion = expect(result).rejects.toMatchObject({ code: 'OFFSCREEN_CLOSED' });
    await expect(f.coordinator.close()).rejects.toMatchObject({
      code: 'OFFSCREEN_ACTIVE_REQUESTS',
    });
    await flush();
    const closed = f.coordinator.close({ force: true });
    await assertion;
    await expect(f.coordinator.ensure()).rejects.toMatchObject({ code: 'OFFSCREEN_CLOSING' });
    expect(f.chrome.offscreen.closeDocument).not.toHaveBeenCalled();
    creation.resolve();
    await closed;
    expect(f.chrome.offscreen.closeDocument).toHaveBeenCalledOnce();
    expect(f.requests).toHaveLength(0);
    await f.coordinator.ensure();
    expect(f.chrome.offscreen.createDocument).toHaveBeenCalledTimes(2);
  });

  it('force cancels dispatched work and ignores responses after a new generation starts', async () => {
    const f = fixture();
    const result = f.coordinator.request('pdf', {});
    const assertion = expect(result).rejects.toMatchObject({ code: 'OFFSCREEN_CLOSED' });
    await flush();
    await f.coordinator.close({ force: true });
    await assertion;
    f.replace('document-2');
    await f.coordinator.ensure();
    f.requests[0].result.resolve(f.reply(f.requests[0].message, 'old'));
    await flush();
    expect(f.coordinator.getDiagnostics()).toMatchObject({ completed: 0, pending: 0, ready: true });
    expect(f.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cancel' })
    );
  });

  it('discovers external recreation and rejects old generation work', async () => {
    const f = fixture(true);
    const result = f.coordinator.request('pdf', {});
    const assertion = expect(result).rejects.toMatchObject({ code: 'OFFSCREEN_STALE_GENERATION' });
    await flush();
    f.replace('document-2');
    await expect(f.coordinator.ensure()).resolves.toMatchObject({ documentId: 'document-2' });
    await assertion;
    f.requests[0].result.resolve(f.reply(f.requests[0].message));
    await flush();
    expect(f.coordinator.getDiagnostics().completed).toBe(0);
  });

  it('fails closed without getContexts instead of relying on hasDocument', async () => {
    const f = fixture();
    Object.assign(f.chrome.runtime, { getContexts: undefined });
    await expect(f.coordinator.ensure()).rejects.toMatchObject({ code: 'OFFSCREEN_UNSUPPORTED' });
    expect(f.chrome.offscreen.createDocument).not.toHaveBeenCalled();
  });

  it.each(['discovery', 'create', 'close'])(
    'handles %s API rejection without exposing its details',
    async api => {
      const f = fixture(api === 'close');
      const method =
        api === 'discovery'
          ? f.chrome.runtime.getContexts
          : api === 'create'
            ? f.chrome.offscreen.createDocument
            : f.chrome.offscreen.closeDocument;
      method.mockRejectedValueOnce(new Error('secret credential'));
      const result = api === 'close' ? f.coordinator.close() : f.coordinator.ensure();
      await expect(result).rejects.toMatchObject({ code: `OFFSCREEN_${api.toUpperCase()}_FAILED` });
      expect(JSON.stringify(f.coordinator.getDiagnostics())).not.toContain('secret');
      await expect(f.coordinator.ensure()).resolves.toMatchObject({ documentId: 'document-1' });
    }
  );

  it.each(['mismatch', 'rejected', 'timeout'])(
    'bounds and validates %s handshakes before dispatch',
    async mode => {
      const f = fixture(true);
      if (mode === 'timeout')
        f.chrome.runtime.sendMessage.mockImplementation(() => new Promise(() => {}));
      else if (mode === 'rejected')
        f.chrome.runtime.sendMessage.mockRejectedValue(new Error('sensitive'));
      else
        f.chrome.runtime.sendMessage.mockResolvedValue({
          version: 2,
          ok: true,
          result: { ready: true },
        });
      const result = f.coordinator.request('pdf', {}, { timeoutMs: 5000 });
      const assertion = expect(result).rejects.toMatchObject({
        code: mode === 'timeout' ? 'OFFSCREEN_HANDSHAKE_TIMEOUT' : 'OFFSCREEN_INVALID_HANDSHAKE',
      });
      await flush();
      if (mode === 'timeout') await vi.advanceTimersByTimeAsync(3000);
      await assertion;
      expect(f.requests).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
    }
  );
  it('invalidates old work immediately when replacement discovery precedes a slow probe', async () => {
    const f = fixture(true);
    const result = f.coordinator.request('pdf', {});
    const rejected = expect(result).rejects.toMatchObject({ code: 'OFFSCREEN_STALE_GENERATION' });
    await flush();
    f.replace('document-2');
    const probe = deferred();
    const original = f.chrome.runtime.sendMessage.getMockImplementation()!;
    f.chrome.runtime.sendMessage.mockImplementation(message =>
      message.action === 'probe' ? probe.promise : original(message)
    );
    const ensuring = f.coordinator.ensure();
    await flush();
    await rejected;
    f.requests[0].result.resolve(f.reply(f.requests[0].message, 'stale'));
    const probeMessage = f.chrome.runtime.sendMessage.mock.calls
      .map(([message]) => message)
      .filter(message => message.action === 'probe')
      .at(-1)!;
    probe.resolve(f.reply(probeMessage, { ready: true }));
    await ensuring;
    expect(f.coordinator.getDiagnostics().completed).toBe(0);
  });

  it('aborting one caller during ensure preserves another caller and cleans its listener', async () => {
    const f = fixture(true);
    const discovery = deferred<Awaited<ReturnType<typeof f.chrome.runtime.getContexts>>>();
    f.chrome.runtime.getContexts.mockReturnValueOnce(discovery.promise);
    const controller = new AbortController();
    const first = f.coordinator.request('pdf', {}, { signal: controller.signal });
    const rejected = expect(first).rejects.toMatchObject({ code: 'OFFSCREEN_ABORTED' });
    const second = f.coordinator.request('syslab', {});
    await flush();
    controller.abort();
    await rejected;
    discovery.resolve([
      { contextId: 'context-1', documentUrl: 'chrome-extension://test/syslab-offscreen.html' },
    ]);
    await flush();
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0].message.channel).toBe('syslab');
    f.requests[0].result.resolve(f.reply(f.requests[0].message, 'kept'));
    await expect(second).resolves.toBe('kept');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('serializes a normal close racing ensure without destroying a newly foreign document', async () => {
    const f = fixture(true);
    const discovery = deferred<Awaited<ReturnType<typeof f.chrome.runtime.getContexts>>>();
    f.chrome.runtime.getContexts.mockReturnValueOnce(discovery.promise);
    const ensuring = f.coordinator.ensure();
    const rejected = expect(ensuring).rejects.toMatchObject({ code: 'OFFSCREEN_STALE_GENERATION' });
    await flush();
    const closing = f.coordinator.close();
    const blocked = expect(closing).rejects.toMatchObject({ code: 'OFFSCREEN_FOREIGN_DOCUMENT' });
    f.setContexts([{ contextId: 'foreign', documentUrl: 'chrome-extension://test/other.html' }]);
    discovery.resolve([]);
    await rejected;
    await blocked;
    expect(f.chrome.offscreen.closeDocument).not.toHaveBeenCalled();
    expect(f.chrome.offscreen.createDocument).not.toHaveBeenCalled();
  });

  it.each([0, 900000])('clamps timeout %s to contract bounds', async input => {
    const f = fixture(true);
    const timeout = input === 0 ? 250 : 601000;
    const result = f.coordinator.request('pdf', {}, { timeoutMs: input });
    const rejected = expect(result).rejects.toMatchObject({ code: 'OFFSCREEN_TIMEOUT' });
    await flush();
    expect(f.requests[0].message.timeoutMs).toBe(timeout);
    await vi.advanceTimersByTimeAsync(timeout - 1);
    expect(f.coordinator.getDiagnostics().pending).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
  });

  it('fails closed on malformed discovery and missing offscreen API', async () => {
    const f = fixture();
    f.chrome.runtime.getContexts.mockResolvedValueOnce(null as never);
    await expect(f.coordinator.ensure()).rejects.toMatchObject({
      code: 'OFFSCREEN_DISCOVERY_FAILED',
    });
    Object.assign(f.chrome.offscreen, { createDocument: undefined });
    await expect(f.coordinator.ensure()).rejects.toMatchObject({ code: 'OFFSCREEN_UNSUPPORTED' });
    expect(f.chrome.offscreen.closeDocument).not.toHaveBeenCalled();
  });
});
