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
}

type PlotComponent = ComponentType<PlotComponentProps>;

export function PlotlyChart({
  figure,
  height = 560,
  className = '',
}: {
  figure: PlotlyFigure | null | undefined;
  height?: number;
  className?: string;
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

  return (
    <div className={`h-full w-full overflow-hidden rounded-md border bg-white ${className}`}>
      <PlotComponent
        data={(figure.data ?? []) as never[]}
        layout={
          {
            ...(figure.layout ?? {}),
            autosize: true,
            height,
          } as never
        }
        frames={(figure.frames ?? []) as never[]}
        config={
          {
            responsive: true,
            displaylogo: false,
            modeBarButtonsToRemove: ['lasso2d', 'select2d'],
          } as never
        }
        onError={(error) => setRenderError(error.message)}
        onInitialized={() => setRenderError(null)}
        useResizeHandler
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
}
