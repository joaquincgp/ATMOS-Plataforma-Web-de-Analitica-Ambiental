import { useEffect, useState, type ComponentType, type CSSProperties } from 'react';

interface PlotlyFigure {
  data?: unknown[];
  layout?: Record<string, unknown>;
  frames?: unknown[];
}

interface PlotComponentProps {
  data: never[];
  layout: never;
  frames: never[];
  config: never;
  useResizeHandler?: boolean;
  style?: CSSProperties;
  onError?: (error: Error) => void;
  onInitialized?: () => void;
  onRelayout?: (event: Record<string, unknown>) => void;
}

type PlotComponent = ComponentType<PlotComponentProps>;

function normalizePlotlyTitle(value: unknown): unknown {
  if (typeof value === 'string') {
    return { text: value, font: { size: 14 } };
  }
  if (value && typeof value === 'object') {
    const title = value as Record<string, unknown>;
    const font = title.font && typeof title.font === 'object' ? title.font as Record<string, unknown> : {};
    return {
      ...title,
      text: typeof title.text === 'string' ? title.text : '',
      font: {
        ...font,
        size: typeof font.size === 'number' ? font.size : 14,
      },
    };
  }
  return { text: '', font: { size: 14 } };
}

function normalizeAxis(value: unknown): unknown {
  if (!value || typeof value !== 'object') {
    return value;
  }
  const axis = value as Record<string, unknown>;
  return {
    ...axis,
    title: normalizePlotlyTitle(axis.title),
  };
}

function normalizeAxes(layout: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(layout)
      .filter(([key]) => /^[xy]axis\d*$/.test(key))
      .map(([key, value]) => [key, normalizeAxis(value)]),
  );
}

export function PlotlyChart({
  figure,
  height = 560,
  className = '',
  enableTimeNavigation = false,
  uirevision,
  onViewportChange,
}: {
  figure: PlotlyFigure | null | undefined;
  height?: number;
  className?: string;
  enableTimeNavigation?: boolean;
  uirevision?: string;
  onViewportChange?: (viewport: { from: string | null; to: string | null }) => void;
}) {
  const [PlotComponent, setPlotComponent] = useState<PlotComponent | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    let cancelled = false;

    void import('react-plotly.js')
      .then((module) => {
        if (cancelled) {
          return;
        }
        setPlotComponent(() => module.default as PlotComponent);
        setLoadError(null);
        setRenderError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setLoadError(error instanceof Error ? error.message : 'Failed to load Plotly.');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setRenderError(null);
  }, [figure]);

  if (!figure) {
    return <div className={`h-full w-full rounded-md border bg-white ${className}`} />;
  }

  if (loadError) {
    return (
      <div className={`flex h-full w-full items-center justify-center rounded-md border bg-white px-4 text-center text-sm text-muted-foreground ${className}`}>
        {loadError}
      </div>
    );
  }

  if (renderError) {
    return (
      <div className={`flex h-full w-full items-center justify-center rounded-md border bg-white px-4 text-center text-sm text-muted-foreground ${className}`}>
        {renderError}
      </div>
    );
  }

  if (!PlotComponent) {
    return (
      <div className={`flex h-full w-full items-center justify-center rounded-md border bg-white text-sm text-muted-foreground ${className}`}>
        Loading Plotly renderer...
      </div>
    );
  }

  const baseLayout = figure.layout ?? {};
  const layout = {
    ...baseLayout,
    ...normalizeAxes(baseLayout),
    title: normalizePlotlyTitle(baseLayout.title),
    autosize: true,
    height,
    dragmode: enableTimeNavigation ? 'pan' : (figure.layout?.dragmode as string | undefined),
    uirevision: uirevision ?? 'plotly-chart',
  };

  const handleRelayout = (event: Record<string, unknown>) => {
    if (!enableTimeNavigation || !onViewportChange) {
      return;
    }
    const rangeKey = Object.keys(event).find((key) => /^xaxis\d*\.range\[0\]$/.test(key));
    const axisPrefix = rangeKey?.replace('.range[0]', '') ?? 'xaxis';
    const fromValue = event[`${axisPrefix}.range[0]`];
    const toValue = event[`${axisPrefix}.range[1]`];
    const from = typeof fromValue === 'string' ? fromValue : null;
    const to = typeof toValue === 'string' ? toValue : null;
    if (from && to) {
      onViewportChange({ from, to });
      return;
    }
    if (Object.keys(event).some((key) => /^xaxis\d*\.autorange$/.test(key))) {
      onViewportChange({ from: null, to: null });
    }
  };

  return (
    <div className={`relative h-full w-full overflow-hidden rounded-md border bg-white ${className}`}>
      <PlotComponent
        data={(figure.data ?? []) as never[]}
        layout={layout as never}
        frames={(figure.frames ?? []) as never[]}
        config={
          {
            responsive: true,
            displaylogo: false,
            scrollZoom: true,
            modeBarButtonsToRemove: ['lasso2d', 'select2d'],
          } as never
        }
        onError={(error) => setRenderError(error.message)}
        onInitialized={() => setRenderError(null)}
        onRelayout={handleRelayout}
        useResizeHandler
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
}
