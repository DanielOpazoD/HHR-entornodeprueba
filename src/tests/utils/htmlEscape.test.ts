import { describe, expect, it } from 'vitest';

import { escapeHtml } from '@/utils/htmlEscape';

describe('escapeHtml', () => {
  it('escapes all five HTML-significant characters', () => {
    expect(escapeHtml(`Tom & "Jerry" <b> it's`)).toBe(
      'Tom &amp; &quot;Jerry&quot; &lt;b&gt; it&#39;s'
    );
  });

  it('escapes the ampersand exactly once (no double-escaping of entities)', () => {
    expect(escapeHtml('a < b')).toBe('a &lt; b');
    // A literal entity-looking string must not have its leading & swallowed twice.
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  it('is safe for both text content and attribute values', () => {
    expect(escapeHtml('<Alta & control>')).toBe('&lt;Alta &amp; control&gt;');
    expect(escapeHtml('Tom & "Jerry"')).toBe('Tom &amp; &quot;Jerry&quot;');
  });

  it('leaves strings without special characters untouched', () => {
    expect(escapeHtml('Paciente estable 24h')).toBe('Paciente estable 24h');
    expect(escapeHtml('')).toBe('');
  });
});
