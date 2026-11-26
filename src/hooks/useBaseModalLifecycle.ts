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

const SEQUENTIAL_CONTROLS =
  'button, [href], input, select, textarea, details > summary:first-of-type, [contenteditable]:not([contenteditable="false"]), audio[controls], video[controls], iframe, [tabindex]';
const BODY_CONTROLS = 'input, select, textarea';
const SEGMENTED_INPUT_TYPES = new Set(['date', 'time', 'datetime-local', 'month', 'week']);

const isContentEditableControl = (element: HTMLElement): boolean => {
  if (element.isContentEditable) return true;
  const attr = element.getAttribute('contenteditable');
  return attr !== null && attr.toLowerCase() !== 'false';
};

const isSegmentedNativeInput = (element: HTMLElement | null): element is HTMLInputElement =>
  element instanceof HTMLInputElement && SEGMENTED_INPUT_TYPES.has(element.type);

const isInsideClosedDetailsBody = (element: HTMLElement): boolean => {
  let ancestorDetails = element.parentElement?.closest('details') ?? null;
  while (ancestorDetails) {
    if (!ancestorDetails.open) {
      const ownSummary = ancestorDetails.querySelector(':scope > summary');
      if (element !== ownSummary && !ownSummary?.contains(element)) {
        return true;
      }
    }
    ancestorDetails = ancestorDetails.parentElement?.closest('details') ?? null;
  }
  return false;
};

const isSequentiallyFocusable = (element: HTMLElement): boolean => {
  const explicitTabIndex = element.getAttribute('tabindex');
  const hasNegativeTabIndex =
    explicitTabIndex !== null
      ? Number(explicitTabIndex) < 0
      : element.tabIndex < 0 && !isContentEditableControl(element);
  if (
    hasNegativeTabIndex ||
    element.matches(':disabled') ||
    element.closest('[hidden], [inert], [aria-hidden="true"]') ||
    isInsideClosedDetailsBody(element)
  ) {
    return false;
  }
  const style = getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden';
};

const sequentialControls = (modal: HTMLElement): HTMLElement[] => {
  const candidates = Array.from(modal.querySelectorAll<HTMLElement>(SEQUENTIAL_CONTROLS)).filter(
    isSequentiallyFocusable
  );
  const checkedRadioGroups = new Set<string>();
  for (const element of candidates) {
    if (
      element instanceof HTMLInputElement &&
      element.type === 'radio' &&
      element.name &&
      element.checked
    ) {
      checkedRadioGroups.add(element.name);
    }
  }
  const seenUncheckedRadioGroups = new Set<string>();
  return candidates.filter(element => {
    if (!(element instanceof HTMLInputElement) || element.type !== 'radio' || !element.name) {
      return true;
    }
    if (checkedRadioGroups.has(element.name)) {
      return element.checked;
    }
    if (seenUncheckedRadioGroups.has(element.name)) {
      return false;
    }
    seenUncheckedRadioGroups.add(element.name);
    return true;
  });
};

/** Stops at the first match, so a long form does not compute the style of every control. */
const firstSequentialControl = (modal: HTMLElement, selector: string): HTMLElement | undefined =>
  Array.from(modal.querySelectorAll<HTMLElement>(selector)).find(isSequentiallyFocusable);

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

  const firstFocusable =
    firstSequentialControl(modalRef.current, BODY_CONTROLS) ??
    firstSequentialControl(modalRef.current, SEQUENTIAL_CONTROLS);

  (firstFocusable ?? modalRef.current).focus();
};

