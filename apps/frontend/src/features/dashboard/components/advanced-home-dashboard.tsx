import { useState, useEffect, useRef } from 'react';
import { Wind, Droplets, Gauge, TrendingUp, AlertTriangle, Activity, Thermometer, Eye, X } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { LineChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ComposedChart } from 'recharts';
import L from 'leaflet';

// Fix Leaflet default marker icon issue
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const createCustomIcon = (color: string, shouldPulse: boolean = false) => {
  const pulseAnimation = shouldPulse ? `
    @keyframes pulse {
      0%, 100% { box-shadow: 0 0 0 0 ${color}80, 0 2px 8px rgba(0,0,0,0.3); }
      50% { box-shadow: 0 0 0 8px ${color}00, 0 2px 8px rgba(0,0,0,0.3); }
    }
  ` : '';
  
  return L.divIcon({
    className: 'custom-marker',
    html: `
      <style>${pulseAnimation}</style>
      <div style="
        background-color: ${color};
        width: 24px;
        height: 24px;
        border-radius: 50%;
        border: 3px solid white;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        ${shouldPulse ? `animation: pulse 2s ease-in-out infinite;` : ''}
      "></div>
    `,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
};

const greenIcon = createCustomIcon('#22C55E', true);
const yellowIcon = createCustomIcon('#EAB308', true);
const orangeIcon = createCustomIcon('#F97316', true);
const redIcon = createCustomIcon('#EF4444', true);

interface StationData {
  id: number;
  name: string;
  lat: number;
  lng: number;
  aqi: number;
  status: string;
  // Contaminantes
  CO: number;
  NO2: number;
  O3: number;
  PM25: number;
  PM10: number;
  SO2: number;
  // Meteorología
  TMP: number;
  HUM: number;
  VEL: number;
  DIR: string;
  PRE: number;
  // Variables adicionales REMMAQ
  IUV: number; // Ultraviolet Index
  RS: number;  // Solar Radiation (W/m²)
  LLU: number; // Precipitation (mm)
}

const stations: StationData[] = [
  { 
    id: 1, name: 'Centro Histórico', lat: -0.2150, lng: -78.5001, aqi: 45, status: 'good',
    CO: 0.8, NO2: 28, O3: 42, PM25: 12, PM10: 25, SO2: 5,
    TMP: 18, HUM: 65, VEL: 8, DIR: 'NE', PRE: 1013,
    IUV: 6, RS: 450, LLU: 0
  },
  { 
    id: 2, name: 'La Carolina', lat: -0.1807, lng: -78.4867, aqi: 78, status: 'moderate',
    CO: 1.2, NO2: 35, O3: 58, PM25: 25, PM10: 45, SO2: 8,
    TMP: 19, HUM: 60, VEL: 12, DIR: 'NE', PRE: 1012,
    IUV: 7, RS: 520, LLU: 0
  },
  { 
    id: 3, name: 'Tumbaco', lat: -0.2104, lng: -78.3977, aqi: 125, status: 'unhealthy',
    CO: 2.1, NO2: 52, O3: 72, PM25: 48, PM10: 89, SO2: 15,
    TMP: 20, HUM: 55, VEL: 6, DIR: 'E', PRE: 1011,
    IUV: 8, RS: 580, LLU: 0.2
  },
  { 
    id: 4, name: 'Carapungo', lat: -0.1049, lng: -78.4389, aqi: 55, status: 'moderate',
    CO: 0.9, NO2: 30, O3: 48, PM25: 15, PM10: 30, SO2: 6,
    TMP: 17, HUM: 68, VEL: 10, DIR: 'NE', PRE: 1014,
    IUV: 5, RS: 410, LLU: 0
  },
  { 
    id: 5, name: 'Los Chillos', lat: -0.3124, lng: -78.4422, aqi: 92, status: 'moderate',
    CO: 1.5, NO2: 42, O3: 65, PM25: 32, PM10: 58, SO2: 11,
    TMP: 19, HUM: 58, VEL: 9, DIR: 'NE', PRE: 1012,
    IUV: 7, RS: 490, LLU: 0
  },
  { 
    id: 6, name: 'Cumbayá', lat: -0.2028, lng: -78.4269, aqi: 65, status: 'moderate',
    CO: 1.0, NO2: 33, O3: 52, PM25: 20, PM10: 38, SO2: 7,
    TMP: 18, HUM: 62, VEL: 11, DIR: 'NE', PRE: 1013,
    IUV: 6, RS: 470, LLU: 0
  },
  { 
    id: 7, name: 'El Camal', lat: -0.2589, lng: -78.5250, aqi: 58, status: 'moderate',
    CO: 1.1, NO2: 31, O3: 50, PM25: 18, PM10: 35, SO2: 7,
    TMP: 18, HUM: 64, VEL: 7, DIR: 'NE', PRE: 1013,
    IUV: 6, RS: 455, LLU: 0
  },
  { 
    id: 8, name: 'Guamaní', lat: -0.3080, lng: -78.5470, aqi: 48, status: 'good',
    CO: 0.9, NO2: 27, O3: 45, PM25: 13, PM10: 28, SO2: 6,
    TMP: 17, HUM: 66, VEL: 8, DIR: 'NE', PRE: 1014,
    IUV: 5, RS: 430, LLU: 0
  },
];

const sparklineData = [42, 45, 48, 46, 50, 52, 55, 58, 62, 65, 68, 72];

const pollutantMeteoData = [
  { time: '00:00', PM25: 12, PM10: 25, temp: 14, humidity: 75 },
  { time: '04:00', PM25: 15, PM10: 28, temp: 13, humidity: 80 },
  { time: '08:00', PM25: 28, PM10: 45, temp: 16, humidity: 70 },
  { time: '12:00', PM25: 35, PM10: 58, temp: 20, humidity: 55 },
  { time: '16:00', PM25: 32, PM10: 52, temp: 19, humidity: 60 },
  { time: '20:00', PM25: 22, PM10: 38, temp: 16, humidity: 68 },
  { time: '23:00', PM25: 18, PM10: 32, temp: 15, humidity: 72 },
];

export function AdvancedHomeDashboard() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const windLayerRef = useRef<L.LayerGroup | null>(null);
  const heatmapLayerRef = useRef<L.LayerGroup | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const cloudLayerRef = useRef<HTMLDivElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  
  const [showAQIStations, setShowAQIStations] = useState(true);
  const [showWindFlow, setShowWindFlow] = useState(true);
  const [showTempHeatmap, setShowTempHeatmap] = useState(true);
  const [showAtmosphericEffects, setShowAtmosphericEffects] = useState(true);
  const [selectedStation, setSelectedStation] = useState<StationData | null>(null);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const map = L.map(mapRef.current).setView([-0.1807, -78.4678], 11);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    mapInstanceRef.current = map;
    windLayerRef.current = L.layerGroup().addTo(map);
    heatmapLayerRef.current = L.layerGroup().addTo(map);
    markersLayerRef.current = L.layerGroup().addTo(map);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Animate cloud layer
  useEffect(() => {
    if (!showAtmosphericEffects || !cloudLayerRef.current) return;

    let offset = 0;
    const animate = () => {
      offset += 0.2;
      if (cloudLayerRef.current) {
        cloudLayerRef.current.style.backgroundPosition = `${offset}px ${offset * 0.5}px`;
      }
      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [showAtmosphericEffects]);

  // Update AQI stations layer
  useEffect(() => {
    if (!markersLayerRef.current) return;
    
    markersLayerRef.current.clearLayers();
    
    if (showAQIStations) {
      stations.forEach((station) => {
        const icon = station.status === 'good' ? greenIcon :
                     station.status === 'moderate' ? yellowIcon :
                     station.status === 'unhealthy' ? redIcon : orangeIcon;
        
        const marker = L.marker([station.lat, station.lng], { icon });
        
        // Enhanced tooltip with all REMMAQ variables
        const tooltipContent = `
          <div style="min-width: 200px; font-family: Inter, sans-serif;">
            <div style="font-weight: 600; font-size: 14px; margin-bottom: 8px; color: #1f2937;">
              ${station.name}
            </div>
            <div style="font-size: 11px; color: #6b7280; margin-bottom: 6px;">
              AQI: <span style="font-weight: 600; color: #1f2937;">${station.aqi}</span>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; font-size: 10px;">
              <div style="color: #6b7280;">CO: <span style="color: #1f2937;">${station.CO} mg/m³</span></div>
              <div style="color: #6b7280;">NO₂: <span style="color: #1f2937;">${station.NO2} µg/m³</span></div>
              <div style="color: #6b7280;">O₃: <span style="color: #1f2937;">${station.O3} µg/m³</span></div>
              <div style="color: #6b7280;">PM2.5: <span style="color: #1f2937;">${station.PM25} µg/m³</span></div>
              <div style="color: #6b7280;">PM10: <span style="color: #1f2937;">${station.PM10} µg/m³</span></div>
              <div style="color: #6b7280;">SO₂: <span style="color: #1f2937;">${station.SO2} µg/m³</span></div>
            </div>
            <div style="border-top: 1px solid #e5e7eb; margin: 6px 0; padding-top: 6px; display: grid; grid-template-columns: 1fr 1fr; gap: 4px; font-size: 10px;">
              <div style="color: #6b7280;">Temp: <span style="color: #1f2937;">${station.TMP}°C</span></div>
              <div style="color: #6b7280;">Hum: <span style="color: #1f2937;">${station.HUM}%</span></div>
              <div style="color: #6b7280;">Wind: <span style="color: #1f2937;">${station.VEL} km/h ${station.DIR}</span></div>
              <div style="color: #6b7280;">Press: <span style="color: #1f2937;">${station.PRE} hPa</span></div>
              <div style="color: #6b7280;">UV: <span style="color: #1f2937;">${station.IUV}</span></div>
              <div style="color: #6b7280;">Solar: <span style="color: #1f2937;">${station.RS} W/m²</span></div>
              <div style="color: #6b7280;">Rain: <span style="color: #1f2937;">${station.LLU} mm</span></div>
            </div>
          </div>
        `;
        
        marker.bindTooltip(tooltipContent, {
          permanent: false,
          direction: 'top',
          offset: [0, -15],
          className: 'custom-tooltip'
        });
        
        marker.on('click', () => {
          setSelectedStation(station);
        });
        
        marker.addTo(markersLayerRef.current!);
      });
    }
  }, [showAQIStations]);

  // Update multi-variable heatmap with dispersion plumes
  useEffect(() => {
    if (!heatmapLayerRef.current || !mapInstanceRef.current) return;
    
    heatmapLayerRef.current.clearLayers();
    
    if (showTempHeatmap) {
      stations.forEach((station) => {
        // Calculate environmental intensity (aggregated from multiple variables)
        const pollutantScore = (station.PM25 + station.PM10 * 0.5 + station.NO2 * 0.5 + station.O3 * 0.3) / 50;
        
        let color, opacity;
        
        if (pollutantScore <= 1.5) {
          color = '#22C55E'; // Green
          opacity = 0.15;
        } else if (pollutantScore <= 3) {
          color = '#EAB308'; // Yellow
          opacity = 0.20;
        } else if (pollutantScore <= 4.5) {
          color = '#F97316'; // Orange
          opacity = 0.25;
        } else {
          color = '#EF4444'; // Red
          opacity = 0.30;
        }
        
        // Layer 1: Ultra-wide diffusion zone (covers entire region)
        const ultraWideCircle = L.circle([station.lat, station.lng], {
          color: 'transparent',
          fillColor: color,
          fillOpacity: opacity * 0.15,
          radius: 12000,
        });
        ultraWideCircle.addTo(heatmapLayerRef.current!);
        
        // Layer 2: Wide dispersion zone
        const wideCircle = L.circle([station.lat, station.lng], {
          color: 'transparent',
          fillColor: color,
          fillOpacity: opacity * 0.25,
          radius: 8000,
        });
        wideCircle.addTo(heatmapLayerRef.current!);
        
        // Layer 3: Medium dispersion zone
        const mediumCircle = L.circle([station.lat, station.lng], {
          color: 'transparent',
          fillColor: color,
          fillOpacity: opacity * 0.4,
          radius: 5000,
        });
        mediumCircle.addTo(heatmapLayerRef.current!);
        
        // Layer 4: Near-field zone
        const nearCircle = L.circle([station.lat, station.lng], {
          color: 'transparent',
          fillColor: color,
          fillOpacity: opacity * 0.7,
          radius: 2500,
        });
        nearCircle.addTo(heatmapLayerRef.current!);
        
        // Layer 5: Source point (brightest, smallest)
        const sourceCircle = L.circle([station.lat, station.lng], {
          color: color,
          weight: 2,
          fillColor: color,
          fillOpacity: opacity * 1.2,
          radius: 800,
        });
        sourceCircle.addTo(heatmapLayerRef.current!);
      });
    }
  }, [showTempHeatmap]);

  // Update animated wind flow particles
  useEffect(() => {
    if (!windLayerRef.current || !mapInstanceRef.current) return;
    
    windLayerRef.current.clearLayers();
    
    if (showWindFlow) {
      const bounds = mapInstanceRef.current.getBounds();
      const north = bounds.getNorth();
      const south = bounds.getSouth();
      const east = bounds.getEast();
      const west = bounds.getWest();
      
      // Create flowing wind streamlines
      const numStreamlines = 35;
      
      for (let i = 0; i < numStreamlines; i++) {
        const startLat = south + Math.random() * (north - south);
        const startLng = west + Math.random() * (east - west);
        
        const points: [number, number][] = [[startLat, startLng]];
        
        // Create curved streamline following wind direction (NE)
        const numPoints = 12 + Math.floor(Math.random() * 8);
        const curvature = (Math.random() - 0.5) * 0.00015;
        
        for (let j = 1; j < numPoints; j++) {
          const prevPoint = points[j - 1];
          const newLat = prevPoint[0] + 0.0018 + curvature * j; // NE direction
          const newLng = prevPoint[1] + 0.0025 + curvature * j;
          
          if (newLat > north || newLng > east) break;
          points.push([newLat, newLng]);
        }
        
        if (points.length > 3) {
          const opacity = 0.09 + Math.random() * 0.07;
          const weight = 0.9 + Math.random() * 0.5;
          
          const streamline = L.polyline(points, {
            color: '#509EE3',
            weight: weight,
            opacity: opacity,
            smoothFactor: 2,
          });
          
          streamline.addTo(windLayerRef.current!);
        }
      }
    }
  }, [showWindFlow]);

  const currentAQI = 72;
  const criticalZones = ['Tumbaco (125)', 'Los Chillos (92)'];

  return (
    <div className="w-full h-full overflow-y-auto bg-white">
      {/* Hero Section - Multi-Layer Map (50% height) */}
      <div className="relative" style={{ height: '50vh' }}>
        {/* Atmospheric cloud layer overlay */}
        {showAtmosphericEffects && (
          <div
            ref={cloudLayerRef}
            className="absolute inset-0 z-[400] pointer-events-none"
            style={{
              background: `
                radial-gradient(ellipse 1200px 800px at 25% 35%, rgba(80, 158, 227, 0.04) 0%, transparent 60%),
                radial-gradient(ellipse 900px 1100px at 75% 65%, rgba(234, 179, 8, 0.03) 0%, transparent 60%),
                radial-gradient(ellipse 700px 700px at 50% 50%, rgba(255, 255, 255, 0.08) 0%, transparent 60%)
              `,
              backgroundSize: '300% 300%',
              opacity: 0.7,
              mixBlendMode: 'soft-light',
            }}
          />
        )}

        <div ref={mapRef} style={{ height: '100%', width: '100%' }} />

        {/* Map Layer Controller */}
        <Card className="absolute top-4 right-4 z-[1000] shadow-lg w-72">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Visual Layers</CardTitle>
            <CardDescription className="text-xs">Aesthetic atmospheric simulation</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="aqi-stations" className="text-sm">Monitoring Stations</Label>
              <Switch
                id="aqi-stations"
                checked={showAQIStations}
                onCheckedChange={setShowAQIStations}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="wind-flow" className="text-sm">Wind Streamlines</Label>
              <Switch
                id="wind-flow"
                checked={showWindFlow}
                onCheckedChange={setShowWindFlow}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="temp-heatmap" className="text-sm">Dispersion Plumes</Label>
              <Switch
                id="temp-heatmap"
                checked={showTempHeatmap}
                onCheckedChange={setShowTempHeatmap}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="atmospheric" className="text-sm">Atmospheric Diffusion</Label>
              <Switch
                id="atmospheric"
                checked={showAtmosphericEffects}
                onCheckedChange={setShowAtmosphericEffects}
              />
            </div>
            <div className="pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground italic">
                Visual effects for presentation purposes
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Station Detail Tooltip */}
        {selectedStation && (
          <Card className="absolute top-4 left-4 z-[1000] shadow-xl w-96 border-2 border-[#509EE3]">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">{selectedStation.name}</CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    AQI: <span className="font-semibold">{selectedStation.aqi}</span>
                  </p>
                </div>
                <button
                  onClick={() => setSelectedStation(null)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Contaminantes */}
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Pollutants</h4>
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2 bg-[#F9FBFC] rounded">
                    <p className="text-xs text-muted-foreground">CO</p>
                    <p className="text-sm font-semibold">{selectedStation.CO} mg/m³</p>
                  </div>
                  <div className="p-2 bg-[#F9FBFC] rounded">
                    <p className="text-xs text-muted-foreground">NO₂</p>
                    <p className="text-sm font-semibold">{selectedStation.NO2} µg/m³</p>
                  </div>
                  <div className="p-2 bg-[#F9FBFC] rounded">
                    <p className="text-xs text-muted-foreground">O₃</p>
                    <p className="text-sm font-semibold">{selectedStation.O3} µg/m³</p>
                  </div>
                  <div className="p-2 bg-[#F9FBFC] rounded">
                    <p className="text-xs text-muted-foreground">PM2.5</p>
                    <p className="text-sm font-semibold">{selectedStation.PM25} µg/m³</p>
                  </div>
                  <div className="p-2 bg-[#F9FBFC] rounded">
                    <p className="text-xs text-muted-foreground">PM10</p>
                    <p className="text-sm font-semibold">{selectedStation.PM10} µg/m³</p>
                  </div>
                  <div className="p-2 bg-[#F9FBFC] rounded">
                    <p className="text-xs text-muted-foreground">SO₂</p>
                    <p className="text-sm font-semibold">{selectedStation.SO2} µg/m³</p>
                  </div>
                </div>
              </div>

              {/* Meteorología */}
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Meteorology</h4>
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 bg-[#F9FBFC] rounded">
                    <p className="text-xs text-muted-foreground">Temperature</p>
                    <p className="text-sm font-semibold">{selectedStation.TMP}°C</p>
                  </div>
                  <div className="p-2 bg-[#F9FBFC] rounded">
                    <p className="text-xs text-muted-foreground">Humidity</p>
                    <p className="text-sm font-semibold">{selectedStation.HUM}%</p>
                  </div>
                  <div className="p-2 bg-[#F9FBFC] rounded">
                    <p className="text-xs text-muted-foreground">Wind</p>
                    <p className="text-sm font-semibold">{selectedStation.VEL} km/h {selectedStation.DIR}</p>
                  </div>
                  <div className="p-2 bg-[#F9FBFC] rounded">
                    <p className="text-xs text-muted-foreground">Pressure</p>
                    <p className="text-sm font-semibold">{selectedStation.PRE} hPa</p>
                  </div>
                </div>
              </div>

              {/* Radiación y Precipitación */}
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Radiation & Precipitation</h4>
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2 bg-[#F9FBFC] rounded">
                    <p className="text-xs text-muted-foreground">UV Index</p>
                    <p className="text-sm font-semibold">{selectedStation.IUV}</p>
                  </div>
                  <div className="p-2 bg-[#F9FBFC] rounded">
                    <p className="text-xs text-muted-foreground">Solar</p>
                    <p className="text-sm font-semibold">{selectedStation.RS} W/m²</p>
                  </div>
                  <div className="p-2 bg-[#F9FBFC] rounded">
                    <p className="text-xs text-muted-foreground">Rain</p>
                    <p className="text-sm font-semibold">{selectedStation.LLU} mm</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* High-Density KPI & Alerts Ribbon */}
      <div className="px-6 py-4 bg-[#F9FBFC] border-b border-border">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {/* Current City AQI */}
          <Card className="bg-white">
            <CardContent className="p-4">
              <div className="flex items-start justify-between mb-2">
                <Activity className="w-5 h-5 text-[#509EE3]" />
                <Badge variant="outline" className="text-xs">24h</Badge>
              </div>
              <div className="space-y-1">
                <p className="text-2xl font-bold text-foreground">{currentAQI}</p>
                <p className="text-xs text-muted-foreground">Current AQI</p>
                <p className="text-xs font-medium text-yellow-600">Moderate</p>
              </div>
              {/* Mini sparkline */}
              <div className="mt-2 h-8">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={sparklineData.map((v) => ({ value: v }))}>
                    <Line type="monotone" dataKey="value" stroke="#509EE3" strokeWidth={1.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Critical Alerts */}
          <Card className="bg-white border-red-200">
            <CardContent className="p-4">
              <div className="flex items-start justify-between mb-2">
                <AlertTriangle className="w-5 h-5 text-red-600" />
                <Badge variant="destructive" className="text-xs">2</Badge>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-foreground">Critical Alerts</p>
                <div className="space-y-0.5">
                  {criticalZones.map((zone, idx) => (
                    <p key={idx} className="text-xs text-red-600 truncate">{zone}</p>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Temperature */}
          <Card className="bg-white">
            <CardContent className="p-4">
              <div className="flex items-start justify-between mb-2">
                <Thermometer className="w-5 h-5 text-[#509EE3]" />
                <TrendingUp className="w-4 h-4 text-green-600" />
              </div>
              <div className="space-y-1">
                <p className="text-2xl font-bold text-foreground">18°C</p>
                <p className="text-xs text-muted-foreground">Temperature</p>
                <p className="text-xs text-green-600">+2° from avg</p>
              </div>
            </CardContent>
          </Card>

          {/* Humidity */}
          <Card className="bg-white">
            <CardContent className="p-4">
              <div className="flex items-start justify-between mb-2">
                <Droplets className="w-5 h-5 text-[#509EE3]" />
                <TrendingUp className="w-4 h-4 text-blue-600" />
              </div>
              <div className="space-y-1">
                <p className="text-2xl font-bold text-foreground">65%</p>
                <p className="text-xs text-muted-foreground">Humidity</p>
                <p className="text-xs text-blue-600">Normal range</p>
              </div>
            </CardContent>
          </Card>

          {/* Barometric Pressure */}
          <Card className="bg-white">
            <CardContent className="p-4">
              <div className="flex items-start justify-between mb-2">
                <Gauge className="w-5 h-5 text-[#509EE3]" />
                <Eye className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="space-y-1">
                <p className="text-2xl font-bold text-foreground">1013</p>
                <p className="text-xs text-muted-foreground">hPa</p>
                <p className="text-xs text-muted-foreground">Stable</p>
              </div>
            </CardContent>
          </Card>

          {/* Wind Dynamics */}
          <Card className="bg-white">
            <CardContent className="p-4">
              <div className="flex items-start justify-between mb-2">
                <Wind className="w-5 h-5 text-[#509EE3]" />
                <div className="w-6 h-6 flex items-center justify-center">
                  <div className="w-4 h-4 border-2 border-[#509EE3] border-t-transparent rounded-full" style={{ transform: 'rotate(45deg)' }}></div>
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-2xl font-bold text-foreground">14</p>
                <p className="text-xs text-muted-foreground">km/h - NE</p>
                <p className="text-xs text-muted-foreground">Light breeze</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Tabbed Charts Section */}
      <div className="px-6 py-6">
        <Tabs defaultValue="pollutants" className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="pollutants">Pollutants vs Meteorology</TabsTrigger>
            <TabsTrigger value="wind">Wind & Dispersion Patterns</TabsTrigger>
          </TabsList>

          <TabsContent value="pollutants">
            <Card className="bg-white">
              <CardHeader>
                <CardTitle>Pollutants vs Meteorology (Last 24h)</CardTitle>
                <CardDescription>Dual-axis correlation analysis</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-96">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={pollutantMeteoData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="time" fontSize={12} />
                      <YAxis yAxisId="left" fontSize={12} label={{ value: 'Concentration (µg/m³)', angle: -90, position: 'insideLeft' }} />
                      <YAxis yAxisId="right" orientation="right" fontSize={12} label={{ value: 'Temp (°C) / Humidity (%)', angle: 90, position: 'insideRight' }} />
                      <Tooltip />
                      <Legend />
                      <Bar yAxisId="left" dataKey="PM25" fill="#509EE3" name="PM2.5" />
                      <Bar yAxisId="left" dataKey="PM10" fill="#EAB308" name="PM10" />
                      <Line yAxisId="right" type="monotone" dataKey="temp" stroke="#EF4444" strokeWidth={2} strokeDasharray="5 5" name="Temperature" />
                      <Line yAxisId="right" type="monotone" dataKey="humidity" stroke="#3B82F6" strokeWidth={2} strokeDasharray="5 5" name="Humidity" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="wind">
            <Card className="bg-white">
              <CardHeader>
                <CardTitle>Wind & Dispersion Patterns</CardTitle>
                <CardDescription>Wind rose and pollutant dispersion heatmap</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-96 flex items-center justify-center bg-[#F9FBFC] rounded-lg">
                  <p className="text-muted-foreground">Wind Rose Chart & Dispersion Heatmap Placeholder</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Data Source Manager Card */}
      <div className="px-6 pb-6">
        <Card className="bg-white">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>REMMAQ Auto-Sync</CardTitle>
                <CardDescription>Automated web scraper for air quality data</CardDescription>
              </div>
              <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100">
                Active
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="p-4 bg-[#F9FBFC] rounded-lg">
                <p className="text-xs text-muted-foreground mb-1">Last Sync</p>
                <p className="text-sm font-semibold">2 hours ago</p>
              </div>
              <div className="p-4 bg-[#F9FBFC] rounded-lg">
                <p className="text-xs text-muted-foreground mb-1">Records Today</p>
                <p className="text-sm font-semibold">12,847</p>
              </div>
              <div className="p-4 bg-[#F9FBFC] rounded-lg">
                <p className="text-xs text-muted-foreground mb-1">Success Rate</p>
                <p className="text-sm font-semibold text-green-600">99.8%</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Custom styles for tooltips */}
      <style>{`
        .custom-tooltip {
          background: white !important;
          border: 2px solid #509EE3 !important;
          border-radius: 8px !important;
          padding: 0 !important;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15) !important;
        }
        .custom-tooltip .leaflet-tooltip-left::before {
          border-left-color: #509EE3 !important;
        }
        .custom-tooltip .leaflet-tooltip-right::before {
          border-right-color: #509EE3 !important;
        }
      `}</style>
    </div>
  );
}
