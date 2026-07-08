import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyExamRequestPrintSnapshot,
  captureExamRequestPrintSnapshot,
  restoreExamRequestPrintSnapshot,
  runExamRequestPrint,
} from '@/hooks/controllers/examRequestPrintController';
import { EXAM_REQUEST_PRINT_STYLES } from '@/components/modals/examRequestPrintStyles';

describe('examRequestPrintController', () => {
  beforeEach(() => {
    document.body.innerHTML = '<h3 id="modal-title">Solicitud de Laboratorio</h3>';
    document.title = 'HHR';
  });

  it('captures, clears and restores the print snapshot', () => {
    const snapshot = captureExamRequestPrintSnapshot(document, 'modal-title');

    applyExamRequestPrintSnapshot(snapshot, document);
    expect(document.title).toBe('');
    expect(document.getElementById('modal-title')?.textContent).toBe('');

    restoreExamRequestPrintSnapshot(snapshot, document);
    expect(document.title).toBe('HHR');
    expect(document.getElementById('modal-title')?.textContent).toBe('Solicitud de Laboratorio');
  });

  it('runs the deferred print workflow', () => {
    vi.useFakeTimers();
    const printSpy = vi.fn();
    runExamRequestPrint({
      documentRef: document,
      windowRef: {
        ...window,
        print: printSpy,
        setTimeout: window.setTimeout.bind(window),
      } as unknown as Window,
      printDelayMs: 10,
      restoreDelayMs: 20,
    });

    expect(document.title).toBe('');
    vi.advanceTimersByTime(10);
    expect(printSpy).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(20);
    expect(document.title).toBe('HHR');
    expect(document.getElementById('modal-title')?.textContent).toBe('Solicitud de Laboratorio');
    vi.useRealTimers();
  });

  it('targets the printable modal portal root instead of a nested dialog body child', () => {
    expect(EXAM_REQUEST_PRINT_STYLES).toContain('body > [data-printable-modal-root]');
    expect(EXAM_REQUEST_PRINT_STYLES).not.toContain('body > div[role="dialog"]');
  });
});
