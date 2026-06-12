declare module 'plotly.js' {
  const Plotly: {
    newPlot: (element: HTMLElement, data: unknown[], layout?: unknown, config?: unknown) => Promise<unknown>;
    toImage: (
      element: HTMLElement,
      options: { format: 'png' | 'jpeg' | 'webp' | 'svg'; width?: number; height?: number; scale?: number },
    ) => Promise<string>;
    purge: (element: HTMLElement) => void;
  };

  export default Plotly;
}
