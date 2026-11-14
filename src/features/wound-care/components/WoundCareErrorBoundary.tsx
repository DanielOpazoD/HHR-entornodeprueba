import React, { Component } from 'react';
import { Camera, RefreshCw } from 'lucide-react';
import { createScopedLogger } from '@/services/utils/loggerScope';

interface Props {
  children: React.ReactNode;
  patientName?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

const woundCareErrorBoundaryLogger = createScopedLogger('WoundCareErrorBoundary');

/**
 * Error boundary for the wound care module.
 * Catches render errors in photo gallery, upload modals, and lightbox
 * without crashing the entire handoff view.
 */
export class WoundCareErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo) {
    woundCareErrorBoundaryLogger.error('Error boundary caught', {
      error,
      componentStack: info.componentStack,
      patientName: this.props.patientName,
    });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  override render() {
    if (this.state.hasError) {
      return (
        <div className="relative flex flex-col items-center justify-center p-6 text-center overflow-hidden">
          <Camera className="absolute w-32 h-32 text-slate-100 opacity-10 pointer-events-none" />
          <Camera className="w-8 h-8 text-slate-300 mb-2 relative" />
          <p className="text-sm text-slate-500 mb-1 relative">
            Error al cargar el registro fotográfico
            {this.props.patientName ? ` de ${this.props.patientName}` : ''}
          </p>
          <p className="text-xs text-slate-400 mb-3 relative">
            Ocurrió un problema inesperado. Por favor, reintente.
          </p>
          <button
            type="button"
            onClick={this.handleRetry}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-sky-600 bg-sky-50 hover:bg-sky-100 rounded-lg transition-colors relative"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Reintentar
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
