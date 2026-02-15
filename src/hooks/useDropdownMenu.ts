import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

interface UseDropdownMenuResult {
  isOpen: boolean;
  menuRef: RefObject<HTMLDivElement | null>;
  setIsOpen: (nextIsOpen: boolean) => void;
  toggle: () => void;
  close: () => void;
}

interface UseDropdownMenuOptions {
  closeOnOutsideClick?: boolean;
  closeOnEscape?: boolean;
}

export const useDropdownMenu = ({
  closeOnOutsideClick = true,
  closeOnEscape = true,
}: UseDropdownMenuOptions = {}): UseDropdownMenuResult => {
  const [isOpen, setIsOpenState] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (
        closeOnOutsideClick &&
        menuRef.current &&
        !menuRef.current.contains(event.target as Node)
      ) {
        setIsOpenState(false);
      }
    };

    const handleEscapeKey = (event: KeyboardEvent) => {
      if (closeOnEscape && event.key === 'Escape') {
        setIsOpenState(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscapeKey);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscapeKey);
    };
  }, [isOpen, closeOnEscape, closeOnOutsideClick]);

  const setIsOpen = useCallback((nextIsOpen: boolean) => {
    setIsOpenState(nextIsOpen);
  }, []);

  const toggle = useCallback(() => {
    setIsOpenState(previousIsOpen => !previousIsOpen);
  }, []);

  const close = useCallback(() => {
    setIsOpenState(false);
  }, []);

  return {
    isOpen,
    menuRef,
    setIsOpen,
    toggle,
    close,
  };
};
