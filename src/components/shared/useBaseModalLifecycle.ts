import React from 'react';

import { useScrollLock } from '@/hooks/useScrollLock';

export interface BaseModalLifecycleDependencies {
  getWindow?: () => Window | null;
  getDocument?: () => Document | null;
}

const getDefaultWindow = (): Window | null => (typeof window !== 'undefined' ? window : null);

const getDefaultDocument = (): Document | null => {
  if (typeof window !== 'undefined' && window.document) {
    return window.document;
  }

  if (typeof document !== 'undefined') {
    return document;
  }

  return null;
};

const sequentialControls = (modal: HTMLElement): HTMLElement[] =>
  Array.from(
    modal.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]')
  ).filter(
    element =>
      element.tabIndex >= 0 &&
      !element.matches(':disabled') &&
      !element.closest('[hidden], [inert], [aria-hidden="true"]') &&
      getComputedStyle(element).display !== 'none' &&
      getComputedStyle(element).visibility !== 'hidden'
  );

export const resolveBaseModalLifecycleDependencies = (
  dependencies?: BaseModalLifecycleDependencies
): BaseModalLifecycleDependencies => ({
  getWindow: dependencies?.getWindow ?? getDefaultWindow,
  getDocument: dependencies?.getDocument ?? getDefaultDocument,
});

const focusFirstModalElement = (
  modalRef: React.RefObject<HTMLDivElement | null>,
  initialFocusRef: React.RefObject<HTMLElement | null> | undefined,
  runtimeDocument: Document | null
) => {
  if (initialFocusRef?.current) {
    initialFocusRef.current.focus();
    return;
  }

  if (!modalRef.current || !runtimeDocument) {
    return;
  }

  const controls = sequentialControls(modalRef.current);
  const bodyFocusable = controls.find(element => element.matches('input, select, textarea'));

  if (bodyFocusable) {
    bodyFocusable.focus();
    return;
  }

  const firstFocusable = controls[0];

  (firstFocusable ?? modalRef.current).focus();
};

const trapModalTabNavigation = (
  event: KeyboardEvent,
  modalRef: React.RefObject<HTMLDivElement | null>,
  runtimeDocument: Document | null
) => {
  if (event.key !== 'Tab' || !modalRef.current || !runtimeDocument) {
    return;
  }

  const focusableElements = sequentialControls(modalRef.current);
  const firstElement = focusableElements[0] as HTMLElement | undefined;
  const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement | undefined;

  if (!firstElement || !lastElement) {
    event.preventDefault();
    modalRef.current.focus();
    return;
  }

  if (event.shiftKey && runtimeDocument.activeElement === firstElement) {
    lastElement.focus();
    event.preventDefault();
    return;
  }

  if (!event.shiftKey && runtimeDocument.activeElement === lastElement) {
    firstElement.focus();
    event.preventDefault();
  }
};

/**
 * Enter should confirm the modal — EXCEPT when the user is in a control that owns Enter itself:
 * a multi-line textarea (newline), a button/link (its own click), a select, or contenteditable.
 */
const shouldConfirmOnEnter = (target: EventTarget | null): boolean => {
  const element = target as HTMLElement | null;
  if (!element || element.isContentEditable) return false;
  const tag = element.tagName;
  return tag !== 'TEXTAREA' && tag !== 'BUTTON' && tag !== 'A' && tag !== 'SELECT';
};

export const useBaseModalLifecycle = ({
  isOpen,
  onClose,
  onConfirm,
  initialFocusRef,
  lifecycleDependencies,
}: {
  isOpen: boolean;
  onClose: () => void;
  /** Optional: pressing Enter (outside a textarea/button/select) triggers this — "grabar/aceptar". */
  onConfirm?: () => void;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  lifecycleDependencies?: BaseModalLifecycleDependencies;
}) => {
  const modalRef = React.useRef<HTMLDivElement>(null);
  const onCloseRef = React.useRef(onClose);
  const onConfirmRef = React.useRef(onConfirm);
  const dependencies = React.useMemo(
    () => resolveBaseModalLifecycleDependencies(lifecycleDependencies),
    [lifecycleDependencies]
  );

  React.useEffect(() => {
    onCloseRef.current = onClose;
    onConfirmRef.current = onConfirm;
  }, [onClose, onConfirm]);

  useScrollLock(isOpen);

  const [opening, setOpening] = React.useState(() => ({
    isOpen,
    opener: dependencies.getDocument?.()?.activeElement as HTMLElement | null,
  }));
  // Capture before descendants mount: autoFocus runs before layout effects.
  if (opening.isOpen !== isOpen) {
    setOpening({
      isOpen,
      opener: dependencies.getDocument?.()?.activeElement as HTMLElement | null,
    });
  }

  React.useLayoutEffect(() => {
    if (!isOpen) {
      return () => undefined;
    }

    const runtimeDocument = dependencies.getDocument?.() ?? null;

    if (!runtimeDocument) {
      return () => undefined;
    }

    const opener = opening.opener;
    const openedModal = modalRef.current;

    const handleKeyDown = (event: KeyboardEvent) => {
      const focusedDialog = runtimeDocument.activeElement?.closest('[role="dialog"]');
      if (focusedDialog && focusedDialog !== modalRef.current) return;
      if (event.key === 'Escape') {
        onCloseRef.current();
      }

      if (
        event.key === 'Enter' &&
        !event.shiftKey &&
        onConfirmRef.current &&
        shouldConfirmOnEnter(event.target)
      ) {
        event.preventDefault();
        onConfirmRef.current();
      }

      trapModalTabNavigation(event, modalRef, runtimeDocument);
    };

    // Establish ownership before keyboard input, preserving explicit child autoFocus.
    if (!openedModal?.contains(runtimeDocument.activeElement)) {
      focusFirstModalElement(modalRef, initialFocusRef, runtimeDocument);
    }
    runtimeDocument.addEventListener('keydown', handleKeyDown);

    return () => {
      runtimeDocument.removeEventListener('keydown', handleKeyDown);
      const active = runtimeDocument.activeElement;
      if (
        opener?.isConnected &&
        (active === runtimeDocument.body || openedModal?.contains(active))
      ) {
        opener.focus();
      }
    };
  }, [dependencies, initialFocusRef, isOpen, opening.opener]);

  return { modalRef };
};
