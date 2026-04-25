import { Database } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

export function AnalyticalWorkspaceKpiCard({
  label,
  value,
  icon: Icon,
  badgeTone,
  small = false,
}: {
  label: string;
  value: string;
  icon: typeof Database;
  badgeTone?: 'green' | 'amber' | 'blue';
  small?: boolean;
}) {
  const tone =
    badgeTone === 'green'
      ? 'bg-green-100 text-green-700 border-green-200'
      : badgeTone === 'amber'
        ? 'bg-amber-100 text-amber-700 border-amber-200'
        : 'bg-[#509EE3]/10 text-[#1F5A8A] border-[#509EE3]/20';

  return (
    <Card className="bg-white border-[#dce5f1]">
      <CardContent className="py-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
          <Icon className="w-4 h-4 text-[#509EE3]" />
        </div>
        {badgeTone ? (
          <Badge className={`mt-2 ${tone}`}>{value}</Badge>
        ) : (
          <p className={`mt-2 font-semibold text-foreground ${small ? 'text-sm truncate' : 'text-xl'}`}>{value}</p>
        )}
      </CardContent>
    </Card>
  );
}
