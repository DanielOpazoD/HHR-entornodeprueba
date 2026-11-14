/**
 * @module LabChartErrorBoundary
 * @description Error boundary that catches rendering errors in Recharts components.
 * Displays a friendly message instead of crashing the entire analysis view.
 */

import React from 'react';

interface Props {
  children: React.ReactNode;
  chartLabel?: string;
}

interface State {
  hasError: boolean;
}

export class LabChartErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center rounded-xl border border-amber-200 bg-amber-50 px-4 py-8 text-center">
          <p className="text-[12px] text-amber-700">
            No se pudo renderizar el gráfico
            {this.props.chartLabel ? ` de ${this.props.chartLabel}` : ''}.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
