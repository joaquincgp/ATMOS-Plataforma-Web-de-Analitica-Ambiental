import { Download, Calendar, MapPin, Activity, Radio } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useState } from 'react';

export function AnalyticsDashboard() {
  const [dateRange, setDateRange] = useState('Last 30 Days');

  // Mock data for PM2.5 vs PM10 chart
  const chartData = [
    { date: 'Jan 15', pm25: 35, pm10: 52 },
    { date: 'Jan 18', pm25: 42, pm10: 61 },
    { date: 'Jan 21', pm25: 38, pm10: 55 },
    { date: 'Jan 24', pm25: 45, pm10: 68 },
    { date: 'Jan 27', pm25: 39, pm10: 58 },
    { date: 'Jan 30', pm25: 36, pm10: 53 },
    { date: 'Feb 2', pm25: 41, pm10: 62 },
    { date: 'Feb 5', pm25: 37, pm10: 54 },
    { date: 'Feb 8', pm25: 43, pm10: 65 },
    { date: 'Feb 11', pm25: 40, pm10: 59 },
  ];

  // Mock station locations
  const stations = [
    { id: 1, name: 'Centro Histórico', lat: -0.22, lng: -78.51, aqi: 45, color: '#10b981' },
    { id: 2, name: 'La Carolina', lat: -0.18, lng: -78.49, aqi: 52, color: '#10b981' },
    { id: 3, name: 'Tumbaco', lat: -0.21, lng: -78.40, aqi: 38, color: '#10b981' },
    { id: 4, name: 'El Camal', lat: -0.27, lng: -78.54, aqi: 68, color: '#f59e0b' },
    { id: 5, name: 'Belisario', lat: -0.19, lng: -78.50, aqi: 55, color: '#f59e0b' },
    { id: 6, name: 'Guamaní', lat: -0.32, lng: -78.55, aqi: 72, color: '#f59e0b' },
    { id: 7, name: 'Los Chillos', lat: -0.31, lng: -78.44, aqi: 41, color: '#10b981' },
    { id: 8, name: 'Cumbayá', lat: -0.20, lng: -78.43, aqi: 47, color: '#10b981' },
    { id: 9, name: 'Cotocollao', lat: -0.13, lng: -78.50, aqi: 59, color: '#f59e0b' },
    { id: 10, name: 'Quitumbe', lat: -0.30, lng: -78.56, aqi: 65, color: '#f59e0b' },
    { id: 11, name: 'Calderón', lat: -0.10, lng: -78.45, aqi: 43, color: '#10b981' },
    { id: 12, name: 'San Antonio', lat: -0.01, lng: -78.44, aqi: 36, color: '#10b981' },
  ];

  return (
    <div className="p-8 space-y-6">
      {/* Header with filters */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Environmental Analytics</h1>
          <p className="text-muted-foreground mt-1">Real-time air quality monitoring for Quito</p>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="relative">
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value)}
              className="appearance-none bg-secondary border border-border rounded-lg px-4 py-2 pr-10 text-sm cursor-pointer hover:bg-secondary/80 transition-colors"
            >
              <option>Last 7 Days</option>
              <option>Last 30 Days</option>
              <option>Last 90 Days</option>
              <option>This Year</option>
            </select>
            <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          </div>
          
          <button className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors">
            <Download className="w-4 h-4" />
            Download Report
          </button>
        </div>
      </div>

      {/* Key Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-lg p-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-green-500/10 rounded-lg flex items-center justify-center">
              <Activity className="w-5 h-5 text-green-500" />
            </div>
            <h3 className="text-sm text-muted-foreground">Current AQI</h3>
          </div>
          <div className="mt-2">
            <p className="text-3xl font-semibold text-foreground">45</p>
            <p className="text-sm text-green-500 mt-1">Good</p>
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg p-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
              <Radio className="w-5 h-5 text-primary" />
            </div>
            <h3 className="text-sm text-muted-foreground">Active Stations</h3>
          </div>
          <div className="mt-2">
            <p className="text-3xl font-semibold text-foreground">12</p>
            <p className="text-sm text-muted-foreground mt-1">of 12 online</p>
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg p-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-orange-500/10 rounded-lg flex items-center justify-center">
              <MapPin className="w-5 h-5 text-orange-500" />
            </div>
            <h3 className="text-sm text-muted-foreground">Alerts</h3>
          </div>
          <div className="mt-2">
            <p className="text-3xl font-semibold text-foreground">3</p>
            <p className="text-sm text-orange-500 mt-1">Moderate zones</p>
          </div>
        </div>
      </div>

      {/* Main Grid: Map and Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Geospatial Map - Large */}
        <div className="lg:col-span-2 bg-card border border-border rounded-lg p-6">
          <h2 className="font-semibold text-foreground mb-4">Station Locations & AQI</h2>
          
          {/* Simplified map visualization */}
          <div className="h-96 bg-secondary/30 rounded-lg relative overflow-hidden">
            {/* Map background pattern */}
            <div className="absolute inset-0 opacity-10">
              <div className="grid grid-cols-10 grid-rows-10 h-full">
                {Array.from({ length: 100 }).map((_, i) => (
                  <div key={i} className="border border-border/30"></div>
                ))}
              </div>
            </div>

            {/* Station markers */}
            {stations.map((station) => {
              // Convert lat/lng to x/y position (simplified)
              const x = ((station.lng + 78.6) / 0.2) * 100;
              const y = ((station.lat + 0.35) / 0.35) * 100;
              
              return (
                <div
                  key={station.id}
                  className="absolute group cursor-pointer"
                  style={{
                    left: `${x}%`,
                    top: `${y}%`,
                    transform: 'translate(-50%, -50%)',
                  }}
                >
                  <div
                    className="w-8 h-8 rounded-full border-2 border-white shadow-lg transition-transform hover:scale-125"
                    style={{ backgroundColor: station.color }}
                  >
                    <div className="absolute inset-0 rounded-full animate-ping opacity-30"
                      style={{ backgroundColor: station.color }}
                    ></div>
                  </div>
                  
                  {/* Tooltip */}
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-foreground text-background text-xs rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                    <div className="font-semibold">{station.name}</div>
                    <div>AQI: {station.aqi}</div>
                    <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-foreground"></div>
                  </div>
                </div>
              );
            })}

            {/* Legend */}
            <div className="absolute bottom-4 left-4 bg-card border border-border rounded-lg p-3 text-xs">
              <div className="font-semibold mb-2">AQI Level</div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-3 h-3 rounded-full bg-green-500"></div>
                <span>Good (0-50)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-orange-500"></div>
                <span>Moderate (51-100)</span>
              </div>
            </div>
          </div>
        </div>

        {/* PM2.5 vs PM10 Chart */}
        <div className="lg:col-span-1 bg-card border border-border rounded-lg p-6">
          <h2 className="font-semibold text-foreground mb-4">PM2.5 vs PM10 Trends</h2>
          
          <div className="h-96">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis 
                  dataKey="date" 
                  tick={{ fill: '#6b7280', fontSize: 10 }}
                  stroke="#e5e7eb"
                  angle={-45}
                  textAnchor="end"
                  height={60}
                />
                <YAxis 
                  tick={{ fill: '#6b7280', fontSize: 10 }}
                  stroke="#e5e7eb"
                  label={{ value: 'µg/m³', angle: -90, position: 'insideLeft', fill: '#6b7280', fontSize: 10 }}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: '#ffffff', 
                    border: '1px solid #e5e7eb', 
                    borderRadius: '0.5rem',
                    fontSize: '11px'
                  }}
                />
                <Legend 
                  wrapperStyle={{ fontSize: '11px' }}
                />
                <Line 
                  type="monotone" 
                  dataKey="pm25" 
                  stroke="#509EE3" 
                  strokeWidth={2}
                  name="PM2.5"
                  dot={{ fill: '#509EE3', r: 3 }}
                />
                <Line 
                  type="monotone" 
                  dataKey="pm10" 
                  stroke="#10b981" 
                  strokeWidth={2}
                  name="PM10"
                  dot={{ fill: '#10b981', r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
