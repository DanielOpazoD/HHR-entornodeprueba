import { Component, Suspense, type ReactNode } from 'react';
import { BaseModal, type BaseModalProps } from '@/components/shared/BaseModal';

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** The detail's own size, so the loading frame does not jump when the content arrives. */
  size?: BaseModalProps['size'];
}

/** Keep a missing detail chunk from taking down the census or reloading an active edit. */
export class ClinicalDetailLoadBoundary extends Component<Props, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    const { title, onClose, children, size } = this.props;
    const pending = (
      <BaseModal isOpen title={title} onClose={onClose} variant="white" size={size}>
        <p role="status" className="text-sm text-slate-600">
          Cargando detalle…
        </p>
      </BaseModal>
    );

    if (this.state.failed) {
      return (
        <BaseModal isOpen title={title} onClose={onClose} variant="white" size={size}>
          <p role="alert" className="text-sm text-slate-600">
            No se pudo cargar el detalle. Cierra este cuadro y vuelve a cargar la aplicación.
          </p>
        </BaseModal>
      );
    }

    return <Suspense fallback={pending}>{children}</Suspense>;
  }
}
