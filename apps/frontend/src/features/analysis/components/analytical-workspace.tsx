import { useState } from 'react';
import { Play, Save, Code } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { LineChart, Line, BarChart, Bar, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const sampleData = [
  { date: '2026-01-15', pm25: 12, pm10: 25, temp: 18, station: 'QUI-001' },
  { date: '2026-01-16', pm25: 15, pm10: 28, temp: 19, station: 'QUI-001' },
  { date: '2026-01-17', pm25: 28, pm10: 45, temp: 20, station: 'QUI-001' },
  { date: '2026-01-18', pm25: 35, pm10: 58, temp: 21, station: 'QUI-001' },
  { date: '2026-01-19', pm25: 32, pm10: 52, temp: 19, station: 'QUI-001' },
  { date: '2026-01-20', pm25: 22, pm10: 38, temp: 18, station: 'QUI-001' },
];

export function AnalyticalWorkspace() {
  const [dataSource, setDataSource] = useState('remmaq');
  const [pollutant, setPollutant] = useState('PM25');
  const [aggregation, setAggregation] = useState('avg');
  const [visualization, setVisualization] = useState('line');
  const [generatedSQL, setGeneratedSQL] = useState('');

  const handleVisualize = () => {
    const sql = `SELECT 
  date_trunc('day', timestamp) as date,
  ${aggregation}(${pollutant.toLowerCase()}) as value,
  station_id
FROM environmental_measurements
WHERE timestamp >= NOW() - INTERVAL '7 days'
  AND pollutant_type = '${pollutant}'
GROUP BY date, station_id
ORDER BY date ASC;`;
    setGeneratedSQL(sql);
  };

  const renderVisualization = () => {
    switch (visualization) {
      case 'line':
        return (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={sampleData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" fontSize={12} />
              <YAxis fontSize={12} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="pm25" stroke="#509EE3" strokeWidth={2} name="PM2.5" />
              <Line type="monotone" dataKey="pm10" stroke="#EAB308" strokeWidth={2} name="PM10" />
            </LineChart>
          </ResponsiveContainer>
        );
      case 'bar':
        return (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={sampleData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" fontSize={12} />
              <YAxis fontSize={12} />
              <Tooltip />
              <Legend />
              <Bar dataKey="pm25" fill="#509EE3" name="PM2.5" />
              <Bar dataKey="pm10" fill="#EAB308" name="PM10" />
            </BarChart>
          </ResponsiveContainer>
        );
      case 'scatter':
        return (
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="temp" fontSize={12} label={{ value: 'Temperature (°C)', position: 'bottom' }} />
              <YAxis dataKey="pm25" fontSize={12} label={{ value: 'PM2.5 (µg/m³)', angle: -90, position: 'insideLeft' }} />
              <Tooltip cursor={{ strokeDasharray: '3 3' }} />
              <Scatter name="PM2.5 vs Temperature" data={sampleData} fill="#509EE3" />
            </ScatterChart>
          </ResponsiveContainer>
        );
      default:
        return <div className="flex items-center justify-center h-full text-muted-foreground">Select a visualization type</div>;
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-[#F9FBFC]">
      <div className="px-8 py-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-foreground mb-2">Analytical Workspace</h1>
          <p className="text-muted-foreground">
            Build queries visually, choose statistical visualizations, and save results to dashboards
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Panel - Query Configuration */}
          <div className="lg:col-span-1 space-y-4">
            <Card className="bg-white">
              <CardHeader>
                <CardTitle className="text-lg">Query Configuration</CardTitle>
                <CardDescription>Configure your data query</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Data Source */}
                <div className="space-y-2">
                  <Label htmlFor="data-source">Data Source</Label>
                  <Select value={dataSource} onValueChange={setDataSource}>
                    <SelectTrigger id="data-source">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="remmaq">REMMAQ Stations</SelectItem>
                      <SelectItem value="processed">Processed Datasets</SelectItem>
                      <SelectItem value="manual">Manual Upload</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Date Range */}
                <div className="space-y-2">
                  <Label htmlFor="date-range">Date Range</Label>
                  <Select defaultValue="7d">
                    <SelectTrigger id="date-range">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1d">Last 24 Hours</SelectItem>
                      <SelectItem value="7d">Last 7 Days</SelectItem>
                      <SelectItem value="30d">Last 30 Days</SelectItem>
                      <SelectItem value="custom">Custom Range</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Station Filter */}
                <div className="space-y-2">
                  <Label htmlFor="station">Station</Label>
                  <Select defaultValue="all">
                    <SelectTrigger id="station">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Stations</SelectItem>
                      <SelectItem value="QUI-001">Centro Histórico</SelectItem>
                      <SelectItem value="QUI-002">La Carolina</SelectItem>
                      <SelectItem value="QUI-003">Tumbaco</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Pollutant */}
                <div className="space-y-2">
                  <Label htmlFor="pollutant">Pollutant</Label>
                  <Select value={pollutant} onValueChange={setPollutant}>
                    <SelectTrigger id="pollutant">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PM25">PM2.5</SelectItem>
                      <SelectItem value="PM10">PM10</SelectItem>
                      <SelectItem value="NO2">NO2</SelectItem>
                      <SelectItem value="O3">O3</SelectItem>
                      <SelectItem value="CO">CO</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Aggregation */}
                <div className="space-y-2">
                  <Label htmlFor="aggregation">Aggregation</Label>
                  <Select value={aggregation} onValueChange={setAggregation}>
                    <SelectTrigger id="aggregation">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="avg">Average</SelectItem>
                      <SelectItem value="max">Maximum</SelectItem>
                      <SelectItem value="min">Minimum</SelectItem>
                      <SelectItem value="percentile_95">95th Percentile</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {/* Visualization Selector */}
            <Card className="bg-white">
              <CardHeader>
                <CardTitle className="text-lg">Visualization</CardTitle>
                <CardDescription>Select chart type</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setVisualization('line')}
                    className={`p-3 border-2 rounded-lg text-sm transition-all ${
                      visualization === 'line'
                        ? 'border-[#509EE3] bg-[#509EE3]/5'
                        : 'border-border hover:border-[#509EE3]/50'
                    }`}
                  >
                    Line Chart
                  </button>
                  <button
                    onClick={() => setVisualization('bar')}
                    className={`p-3 border-2 rounded-lg text-sm transition-all ${
                      visualization === 'bar'
                        ? 'border-[#509EE3] bg-[#509EE3]/5'
                        : 'border-border hover:border-[#509EE3]/50'
                    }`}
                  >
                    Bar Chart
                  </button>
                  <button
                    onClick={() => setVisualization('scatter')}
                    className={`p-3 border-2 rounded-lg text-sm transition-all ${
                      visualization === 'scatter'
                        ? 'border-[#509EE3] bg-[#509EE3]/5'
                        : 'border-border hover:border-[#509EE3]/50'
                    }`}
                  >
                    Scatter
                  </button>
                  <button
                    onClick={() => setVisualization('heatmap')}
                    className={`p-3 border-2 rounded-lg text-sm transition-all ${
                      visualization === 'heatmap'
                        ? 'border-[#509EE3] bg-[#509EE3]/5'
                        : 'border-border hover:border-[#509EE3]/50'
                    }`}
                  >
                    Heatmap
                  </button>
                </div>
              </CardContent>
            </Card>

            {/* Actions */}
            <div className="space-y-2">
              <Button
                onClick={handleVisualize}
                className="w-full bg-[#509EE3] hover:bg-[#509EE3]/90 text-white"
              >
                <Play className="w-4 h-4 mr-2" />
                Visualize
              </Button>
              <Button variant="outline" className="w-full">
                <Save className="w-4 h-4 mr-2" />
                Save to Dashboard
              </Button>
            </div>
          </div>

          {/* Right Panel - Preview & SQL */}
          <div className="lg:col-span-2 space-y-4">
            {/* Visualization Preview */}
            <Card className="bg-white">
              <CardHeader>
                <CardTitle>Preview</CardTitle>
                <CardDescription>Live visualization of your query results</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-96">
                  {renderVisualization()}
                </div>
              </CardContent>
            </Card>

            {/* Generated SQL */}
            <Card className="bg-white">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Generated SQL</CardTitle>
                    <CardDescription>Auto-generated query for transparency</CardDescription>
                  </div>
                  <Code className="w-5 h-5 text-[#509EE3]" />
                </div>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={generatedSQL || 'Click "Visualize" to generate SQL query'}
                  readOnly
                  className="font-mono text-xs bg-[#F9FBFC] h-32"
                />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
