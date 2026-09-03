// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(path.resolve('extension/content-hhr-patient-documents.js'), 'utf8');

describe('HHR patient documents content bridge', () => {
  it('does not install on an untrusted origin', () => {
    const addEventListener = vi.fn();
    const context = vm.createContext({
      window: {
        location: { origin: 'http://localhost:4000' },
        addEventListener,
        postMessage: vi.fn(),
      },
      chrome: { runtime: { sendMessage: vi.fn() } },
      HhrRayenMessageContract: {
        types: { PATIENT_DOCUMENT_MANAGER_REQUEST: 'RAYEN_PATIENT_DOCUMENT_MANAGER_REQUEST' },
      },
    });

    vm.runInContext(source, context, { filename: 'content-hhr-patient-documents.js' });
    expect(addEventListener).not.toHaveBeenCalled();
  });

  it.each(['http://localhost:3000', 'http://localhost:3001'])(
    'forwards the manager request from trusted origin %s',
    async origin => {
      let onMessage:
        | ((event: { source: unknown; data: Record<string, unknown> }) => void)
        | undefined;
      const sendMessage = vi.fn(async () => ({ ok: true, count: 2 }));
      const postMessage = vi.fn();
      const windowObject = {
        location: { origin },
        addEventListener: vi.fn((type: string, listener: typeof onMessage) => {
          if (type === 'message') onMessage = listener;
        }),
        postMessage,
      };
      const context = vm.createContext({
        window: windowObject,
        chrome: { runtime: { sendMessage } },
        console: { warn: vi.fn() },
        HhrRayenMessageContract: {
          types: { PATIENT_DOCUMENT_MANAGER_REQUEST: 'RAYEN_PATIENT_DOCUMENT_MANAGER_REQUEST' },
        },
      });
      vm.runInContext(source, context, { filename: 'content-hhr-patient-documents.js' });

      onMessage?.({
        source: windowObject,
        data: {
          type: 'HHR_RAYEN_PATIENT_DOCUMENT_MANAGER_REQUEST',
          reqId: 'docs-1',
          encId: '141121',
          operation: 'count',
          routeHint: 'nurse',
        },
      });
      await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce());
      expect(sendMessage).toHaveBeenCalledWith({
        type: 'RAYEN_PATIENT_DOCUMENT_MANAGER_REQUEST',
        encId: '141121',
        operation: 'count',
        routeHint: 'nurse',
      });
      await vi.waitFor(() =>
        expect(postMessage).toHaveBeenCalledWith(
          {
            type: 'HHR_RAYEN_PATIENT_DOCUMENT_MANAGER_RESULT',
            reqId: 'docs-1',
            ok: true,
            count: 2,
            opened: false,
            reused: false,
            error: undefined,
          },
          origin
        )
      );
    }
  );
});
