/**
 * Tests for the slash command controller.
 *
 * Validates command detection in text content and removal from HTML.
 */

import { describe, it, expect } from 'vitest';
import {
  detectSlashCommand,
  removeSlashCommandFromHtml,
} from '@/features/clinical-documents/controllers/clinicalDocumentSlashCommandController';

describe('detectSlashCommand', () => {
  it('detects /lab followed by a space at end of text', () => {
    expect(detectSlashCommand('some text /lab ')).toBe('lab');
  });

  it('detects /lab followed by newline at end of text', () => {
    expect(detectSlashCommand('some text /lab\n')).toBe('lab');
  });

  it('detects /lab followed by multiple spaces', () => {
    expect(detectSlashCommand('/lab  ')).toBe('lab');
  });

  it('detects /lab as the only content', () => {
    expect(detectSlashCommand('/lab ')).toBe('lab');
  });

  it('returns null when /lab has no trailing whitespace', () => {
    expect(detectSlashCommand('/lab')).toBeNull();
  });

  it('returns null when /lab is in the middle of text', () => {
    expect(detectSlashCommand('/lab more text after')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(detectSlashCommand('')).toBeNull();
  });

  it('returns null for unrelated slash commands', () => {
    expect(detectSlashCommand('/test ')).toBeNull();
  });

  it('returns null for partial match', () => {
    expect(detectSlashCommand('/la ')).toBeNull();
  });
});

describe('removeSlashCommandFromHtml', () => {
  it('removes /lab and trailing space from plain text', () => {
    expect(removeSlashCommandFromHtml('Hello /lab ')).toBe('Hello ');
  });

  it('removes /lab without trailing space', () => {
    expect(removeSlashCommandFromHtml('Hello /lab')).toBe('Hello ');
  });

  it('removes /lab from HTML context', () => {
    expect(removeSlashCommandFromHtml('<p>Notes /lab </p>')).toBe('<p>Notes </p>');
  });

  it('removes the trailing command occurrence (the one the user just typed)', () => {
    expect(removeSlashCommandFromHtml('/lab /lab ')).toBe('/lab ');
  });

  it('returns unchanged HTML when no command present', () => {
    expect(removeSlashCommandFromHtml('<p>Regular text</p>')).toBe('<p>Regular text</p>');
  });

  it('handles empty string', () => {
    expect(removeSlashCommandFromHtml('')).toBe('');
  });

  it('does not corrupt an image src that contains "/lab"', () => {
    expect(removeSlashCommandFromHtml('<img src="https://host/lab/result.png">Notas /lab ')).toBe(
      '<img src="https://host/lab/result.png">Notas '
    );
  });

  it('does not corrupt a link href that contains "/lab"', () => {
    expect(removeSlashCommandFromHtml('<a href="https://host/labs">ver</a> resumen /lab ')).toBe(
      '<a href="https://host/labs">ver</a> resumen '
    );
  });

  it('removes the trailing command even when followed by closing tags', () => {
    expect(removeSlashCommandFromHtml('<div><span>Texto /lab </span></div>')).toBe(
      '<div><span>Texto </span></div>'
    );
  });

  it('removes the trailing command even when a <br> follows it', () => {
    expect(removeSlashCommandFromHtml('<div>Texto /lab <br></div>')).toBe('<div>Texto <br></div>');
  });
});
