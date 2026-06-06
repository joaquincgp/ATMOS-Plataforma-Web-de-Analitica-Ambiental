import { Info } from 'lucide-react';

import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';

interface AnalysisHelpCardProps {
  title: string;
  description: string;
}

export function AnalysisHelpCard({ title, description }: AnalysisHelpCardProps) {
  return (
    <HoverCard openDelay={150} closeDelay={80}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          aria-label={`Help: ${title}`}
          className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-[#b8c7d9] bg-white text-[10px] font-semibold text-[#64748B] transition-colors hover:border-[#509EE3] hover:text-[#1F5A8A]"
        >
          i
        </button>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="start" className="w-72 border-[#dce5f1] bg-white p-3 shadow-lg">
        <div className="flex items-start gap-2">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#509EE3]" />
          <div className="space-y-1">
            <p className="text-xs font-semibold text-[#24384D]">{title}</p>
            <p className="text-[11px] leading-5 text-muted-foreground">{description}</p>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
