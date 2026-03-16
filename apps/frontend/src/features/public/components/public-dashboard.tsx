import { Activity, ShieldCheck, Globe2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useHealthCheck } from '@/hooks/use-health-check';

interface PublicDashboardProps {
  onGoToLogin: () => void;
}

export function PublicDashboard({ onGoToLogin }: PublicDashboardProps) {
  const { health, loading, error } = useHealthCheck(true);

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f7fafc_0%,#f2f6fb_100%)] p-6 lg:p-10">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold text-foreground">Public Dashboard</h1>
            <p className="text-muted-foreground mt-2">
              Public informational panel for generic users with restricted access.
            </p>
          </div>
          <Button onClick={onGoToLogin} className="bg-[#509EE3] hover:bg-[#509EE3]/90 text-white">
            Sign In
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="bg-white border-[#dce5f1]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Activity className="w-4 h-4 text-[#509EE3]" />
                API Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <p className="text-sm text-muted-foreground">Checking...</p>
              ) : error ? (
                <p className="text-sm text-red-600">{error}</p>
              ) : (
                <Badge className="bg-green-100 text-green-700 border border-green-200">
                  {health?.status ?? 'unknown'}
                </Badge>
              )}
            </CardContent>
          </Card>

          <Card className="bg-white border-[#dce5f1]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#509EE3]" />
                Access Scope
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Generic users can view this panel only. Analysis and workspace features require researcher or admin roles.
              </p>
            </CardContent>
          </Card>

          <Card className="bg-white border-[#dce5f1]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Globe2 className="w-4 h-4 text-[#509EE3]" />
                Data Visibility
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                This public view is intentionally simplified for informative and non-editable access.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
