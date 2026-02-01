/**
 * SectionErrorBoundary
 * 
 * Error boundary that isolates failures to individual sections.
 * If one section crashes, other sections continue working.
 */

import React, { Component, ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface Props {
    children: ReactNode;
    /** Name of the section for error display */
    sectionName: string;
    /** Optional fallback height to maintain layout */
    fallbackHeight?: string;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class SectionErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error(`[SectionErrorBoundary] Error in ${this.props.sectionName}:`, error);
        console.error('Component stack:', errorInfo.componentStack);
    }

    handleRetry = () => {
        this.setState({ hasError: false, error: null });
    };

    render() {
        const { hasError, error } = this.state;
        const { children, sectionName, fallbackHeight = 'auto' } = this.props;

        if (hasError) {
            return (
                <div
                    className="bg-red-50 border border-red-200 rounded-lg p-4 my-2"
                    style={{ minHeight: fallbackHeight }}
                >
                    <div className="flex items-start gap-3">
                        <AlertCircle className="text-red-500 flex-shrink-0 mt-0.5\" size={20} />
                        <div className="flex-1">
                            <h4 className="font-medium text-red-800 mb-1">
                                Error en {sectionName}
                            </h4>
                            <p className="text-sm text-red-600 mb-3">
                                Esta sección tuvo un problema. El resto de la aplicación sigue funcionando.
                            </p>
                            {error && (
                                <details className="mb-3">
                                    <summary className="text-xs text-red-500 cursor-pointer hover:underline">
                                        Ver detalles técnicos
                                    </summary>
                                    <pre className="mt-2 text-xs bg-red-100 p-2 rounded overflow-auto max-h-32">
                                        {error.message}
                                    </pre>
                                </details>
                            )}
                            <button
                                onClick={this.handleRetry}
                                className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-red-700 bg-red-100 hover:bg-red-200 rounded-md transition-colors"
                            >
                                <RefreshCw size={14} />
                                Reintentar
                            </button>
                        </div>
                    </div>
                </div>
            );
        }

        return children;
    }
}

export default SectionErrorBoundary;
