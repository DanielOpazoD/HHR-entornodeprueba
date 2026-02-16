import React, { Component, ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { errorService } from '@/services/utils/errorService';
import {
  defaultBrowserWindowRuntime,
  getNavigatorUserAgent,
  writeClipboardText,
} from '@/shared/runtime/browserWindowRuntime';

interface Props {
  children: ReactNode;
  fallbackComponent?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

/**
 * Global Error Boundary
 * Catches all unhandled errors in the React component tree
 */
export class GlobalErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log error to error service
    errorService.logError({
      message: `React Error Boundary: ${error.message}`,
      severity: 'critical',
      error,
      stack: errorInfo.componentStack || undefined,
      context: {
        componentStack: errorInfo.componentStack || undefined,
        errorInfo,
      },
    });

    this.setState({
      error,
      errorInfo,
    });
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
    defaultBrowserWindowRuntime.reload();
  };

  handleReportError = () => {
    const { error, errorInfo } = this.state;
    const errorData = {
      error: error?.message,
      stack: error?.stack,
      componentStack: errorInfo?.componentStack,
      timestamp: new Date().toISOString(),
      userAgent: getNavigatorUserAgent(),
      url: defaultBrowserWindowRuntime.getLocationHref(),
    };

    // Copy error to clipboard for easy reporting
    void writeClipboardText(JSON.stringify(errorData, null, 2))
      .then(() => {
        defaultBrowserWindowRuntime.alert(
          'Información del error copiada al portapapeles. Por favor, envíe esto al administrador.'
        );
      })
      .catch(() => {
        defaultBrowserWindowRuntime.alert(
          'No se pudo copiar el error automáticamente. Por favor, contacte al administrador.'
        );
      });
  };

  render() {
    if (this.state.hasError) {
      // Custom fallback UI if provided
      if (this.props.fallbackComponent) {
        return this.props.fallbackComponent;
      }

      // Default error UI
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
          <div className="max-w-2xl w-full bg-white rounded-xl shadow-lg p-8 border border-red-200">
            {/* Icon */}
            <div className="flex justify-center mb-6">
              <div className="bg-red-100 p-4 rounded-full">
                <AlertTriangle className="text-red-600" size={48} />
              </div>
            </div>

            {/* Title */}
            <h1 className="text-2xl font-bold text-center text-slate-800 mb-4">
              ¡Ups! Algo salió mal
            </h1>

            {/* Message */}
            <p className="text-center text-slate-600 mb-6">
              La aplicación encontró un error inesperado. No se preocupe, sus datos están seguros.
            </p>

            {/* Error details (collapsible in production) */}
            {import.meta.env.DEV && this.state.error && (
              <details className="mb-6 bg-slate-50 p-4 rounded-lg border border-slate-200">
                <summary className="cursor-pointer font-semibold text-slate-700 mb-2">
                  Detalles técnicos (solo visible en desarrollo)
                </summary>
                <pre className="text-xs text-red-600 overflow-auto">
                  {this.state.error.message}
                  {'\n\n'}
                  {this.state.error.stack}
                </pre>
              </details>
            )}

            {/* Actions */}
            <div className="flex gap-4 justify-center">
              <button
                onClick={this.handleReset}
                className="bg-medical-600 text-white font-semibold px-6 py-3 rounded-lg hover:bg-medical-700 transition-colors"
              >
                Recargar Aplicación
              </button>
              <button
                onClick={this.handleReportError}
                className="bg-slate-200 text-slate-700 font-semibold px-6 py-3 rounded-lg hover:bg-slate-300 transition-colors"
              >
                Copiar Error (para reportar)
              </button>
            </div>

            {/* Help text */}
            <p className="text-center text-sm text-slate-500 mt-6">
              Si el problema persiste, contacte al administrador del sistema.
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
