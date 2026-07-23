import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  appendJscanifyDocumentPages,
  applyDocumentScanCrop,
  applyDocumentScanFilter,
  createDocumentCropEditorState,
  createDocumentPageThumbnails,
  createDocumentScanPreview,
  deleteDocumentScanPage,
  getDocumentScanPageFilter,
  redetectDocumentScanPage,
  reorderDocumentScanPage,
  revokeDocumentScanPreview,
  rotateDocumentScanPage,
  type DocumentCropEditorState,
  type DocumentPageThumbnail,
  type DocumentScanCorners,
  type DocumentScanFilterMode,
  type JscanifyDocumentSession,
} from '../services/jscanifyDocumentScannerService';
import type { DocumentScannerDemoPhase } from './documentScannerControllerTypes';

interface UseDocumentScannerPageEditorOptions {
  readonly sessionRef: MutableRefObject<JscanifyDocumentSession | null>;
  readonly mountedRef: MutableRefObject<boolean>;
  readonly operationGenerationRef: MutableRefObject<number>;
  readonly setPhase: Dispatch<SetStateAction<DocumentScannerDemoPhase>>;
  readonly setErrorMessage: Dispatch<SetStateAction<string | null>>;
}

export const useDocumentScannerPageEditor = ({
  sessionRef,
  mountedRef,
  operationGenerationRef,
  setPhase,
  setErrorMessage,
}: UseDocumentScannerPageEditorOptions) => {
  const previewRef = useRef<string | null>(null);
  const thumbnailsRef = useRef<DocumentPageThumbnail[]>([]);
  const cropEditorRef = useRef<DocumentCropEditorState | null>(null);
  const [filterMode, setFilterMode] = useState<DocumentScanFilterMode>('scanner');
  const [previewObjectUrl, setPreviewObjectUrl] = useState<string | null>(null);
  const [pageThumbnails, setPageThumbnails] = useState<DocumentPageThumbnail[]>([]);
  const [cropEditor, setCropEditor] = useState<DocumentCropEditorState | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [selectedPageIndex, setSelectedPageIndex] = useState(0);
  const [detectedPageCount, setDetectedPageCount] = useState(0);

  const replacePreview = useCallback(
    (objectUrl: string | null) => {
      if (!mountedRef.current) {
        revokeDocumentScanPreview(objectUrl);
        return;
      }
      revokeDocumentScanPreview(previewRef.current);
      previewRef.current = objectUrl;
      setPreviewObjectUrl(objectUrl);
    },
    [mountedRef]
  );

  const replacePageThumbnails = useCallback(
    (thumbnails: DocumentPageThumbnail[]) => {
      for (const thumbnail of thumbnailsRef.current) {
        revokeDocumentScanPreview(thumbnail.objectUrl);
      }
      if (!mountedRef.current) {
        for (const thumbnail of thumbnails) revokeDocumentScanPreview(thumbnail.objectUrl);
        return;
      }
      thumbnailsRef.current = thumbnails;
      setPageThumbnails(thumbnails);
    },
    [mountedRef]
  );

  const closeCropEditor = useCallback(() => {
    revokeDocumentScanPreview(cropEditorRef.current?.sourceObjectUrl ?? null);
    cropEditorRef.current = null;
    setCropEditor(null);
  }, []);

  const clearReview = useCallback(() => {
    replacePreview(null);
    replacePageThumbnails([]);
    closeCropEditor();
    if (!mountedRef.current) return;
    setPageCount(0);
    setDetectedPageCount(0);
    setSelectedPageIndex(0);
    setFilterMode('scanner');
  }, [closeCropEditor, mountedRef, replacePageThumbnails, replacePreview]);

  const refreshReview = useCallback(
    async (
      session: JscanifyDocumentSession,
      pageIndex: number,
      operationGeneration: number
    ): Promise<boolean> => {
      const thumbnails = await createDocumentPageThumbnails(session);
      let preview;
      try {
        preview = await createDocumentScanPreview(session, pageIndex);
      } catch (error) {
        for (const thumbnail of thumbnails) revokeDocumentScanPreview(thumbnail.objectUrl);
        throw error;
      }
      if (!mountedRef.current || operationGenerationRef.current !== operationGeneration) {
        revokeDocumentScanPreview(preview.objectUrl);
        for (const thumbnail of thumbnails) revokeDocumentScanPreview(thumbnail.objectUrl);
        return false;
      }
      replacePreview(preview.objectUrl);
      replacePageThumbnails(thumbnails);
      setPageCount(preview.pageCount);
      setDetectedPageCount(preview.detectedPageCount);
      setSelectedPageIndex(pageIndex);
      setFilterMode(getDocumentScanPageFilter(session, pageIndex));
      return true;
    },
    [mountedRef, operationGenerationRef, replacePageThumbnails, replacePreview]
  );

  useEffect(
    () => () => {
      revokeDocumentScanPreview(previewRef.current);
      previewRef.current = null;
      for (const thumbnail of thumbnailsRef.current) {
        revokeDocumentScanPreview(thumbnail.objectUrl);
      }
      thumbnailsRef.current = [];
      revokeDocumentScanPreview(cropEditorRef.current?.sourceObjectUrl ?? null);
      cropEditorRef.current = null;
    },
    []
  );

  const openCropEditor = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    closeCropEditor();
    const nextCropEditor = createDocumentCropEditorState(session, selectedPageIndex);
    cropEditorRef.current = nextCropEditor;
    setCropEditor(nextCropEditor);
    setErrorMessage(null);
    setPhase('crop-editing');
  }, [closeCropEditor, selectedPageIndex, sessionRef, setErrorMessage, setPhase]);

  const cancelCropEditor = useCallback(() => {
    closeCropEditor();
    setErrorMessage(null);
    setPhase('review');
  }, [closeCropEditor, setErrorMessage, setPhase]);

  const addPages = useCallback(
    async (files: ReadonlyArray<File>) => {
      const session = sessionRef.current;
      if (!session || !files.length) return;
      const previousPageCount = session.pages.length;
      const operationGeneration = operationGenerationRef.current + 1;
      operationGenerationRef.current = operationGeneration;
      setErrorMessage(null);
      setPhase('adding-pages');
      try {
        const firstAddedPageIndex = await appendJscanifyDocumentPages(session, files);
        if (!mountedRef.current || operationGenerationRef.current !== operationGeneration) return;
        if (await refreshReview(session, firstAddedPageIndex, operationGeneration)) {
          setPhase('review');
        }
      } catch (error) {
        if (!mountedRef.current || operationGenerationRef.current !== operationGeneration) return;
        session.pages.splice(previousPageCount);
        setErrorMessage(
          error instanceof Error ? error.message : 'No se pudo agregar la nueva página.'
        );
        setPhase('review');
      }
    },
    [mountedRef, operationGenerationRef, refreshReview, sessionRef, setErrorMessage, setPhase]
  );

  const applyCrop = useCallback(
    async (corners: DocumentScanCorners) => {
      const session = sessionRef.current;
      if (!session) return;
      const previousPage = session.pages[selectedPageIndex];
      const operationGeneration = operationGenerationRef.current + 1;
      operationGenerationRef.current = operationGeneration;
      setErrorMessage(null);
      setPhase('cropping');
      try {
        await applyDocumentScanCrop(session, selectedPageIndex, corners);
        if (!mountedRef.current || operationGenerationRef.current !== operationGeneration) return;
        if (!(await refreshReview(session, selectedPageIndex, operationGeneration))) return;
        closeCropEditor();
        setPhase('review');
      } catch (error) {
        if (!mountedRef.current || operationGenerationRef.current !== operationGeneration) return;
        if (previousPage) session.pages[selectedPageIndex] = previousPage;
        setErrorMessage(
          error instanceof Error ? error.message : 'No se pudo aplicar el recorte manual.'
        );
        setPhase('crop-editing');
      }
    },
    [
      closeCropEditor,
      mountedRef,
      operationGenerationRef,
      refreshReview,
      selectedPageIndex,
      sessionRef,
      setErrorMessage,
      setPhase,
    ]
  );

  const changeFilter = useCallback(
    async (mode: DocumentScanFilterMode) => {
      const session = sessionRef.current;
      if (!session || mode === filterMode) return;
      const previousMode = getDocumentScanPageFilter(session, selectedPageIndex);
      const operationGeneration = operationGenerationRef.current + 1;
      operationGenerationRef.current = operationGeneration;
      setErrorMessage(null);
      setPhase('filtering');
      try {
        await applyDocumentScanFilter(session, selectedPageIndex, mode);
        if (!mountedRef.current || operationGenerationRef.current !== operationGeneration) return;
        if (await refreshReview(session, selectedPageIndex, operationGeneration))
          setPhase('review');
      } catch (error) {
        await applyDocumentScanFilter(session, selectedPageIndex, previousMode).catch(
          () => undefined
        );
        if (!mountedRef.current || operationGenerationRef.current !== operationGeneration) return;
        setErrorMessage(error instanceof Error ? error.message : 'No se pudo aplicar el filtro.');
        setPhase('review');
      }
    },
    [
      filterMode,
      mountedRef,
      operationGenerationRef,
      refreshReview,
      selectedPageIndex,
      sessionRef,
      setErrorMessage,
      setPhase,
    ]
  );

  const selectPage = useCallback(
    async (pageIndex: number) => {
      const session = sessionRef.current;
      if (!session || pageIndex === selectedPageIndex || !session.pages[pageIndex]) return;
      const operationGeneration = operationGenerationRef.current + 1;
      operationGenerationRef.current = operationGeneration;
      setErrorMessage(null);
      setPhase('editing');
      try {
        if (await refreshReview(session, pageIndex, operationGeneration)) setPhase('review');
      } catch (error) {
        if (!mountedRef.current || operationGenerationRef.current !== operationGeneration) return;
        setErrorMessage(error instanceof Error ? error.message : 'No se pudo abrir la página.');
        setPhase('review');
      }
    },
    [
      mountedRef,
      operationGenerationRef,
      refreshReview,
      selectedPageIndex,
      sessionRef,
      setErrorMessage,
      setPhase,
    ]
  );

  const runPageEdit = useCallback(
    async (
      edit: (session: JscanifyDocumentSession) => Promise<number> | number,
      fallbackMessage: string
    ) => {
      const session = sessionRef.current;
      if (!session) return;
      const previousPages = session.pages.slice();
      const operationGeneration = operationGenerationRef.current + 1;
      operationGenerationRef.current = operationGeneration;
      setErrorMessage(null);
      setPhase('editing');
      try {
        const nextPageIndex = await edit(session);
        if (!mountedRef.current || operationGenerationRef.current !== operationGeneration) return;
        if (await refreshReview(session, nextPageIndex, operationGeneration)) setPhase('review');
      } catch (error) {
        if (!mountedRef.current || operationGenerationRef.current !== operationGeneration) return;
        session.pages.splice(0, session.pages.length, ...previousPages);
        setErrorMessage(error instanceof Error ? error.message : fallbackMessage);
        setPhase('review');
      }
    },
    [mountedRef, operationGenerationRef, refreshReview, sessionRef, setErrorMessage, setPhase]
  );

  const rotatePage = useCallback(
    () =>
      runPageEdit(async session => {
        await rotateDocumentScanPage(session, selectedPageIndex);
        return selectedPageIndex;
      }, 'No se pudo rotar la página.'),
    [runPageEdit, selectedPageIndex]
  );

  const redetectBorders = useCallback(
    () =>
      runPageEdit(async session => {
        await redetectDocumentScanPage(session, selectedPageIndex);
        return selectedPageIndex;
      }, 'No se pudieron volver a detectar los bordes.'),
    [runPageEdit, selectedPageIndex]
  );

  const movePage = useCallback(
    (offset: -1 | 1) =>
      runPageEdit(
        session => reorderDocumentScanPage(session, selectedPageIndex, selectedPageIndex + offset),
        'No se pudo cambiar el orden de la página.'
      ),
    [runPageEdit, selectedPageIndex]
  );

  const deletePage = useCallback(
    () =>
      runPageEdit(
        session => deleteDocumentScanPage(session, selectedPageIndex),
        'No se pudo eliminar la página.'
      ),
    [runPageEdit, selectedPageIndex]
  );

  return {
    filterMode,
    previewObjectUrl,
    pageThumbnails,
    cropEditor,
    pageCount,
    selectedPageIndex,
    detectedPageCount,
    refreshReview,
    clearReview,
    addPages,
    openCropEditor,
    cancelCropEditor,
    applyCrop,
    changeFilter,
    selectPage,
    rotatePage,
    redetectBorders,
    movePage,
    deletePage,
  };
};
