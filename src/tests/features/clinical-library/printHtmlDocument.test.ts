import { describe, expect, it, vi } from 'vitest';

import {
  buildPrintableHtml,
  escapeHtml,
  printHtmlDocument,
} from '@/features/clinical-library/services/printHtmlDocument';
import type { BrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntimeCore';

const fakeWindow = (readyState: 'complete' | 'loading') => {
  const listeners: Record<string, () => void> = {};
  const target = {
    document: { open: vi.fn(), write: vi.fn(), close: vi.fn(), readyState },
    focus: vi.fn(),
    print: vi.fn(),
    setTimeout: vi.fn((callback: () => void) => callback()),
    addEventListener: vi.fn((type: string, listener: () => void) => {
      listeners[type] = listener;
    }),
  };
  return { target, listeners };
};

describe('printHtmlDocument', () => {
  it('escapes HTML and builds a full document with the styles in the head', () => {
    expect(escapeHtml(`<b>"Tom" & 'Jerry'</b>`)).toBe(
      '&lt;b&gt;&quot;Tom&quot; &amp; &#39;Jerry&#39;&lt;/b&gt;'
    );
    const html = buildPrintableHtml({ title: 'A <b>', body: '<p>x</p>', styles: 'p{margin:0}' });
    expect(html).toContain('<title>A &lt;b&gt;</title>');
    expect(html).toContain('<style>p{margin:0}</style>');
    expect(html).toContain('<body><p>x</p></body>');
  });

  it('writes the document into a new tab and prints once it is ready', () => {
    const { target } = fakeWindow('complete');
    const runtime = { open: vi.fn(() => target) } as unknown as BrowserWindowRuntime;
    expect(printHtmlDocument({ title: 't', body: '<p>x</p>', styles: '' }, runtime)).toBe(
      'printed'
    );
    expect(runtime.open).toHaveBeenCalledWith('', '_blank');
    expect(target.document.write).toHaveBeenCalledWith(expect.stringContaining('<p>x</p>'));
    expect(target.print).toHaveBeenCalledTimes(1);
  });

  it('waits for load when the tab is still loading and reports blocked popups', () => {
    const { target, listeners } = fakeWindow('loading');
    const runtime = { open: vi.fn(() => target) } as unknown as BrowserWindowRuntime;
    printHtmlDocument({ title: 't', body: '', styles: '' }, runtime);
    expect(target.print).not.toHaveBeenCalled();
    listeners.load?.();
    expect(target.print).toHaveBeenCalledTimes(1);

    const blocked = { open: vi.fn(() => null) } as unknown as BrowserWindowRuntime;
    expect(printHtmlDocument({ title: 't', body: '', styles: '' }, blocked)).toBe('blocked');
  });
});