const trapModalTabNavigation = (
  event: KeyboardEvent,
  modalRef: React.RefObject<HTMLDivElement | null>,
  runtimeDocument: Document | null,
  onSegmentedNativeTab?: (direction: 'forward' | 'backward', from: HTMLElement) => void
) => {
  if (event.key !== 'Tab' || event.defaultPrevented || !modalRef.current || !runtimeDocument) {
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

  const activeElement = runtimeDocument.activeElement as HTMLElement | null;
  // Let native segmented date/time inputs step between their internal segments (dd -> mm -> yyyy).
  // A short-lived focusin guard wraps focus back inside the modal if native Tab exits its bounds.
  if (isSegmentedNativeInput(activeElement) && modalRef.current.contains(activeElement)) {
    onSegmentedNativeTab?.(event.shiftKey ? 'backward' : 'forward', activeElement);
    return;
  }

  const currentIndex = activeElement ? focusableElements.indexOf(activeElement) : -1;

  // Step explicitly through every sequential control so browsers where native Tab skips buttons
  // (e.g. WebKit/Safari default keyboard mode) cannot escape a button-only dialog into the page.
  event.preventDefault();
  if (currentIndex === -1) {
    (event.shiftKey ? lastElement : firstElement).focus();
    return;
  }

  const nextIndex = event.shiftKey
    ? (currentIndex - 1 + focusableElements.length) % focusableElements.length
    : (currentIndex + 1) % focusableElements.length;
  focusableElements[nextIndex]?.focus();
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
    const runtimeWindow = dependencies.getWindow?.() ?? null;

    if (!runtimeDocument) {
      return () => undefined;
    }

    const opener = opening.opener;
    const openedModal = modalRef.current;
    let pendingSegmentedTab: { direction: 'forward' | 'backward'; from: HTMLElement } | null = null;
    let clearPendingTabTimer: number | null = null;
    const clearPendingSegmentedTab = () => {
      pendingSegmentedTab = null;
      if (clearPendingTabTimer !== null) {
        runtimeWindow?.clearTimeout(clearPendingTabTimer);
        clearPendingTabTimer = null;
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const focusedDialog = runtimeDocument.activeElement?.closest('[role="dialog"]');
      if (focusedDialog && focusedDialog !== modalRef.current) return;
      if (event.key === 'Escape') {
        onCloseRef.current();
      }

      if (
        event.key === 'Enter' &&
        !event.shiftKey &&
        !event.defaultPrevented &&
        onConfirmRef.current &&
        shouldConfirmOnEnter(event.target)
      ) {
        event.preventDefault();
        onConfirmRef.current();
      }

      trapModalTabNavigation(event, modalRef, runtimeDocument, (direction, from) => {
        clearPendingSegmentedTab();
        pendingSegmentedTab = { direction, from };
        clearPendingTabTimer = runtimeWindow?.setTimeout(clearPendingSegmentedTab, 0) ?? null;
      });
    };

    const handleFocusIn = (event: FocusEvent) => {
      const pending = pendingSegmentedTab;
      if (!pending || !modalRef.current) return;
      clearPendingSegmentedTab();
      const target = event.target as HTMLElement | null;
      if (target && (modalRef.current.contains(target) || target.closest('[role="dialog"]'))) {
        return;
      }
      const focusableElements = sequentialControls(modalRef.current);
      if (!focusableElements.length) {
        modalRef.current.focus();
        return;
      }
      const fromIndex = focusableElements.indexOf(pending.from);
      if (fromIndex === -1) {
        (pending.direction === 'backward'
          ? focusableElements[focusableElements.length - 1]
          : focusableElements[0]
        )?.focus();
        return;
      }
      const nextIndex =
        pending.direction === 'backward'
          ? (fromIndex - 1 + focusableElements.length) % focusableElements.length
          : (fromIndex + 1) % focusableElements.length;
      focusableElements[nextIndex]?.focus();
    };

    // Establish ownership before keyboard input, preserving explicit child autoFocus.
    if (!openedModal?.contains(runtimeDocument.activeElement)) {
      focusFirstModalElement(modalRef, initialFocusRef, runtimeDocument);
    }
    runtimeDocument.addEventListener('keydown', handleKeyDown);
    runtimeDocument.addEventListener('focusin', handleFocusIn);

    return () => {
      clearPendingSegmentedTab();
      runtimeDocument.removeEventListener('keydown', handleKeyDown);
      runtimeDocument.removeEventListener('focusin', handleFocusIn);
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
