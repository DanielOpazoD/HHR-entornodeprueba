import { useEffect, useId, useRef } from 'react';
import type { FocusEvent, KeyboardEvent } from 'react';
import { useDropdownMenu } from '@/hooks/useDropdownMenu';

/** Local navigation disclosures; no shared application or clinical state. */
export const useNavbarDisclosure = (scopeKey?: string) => {
  const { isOpen, menuRef, toggle, close } = useDropdownMenu();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  // An externally changed module/profile must not leave an old disclosure open.
  useEffect(() => {
    close();
  }, [close, scopeKey]);

  const closeAndRestoreFocus = () => {
    close();
    triggerRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && isOpen) {
      event.preventDefault();
      event.stopPropagation();
      closeAndRestoreFocus();
    }
  };

  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    // Clicking non-interactive help text may report a null relatedTarget.
    // Outside pointer dismissal remains owned by useDropdownMenu.
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) {
      close();
    }
  };

  return {
    isOpen,
    menuRef,
    triggerRef,
    panelId,
    toggle,
    close,
    closeAndRestoreFocus,
    onKeyDown,
    onBlur,
  };
};
