import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuditDocumentsView } from '@/features/audit-documents/components/AuditDocumentsView';
import {
  AUDIT_DOCUMENTS_ACK_TIMEOUT_MS,
  AUDIT_DOCUMENTS_IDLE_TIMEOUT_MS,
  AUDIT_DOCUMENTS_CANCEL_TYPE,
  AUDIT_DOCUMENTS_REQUEST_TYPE,
} from '@/features/audit-documents/services/auditDocumentsBridge';
import { mockAuditContextValue } from '../../setup';

type PostedMessage = Record<string, unknown>;

const sentToExtension = (postMessage: ReturnType<typeof vi.spyOn>): PostedMessage[] =>
  postMessage.mock.calls.map((call: unknown[]) => call[0] as PostedMessage);

/** Plays the extension's answer as the content script would post it to the page. */
const fromExtension = (data: PostedMessage) =>
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, origin: window.location.origin }));
  });

describe('Documentos para auditoría', () => {
  let postMessage: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    postMessage = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    mockAuditContextValue.logEvent.mockClear();
  });

  afterEach(() => {
    postMessage.mockRestore();
    vi.useRealTimers();
  });

  const typeRuts = (text: string) =>
    fireEvent.change(screen.getByLabelText('RUT de los pacientes'), { target: { value: text } });

  it('sends the RUTs with general and individual dates and shows what the ZIP contains', async () => {
    render(<AuditDocumentsView />);
    typeRuts('11.111.111-1\n12345678-5');
    fireEvent.change(screen.getByLabelText('Desde (todos)'), { target: { value: '2026-07-01' } });
    fireEvent.change(screen.getByLabelText('Hasta para 12.345.678-5'), {
      target: { value: '2026-08-15' },
    });
    fireEvent.click(screen.getByLabelText('Reporte de cuidados farmacológicos y otros'));
    fireEvent.click(screen.getByRole('button', { name: /buscar documentos/i }));

    const request = sentToExtension(postMessage).find(
      message => message.type === AUDIT_DOCUMENTS_REQUEST_TYPE
    );
    expect(request).toMatchObject({
      patients: [
        { run: '111111111', dateFrom: '2026-07-01' },
        { run: '123456785', dateFrom: '2026-07-01', dateTo: '2026-08-15' },
      ],
      documentTypes: ['history'],
      saveInPage: true,
    });
    const reqId = request?.reqId;

    fromExtension({
      type: 'HHR_RAYEN_AUDIT_DOCUMENTS_PROGRESS',
      reqId,
      phase: 'downloading',
      done: 1,
      total: 2,
    });
    expect(screen.getByRole('status')).toHaveTextContent('Descargando documentos: 1 de 2');

    fromExtension({
      type: 'HHR_RAYEN_AUDIT_DOCUMENTS_RESULT',
      reqId,
      ok: true,
      filename: 'Auditoria_Eloisa_2026-11-02_1610.zip',
      documentCount: 1,
      failedCount: 0,
      summary: [
        {
          run: '111111111',
          name: 'Paciente Prueba Uno',
          hospitalizations: 1,
          unverified: 0,
          downloaded: 1,
          failed: 0,
        },
        {
          run: '123456785',
          name: '',
          error: 'Eloísa respondió HTTP 500',
          hospitalizations: 0,
          unverified: 0,
          downloaded: 0,
          failed: 0,
        },
      ],
    });

    expect(
      await screen.findByText(
        /ZIP Auditoria_Eloisa_2026-11-02_1610.zip ya quedó en tu carpeta Descargas/
      )
    ).toHaveTextContent('Revisa 1 RUT con documentos faltantes');
    // An extension older than 0.48.71 saved it into Downloads already.
    expect(screen.getByRole('status')).toHaveTextContent(
      'Para elegir dónde guardarlo, actualiza la extensión Eloísa.'
    );
    expect(screen.queryByRole('button', { name: 'Descargar ZIP' })).not.toBeInTheDocument();
    expect(screen.getByText('Completo')).toBeInTheDocument();
    expect(
      screen.getByText('No se pudo consultar Eloísa: Eloísa respondió HTTP 500')
    ).toBeInTheDocument();
    expect(mockAuditContextValue.logEvent).toHaveBeenCalledWith(
      'DATA_EXPORTED',
      'system',
      'auditoria-documentos-eloisa',
      expect.objectContaining({
        runs: ['111111111', '123456785'],
        documentTypes: ['history'],
        documentCount: 1,
      })
    );
  });

  it('says the extension must be updated when nobody acknowledges the request', async () => {
    vi.useFakeTimers();
    render(<AuditDocumentsView />);
    typeRuts('11111111-1');
    fireEvent.click(screen.getByRole('button', { name: /buscar documentos/i }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUDIT_DOCUMENTS_ACK_TIMEOUT_MS + 1);
    });

    expect(screen.getByRole('alert')).toHaveTextContent('versión 0.48.65 o superior');
    // Giving up also frees the extension's single download slot.
    const [request, cancel] = sentToExtension(postMessage);
    expect(cancel).toEqual({ type: AUDIT_DOCUMENTS_CANCEL_TYPE, reqId: request.reqId });
    expect(mockAuditContextValue.logEvent).not.toHaveBeenCalled();
  });

  it('shows the second attempts and keeps waiting while the extension reports any progress', async () => {
    vi.useFakeTimers();
    render(<AuditDocumentsView />);
    typeRuts('11111111-1');
    fireEvent.click(screen.getByRole('button', { name: /buscar documentos/i }));
    const reqId = sentToExtension(postMessage)[0].reqId;

    fromExtension({
      type: 'HHR_RAYEN_AUDIT_DOCUMENTS_PROGRESS',
      reqId,
      phase: 'retrying',
      done: 0,
      total: 2,
    });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Reintentando los documentos que Eloísa no entregó: 0 de 2'
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUDIT_DOCUMENTS_IDLE_TIMEOUT_MS - 1_000);
    });
    // A phase this page does not know yet still proves the extension is working.
    fromExtension({
      type: 'HHR_RAYEN_AUDIT_DOCUMENTS_PROGRESS',
      reqId,
      phase: 'future-phase',
      done: 1,
      total: 2,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUDIT_DOCUMENTS_IDLE_TIMEOUT_MS - 1_000);
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('0 de 2');
  });

  it('cancels the download in the extension', async () => {
    render(<AuditDocumentsView />);
    typeRuts('11111111-1');
    fireEvent.click(screen.getByRole('button', { name: /buscar documentos/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    const [request, cancel] = sentToExtension(postMessage);
    expect(cancel).toEqual({ type: AUDIT_DOCUMENTS_CANCEL_TYPE, reqId: request.reqId });
    expect(await screen.findByText('Descarga cancelada.')).toBeInTheDocument();
  });

  describe('with an extension that hands over the ZIP', () => {
    const searchWithArchive = async () => {
      render(<AuditDocumentsView />);
      typeRuts('11.111.111-1');
      fireEvent.click(screen.getByRole('button', { name: /buscar documentos/i }));
      const reqId = sentToExtension(postMessage).find(
        message => message.type === AUDIT_DOCUMENTS_REQUEST_TYPE
      )?.reqId;
      const archive = new Blob(['PK-synthetic'], { type: 'application/zip' });
      fromExtension({
        type: 'HHR_RAYEN_AUDIT_DOCUMENTS_ARCHIVE',
        reqId,
        filename: 'Auditoria_Eloisa_2026-11-03_1129.zip',
        blob: archive,
      });
      fromExtension({
        type: 'HHR_RAYEN_AUDIT_DOCUMENTS_RESULT',
        reqId,
        ok: true,
        filename: 'Auditoria_Eloisa_2026-11-03_1129.zip',
        documentCount: 2,
        failedCount: 0,
        summary: [],
      });
      return { archive, button: await screen.findByRole('button', { name: 'Descargar ZIP' }) };
    };
    const picker = (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    afterEach(() => {
      Object.assign(window, { showSaveFilePicker: picker });
    });

    it('saves nothing until «Descargar ZIP», then where the person chooses', async () => {
      const written: unknown[] = [];
      const close = vi.fn(async () => undefined);
      const showSaveFilePicker = vi
        .fn()
        .mockRejectedValueOnce(new DOMException('closed', 'AbortError'))
        .mockResolvedValue({
          name: 'auditoria-septiembre.zip',
          createWritable: async () => ({
            write: async (data: unknown) => written.push(data),
            close,
          }),
        });
      Object.assign(window, { showSaveFilePicker });
      const { archive, button } = await searchWithArchive();

      expect(showSaveFilePicker).not.toHaveBeenCalled();
      expect(screen.getByRole('status')).toHaveTextContent('El ZIP tiene 2 documento(s).');
      // Closing the picker saves nothing and says nothing; the button stays.
      fireEvent.click(button);
      await vi.waitFor(() => expect(showSaveFilePicker).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      fireEvent.click(button);

      expect(
        await screen.findByText(/Guardado como auditoria-septiembre\.zip\./)
      ).toBeInTheDocument();
      expect(showSaveFilePicker).toHaveBeenLastCalledWith(
        expect.objectContaining({ suggestedName: 'Auditoria_Eloisa_2026-11-03_1129.zip' })
      );
      expect(written).toEqual([archive]);
      expect(close).toHaveBeenCalled();
    });

    it('uses the browser download where there is no picker', async () => {
      Object.assign(window, { showSaveFilePicker: undefined });
      const created: Blob[] = [];
      const createObjectURL = vi
        .spyOn(URL, 'createObjectURL')
        .mockImplementation(blob => (created.push(blob as Blob), 'blob:synthetic'));
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
        this: HTMLAnchorElement
      ) {
        expect(this.download).toBe('Auditoria_Eloisa_2026-11-03_1129.zip');
      });
      try {
        const { archive, button } = await searchWithArchive();

        fireEvent.click(button);

        await vi.waitFor(() => expect(click).toHaveBeenCalledTimes(1));
        expect(created).toEqual([archive]);
        expect(await screen.findByText(/Guardado como Auditoria_Eloisa/)).toBeInTheDocument();
      } finally {
        createObjectURL.mockRestore();
        click.mockRestore();
      }
    });
  });

  it('blocks the download for more than 20 RUTs or a value that is not a RUT', () => {
    render(<AuditDocumentsView />);
    const twentyOne = Array.from({ length: 21 }, (_unused, index) => {
      const body = String(10_000_000 + index);
      let sum = 0;
      let factor = 2;
      for (let i = body.length - 1; i >= 0; i -= 1) {
        sum += Number(body[i]) * factor;
        factor = factor === 7 ? 2 : factor + 1;
      }
      const rest = 11 - (sum % 11);
      return `${body}-${rest === 11 ? '0' : rest === 10 ? 'K' : rest}`;
    });
    typeRuts(twentyOne.join('\n'));

    expect(screen.getByRole('button', { name: /buscar documentos/i })).toBeDisabled();
    expect(
      screen.getByText('Se pueden pedir como máximo 20 RUT por descarga.')
    ).toBeInTheDocument();

    typeRuts('11111111-1\nP1234567');
    expect(screen.getByRole('alert')).toHaveTextContent('No son un RUT válido: P1234567');
    expect(screen.getByRole('button', { name: /buscar documentos/i })).toBeDisabled();
    expect(postMessage).not.toHaveBeenCalled();
  });
});
