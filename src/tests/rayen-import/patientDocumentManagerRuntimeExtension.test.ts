// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import '../../../extension/patient-document-manager-runtime.js';

const globals = globalThis as typeof globalThis & {
  HhrPatientDocumentManagerRuntime: {
    create: (dependencies: Record<string, unknown>) => {
      handleRequest: (request: Record<string, unknown>) => Promise<Record<string, unknown>>;
      list: (request: Record<string, unknown>) => Promise<Record<string, unknown>>;
      openDocument: (request: Record<string, unknown>) => Promise<Record<string, unknown>>;
    };
  };
};

const makeRuntime = () => {
  const chrome = { tabs: { create: vi.fn().mockResolvedValue({ id: 7 }) } };
  const getClinicalReportContext = vi.fn().mockResolvedValue({
    info: { token: 'secret', apiOrigin: 'https://api.example.test' },
    patientId: '9001',
  });
  const readJson = vi.fn().mockResolvedValue({ data: [] });
  const fetchClaims = vi.fn().mockResolvedValue({
    claims: [
      { claim: 'Ver_Repositorio_Documental_Clinico' },
      { claim: 'Ver_Repositorio_Documental_Administrativo' },
    ],
  });
  const hasClaim = vi.fn((result: { claims: Array<{ claim: string }> }, name: string) =>
    result.claims.some(item => item.claim === name)
  );
  const runtime = globals.HhrPatientDocumentManagerRuntime.create({
    chrome,
    getClinicalReportContext,
    readJson,
    fetchClaims,
    hasClaim,
  });
  return { chrome, getClinicalReportContext, readJson, fetchClaims, runtime };
};

const clinicalDocument = {
  id: 10,
  classId: 1,
  class_name: 'Clínico',
  namefile: 'archivo-prueba.pdf',
  name: 'Informe de prueba',
  hcp_created_name: 'Profesional de prueba',
  fac_name: 'Hospital de prueba',
  createdDatetime: '2026-07-16T10:00:00',
  pathAzure: 'https://files.example.test/archivo-prueba.pdf?temporary=secret',
};

describe('patient document manager extension runtime', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns only safe metadata for active documents authorized by claims', async () => {
    const { runtime, readJson, fetchClaims } = makeRuntime();
    readJson.mockResolvedValue({
      data: [
        clinicalDocument,
        { ...clinicalDocument, id: 11, classId: 2, namefile: 'administrativo.pdf' },
        { ...clinicalDocument, id: 12, deleted: true },
        { ...clinicalDocument, id: undefined, namefile: 'sin-identificador.pdf' },
      ],
    });
    fetchClaims.mockResolvedValue({
      claims: [{ claim: 'Ver_Repositorio_Documental_Clinico' }],
    });

    await expect(runtime.list({ encId: '141121', sender: { tab: { id: 5 } } })).resolves.toEqual({
      ok: true,
      documents: [
        {
          id: 'id:10',
          classification: 'Clínico',
          fileName: 'archivo-prueba.pdf',
          name: 'Informe de prueba',
          attachedBy: 'Profesional de prueba',
          facility: 'Hospital de prueba',
          createdAt: '2026-07-16T10:00:00',
        },
      ],
    });
    expect(JSON.stringify(await runtime.list({ encId: '141121' }))).not.toContain('pathAzure');
    expect(JSON.stringify(await runtime.list({ encId: '141121' }))).not.toContain('temporary=secret');
  });

  it('re-fetches authorization and opens the selected HTTPS file in a new tab', async () => {
    const { runtime, readJson, chrome } = makeRuntime();
    readJson.mockResolvedValue({ data: [clinicalDocument] });

    await expect(runtime.openDocument({ encId: '141121', documentId: 'id:10' })).resolves.toEqual({
      ok: true,
      opened: true,
    });
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'https://files.example.test/archivo-prueba.pdf?temporary=secret',
      active: true,
    });
  });

  it('fails closed for deleted, missing, malformed, or insecure documents', async () => {
    const { runtime, readJson, chrome } = makeRuntime();
    readJson.mockResolvedValue({ data: [{ ...clinicalDocument, deleted: true }] });
    await expect(runtime.openDocument({ encId: '141121', documentId: 'id:10' })).resolves.toMatchObject({
      ok: false,
      opened: false,
    });

    readJson.mockResolvedValue({ data: [{ ...clinicalDocument, pathAzure: 'http://files.test/a.pdf' }] });
    await expect(runtime.openDocument({ encId: '141121', documentId: 'id:10' })).resolves.toEqual({
      ok: false,
      opened: false,
      error: 'Eloísa entregó una dirección de archivo no segura.',
    });
    expect(chrome.tabs.create).not.toHaveBeenCalled();

    readJson.mockResolvedValue({ data: { unexpected: true } });
    await expect(runtime.list({ encId: '141121' })).resolves.toEqual({
      ok: false,
      error: 'Eloísa no entregó una lista válida de documentos del paciente.',
    });
  });

  it('rejects unsupported operations', async () => {
    const { runtime } = makeRuntime();
    await expect(runtime.handleRequest({ encId: '141121', operation: 'delete' })).resolves.toEqual({
      ok: false,
      error: 'La operación del Gestor documental no es válida.',
    });
  });
});
