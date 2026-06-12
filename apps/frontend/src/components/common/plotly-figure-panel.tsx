import { Maximize2, MoreHorizontal, Plus } from 'lucide-react';
import { useState } from 'react';

import { PlotlyChart } from '@/components/common/plotly-chart';
import { Button } from '@/components/ui/button';
import { useOptionalDashboard } from '@/features/dashboard/contexts/dashboard-context';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

interface PlotlyFigure {
  data?: unknown[];
  layout?: Record<string, unknown>;
  frames?: unknown[];
}



export function PlotlyFigurePanel({
  figure,
  title,
  description,
  height = 560,
  enableTimeNavigation = false,
  uirevision,
}: {
  figure: PlotlyFigure | null | undefined;
  title: string;
  description?: string | null;
  height?: number;
  enableTimeNavigation?: boolean;
  uirevision?: string;
}) {
  const dashboard = useOptionalDashboard();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleAddToDashboard = () => {
    if (!dashboard || !figure) return;
    dashboard.addCard({
      title,
      description: description ?? '',
      kind: 'plotly',
      size: 'md',
      color: '#509EE3',
      sourceLabel: 'Analytical Workspace',
      figure,
    });
    setMenuOpen(false);
  };

  return (
    <Dialog>
      <div className="space-y-2">
        <div className="flex items-center justify-end gap-2">
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <Maximize2 className="h-4 w-4" />
              Expand
            </Button>
          </DialogTrigger>
          <div className="relative">
            <Button variant="outline" size="sm" onClick={() => setMenuOpen((current) => !current)} aria-label="Opciones de grafica">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
            {menuOpen ? (
              <div className="absolute right-0 top-9 z-30 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
                <button
                  type="button"
                  onClick={handleAddToDashboard}
                  disabled={!dashboard || !figure}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
                >
                  <Plus className="h-4 w-4" />
                  Agregar al dashboard
                </button>
              </div>
            ) : null}
          </div>
        </div>
        <div className="h-full w-full">
          <PlotlyChart
            figure={figure}
            height={height}
            enableTimeNavigation={enableTimeNavigation}
            uirevision={uirevision}
          />
        </div>
      </div>

      <DialogContent className="max-w-[96vw] w-[96vw] h-[92vh] p-0 overflow-hidden">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="h-[calc(92vh-88px)] px-4 pb-4">
          <PlotlyChart
            figure={figure}
            height={Math.max(720, typeof window !== 'undefined' ? window.innerHeight - 180 : 720)}
            enableTimeNavigation={enableTimeNavigation}
            uirevision={uirevision}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
