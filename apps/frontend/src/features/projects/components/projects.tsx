import { Plus, FolderOpen, Database, BarChart3, Code, FileText, Calendar, MoreVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface Project {
  id: string;
  title: string;
  description: string;
  lastActivity: string;
  datasets: number;
  dashboards: number;
  models: number;
  reports: number;
  status: 'active' | 'archived';
}

const projects: Project[] = [
  {
    id: '1',
    title: 'Quito South Analysis',
    description: 'Air quality patterns in southern Quito industrial zones',
    lastActivity: '2 hours ago',
    datasets: 8,
    dashboards: 4,
    models: 2,
    reports: 3,
    status: 'active',
  },
  {
    id: '2',
    title: 'Volcanic Ash Impact Study',
    description: 'PM2.5 correlation with Cotopaxi eruption events',
    lastActivity: '1 day ago',
    datasets: 5,
    dashboards: 3,
    models: 1,
    reports: 2,
    status: 'active',
  },
  {
    id: '3',
    title: 'Traffic vs NO2 Correlation',
    description: 'Analyzing nitrogen dioxide levels during rush hours',
    lastActivity: '3 days ago',
    datasets: 6,
    dashboards: 2,
    models: 3,
    reports: 1,
    status: 'active',
  },
  {
    id: '4',
    title: 'Annual AQI Trends 2025',
    description: 'Comprehensive air quality index analysis for Quito',
    lastActivity: '1 week ago',
    datasets: 12,
    dashboards: 6,
    models: 4,
    reports: 8,
    status: 'active',
  },
];

interface ProjectsProps {
  onSelectProject: (projectId: string) => void;
}

export function Projects({ onSelectProject }: ProjectsProps) {
  return (
    <div className="h-full overflow-y-auto bg-[#F9FBFC]">
      <div className="px-8 py-6">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-foreground mb-2">Research Projects</h1>
          <p className="text-muted-foreground">
            Central hub to manage isolated research workspaces
          </p>
        </div>

        {/* Create New Project Button */}
        <Button
          className="mb-6 bg-[#509EE3] hover:bg-[#509EE3]/90 text-white"
          size="lg"
        >
          <Plus className="w-5 h-5 mr-2" />
          Create New Project
        </Button>

        {/* Projects Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((project) => (
            <Card key={project.id} className="bg-white border-border hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="text-lg mb-2">{project.title}</CardTitle>
                    <CardDescription className="text-sm line-clamp-2">
                      {project.description}
                    </CardDescription>
                  </div>
                  <button className="text-muted-foreground hover:text-foreground">
                    <MoreVertical className="w-5 h-5" />
                  </button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Last Activity */}
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Calendar className="w-4 h-4" />
                  <span>Updated {project.lastActivity}</span>
                </div>

                {/* Asset Indicators */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex items-center gap-2">
                    <Database className="w-4 h-4 text-[#509EE3]" />
                    <div className="flex flex-col">
                      <span className="text-xs text-muted-foreground">Datasets</span>
                      <span className="text-sm font-semibold">{project.datasets}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-[#509EE3]" />
                    <div className="flex flex-col">
                      <span className="text-xs text-muted-foreground">Dashboards</span>
                      <span className="text-sm font-semibold">{project.dashboards}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Code className="w-4 h-4 text-[#509EE3]" />
                    <div className="flex flex-col">
                      <span className="text-xs text-muted-foreground">Models</span>
                      <span className="text-sm font-semibold">{project.models}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-[#509EE3]" />
                    <div className="flex flex-col">
                      <span className="text-xs text-muted-foreground">Reports</span>
                      <span className="text-sm font-semibold">{project.reports}</span>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={() => onSelectProject(project.id)}
                    className="flex-1 bg-[#509EE3] hover:bg-[#509EE3]/90 text-white"
                  >
                    <FolderOpen className="w-4 h-4 mr-2" />
                    Open Project
                  </Button>
                  <Button variant="outline" size="sm">
                    Edit
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
