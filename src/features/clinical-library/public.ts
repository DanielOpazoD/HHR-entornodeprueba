/**
 * @module clinical-library (public API)
 * @description Biblioteca de documentos y herramientas clínicas del censo:
 * botón «Documentos» de la barra de fechas y panel lateral con formularios,
 * protocolos, infografías y calculadoras. Consumir sólo desde este entrypoint
 * (o desde `quick-action.ts`, el barrel liviano para el shell autenticado).
 */

export { ClinicalLibraryQuickAction } from './components/ClinicalLibraryQuickAction';
export { ClinicalLibraryDrawer } from './components/ClinicalLibraryDrawer';
export { CLINICAL_LIBRARY_ENTRIES, LIBRARY_CATEGORIES } from './domain/libraryCatalog';
export type {
  LibraryCategoryId,
  LibraryDocumentEntry,
  LibraryEntry,
  LibraryToolEntry,
  LibraryToolId,
} from './domain/libraryCatalogTypes';
