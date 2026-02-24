import { useState, useEffect, useRef } from 'react';
import { Search, AlertTriangle, Activity, MapPin } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import L from 'leaflet';

// Fix Leaflet default marker icon issue with Vite
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Custom marker icons for different AQI levels
const createCustomIcon = (color: string) => {
  return L.divIcon({
    className: 'custom-marker',
    html: `<div style="
      background-color: ${color};
      width: 24px;
      height: 24px;
      border-radius: 50%;
      border: 3px solid white;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    "></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
};

const greenIcon = createCustomIcon('#22C55E');
const yellowIcon = createCustomIcon('#EAB308');
const redIcon = createCustomIcon('#EF4444');

interface Station {
  id: number;
  name: string;
  lat: number;
  lng: number;
  aqi: number;
  status: 'good' | 'moderate' | 'unhealthy';
  pm25: number;
  pm10: number;
}

const stations: Station[] = [
  { id: 1, name: 'Centro Histórico', lat: -0.2150, lng: -78.5001, aqi: 45, status: 'good', pm25: 12, pm10: 25 },
  { id: 2, name: 'La Carolina', lat: -0.1807, lng: -78.4867, aqi: 78, status: 'moderate', pm25: 25, pm10: 45 },
  { id: 3, name: 'Tumbaco', lat: -0.2104, lng: -78.3977, aqi: 125, status: 'unhealthy', pm25: 48, pm10: 89 },
  { id: 4, name: 'Carapungo', lat: -0.1049, lng: -78.4389, aqi: 55, status: 'good', pm25: 15, pm10: 30 },
  { id: 5, name: 'Los Chillos', lat: -0.3124, lng: -78.4422, aqi: 92, status: 'moderate', pm25: 32, pm10: 58 },
  { id: 6, name: 'Cumbayá', lat: -0.2028, lng: -78.4269, aqi: 65, status: 'moderate', pm25: 20, pm10: 38 },
  { id: 7, name: 'Calderón', lat: -0.1066, lng: -78.4264, aqi: 48, status: 'good', pm25: 13, pm10: 28 },
  { id: 8, name: 'Quitumbe', lat: -0.2891, lng: -78.5489, aqi: 88, status: 'moderate', pm25: 28, pm10: 52 },
];

const chartData = [
  { time: '00:00', PM25: 12, PM10: 25 },
  { time: '04:00', PM25: 15, PM10: 28 },
  { time: '08:00', PM25: 28, PM10: 45 },
  { time: '12:00', PM25: 35, PM10: 58 },
  { time: '16:00', PM25: 32, PM10: 52 },
  { time: '20:00', PM25: 22, PM10: 38 },
  { time: '23:00', PM25: 18, PM10: 32 },
];

export function HomeDashboard() {
  const [timeRange, setTimeRange] = useState('24h');
  const [searchQuery, setSearchQuery] = useState('');
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    // Initialize map
    const map = L.map(mapRef.current).setView([-0.1807, -78.4678], 11);

    // Add tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    // Add markers for each station
    stations.forEach((station) => {
      const icon = station.status === 'good' ? greenIcon :
                   station.status === 'moderate' ? yellowIcon : redIcon;

      const marker = L.marker([station.lat, station.lng], { icon }).addTo(map);

      // Create popup content
      const popupContent = `
        <div style="padding: 8px; min-width: 200px;">
          <h3 style="font-weight: 600; font-size: 14px; margin-bottom: 8px;">${station.name}</h3>
          <div style="font-size: 12px; line-height: 1.8;">
            <p style="display: flex; justify-between; gap: 16px;">
              <span style="color: #6b7280;">AQI:</span>
              <span style="font-weight: 500;">${station.aqi}</span>
            </p>
            <p style="display: flex; justify-between; gap: 16px;">
              <span style="color: #6b7280;">PM2.5:</span>
              <span style="font-weight: 500;">${station.pm25} µg/m³</span>
            </p>
            <p style="display: flex; justify-between; gap: 16px;">
              <span style="color: #6b7280;">PM10:</span>
              <span style="font-weight: 500;">${station.pm10} µg/m³</span>
            </p>
            <p style="display: flex; justify-between; gap: 16px;">
              <span style="color: #6b7280;">Status:</span>
              <span style="font-weight: 500; text-transform: capitalize; color: ${
                station.status === 'good' ? '#16a34a' :
                station.status === 'moderate' ? '#ca8a04' : '#dc2626'
              };">${station.status}</span>
            </p>
          </div>
        </div>
      `;

      marker.bindPopup(popupContent);
    });

    mapInstanceRef.current = map;

    // Cleanup
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  const currentAQI = 72;
  const activeStations = stations.length;
  const alerts = 2;

  return (
    <div className="w-full h-full overflow-y-auto bg-white">
      {/* Persistent Header */}
      <div className="sticky top-0 z-10 bg-white border-b border-border px-8 py-4">
        <div className="max-w-7xl mx-auto flex items-center gap-4">
          {/* Search Bar */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search stations, locations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-[#F9FBFC]"
            />
          </div>
          
          {/* Time Range Filter */}
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-48 bg-[#F9FBFC]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1h">Last Hour</SelectItem>
              <SelectItem value="24h">Last 24 Hours</SelectItem>
              <SelectItem value="7d">Last 7 Days</SelectItem>
              <SelectItem value="30d">Last 30 Days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Hero Section - Interactive Map */}
      <div className="relative" style={{ height: '60vh' }}>
        <div ref={mapRef} style={{ height: '100%', width: '100%' }} />

        {/* Floating Legend Card */}
        <Card className="absolute top-4 right-4 z-[1000] shadow-lg w-56">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">AQI Legend</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-green-500"></div>
              <span className="text-xs text-muted-foreground">Good (0-50)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-yellow-500"></div>
              <span className="text-xs text-muted-foreground">Moderate (51-100)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-red-500"></div>
              <span className="text-xs text-muted-foreground">Unhealthy (101+)</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Content Below the Fold */}
      <div className="px-8 py-8 bg-[#F9FBFC]">
        <div className="max-w-7xl mx-auto space-y-8">
          {/* KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="bg-white border-border">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Current AQI
                </CardTitle>
                <Activity className="w-5 h-5 text-[#509EE3]" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-semibold text-foreground">{currentAQI}</div>
                <p className="text-xs text-muted-foreground mt-2">
                  Moderate air quality
                </p>
              </CardContent>
            </Card>

            <Card className="bg-white border-border">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Active Stations
                </CardTitle>
                <MapPin className="w-5 h-5 text-[#509EE3]" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-semibold text-foreground">{activeStations}</div>
                <p className="text-xs text-muted-foreground mt-2">
                  All stations online
                </p>
              </CardContent>
            </Card>

            <Card className="bg-white border-border">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Alerts
                </CardTitle>
                <AlertTriangle className="w-5 h-5 text-[#509EE3]" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-semibold text-foreground">{alerts}</div>
                <p className="text-xs text-muted-foreground mt-2">
                  Unhealthy zones detected
                </p>
              </CardContent>
            </Card>
          </div>

          {/* PM2.5 vs PM10 Chart */}
          <Card className="bg-white border-border">
            <CardHeader>
              <CardTitle>PM2.5 vs PM10</CardTitle>
              <CardDescription>
                Particulate matter concentration over the last 24 hours
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis 
                      dataKey="time" 
                      stroke="#888888"
                      fontSize={12}
                    />
                    <YAxis 
                      stroke="#888888"
                      fontSize={12}
                      label={{ value: 'µg/m³', angle: -90, position: 'insideLeft', style: { fontSize: 12 } }}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'white', 
                        border: '1px solid #e5e7eb',
                        borderRadius: '8px',
                        fontSize: '12px'
                      }}
                    />
                    <Legend 
                      wrapperStyle={{ fontSize: '12px' }}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="PM25" 
                      stroke="#509EE3" 
                      strokeWidth={2}
                      dot={{ fill: '#509EE3', r: 4 }}
                      activeDot={{ r: 6 }}
                      name="PM2.5"
                    />
                    <Line 
                      type="monotone" 
                      dataKey="PM10" 
                      stroke="#EAB308" 
                      strokeWidth={2}
                      dot={{ fill: '#EAB308', r: 4 }}
                      activeDot={{ r: 6 }}
                      name="PM10"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
