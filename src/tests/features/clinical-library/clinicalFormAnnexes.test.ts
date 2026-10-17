import { readFileSync, writeFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import PizZip from 'pizzip';
import { act, renderHook } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClinicalFormDocx } from '@/features/clinical-library/services/clinicalFormDocx';
import { validateClinicalFormAnnexes } from '@/features/clinical-library/services/clinicalFormAnnexes';
import { getClinicalForm } from '@/features/clinical-library/domain/forms/clinicalFormCatalog';
import { useClinicalFormAnnexes } from '@/features/clinical-library/components/tools/forms/useClinicalFormAnnexes';
import type { DicomCapture } from '@/services/radiology/dicomTypes';

const form = getClinicalForm('informe-traslado-hospital-salvador');
const template = new Uint8Array(readFileSync(`public${form.sourceUrl}`));
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const image = (id = 'synthetic-image'): DicomCapture => ({
  id,
  patientId: '111111111',
  studyUid: '1.2.3',
  seriesUid: '1.2.3.1',
  plane: 'axial',
  caption: 'Captura sintética A & B < C',
  width: 1,
  height: 1,
  png: new Uint8Array(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a+s0AAAAASUVORK5CYII=',
      'base64'
    )
  ),
});

describe('Salvador DICOM annexes', () => {
  beforeAll(() => vi.stubGlobal('crypto', webcrypto));
  afterAll(() => vi.unstubAllGlobals());
  it('appends ordered images after the original form on separate pages and preserves original headers, media and geometry', async () => {
    const captures = [image('first'), { ...image('second'), caption: 'Segunda captura' }];
    const bytes = await createClinicalFormDocx(
      template,
      form,
      { paciente_rut: '11.111.111-1', paciente_nombre_completo: 'PACIENTE SINTÉTICO' },
      [],
      captures
    );
    const before = new PizZip(template);
    const after = new PizZip(bytes);
    for (const [name, part] of Object.entries(before.files))
      if (
        !part.dir &&
        !['word/document.xml', 'word/_rels/document.xml.rels', '[Content_Types].xml'].includes(name)
      )
        expect(after.file(name)!.asUint8Array(), name).toEqual(part.asUint8Array());
    const parse = (zip: PizZip) =>
      new DOMParser().parseFromString(zip.file('word/document.xml')!.asText(), 'application/xml');
    const xml = parse(after);
    const original = parse(before);
    expect(xml.getElementsByTagName('parsererror')).toHaveLength(0);
    const body = xml.getElementsByTagNameNS(W, 'body')[0];
    expect(body.lastElementChild!.localName).toBe('sectPr');
    expect(body.lastElementChild!.outerHTML).toBe(
      original.getElementsByTagNameNS(W, 'sectPr')[0].outerHTML
    );
    const paragraphs = Array.from(body.children).filter(item => item.localName === 'p');
    expect(paragraphs.slice(0, 27).some(item => item.textContent?.includes('ANEXOS'))).toBe(false);
    expect(paragraphs[27].textContent).toContain('Anexo 1 · Captura sintética A & B < C');
    expect(paragraphs[29].textContent).toContain('Anexo 2 · Segunda captura');
    expect(xml.getElementsByTagNameNS(W, 'pageBreakBefore')).toHaveLength(2);
    expect(after.file('word/media/dicom-annex-1.png')!.asUint8Array()).toEqual(captures[0].png);
    expect(after.file('word/_rels/document.xml.rels')!.asText()).toContain(
      'media/dicom-annex-2.png'
    );
    if (process.env.DICOM_QA_DOCX) writeFileSync(process.env.DICOM_QA_DOCX, bytes);
  });
  it('refuses cross-patient images, mismatched dimensions and oversized lists', async () => {
    expect(() => validateClinicalFormAnnexes([image()], '22.222.222-2')).toThrow('RUT');
    expect(() => validateClinicalFormAnnexes([{ ...image(), width: 50 }], '11111111-1')).toThrow(
      'PNG'
    );
    expect(() =>
      validateClinicalFormAnnexes(
        Array.from({ length: 11 }, () => image()),
        '11111111-1'
      )
    ).toThrow('10 capturas');
    await expect(createClinicalFormDocx(template, form, {}, [], [image()])).rejects.toThrow('RUT');
  });
  it('drops captures on context changes, ignores stale callbacks and supports ordering and captions', () => {
    const { result, rerender } = renderHook(
      ({ context }) => useClinicalFormAnnexes(context, '11111111-1'),
      { initialProps: { context: 'episode-a' } }
    );
    act(() => {
      result.current.add(image('a'));
      result.current.add(image('b'));
    });
    expect(result.current.images.map(item => item.id)).toEqual(['a', 'b']);
    act(() => result.current.move('b', -1));
    expect(result.current.images[0].id).toBe('b');
    act(() => result.current.caption('b', 'Descripción revisada'));
    expect(result.current.images[0].caption).toBe('Descripción revisada');
    const stale = result.current.add;
    rerender({ context: 'episode-b' });
    expect(result.current.images).toEqual([]);
    act(() => stale(image('late')));
    expect(result.current.images).toEqual([]);
    act(() => result.current.add(image('c')));
    act(() => result.current.remove('c'));
    expect(result.current.images).toEqual([]);
  });
});
