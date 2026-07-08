import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_NETLIFY_FUNCTION_DEV_ENTRIES,
  NETLIFY_FUNCTION_DEV_EXTERNAL_MODULES,
  handleNetlifyFunctionDevRequest,
  hydrateLocalFunctionEnv,
  resolveTsconfigAliasPath,
} from '../../../scripts/config/netlifyFunctionDevServer';

const createReadableRequest = ({
  body = '',
  headers = {},
  method = 'POST',
  url,
}: {
  body?: string;
  headers?: Record<string, string>;
  method?: string;
  url: string;
}) => {
  const request = Readable.from(body ? [body] : []);
  return Object.assign(request, {
    headers,
    method,
    url,
  });
};

const createResponse = () => {
  const headers = new Map<string, string | number | readonly string[]>();
  return {
    body: '',
    ended: false,
    headers,
    statusCode: 200,
    setHeader(name: string, value: string | number | readonly string[]) {
      headers.set(name, value);
    },
    end(body?: string | Buffer) {
      this.body = Buffer.isBuffer(body) ? body.toString('utf8') : body || '';
      this.ended = true;
    },
  };
};

describe('netlifyFunctionDevServer', () => {
  it('hydrates local Vite AI and Firebase env names for function runtime', () => {
    const target: NodeJS.ProcessEnv = {};

    hydrateLocalFunctionEnv(
      {
        VITE_FIREBASE_API_KEY: 'firebase-key',
        VITE_FIREBASE_APP_ID: 'firebase-app',
        VITE_FIREBASE_PROJECT_ID: 'firebase-project',
        VITE_LOCAL_AI_PROVIDER: 'gemini',
        VITE_LOCAL_GEMINI_API_KEY: 'gemini-local-key',
      },
      target
    );

    expect(target.AI_PROVIDER).toBe('gemini');
    expect(target.GEMINI_API_KEY).toBe('gemini-local-key');
    expect(target.VITE_FIREBASE_API_KEY).toBe('firebase-key');
    expect(target.VITE_FIREBASE_APP_ID).toBe('firebase-app');
    expect(target.VITE_FIREBASE_PROJECT_ID).toBe('firebase-project');
    expect(target.HHR_ALLOW_PRESCRIPTION_IMAGE_PROXY_FIXTURE).toBe('true');
  });

  it('does not override server-side AI env vars with local Vite fallbacks', () => {
    const target: NodeJS.ProcessEnv = {
      AI_PROVIDER: 'openai',
      GEMINI_API_KEY: 'server-gemini-key',
      OPENAI_API_KEY: 'server-openai-key',
    };

    hydrateLocalFunctionEnv(
      {
        VITE_LOCAL_AI_PROVIDER: 'gemini',
        VITE_LOCAL_GEMINI_API_KEY: 'gemini-local-key',
        VITE_LOCAL_OPENAI_API_KEY: 'openai-local-key',
      },
      target
    );

    expect(target.AI_PROVIDER).toBe('openai');
    expect(target.GEMINI_API_KEY).toBe('server-gemini-key');
    expect(target.OPENAI_API_KEY).toBe('server-openai-key');
  });

  it('serves the clinical document import function from Vite dev server', async () => {
    const requestBody = JSON.stringify({ sourceText: 'Informe de traslado con indicaciones.' });
    const request = createReadableRequest({
      body: requestBody,
      headers: {
        authorization: 'Bearer test-token',
        'content-type': 'application/json',
      },
      url: '/.netlify/functions/clinical-document-ai-import?trace=1',
    });
    const response = createResponse();
    const next = vi.fn();
    const handler = vi.fn(async event => ({
      statusCode: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        method: event.httpMethod,
        body: event.body,
        path: event.path,
        query: event.rawQuery,
      }),
    }));
    const loadModule = vi.fn(async () => ({ handler }));
    const server = {
      ssrFixStacktrace: vi.fn(),
    };

    await handleNetlifyFunctionDevRequest({
      entries: DEFAULT_NETLIFY_FUNCTION_DEV_ENTRIES,
      loadModule,
      next,
      req: request as unknown as IncomingMessage,
      res: response as unknown as ServerResponse,
      server,
    });

    expect(next).not.toHaveBeenCalled();
    expect(loadModule).toHaveBeenCalledWith('/netlify/functions/clinical-document-ai-import.ts');
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        body: requestBody,
        headers: expect.objectContaining({
          authorization: 'Bearer test-token',
          'content-type': 'application/json',
        }),
        httpMethod: 'POST',
        path: '/.netlify/functions/clinical-document-ai-import',
        rawQuery: 'trace=1',
      })
    );
    expect(response.statusCode).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(JSON.parse(response.body)).toEqual({
      body: requestBody,
      method: 'POST',
      path: '/.netlify/functions/clinical-document-ai-import',
      query: 'trace=1',
    });
  });

  it('registers the prescription image proxy and externalizes native sharp in local dev', () => {
    expect(DEFAULT_NETLIFY_FUNCTION_DEV_ENTRIES).toContainEqual({
      route: '/.netlify/functions/prescription-image-proxy',
      modulePath: '/netlify/functions/prescription-image-proxy.ts',
    });
    expect(NETLIFY_FUNCTION_DEV_EXTERNAL_MODULES).toContain('sharp');
  });

  it('resolves extensionless tsconfig aliases to source files for esbuild', () => {
    const resolvedPath = resolveTsconfigAliasPath(
      '@/features/clinical-documents/controllers/clinicalDocumentAiImportController',
      process.cwd()
    );

    expect(resolvedPath).toMatch(/clinicalDocumentAiImportController\.ts$/);
  });

  it('delegates non-function routes back to Vite', async () => {
    const request = createReadableRequest({ method: 'GET', url: '/census' });
    const response = createResponse();
    const next = vi.fn();
    const server = {
      ssrFixStacktrace: vi.fn(),
    };
    const loadModule = vi.fn();

    await handleNetlifyFunctionDevRequest({
      entries: DEFAULT_NETLIFY_FUNCTION_DEV_ENTRIES,
      loadModule,
      next,
      req: request as unknown as IncomingMessage,
      res: response as unknown as ServerResponse,
      server,
    });

    expect(next).toHaveBeenCalledTimes(1);
    expect(loadModule).not.toHaveBeenCalled();
    expect(response.ended).toBe(false);
  });
});
