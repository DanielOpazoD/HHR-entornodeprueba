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

  const bodyFocusable = modalRef.current.querySelector(
    'input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
  ) as HTMLElement | null;

  if (bodyFocusable) {
    bodyFocusable.focus();
    return;
  }

  const firstFocusable = modalRef.current.querySelector(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  ) as HTMLElement | null;

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

  const focusableElements = modalRef.current.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  const firstElement = focusableElements[0] as HTMLElement | undefined;
  const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement | undefined;

  if (!firstElement || !lastElement) {
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

  React.useEffect(() => {
    if (!isOpen) {
      return () => undefined;
    }

    const runtimeWindow = dependencies.getWindow?.() ?? null;
    const runtimeDocument = dependencies.getDocument?.() ?? null;

    if (!runtimeDocument) {
      return () => undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
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

    runtimeDocument.addEventListener('keydown', handleKeyDown);
    const focusTimeout = (runtimeWindow?.setTimeout ?? setTimeout)(
      () => focusFirstModalElement(modalRef, initialFocusRef, runtimeDocument),
      100
    );

    return () => {
      (runtimeWindow?.clearTimeout ?? clearTimeout)(focusTimeout);

      runtimeDocument.removeEventListener('keydown', handleKeyDown);
    };
  }, [dependencies, initialFocusRef, isOpen]);

  return { modalRef };
};
