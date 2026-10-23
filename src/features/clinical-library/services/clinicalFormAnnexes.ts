import type PizZip from 'pizzip';
import { normalizeDicomPatientId, type DicomCapture } from '@/services/radiology/dicomTypes';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const IMAGE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';

export const validateClinicalFormAnnexes = (
  annexes: ReadonlyArray<DicomCapture>,
  patientId: string
): void => {
  if (
    annexes.length > 10 ||
    annexes.reduce((sum, image) => sum + image.png.byteLength, 0) > 20 * 1024 * 1024
  )
    throw new Error('El informe admite hasta 10 capturas y 20 MB de anexos.');
  for (const image of annexes) {
    if (
      !patientId ||
      normalizeDicomPatientId(image.patientId) !== normalizeDicomPatientId(patientId)
    )
      throw new Error('Los anexos no corresponden al RUT de este informe.');
    const png = image.png;
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    if (
      png.length < 33 ||
      png.length > 4 * 1024 * 1024 ||
      [137, 80, 78, 71, 13, 10, 26, 10].some((byte, i) => png[i] !== byte) ||
      new TextDecoder().decode(png.subarray(12, 16)) !== 'IHDR' ||
      view.getUint32(16) !== image.width ||
      view.getUint32(20) !== image.height ||
      !Number.isInteger(image.width) ||
      !Number.isInteger(image.height) ||
      image.width < 1 ||
      image.height < 1 ||
      image.width > 4096 ||
      image.height > 4096 ||
      image.width * image.height > 8_000_000
    )
      throw new Error('Una captura PNG no es válida o supera el tamaño permitido.');
    if (
      image.caption.length > 500 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(image.caption)
    )
      throw new Error('El texto de un anexo no es válido (máximo 500 caracteres).');
  }
};

/** Append after the original form, before the final section properties. No changes to headers or logos. */
export const appendClinicalFormAnnexes = (
  zip: PizZip,
  document: Document,
  annexes: ReadonlyArray<DicomCapture>
): void => {
  if (!annexes.length) return;
  const parse = (path: string) => {
    const source = zip.file(path)?.asText();
    if (!source) throw new Error('La plantilla Word no contiene las relaciones de imágenes.');
    const parsed = new DOMParser().parseFromString(source, 'application/xml');
    if (parsed.getElementsByTagName('parsererror').length)
      throw new Error('Paquete Word no válido.');
    return parsed;
  };
  const rels = parse('word/_rels/document.xml.rels');
  const types = parse('[Content_Types].xml');
  const body = document.getElementsByTagNameNS(W, 'body')[0];
  const section = Array.from(body.children).find(
    item => item.namespaceURI === W && item.localName === 'sectPr'
  );
  if (!section) throw new Error('La plantilla Word no define el tamaño de página.');
  const page = section.getElementsByTagNameNS(W, 'pgSz')[0];
  const margin = section.getElementsByTagNameNS(W, 'pgMar')[0];
  const size = (element: Element, key: string) => Number(element.getAttributeNS(W, key));
  const maxWidth = (size(page, 'w') - size(margin, 'left') - size(margin, 'right')) * 635;
  const maxHeight = (size(page, 'h') - size(margin, 'top') - size(margin, 'bottom') - 2400) * 635;
  const existingIds = new Set(
    Array.from(rels.getElementsByTagNameNS(R, 'Relationship')).map(item => item.getAttribute('Id'))
  );
  const docIds = Array.from(
    document.getElementsByTagNameNS(
      'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
      'docPr'
    )
  ).map(item => Number(item.getAttribute('id')) || 0);
  let drawingId = Math.max(0, ...docIds) + 1;
  annexes.forEach((image, index) => {
    let suffix = index + 1;
    while (existingIds.has(`rIdDicom${suffix}`) || zip.file(`word/media/dicom-annex-${suffix}.png`))
      suffix++;
    const relationshipId = `rIdDicom${suffix}`;
    existingIds.add(relationshipId);
    const name = `dicom-annex-${suffix}.png`;
    zip.file(`word/media/${name}`, image.png);
    const relationship = rels.createElementNS(R, 'Relationship');
    relationship.setAttribute('Id', relationshipId);
    relationship.setAttribute('Type', IMAGE_REL);
    relationship.setAttribute('Target', `media/${name}`);
    rels.documentElement.appendChild(relationship);

    const paragraph = document.createElementNS(W, 'w:p');
    const properties = document.createElementNS(W, 'w:pPr');
    properties.appendChild(document.createElementNS(W, 'w:keepNext'));
    properties.appendChild(document.createElementNS(W, 'w:pageBreakBefore'));
    paragraph.appendChild(properties);
    const run = document.createElementNS(W, 'w:r');
    const text = document.createElementNS(W, 'w:t');
    text.textContent = `${index === 0 ? 'ANEXOS — ' : ''}Anexo ${index + 1}${image.caption ? ` · ${image.caption}` : ''}`;
    run.appendChild(text);
    paragraph.appendChild(run);
    body.insertBefore(paragraph, section);

    const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
    const cx = Math.round(image.width * scale);
    const cy = Math.round(image.height * scale);
    const drawing = new DOMParser().parseFromString(
      `<w:p xmlns:w="${W}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"
      xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <w:pPr><w:spacing w:before="120" w:after="0"/><w:jc w:val="center"/></w:pPr><w:r><w:drawing>
      <wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>
      <wp:docPr id="${drawingId++}" name="Anexo ${index + 1}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>
      <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>
      <pic:nvPicPr><pic:cNvPr id="0" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr>
      <pic:blipFill><a:blip r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
      <pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
      </pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`,
      'application/xml'
    );
    body.insertBefore(document.importNode(drawing.documentElement, true), section);
  });
  if (
    !Array.from(types.getElementsByTagNameNS(CT, 'Default')).some(
      item => item.getAttribute('Extension')?.toLowerCase() === 'png'
    )
  ) {
    const type = types.createElementNS(CT, 'Default');
    type.setAttribute('Extension', 'png');
    type.setAttribute('ContentType', 'image/png');
    types.documentElement.appendChild(type);
  }
  const serializer = new XMLSerializer();
  zip.file('word/_rels/document.xml.rels', serializer.serializeToString(rels));
  zip.file('[Content_Types].xml', serializer.serializeToString(types));
};
