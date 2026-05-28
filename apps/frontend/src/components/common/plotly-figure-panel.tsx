import { Maximize2 } from 'lucide-react';

import { PlotlyChart } from '@/components/common/plotly-chart';
import { Button } from '@/components/ui/button';
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
  return (
    <Dialog>
      <div className="space-y-2">
        <div className="flex items-center justify-end">
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <Maximize2 className="h-4 w-4" />
              Expand
            </Button>
          </DialogTrigger>
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
