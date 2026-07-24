export interface DocumentPageCollection<TPage> {
  readonly pages: TPage[];
}

export const getDocumentPage = <TPage>(
  collection: DocumentPageCollection<TPage>,
  pageIndex: number
): TPage => {
  const page = collection.pages[pageIndex];
  if (!page) throw new Error('La página seleccionada ya no está disponible.');
  return page;
};

export const moveDocumentPage = <TPage>(
  collection: DocumentPageCollection<TPage>,
  pageIndex: number,
  destinationIndex: number
): number => {
  const page = getDocumentPage(collection, pageIndex);
  const boundedDestination = Math.max(0, Math.min(destinationIndex, collection.pages.length - 1));
  if (pageIndex === boundedDestination) return pageIndex;
  collection.pages.splice(pageIndex, 1);
  collection.pages.splice(boundedDestination, 0, page);
  return boundedDestination;
};

export const removeDocumentPage = <TPage>(
  collection: DocumentPageCollection<TPage>,
  pageIndex: number
): number => {
  getDocumentPage(collection, pageIndex);
  if (collection.pages.length === 1) {
    throw new Error('El documento debe conservar al menos una página.');
  }
  collection.pages.splice(pageIndex, 1);
  return Math.min(pageIndex, collection.pages.length - 1);
};
