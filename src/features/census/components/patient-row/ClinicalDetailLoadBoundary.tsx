import React, { Component, Suspense, type ReactNode } from 'react';
import { BaseModal } from '@/components/shared/BaseModal';

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/** Keep a missing detail chunk from taking down the census or reloading an active edit. */
export class ClinicalDetailLoadBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    const { title, onClose, children } = this.props;
    const pending = (
      <BaseModal isOpen title={title} onClose={onClose} variant="white">
        <p role="status" className="text-sm text-slate-600">
          Cargando detalle…
        </p>
      </BaseModal>
    );

    if (this.state.failed) {
      return (
        <BaseModal isOpen title={title} onClose={onClose} variant="white">
          <p role="alert" className="text-sm text-slate-600">
            No se pudo cargar el detalle. Cierra este cuadro y vuelve a cargar la aplicación.
          </p>
        </BaseModal>
      );
    }

    return <Suspense fallback={pending}>{children}</Suspense>;
  }
}
