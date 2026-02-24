import { ChevronRight, ChevronDown, Play } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useState } from 'react';

export function QueryBuilder() {
  const [dataSource, setDataSource] = useState('REMMAQ Stations');
  const [filterBy, setFilterBy] = useState('Last 30 Days');
  const [viewType, setViewType] = useState('Average by Day');

  // Mock data for the chart preview
  const mockData = [
    { date: 'Jan 15', value: 35 },
    { date: 'Jan 18', value: 42 },
    { date: 'Jan 21', value: 38 },
    { date: 'Jan 24', value: 45 },
    { date: 'Jan 27', value: 39 },
    { date: 'Jan 30', value: 36 },
    { date: 'Feb 2', value: 41 },
    { date: 'Feb 5', value: 37 },
    { date: 'Feb 8', value: 43 },
    { date: 'Feb 11', value: 40 },
  ];

  return (
    <div className="p-8 space-y-6">
      {/* Breadcrumbs */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="hover:text-foreground cursor-pointer">Data</span>
        <ChevronRight className="w-4 h-4" />
        <span className="hover:text-foreground cursor-pointer">Air Quality</span>
        <ChevronRight className="w-4 h-4" />
        <span className="text-foreground">Custom Query</span>
      </div>

      {/* Page Title */}
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Query Builder</h1>
        <p className="text-muted-foreground mt-1">Filter and visualize your data without code</p>
      </div>

      {/* Data Logic Section */}
      <section className="bg-card border border-border rounded-lg p-6">
        <h2 className="font-semibold text-foreground mb-4">Data Logic</h2>
        
        <div className="flex items-center gap-3 flex-wrap">
          {/* Data Source */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Data Source:</span>
            <div className="relative">
              <select
                value={dataSource}
                onChange={(e) => setDataSource(e.target.value)}
                className="appearance-none bg-secondary border border-border rounded-full px-4 py-2 pr-8 text-sm font-medium text-foreground cursor-pointer hover:bg-secondary/80 transition-colors"
              >
                <option>REMMAQ Stations</option>
                <option>Meteorology</option>
                <option>Pollutants</option>
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            </div>
          </div>

          <ChevronRight className="w-4 h-4 text-muted-foreground" />

          {/* Filtered By */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Filtered by:</span>
            <div className="relative">
              <select
                value={filterBy}
                onChange={(e) => setFilterBy(e.target.value)}
                className="appearance-none bg-secondary border border-border rounded-full px-4 py-2 pr-8 text-sm font-medium text-foreground cursor-pointer hover:bg-secondary/80 transition-colors"
              >
                <option>Last 30 Days</option>
                <option>Last 7 Days</option>
                <option>Last 90 Days</option>
                <option>This Year</option>
                <option>Custom Range</option>
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            </div>
          </div>

          <ChevronRight className="w-4 h-4 text-muted-foreground" />

          {/* View Type */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">View:</span>
            <div className="relative">
              <select
                value={viewType}
                onChange={(e) => setViewType(e.target.value)}
                className="appearance-none bg-secondary border border-border rounded-full px-4 py-2 pr-8 text-sm font-medium text-foreground cursor-pointer hover:bg-secondary/80 transition-colors"
              >
                <option>Average by Day</option>
                <option>Sum by Day</option>
                <option>Average by Hour</option>
                <option>Maximum by Day</option>
                <option>Minimum by Day</option>
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            </div>
          </div>
        </div>
      </section>

      {/* Visualization Preview Section */}
      <section className="bg-card border border-border rounded-lg p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="font-semibold text-foreground">Visualization Preview</h2>
            <p className="text-sm text-muted-foreground mt-1">PM2.5 Concentration over time</p>
          </div>
          <button className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors">
            <Play className="w-4 h-4" />
            Visualize
          </button>
        </div>

        {/* Chart */}
        <div className="h-80 bg-secondary/30 rounded-lg p-4">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={mockData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis 
                dataKey="date" 
                tick={{ fill: '#6b7280', fontSize: 12 }}
                stroke="#e5e7eb"
              />
              <YAxis 
                tick={{ fill: '#6b7280', fontSize: 12 }}
                stroke="#e5e7eb"
                label={{ value: 'PM2.5 (µg/m³)', angle: -90, position: 'insideLeft', fill: '#6b7280' }}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#ffffff', 
                  border: '1px solid #e5e7eb', 
                  borderRadius: '0.5rem',
                  fontSize: '12px'
                }}
              />
              <Line 
                type="monotone" 
                dataKey="value" 
                stroke="#509EE3" 
                strokeWidth={2}
                dot={{ fill: '#509EE3', r: 4 }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Query Summary */}
        <div className="mt-4 p-4 bg-secondary rounded-lg">
          <p className="text-xs text-muted-foreground mb-2">Query Summary:</p>
          <code className="text-xs text-foreground">
            SELECT {viewType.toLowerCase()} FROM {dataSource} WHERE date IN ({filterBy})
          </code>
        </div>
      </section>
    </div>
  );
}
