import type React from 'react';
import type { ModalSize } from '@/components/shared/baseModalStyles';

export interface BaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Optional: Enter (outside a textarea/button/select) confirms — "grabar/aceptar". */
  onConfirm?: () => void;
  title: React.ReactNode;
  icon?: React.ReactNode;
  size?: ModalSize;
  children: React.ReactNode;
  className?: string;
  closeOnBackdrop?: boolean;
  showCloseButton?: boolean;
  headerIconColor?: string;
  variant?: 'glass' | 'white';
  printable?: boolean;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  headerActions?: React.ReactNode;
  bodyClassName?: string;
  scrollableBody?: boolean;
  dataModule?: string;
  dataTestId?: string;
}
