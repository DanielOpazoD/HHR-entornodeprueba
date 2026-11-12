import type PizZip from 'pizzip';
import { loadPdfLibGenerationRuntime } from '@/services/pdf/pdfLibRuntime';

/** Embed bytes, never a remote image URL or credential, in the existing signature cell. */
export const insertSicWordSignature = async (
  zip: PizZip,
  document: Document,
  paragraph: Element,
  png: Uint8Array
) => {
  const { PDFDocument } = await loadPdfLibGenerationRuntime();
  const image = await (await PDFDocument.create()).embedPng(png);
  const { width, height } = image.scaleToFit(82, 16);
  const cx = Math.floor(width * 12700),
    cy = Math.floor(height * 12700);
  const name = 'sic-signature.png',
    id = 'rIdSicSignature';
  zip.file(`word/media/${name}`, png);
  const rels = new DOMParser().parseFromString(
    zip.file('word/_rels/document.xml.rels')!.asText(),
    'application/xml'
  );
  const relation = rels.createElementNS(rels.documentElement.namespaceURI, 'Relationship');
  relation.setAttribute('Id', id);
  relation.setAttribute(
    'Type',
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'
  );
  relation.setAttribute('Target', `media/${name}`);
  rels.documentElement.appendChild(relation);
  const drawing = new DOMParser().parseFromString(
    `<w:r xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="9001" name="Firma del profesional"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="9001" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`,
    'application/xml'
  );
  paragraph.appendChild(document.importNode(drawing.documentElement, true));
  const types = new DOMParser().parseFromString(
    zip.file('[Content_Types].xml')!.asText(),
    'application/xml'
  );
  if (
    !Array.from(types.documentElement.children).some(
      type => type.getAttribute('Extension') === 'png'
    )
  ) {
    const type = types.createElementNS(types.documentElement.namespaceURI, 'Default');
    type.setAttribute('Extension', 'png');
    type.setAttribute('ContentType', 'image/png');
    types.documentElement.appendChild(type);
  }
  const serializer = new XMLSerializer();
  zip.file('word/_rels/document.xml.rels', serializer.serializeToString(rels));
  zip.file('[Content_Types].xml', serializer.serializeToString(types));
};
