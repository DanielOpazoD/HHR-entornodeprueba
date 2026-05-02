import React from 'react';
import { createPortal } from 'react-dom';
import type { BaseModalProps } from '@/components/shared/baseModalContracts';
import {
  resolveBaseModalContainerClassName,
  shouldCloseBaseModalFromBackdropClick,
} from '@/components/shared/baseModalController';
import {
  BaseModalBackdrop,
  BaseModalBody,
  BaseModalHeader,
} from '@/components/shared/baseModalLayout';
import { useBaseModalLifecycle } from '@/components/shared/useBaseModalLifecycle';

export const BaseModalContent: React.FC<BaseModalProps> = ({
  isOpen,
  onClose,
  title,
  icon,
  size = 'md',
  children,
  className,
  closeOnBackdrop = true,
  showCloseButton = true,
  headerIconColor = 'text-accent-600',
  variant = 'glass',
  printable = false,
  initialFocusRef,
  headerActions,
  bodyClassName,
  scrollableBody = true,
  dataModule,
  dataTestId,
}) => {
  const { modalRef } = useBaseModalLifecycle({ isOpen, onClose, initialFocusRef });

  if (!isOpen) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (
      shouldCloseBaseModalFromBackdropClick({
        closeOnBackdrop,
        target: e.target,
        currentTarget: e.currentTarget,
      })
    ) {
      onClose();
    }
  };

  const modalContent = (
    <BaseModalBackdrop
      printable={printable}
      scrollableBody={scrollableBody}
      onClick={handleBackdropClick}
    >
      <div
        ref={modalRef}
        data-module={dataModule}
        data-testid={dataTestId}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        className={resolveBaseModalContainerClassName({
          scrollableBody,
          variant,
          size,
          className,
        })}
      >
        <BaseModalHeader
          title={title}
          icon={icon}
          onClose={onClose}
          showCloseButton={showCloseButton}
          headerIconColor={headerIconColor}
          variant={variant}
          headerActions={headerActions}
        />
        <BaseModalBody scrollableBody={scrollableBody} bodyClassName={bodyClassName}>
          {children}
        </BaseModalBody>
      </div>
    </BaseModalBackdrop>
  );

  if (typeof document === 'undefined' || !document.body) {
    return null;
  }

  return createPortal(modalContent, document.body);
};
