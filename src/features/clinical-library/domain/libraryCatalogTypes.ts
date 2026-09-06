/**
 * Contratos del catálogo de la biblioteca clínica del censo.
 *
 * El catálogo es estático y vive en el repositorio: nunca contiene datos de
 * pacientes ni depende de Firestore. Los documentos se sirven como assets
 * públicos fuera del precache de la PWA; las herramientas son código de la app
 * y funcionan sin conexión.
 */

export const LIBRARY_CATEGORY_IDS = ['forms', 'protocols', 'infographics', 'tools'] as const;
export type LibraryCategoryId = (typeof LIBRARY_CATEGORY_IDS)[number];
export type LibraryDocumentCategoryId = Exclude<LibraryCategoryId, 'tools'>;

export interface LibraryCategory {
  id: LibraryCategoryId;
  label: string;
  description: string;
  emptyTitle: string;
  emptyDetail: string;
}

export const LIBRARY_DOCUMENT_FORMATS = ['pdf', 'docx', 'image'] as const;
export type LibraryDocumentFormat = (typeof LIBRARY_DOCUMENT_FORMATS)[number];

export interface LibraryDocumentEntry {
  kind: 'document';
  id: string;
  category: LibraryDocumentCategoryId;
  title: string;
  description: string;
  format: LibraryDocumentFormat;
  /** Ruta pública bajo docs/, templates/ o images/forms/ (fuera del precache); se codifica al construir el enlace. */
  url: string;
  pages?: number;
  /** Tamaño aproximado en KB; el test de integridad lo contrasta con el archivo real. */
  sizeKb: number;
  keywords: string[];
  source?: string;
}

export const LIBRARY_TOOL_IDS = ['infusion', 'dosing', 'scores'] as const;
export type LibraryToolId = (typeof LIBRARY_TOOL_IDS)[number];

export interface LibraryToolEntry {
  kind: 'tool';
  id: LibraryToolId;
  category: 'tools';
  title: string;
  description: string;
  keywords: string[];
}

export type LibraryEntry = LibraryDocumentEntry | LibraryToolEntry;
