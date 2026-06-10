import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FocusEvent as ReactFocusEvent, MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  CloudRain,
  Gauge,
  Info,
  LogIn,
  MapPin,
  RefreshCw,
  Thermometer,
  Waves,
  Wind,
} from 'lucide-react';
import L from 'leaflet';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import {
  getPublicAirQuality,
  type PublicAirQualityResponse,
  type PublicMeteorologySummary,
  type PublicStationObservation,
  type PublicVariableSummary,
} from '@/api/modules/public-air-quality';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

interface PublicDashboardProps {
  onGoToLogin: () => void;
}

type RangePreset = 'latest' | 'today' | '72h' | 'week' | 'month';

interface QualityBand {
  label: string;
  color: string;
  background: string;
  description: string;
}

interface ChartPoint {
  time: string;
  mean: number;
  min: number;
  max: number;
}

interface HistogramPoint {
  range: string;
  stations: number;
}

interface StationBarPoint {
  station: string;
  mean: number;
  latest: number;
}

interface VariableCoveragePoint {
  variable: string;
  samples: number;
  stations: number;
}

interface IdwLegendData {
  min: number | null;
  max: number | null;
  lowLabel: string;
  midLabel: string;
  highLabel: string;
  scaleLabel: string;
  description: string;
}

const POLLING_INTERVAL_MS = 60 * 60 * 1000;
const QUITO_CENTER: L.LatLngExpression = [-0.1807, -78.4678];
const ALL_STATIONS = 'all';
const DEFAULT_VARIABLE = 'PM25';
const DATA_ERROR_MESSAGE =
  'No se pudo conectar con el servicio público de datos. Verifica que el backend actualizado esté corriendo y vuelve a intentar.';
const VARIABLE_ORDER = ['PM25', 'PM10', 'NO2', 'O3', 'CO', 'SO2', 'TMP', 'HUM', 'VEL', 'DIR', 'LLU', 'RS', 'IUV'];
const VARIABLE_HELP: Record<string, string> = {
  PM25: 'Particulas finas de 2.5 micras o menos. Son relevantes porque penetran profundamente en el sistema respiratorio.',
  PM10: 'Particulas inhalables de hasta 10 micras. Ayudan a observar polvo, combustion y resuspension urbana.',
  NO2: 'Dioxido de nitrogeno. Se asocia principalmente con trafico y combustion; es clave para entender exposicion urbana.',
  O3: 'Ozono troposferico. Se forma por reacciones fotoquimicas y suele variar con radiacion solar y meteorologia.',
  CO: 'Monoxido de carbono. Indica combustion incompleta y se usa como senal de fuentes vehiculares o puntuales.',
  SO2: 'Dioxido de azufre. Relacionado con combustion de combustibles con azufre y episodios industriales o volcanicos.',
  TMP: 'Temperatura ambiente. Condiciona mezcla atmosferica, reaccion fotoquimica y dispersion de contaminantes.',
  HUM: 'Humedad relativa. Influye en formacion de particulas, niebla, deposicion y lectura de episodios meteorologicos.',
  VEL: 'Velocidad del viento. Indica capacidad de dispersion: viento bajo puede favorecer acumulacion local.',
  DIR: 'Direccion del viento. Ayuda a interpretar transporte de contaminantes entre zonas y estaciones.',
  LLU: 'Precipitacion. La lluvia puede remover contaminantes del aire y cambiar rapidamente la concentracion observada.',
  RS: 'Radiacion solar. Es importante para procesos fotoquimicos como la formacion de ozono.',
  IUV: 'Indice ultravioleta. Resume intensidad de radiacion UV y complementa el analisis de radiacion solar.',
};
const VARIABLE_RECOMMENDATIONS: Record<string, string> = {
  PM25: 'Si el valor sube, personas con enfermedad respiratoria o cardiaca, ninos y adultos mayores deben reducir exposicion prolongada.',
  PM10: 'En episodios altos conviene reducir actividad fisica intensa al aire libre y evitar zonas con polvo o trafico pesado.',
  NO2: 'Valores elevados suelen relacionarse con combustion vehicular; grupos sensibles deben limitar exposicion cerca de vias congestionadas.',
  O3: 'Puede aumentar con radiacion solar; en valores altos se recomienda moderar actividad fisica al aire libre en horas de mayor sol.',
  CO: 'Valores altos indican combustion incompleta; se recomienda ventilar espacios y evitar exposicion cerca de fuentes de combustion.',
  SO2: 'Personas con asma pueden ser mas sensibles; en episodios altos conviene reducir exposicion exterior.',
  TMP: 'La temperatura ayuda a interpretar estabilidad atmosferica y formacion fotoquimica; no es un contaminante por si sola.',
  HUM: 'La humedad puede modificar particulas, niebla y deposicion; sirve para interpretar cambios de concentracion.',
  VEL: 'Viento bajo puede favorecer acumulacion local; viento mayor suele dispersar contaminantes.',
  DIR: 'La direccion del viento ayuda a inferir transporte de contaminantes entre zonas.',
  LLU: 'La lluvia puede remover contaminantes del aire, por lo que las concentraciones pueden bajar rapidamente.',
  RS: 'La radiacion solar influye en procesos fotoquimicos como la formacion de ozono.',
  IUV: 'El indice UV informa exposicion solar; use proteccion cuando el valor aumenta.',
};
const METEOROLOGY_ICONS: Record<string, typeof Wind> = {
  VEL: Wind,
  DIR: Waves,
  TMP: Thermometer,
  HUM: CloudRain,
  LLU: CloudRain,
  RS: Activity,
};

const QUITO_PUBLIC_MAP_POLYGONS: [number, number][][] = [
  [
    [-0.005, -78.505],
    [-0.012, -78.463],
    [-0.07, -78.444],
    [-0.14, -78.448],
    [-0.205, -78.468],
    [-0.275, -78.487],
    [-0.345, -78.523],
    [-0.365, -78.555],
    [-0.312, -78.568],
    [-0.232, -78.545],
    [-0.148, -78.524],
    [-0.067, -78.517],
  ],
  [
    [-0.145, -78.432],
    [-0.13, -78.37],
    [-0.175, -78.315],
    [-0.245, -78.31],
    [-0.315, -78.362],
    [-0.337, -78.432],
    [-0.288, -78.472],
    [-0.212, -78.462],
  ],
  [
    [-0.075, -78.445],
    [-0.057, -78.392],
    [-0.092, -78.34],
    [-0.145, -78.333],
    [-0.173, -78.381],
    [-0.153, -78.433],
  ],
];

const RANGE_LABELS: Record<RangePreset, string> = {
  latest: 'Ultima hora',
  today: 'Hoy',
  '72h': 'Ultimas 72 horas',
  week: 'Ultima semana',
  month: 'Mes en curso',
};

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => hour);

const roundValue = (value: number | null | undefined, digits = 1) => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 'Sin datos';
  }
  return value.toLocaleString('es-EC', {
    maximumFractionDigits: digits,
    minimumFractionDigits: value % 1 === 0 ? 0 : digits,
  });
};

const getVariableDigits = (code: string | null | undefined, unit?: string | null) => {
  if (code === 'CO') return 3;
  if (code === 'NO2' || code === 'O3' || code === 'SO2' || code === 'DIR' || code === 'VEL') return 2;
  if (unit === 'mg/m3') return 3;
  return 1;
};

const formatVariableValue = (
  value: number | null | undefined,
  code: string | null | undefined,
  unit?: string | null,
) => roundValue(value, getVariableDigits(code, unit));

const formatDateTime = (value: string | null | undefined) => {
  if (!value) {
    return 'Sin actualización';
  }
  return new Intl.DateTimeFormat('es-EC', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
};

const formatShortTime = (value: string) =>
  new Intl.DateTimeFormat('es-EC', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
  }).format(new Date(value));

const getVariableLabel = (code: string) => {
  if (code === 'PM25') return 'PM2.5';
  if (code === 'NO2') return 'NO₂';
  if (code === 'O3') return 'O₃';
  if (code === 'SO2') return 'SO₂';
  return code;
};

const getUnitLabel = (unit: string | null | undefined) => {
  if (!unit) return '';
  if (unit.toLowerCase() === 'u') return 'index';
  return unit.replace('ug/m3', 'µg/m³').replace('mg/m3', 'mg/m³');
};

const getLegendData = (
  variableCode: string,
  min: number | null,
  max: number | null,
  unit: string | null | undefined,
): IdwLegendData => {
  const formattedUnit = getUnitLabel(unit);
  if (min === null || max === null) {
    return {
      min,
      max,
      lowLabel: 'Menor',
      midLabel: 'Intermedio',
      highLabel: 'Mayor',
      scaleLabel: 'Escala de lectura',
      description: 'Sin valores suficientes para clasificar el rango observado.',
    };
  }
  if (variableCode === 'PM25') {
    return {
      min,
      max,
      lowLabel: `< 10 ${formattedUnit}`.trim(),
      midLabel: `10-25 ${formattedUnit}`.trim(),
      highLabel: `> 25 ${formattedUnit}`.trim(),
      scaleLabel: 'Umbral PM2.5',
      description: 'Verde, amarillo y rojo siguen bandas de PM2.5 usadas para lectura publica de exposicion.',
    };
  }
  return {
    min,
    max,
    lowLabel: `${roundValue(min)} ${formattedUnit}`.trim(),
    midLabel: 'Valor medio',
    highLabel: `${roundValue(max)} ${formattedUnit}`.trim(),
    scaleLabel: 'Escala relativa',
    description: 'La escala compara el minimo y maximo observados para esta variable en el periodo seleccionado.',
  };
};

const normalizeLoadError = (loadError: unknown) => {
  if (!(loadError instanceof Error)) {
    return DATA_ERROR_MESSAGE;
  }
  if (loadError.message === 'Failed to fetch') {
    return DATA_ERROR_MESSAGE;
  }
  return loadError.message;
};

const getQualityBand = (variableCode: string, value: number, values: number[]): QualityBand => {
  if (variableCode === 'PM25') {
    if (value < 10) {
      return {
        label: 'Bajo',
        color: '#15803d',
        background: '#dcfce7',
        description: 'PM2.5 menor a 10 µg/m³',
      };
    }
    if (value <= 25) {
      return {
        label: 'Moderado',
        color: '#a16207',
        background: '#fef9c3',
        description: 'PM2.5 entre 10 y 25 µg/m³',
      };
    }
    return {
      label: 'Alto',
      color: '#b91c1c',
      background: '#fee2e2',
      description: 'PM2.5 mayor a 25 µg/m³',
    };
  }

  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const observedMin = sorted[0];
  const observedMax = sorted[sorted.length - 1];
  if (sorted.length < 3 || observedMax - observedMin <= 0.05 || roundValue(observedMin) === roundValue(observedMax)) {
    return {
      label: 'Sin variacion relevante',
      color: '#1d4ed8',
      background: '#dbeafe',
      description: 'Valores muy similares en el rango seleccionado',
    };
  }
  const low = sorted[Math.floor(sorted.length * 0.33)];
  const high = sorted[Math.floor(sorted.length * 0.66)];
  if (value <= low) {
    return { label: 'Bajo relativo', color: '#0f766e', background: '#ccfbf1', description: 'Tercio inferior del rango' };
  }
  if (value <= high) {
    return { label: 'Medio relativo', color: '#a16207', background: '#fef3c7', description: 'Tercio medio del rango' };
  }
  return { label: 'Alto relativo', color: '#b91c1c', background: '#fee2e2', description: 'Tercio superior del rango' };
};

const colorForInterpolatedValue = (variableCode: string, value: number, values: number[]) => {
  if (!Number.isFinite(value)) {
    return '#509EE3';
  }
  return getQualityBand(variableCode, value, values).color;
};

const distanceToNearestStation = (lat: number, lng: number, stations: PublicStationObservation[]) =>
  Math.min(...stations.map((station) => Math.hypot(lat - station.latitude, lng - station.longitude)));

const computeIdw = (lat: number, lng: number, stations: PublicStationObservation[]) => {
  if (stations.length === 1) {
    return stations[0].mean_value;
  }
  let weightedSum = 0;
  let weightTotal = 0;
  for (const station of stations) {
    const distance = Math.hypot(lat - station.latitude, lng - station.longitude);
    if (distance < 0.008) {
      return station.mean_value;
    }
    const weight = 1 / distance ** 3.4;
    weightedSum += station.mean_value * weight;
    weightTotal += weight;
  }
  return weightTotal > 0 ? weightedSum / weightTotal : 0;
};

const stationCoverageRadiusMeters = (stationCount: number) => (stationCount <= 1 ? 5200 : 7000);
const stationCoverageRadiusDegrees = (stationCount: number) => (stationCount <= 1 ? 0.048 : 0.064);

const pointInPolygon = (lat: number, lng: number, polygon: [number, number][]) => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const yi = polygon[i][0];
    const xi = polygon[i][1];
    const yj = polygon[j][0];
    const xj = polygon[j][1];
    const intersects = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
};

const pointInAnyPolygon = (lat: number, lng: number, polygons: [number, number][][]) =>
  polygons.some((polygon) => pointInPolygon(lat, lng, polygon));

const getPolygonBounds = (polygons: [number, number][][]) => {
  const points = polygons.flat();
  return {
    minLat: Math.min(...points.map((point) => point[0])),
    maxLat: Math.max(...points.map((point) => point[0])),
    minLng: Math.min(...points.map((point) => point[1])),
    maxLng: Math.max(...points.map((point) => point[1])),
  };
};

const buildHistogram = (stations: PublicStationObservation[]): HistogramPoint[] => {
  if (stations.length === 0) {
    return [];
  }
  const values = stations.map((station) => station.mean_value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    return [{ range: roundValue(min), stations: stations.length }];
  }
  const binCount = Math.min(6, Math.max(3, stations.length));
  const width = (max - min) / binCount;
  return Array.from({ length: binCount }, (_, index) => {
    const start = min + width * index;
    const end = index === binCount - 1 ? max : start + width;
    const count = values.filter((value) => value >= start && (index === binCount - 1 ? value <= end : value < end)).length;
    return {
      range: `${roundValue(start, 0)}-${roundValue(end, 0)}`,
      stations: count,
    };
  });
};

const summarizeAvailability = (summaries: PublicVariableSummary[]) => {
  const withData = summaries.filter((summary) => summary.sample_count > 0).length;
  return `${withData}/${summaries.length} variables con datos en el rango`;
};

const formatFreshness = (value: string | null | undefined) => {
  if (!value) {
    return 'Sin datos observados';
  }
  const observedAt = new Date(value).getTime();
  if (!Number.isFinite(observedAt)) {
    return 'Fecha no valida';
  }
  const diffHours = Math.max(0, (Date.now() - observedAt) / 36e5);
  if (diffHours < 1) {
    return 'Hace menos de 1 h';
  }
  if (diffHours < 48) {
    return `Hace ${Math.round(diffHours)} h`;
  }
  return `Hace ${Math.round(diffHours / 24)} dias`;
};

const buildCoverageMessage = (summaries: PublicVariableSummary[]) => {
  const withData = summaries.filter((summary) => summary.sample_count > 0);
  if (summaries.length === 0) {
    return 'El servicio publico no devolvio catalogo de variables.';
  }
  if (withData.length === summaries.length) {
    return 'Todas las variables del catalogo tienen datos para el rango seleccionado.';
  }
  if (withData.length === 0) {
    return 'No hay mediciones cargadas para las variables REMMAQ en este rango.';
  }
  return `La base local solo tiene mediciones para ${withData.map((summary) => getVariableLabel(summary.variable_code)).join(', ')} en este rango.`;
};

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character] ?? character;
  });

const buildVariableRows = (station: PublicStationObservation, category: 'pollutant' | 'meteorological') => {
  const rows = (station.variables ?? [])
    .filter((item) => item.category === category)
    .map(
      (item) => `
        <div style="display:flex; justify-content:space-between; gap:12px; align-items:baseline;">
          <span style="color:#64748b;">${escapeHtml(getVariableLabel(item.variable_code))}</span>
          <strong style="color:#0f172a;">${escapeHtml(formatVariableValue(item.value, item.variable_code, item.unit))} ${escapeHtml(getUnitLabel(item.unit))}</strong>
        </div>
      `,
    )
    .join('');
  return rows || '<span style="color:#64748b;">Sin lectura reciente</span>';
};

const buildStationPopup = (
  station: PublicStationObservation,
  selectedVariable: string,
  unit: string | null,
  band: QualityBand,
) => `
  <div style="min-width: 320px; max-width: 380px; font-family: Inter, system-ui, sans-serif; color:#0f172a;">
    <div style="display:flex; justify-content:space-between; gap:12px; margin-bottom:12px; align-items:flex-start;">
      <div>
        <div style="font-weight: 700; font-size: 16px; line-height:1.2;">${escapeHtml(station.station_name)}</div>
        <div style="font-size: 11px; color:#64748b; text-transform:uppercase; margin-top:2px;">${escapeHtml(station.station_code)}</div>
      </div>
      <div style="border:1px solid ${band.color}; background:${band.background}; color:${band.color}; border-radius:999px; padding:3px 8px; font-size:11px; font-weight:700; white-space:nowrap;">${band.label}</div>
    </div>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:12px; font-size:12px;">
      <div style="border:1px solid #dce5f1; background:#f9fbfc; border-radius:8px; padding:9px;">
        <div style="color:#64748b; font-size:11px;">Promedio ${escapeHtml(getVariableLabel(selectedVariable))}</div>
        <strong style="display:block; margin-top:3px; font-size:15px;">${escapeHtml(formatVariableValue(station.mean_value, selectedVariable, unit))} ${escapeHtml(getUnitLabel(unit))}</strong>
      </div>
      <div style="border:1px solid #dce5f1; background:#f9fbfc; border-radius:8px; padding:9px;">
        <div style="color:#64748b; font-size:11px;">Ultima lectura</div>
        <strong style="display:block; margin-top:3px; font-size:15px;">${escapeHtml(formatVariableValue(station.latest_value, selectedVariable, unit))} ${escapeHtml(getUnitLabel(unit))}</strong>
      </div>
      <div style="border:1px solid #dce5f1; background:#ffffff; border-radius:8px; padding:9px;">
        <div style="color:#64748b; font-size:11px;">Muestras</div>
        <strong style="display:block; margin-top:3px;">${station.sample_count}</strong>
      </div>
      <div style="border:1px solid #dce5f1; background:#ffffff; border-radius:8px; padding:9px;">
        <div style="color:#64748b; font-size:11px;">Fecha</div>
        <strong style="display:block; margin-top:3px;">${escapeHtml(formatDateTime(station.latest_observed_at))}</strong>
      </div>
    </div>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; border-top:1px solid #e5edf6; padding-top:12px; font-size:12px;">
      <div>
        <div style="font-weight:700; margin-bottom:6px;">Contaminantes</div>
        <div style="display:grid; gap:3px;">${buildVariableRows(station, 'pollutant')}</div>
      </div>
      <div>
        <div style="font-weight:700; margin-bottom:6px;">Meteorologia</div>
        <div style="display:grid; gap:3px;">${buildVariableRows(station, 'meteorological')}</div>
      </div>
    </div>
  </div>
`;

function updateMapLayers({
  map,
  stations,
  selectedVariable,
  unit,
  showSurface,
  showStations,
  surfaceLayer,
  markerLayer,
}: {
  map: L.Map;
  stations: PublicStationObservation[];
  selectedVariable: string;
  unit: string | null;
  showSurface: boolean;
  showStations: boolean;
  surfaceLayer: L.LayerGroup;
  markerLayer: L.LayerGroup;
}) {
  surfaceLayer.clearLayers();
  markerLayer.clearLayers();
  if (stations.length === 0) {
    return;
  }

  const values = stations.map((station) => station.mean_value);
  if (showSurface && stations.length >= 1) {
    if (stations.length === 1) {
      const station = stations[0];
      const band = getQualityBand(selectedVariable, station.mean_value, values);
      L.circle([station.latitude, station.longitude], {
        radius: stationCoverageRadiusMeters(stations.length),
        color: band.color,
        fillColor: band.color,
        fillOpacity: 0.22,
        opacity: 0.55,
        weight: 1,
        interactive: false,
      }).addTo(surfaceLayer);
    } else {
      const { minLat, maxLat, minLng, maxLng } = getPolygonBounds(QUITO_PUBLIC_MAP_POLYGONS);
      const rows = 86;
      const cols = 58;
      const stepLat = (maxLat - minLat) / rows;
      const stepLng = (maxLng - minLng) / cols;
      const maxCoverageDistance = stationCoverageRadiusDegrees(stations.length);

      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          const lat = minLat + stepLat * (row + 0.5);
          const lng = minLng + stepLng * (col + 0.5);
          if (!pointInAnyPolygon(lat, lng, QUITO_PUBLIC_MAP_POLYGONS)) {
            continue;
          }
          if (distanceToNearestStation(lat, lng, stations) > maxCoverageDistance) {
            continue;
          }
          const value = computeIdw(lat, lng, stations);
          const fillColor = colorForInterpolatedValue(selectedVariable, value, values);
          const rectangle = L.rectangle(
            [
              [minLat + stepLat * row, minLng + stepLng * col],
              [minLat + stepLat * (row + 1), minLng + stepLng * (col + 1)],
            ],
            {
              color: fillColor,
              fillColor,
              fillOpacity: 0.46,
              opacity: 0,
              interactive: false,
            },
          );
          rectangle.addTo(surfaceLayer);
        }
      }
    }
  }

  if (showStations) {
    for (const station of stations) {
      const band = getQualityBand(selectedVariable, station.mean_value, values);
      const marker = L.circleMarker([station.latitude, station.longitude], {
        radius: 9,
        color: '#ffffff',
        weight: 2,
        fillColor: band.color,
        fillOpacity: 0.92,
      });
      marker.bindPopup(buildStationPopup(station, selectedVariable, unit, band), {
        className: 'public-station-popup',
        maxWidth: 420,
      });
      marker.bindTooltip(`${formatVariableValue(station.latest_value, selectedVariable, unit)} ${getUnitLabel(unit)}`, {
        permanent: true,
        direction: 'top',
        offset: [0, -12],
        className: 'public-station-value-label',
      });
      marker.addTo(markerLayer);
    }
  }

  if (stations.length > 1) {
    const bounds = L.latLngBounds(stations.map((station) => [station.latitude, station.longitude]));
    map.fitBounds(bounds.pad(0.18), { animate: false });
  } else {
    map.setView([stations[0].latitude, stations[0].longitude], 12, { animate: false });
  }
}

export function PublicDashboard({ onGoToLogin }: PublicDashboardProps) {
  const [snapshot, setSnapshot] = useState<PublicAirQualityResponse | null>(null);
  const [selectedVariable, setSelectedVariable] = useState(DEFAULT_VARIABLE);
  const [rangePreset, setRangePreset] = useState<RangePreset>('latest');
  const [selectedStation, setSelectedStation] = useState(ALL_STATIONS);
  const [selectedHour, setSelectedHour] = useState<string>(ALL_STATIONS);
  const [stationOptions, setStationOptions] = useState<{ code: string; name: string }[]>([]);
  const [showSurface, setShowSurface] = useState(true);
  const [showStations, setShowStations] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);
  const snapshotCacheRef = useRef<Map<string, PublicAirQualityResponse>>(new Map());
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const surfaceLayerRef = useRef<L.LayerGroup | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);

  const requestParams = useMemo(() => {
    return {
      variable_code: selectedVariable,
      period: rangePreset,
      hour: rangePreset === 'today' && selectedHour !== ALL_STATIONS ? Number(selectedHour) : undefined,
      station_code: selectedStation !== ALL_STATIONS ? selectedStation : undefined,
    };
  }, [rangePreset, selectedHour, selectedStation, selectedVariable]);

  const cacheGroupKey = useMemo(
    () => `${rangePreset}|${selectedHour}|${selectedStation}`,
    [rangePreset, selectedHour, selectedStation],
  );
  const requestCacheKey = useMemo(
    () => `${cacheGroupKey}|${selectedVariable}`,
    [cacheGroupKey, selectedVariable],
  );

  const cacheSnapshot = useCallback((response: PublicAirQualityResponse) => {
    const hourKey = requestParams.hour ?? ALL_STATIONS;
    const stationKey = requestParams.station_code ?? ALL_STATIONS;
    snapshotCacheRef.current.set(`${requestParams.period}|${hourKey}|${stationKey}|${response.variable_code}`, response);
    if (!requestParams.station_code && response.stations.length > 0) {
      setStationOptions((current) => {
        const next = new Map(current.map((station) => [station.code, station]));
        response.stations.forEach((station) => next.set(station.station_code, { code: station.station_code, name: station.station_name }));
        return [...next.values()].sort((a, b) => a.name.localeCompare(b.name));
      });
    }
  }, [requestParams.hour, requestParams.period, requestParams.station_code]);

  const preloadVariables = useCallback(async (baseResponse: PublicAirQualityResponse) => {
    const variablesToLoad = baseResponse.variables
      .map((variable) => variable.code)
      .filter((code) => code !== baseResponse.variable_code)
      .filter((code) => !snapshotCacheRef.current.has(`${cacheGroupKey}|${code}`));
    if (variablesToLoad.length === 0) {
      return;
    }
    const loaded = await Promise.allSettled(
      variablesToLoad.map((code) =>
        getPublicAirQuality({
          ...requestParams,
          variable_code: code,
          sync: false,
          force_sync: false,
        }),
      ),
    );
    loaded.forEach((result) => {
      if (result.status === 'fulfilled') {
        cacheSnapshot(result.value);
      }
    });
  }, [cacheGroupKey, cacheSnapshot, requestParams]);

  const loadSnapshot = useCallback(async (forceSync = false) => {
    setLoading(true);
    setError(null);
    try {
      const response = await getPublicAirQuality({
        ...requestParams,
        sync: true,
        force_sync: forceSync,
      });
      if (forceSync) {
        snapshotCacheRef.current.clear();
      }
      cacheSnapshot(response);
      setSnapshot(response);
      if (response.variable_code && response.variable_code !== selectedVariable) {
        setSelectedVariable(response.variable_code);
      }
      setLastFetchedAt(new Date().toISOString());
      void preloadVariables(response);
    } catch (loadError) {
      setError(normalizeLoadError(loadError));
    } finally {
      setLoading(false);
    }
  }, [cacheSnapshot, preloadVariables, requestParams, selectedVariable]);

  useEffect(() => {
    const cached = snapshotCacheRef.current.get(requestCacheKey);
    if (cached) {
      setSnapshot(cached);
      return;
    }
    void loadSnapshot(false);
  }, [loadSnapshot, requestCacheKey]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void loadSnapshot(true);
    }, POLLING_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [loadSnapshot]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) {
      return;
    }
    const map = L.map(mapContainerRef.current, {
      zoomControl: true,
      scrollWheelZoom: true,
    }).setView(QUITO_CENTER, 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
    surfaceLayerRef.current = L.layerGroup().addTo(map);
    markerLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      surfaceLayerRef.current = null;
      markerLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current || !surfaceLayerRef.current || !markerLayerRef.current || !snapshot) {
      return;
    }
    updateMapLayers({
      map: mapRef.current,
      stations: snapshot.stations,
      selectedVariable: snapshot.variable_code,
      unit: snapshot.unit,
      showSurface,
      showStations,
      surfaceLayer: surfaceLayerRef.current,
      markerLayer: markerLayerRef.current,
    });
  }, [showStations, showSurface, snapshot]);

  const values = snapshot?.stations.map((station) => station.mean_value) ?? [];
  const selectedMin = values.length > 0 ? Math.min(...values) : null;
  const selectedMax = values.length > 0 ? Math.max(...values) : null;
  const idwLegend = getLegendData(snapshot?.variable_code ?? selectedVariable, selectedMin, selectedMax, snapshot?.unit);
  const cityMean = values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const periodSummary = snapshot?.period_summary;
  const periodUnit = periodSummary?.unit ?? snapshot?.unit;
  const displayMean = periodSummary?.avg_value ?? cityMean;
  const cityBand = displayMean !== null && displayMean !== undefined && snapshot ? getQualityBand(snapshot.variable_code, displayMean, values) : null;
  const chartData: ChartPoint[] = useMemo(
    () =>
      snapshot?.time_series.map((point) => ({
        time: formatShortTime(point.timestamp),
        mean: Number(point.mean_value.toFixed(2)),
        min: Number(point.min_value.toFixed(2)),
        max: Number(point.max_value.toFixed(2)),
      })) ?? [],
    [snapshot],
  );
  const variableOptions = useMemo(() => {
    const options = snapshot?.variables ?? [];
    return [...options].sort((a, b) => {
      const orderA = VARIABLE_ORDER.indexOf(a.code);
      const orderB = VARIABLE_ORDER.indexOf(b.code);
      if (orderA === -1 && orderB === -1) return a.code.localeCompare(b.code);
      if (orderA === -1) return 1;
      if (orderB === -1) return -1;
      return orderA - orderB;
    });
  }, [snapshot]);
  const variableSummaries = useMemo(() => snapshot?.variable_summaries ?? [], [snapshot]);
  const selectedVariableSummary = variableSummaries.find((summary) => summary.variable_code === snapshot?.variable_code);
  const stationComparison: StationBarPoint[] = useMemo(
    () =>
      [...(snapshot?.stations ?? [])]
        .sort((a, b) => b.mean_value - a.mean_value)
        .slice(0, 9)
        .map((station) => ({
          station: station.station_name.replace('Los ', ''),
          mean: Number(station.mean_value.toFixed(2)),
          latest: Number(station.latest_value.toFixed(2)),
        })),
    [snapshot],
  );
  const histogramData = useMemo(() => buildHistogram(snapshot?.stations ?? []), [snapshot]);
  const pollutantSummaries = variableSummaries.filter((summary) => summary.category === 'pollutant');
  const meteorologySummaries = variableSummaries.filter((summary) => summary.category === 'meteorological');
  const activeVariableSummaries = variableSummaries.filter((summary) => summary.sample_count > 0);
  const missingVariableSummaries = variableSummaries.filter((summary) => summary.sample_count === 0);
  const coveragePercent = variableSummaries.length > 0 ? Math.round((activeVariableSummaries.length / variableSummaries.length) * 100) : 0;
  const coverageMessage = buildCoverageMessage(variableSummaries);
  const freshnessLabel = formatFreshness(snapshot?.latest_observed_at);
  const latestIngestedAt = snapshot?.latest_ingested_at ?? snapshot?.sync?.latest_source_processed_at ?? snapshot?.sync?.latest_run_finished_at;
  const topRelativeStations = useMemo(
    () =>
      [...(snapshot?.stations ?? [])]
        .sort((a, b) => b.mean_value - a.mean_value)
        .slice(0, 2),
    [snapshot],
  );
  const stationSnapshot = useMemo(
    () =>
      [...(snapshot?.stations ?? [])]
        .sort((a, b) => b.latest_value - a.latest_value)
        .slice(0, 6),
    [snapshot],
  );
  const variableCoverageData: VariableCoveragePoint[] = useMemo(
    () =>
      variableSummaries.map((summary) => ({
        variable: getVariableLabel(summary.variable_code),
        samples: summary.sample_count,
        stations: summary.station_count,
      })),
    [variableSummaries],
  );
  const stationMatrixCodes = useMemo(
    () =>
      VARIABLE_ORDER.filter((code) =>
        variableSummaries.some((summary) => summary.variable_code === code && summary.sample_count > 0),
      ).slice(0, 8),
    [variableSummaries],
  );
  const stationMatrixRows = useMemo(
    () =>
      [...(snapshot?.stations ?? [])]
        .slice(0, 7)
        .map((station) => ({
          station,
          values: stationMatrixCodes.map((code) => (station.variables ?? []).find((item) => item.variable_code === code) ?? null),
        })),
    [snapshot, stationMatrixCodes],
  );

  return (
    <div className="min-h-screen bg-[#F7FAFC]">
      <style>{`
        .public-station-popup .leaflet-popup-content-wrapper {
          border: 1px solid #dce5f1;
          border-radius: 8px;
          box-shadow: 0 14px 30px rgba(15, 23, 42, 0.18);
        }
        .public-station-popup .leaflet-popup-content {
          margin: 14px;
        }
        .public-station-popup .leaflet-popup-tip {
          border: 1px solid #dce5f1;
        }
        .public-station-value-label {
          border: 1px solid #dce5f1;
          border-radius: 6px;
          background: rgba(255, 255, 255, 0.94);
          color: #0f172a;
          box-shadow: 0 4px 12px rgba(15, 23, 42, 0.14);
          font-size: 11px;
          font-weight: 700;
          padding: 2px 6px;
        }
        .public-station-value-label::before {
          display: none;
        }
      `}</style>
      <header className="border-b bg-white px-5 py-4 lg:px-8">
        <div className="flex w-full flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Mapa público REMMAQ</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Calidad de aire y patrones meteorológicos en Quito
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={() => void loadSnapshot(true)} disabled={loading} className="gap-2">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Actualizar
            </Button>
            <Button onClick={onGoToLogin} className="gap-2 bg-[#509EE3] text-white hover:bg-[#509EE3]/90">
              <LogIn className="h-4 w-4" />
              Ingresar
            </Button>
          </div>
        </div>
      </header>

      <main className="w-full space-y-5 px-5 py-5 lg:px-8">
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <Card className="border-[#dce5f1] bg-white">
            <CardContent className="pt-5">
              <div className="flex items-start justify-between gap-3">
                <Activity className="h-4 w-4 text-[#509EE3]" />
                <Badge variant="outline">{RANGE_LABELS[rangePreset]}</Badge>
              </div>
              <p className="mt-4 text-3xl font-semibold text-foreground">
                {formatVariableValue(displayMean, snapshot?.variable_code, snapshot?.unit)}{' '}
                <span className="text-sm font-normal">{getUnitLabel(snapshot?.unit)}</span>
              </p>
              <p className="text-xs text-muted-foreground">Promedio actual de {getVariableLabel(snapshot?.variable_code ?? selectedVariable)}</p>
              {cityBand ? <p className="mt-2 text-xs font-medium" style={{ color: cityBand.color }}>{cityBand.label}</p> : null}
            </CardContent>
          </Card>

          <Card className="border-[#dce5f1] bg-white">
            <CardContent className="pt-5">
              <div className="flex items-start justify-between gap-3">
                <AlertTriangle className="h-4 w-4 text-red-500" />
                <Badge className={topRelativeStations.length > 0 ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600'}>
                  {topRelativeStations.length}
                </Badge>
              </div>
              <p className="mt-4 text-sm font-semibold text-foreground">Alertas relativas</p>
              {topRelativeStations.length > 0 ? (
                <div className="mt-2 space-y-1 text-xs text-red-600">
                  {topRelativeStations.map((station) => (
                    <p key={station.station_code}>
                      {station.station_name} ({formatVariableValue(station.mean_value, snapshot?.variable_code, snapshot?.unit)} {getUnitLabel(snapshot?.unit)})
                    </p>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">Sin estaciones para evaluar.</p>
              )}
            </CardContent>
          </Card>

          <Card className="border-[#dce5f1] bg-white">
            <CardContent className="pt-5">
              <div className="flex items-start justify-between gap-3">
                <MapPin className="h-4 w-4 text-[#509EE3]" />
                <Badge className="bg-blue-50 text-blue-700">{snapshot?.station_count ?? 0}</Badge>
              </div>
              <p className="mt-4 text-3xl font-semibold text-foreground">{snapshot?.today_observation_count ?? 0}</p>
              <p className="text-xs text-muted-foreground">Datos observados del dia en curso</p>
              <p className="mt-2 text-xs text-muted-foreground">{snapshot?.station_count ?? 0} estaciones con lectura</p>
            </CardContent>
          </Card>

          <Card className="border-[#dce5f1] bg-white">
            <CardContent className="pt-5">
              <div className="flex items-start justify-between gap-3">
                <Gauge className="h-4 w-4 text-[#509EE3]" />
                <Badge className={coveragePercent === 100 ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}>
                  {coveragePercent}%
                </Badge>
              </div>
              <p className="mt-4 text-sm font-semibold text-foreground">Cobertura REMMAQ</p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-[#509EE3]" style={{ width: `${coveragePercent}%` }} />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{activeVariableSummaries.length}/{variableSummaries.length} variables alimentadas</p>
            </CardContent>
          </Card>

          <Card className="border-[#dce5f1] bg-white">
            <CardContent className="pt-5">
              <div className="flex items-start justify-between gap-3">
                <CalendarClock className="h-4 w-4 text-[#509EE3]" />
                <Badge className="bg-blue-50 text-blue-700">Cada hora</Badge>
              </div>
              <p className="mt-4 text-sm font-semibold text-foreground">Actualizacion REMMAQ</p>
              <p className="mt-2 text-xs text-muted-foreground">Ultima presencia: {formatDateTime(snapshot?.latest_observed_at)}</p>
              <p className="text-xs text-muted-foreground">Antiguedad del dato: {freshnessLabel}</p>
              <p className="text-xs text-muted-foreground">Ultima ingesta: {formatDateTime(latestIngestedAt)}</p>
              <p className="text-xs text-muted-foreground">Consulta local: {formatDateTime(lastFetchedAt)}</p>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <Card className="border-[#dce5f1] bg-white">
            <CardContent className="pt-5">
              <p className="text-sm font-semibold text-foreground">MAX del periodo</p>
              <p className="mt-3 text-2xl font-semibold text-foreground">
                {formatVariableValue(periodSummary?.max_value, snapshot?.variable_code, periodUnit)}{' '}
                <span className="text-sm font-normal">{getUnitLabel(periodUnit)}</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{RANGE_LABELS[rangePreset]} segun lecturas oficiales disponibles</p>
            </CardContent>
          </Card>
          <Card className="border-[#dce5f1] bg-white">
            <CardContent className="pt-5">
              <p className="text-sm font-semibold text-foreground">AVG del periodo</p>
              <p className="mt-3 text-2xl font-semibold text-foreground">
                {formatVariableValue(periodSummary?.avg_value, snapshot?.variable_code, periodUnit)}{' '}
                <span className="text-sm font-normal">{getUnitLabel(periodUnit)}</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{periodSummary?.station_count ?? 0} estaciones con datos</p>
            </CardContent>
          </Card>
          <Card className="border-[#dce5f1] bg-white">
            <CardContent className="pt-5">
              <p className="text-sm font-semibold text-foreground">RDS del periodo</p>
              <p className="mt-3 text-2xl font-semibold text-foreground">{periodSummary?.rds ?? 0}</p>
              <p className="mt-1 text-xs text-muted-foreground">Lecturas validas usadas para el resumen</p>
            </CardContent>
          </Card>
        </section>

        {missingVariableSummaries.length > 0 ? (
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="flex flex-col gap-3 py-4 text-sm text-amber-900 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="font-semibold">Diagnostico de cobertura de datos</p>
                <p className="mt-1">{coverageMessage}</p>
              </div>
              <p className="max-w-3xl text-xs">
                Este aviso no indica un fallo del mapa: indica que el catalogo publico contempla mas variables que las mediciones disponibles en la base local actual.
              </p>
            </CardContent>
          </Card>
        ) : null}

        <section className="grid items-start gap-4 2xl:grid-cols-[320px_minmax(0,1fr)_340px]">
          <div className="space-y-4">
            <Card className="border-[#dce5f1] bg-white">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Configuración</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Variable</Label>
                  <Select value={selectedVariable} onValueChange={setSelectedVariable}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {variableOptions.map((variable) => (
                        <SelectItem key={variable.code} value={variable.code}>
                          {getVariableLabel(variable.code)}
                        </SelectItem>
                      ))}
                      {variableOptions.length === 0 ? (
                        <SelectItem value={DEFAULT_VARIABLE}>{getVariableLabel(DEFAULT_VARIABLE)}</SelectItem>
                      ) : null}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Rango</Label>
                  <Select value={rangePreset} onValueChange={(value) => setRangePreset(value as RangePreset)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="latest">Ultima hora</SelectItem>
                      <SelectItem value="today">Hoy</SelectItem>
                      <SelectItem value="72h">Ultimas 72 horas</SelectItem>
                      <SelectItem value="week">Ultima semana</SelectItem>
                      <SelectItem value="month">Mes en curso</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Estacion</Label>
                  <Select value={selectedStation} onValueChange={setSelectedStation}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_STATIONS}>Todas las estaciones</SelectItem>
                      {stationOptions.map((station) => (
                        <SelectItem key={station.code} value={station.code}>
                          {station.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {rangePreset === 'today' ? (
                  <div className="space-y-2">
                    <Label>Hora del dia</Label>
                    <Select value={selectedHour} onValueChange={setSelectedHour}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL_STATIONS}>Todas las horas disponibles</SelectItem>
                        {HOUR_OPTIONS.map((hour) => (
                          <SelectItem key={hour} value={String(hour)}>
                            {`${String(hour).padStart(2, '0')}:00`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}

                <div className="flex items-center justify-between rounded-md border px-3 py-2">
                  <div>
                    <Label htmlFor="surface-layer" className="text-sm">Mapa de calor IDW</Label>
                    <p className="text-xs text-muted-foreground">Estimacion entre estaciones cercanas</p>
                  </div>
                  <Switch id="surface-layer" checked={showSurface} onCheckedChange={setShowSurface} />
                </div>
                <div className="flex items-center justify-between rounded-md border px-3 py-2">
                  <Label htmlFor="station-layer" className="text-sm">Estaciones</Label>
                  <Switch id="station-layer" checked={showStations} onCheckedChange={setShowStations} />
                </div>
              </CardContent>
            </Card>

            <Card className="border-[#dce5f1] bg-white">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <CalendarClock className="h-4 w-4 text-[#509EE3]" />
                  Actualización
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>Datos observados: {formatDateTime(snapshot?.latest_observed_at)}</p>
                <p>Consulta local: {formatDateTime(lastFetchedAt)}</p>
                <p>La informacion se actualiza automaticamente cada hora.</p>
              </CardContent>
            </Card>

            <Card className="border-[#dce5f1] bg-white">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Info className="h-4 w-4 text-[#509EE3]" />
                  Lectura del periodo
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>Los colores se recalculan con los valores del rango seleccionado.</p>
                <p>Si la ultima presencia es la misma fecha, los rangos pueden cambiar porque promedian ventanas distintas del mes actual.</p>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <Card className="border-[#dce5f1] bg-white">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Activity className="h-4 w-4 text-[#509EE3]" />
                    Promedio urbano
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-semibold text-foreground">
                    {formatVariableValue(displayMean, snapshot?.variable_code, snapshot?.unit)}{' '}
                    <span className="text-base font-normal">{getUnitLabel(snapshot?.unit)}</span>
                  </div>
                  {cityBand ? (
                    <Badge
                      className="mt-3 border"
                      style={{ color: cityBand.color, backgroundColor: cityBand.background, borderColor: cityBand.color }}
                    >
                      {cityBand.label}
                    </Badge>
                  ) : null}
                </CardContent>
              </Card>

              <Card className="border-[#dce5f1] bg-white">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <MapPin className="h-4 w-4 text-[#509EE3]" />
                    Estaciones
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-semibold text-foreground">{snapshot?.station_count ?? 0}</div>
                  <p className="mt-3 text-sm text-muted-foreground">{snapshot?.observation_count ?? 0} observaciones agregadas</p>
                </CardContent>
              </Card>

              <Card className="border-[#dce5f1] bg-white">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Info className="h-4 w-4 text-[#509EE3]" />
                    Variable
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-lg font-semibold text-foreground">
                    {getVariableLabel(snapshot?.variable_code ?? selectedVariable)} {getUnitLabel(snapshot?.unit)}
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">
                    {VARIABLE_HELP[snapshot?.variable_code ?? selectedVariable] ?? 'Variable REMMAQ seleccionada.'}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {VARIABLE_RECOMMENDATIONS[snapshot?.variable_code ?? selectedVariable] ?? cityBand?.description}
                  </p>
                </CardContent>
              </Card>
            </div>

            {error ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            ) : null}

            <Card className="overflow-hidden border-[#dce5f1] bg-white">
              <div className="relative h-[clamp(760px,calc(100vh-120px),1120px)]">
                <div ref={mapContainerRef} className="h-full w-full" />
                <div className="absolute bottom-4 left-4 z-[500] w-[min(390px,calc(100%-2rem))] rounded-md border border-[#dce5f1] bg-white/95 p-3 shadow-md">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">Mapa de calor IDW</p>
                      <p className="text-xs text-muted-foreground">{getVariableLabel(snapshot?.variable_code ?? selectedVariable)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-medium text-foreground">{idwLegend.scaleLabel}</p>
                      <p className="text-xs text-muted-foreground">{getUnitLabel(snapshot?.unit)}</p>
                    </div>
                  </div>
                  <div className="h-3 rounded-sm bg-[linear-gradient(90deg,#2e7d32,#fde047,#b91c1c)]" />
                  <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                    <span>{idwLegend.lowLabel}</span>
                    <span>{idwLegend.midLabel}</span>
                    <span>{idwLegend.highLabel}</span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {idwLegend.description}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    La superficie IDW estima zonas no medidas; los puntos son estaciones observadas.
                  </p>
                </div>
              </div>
            </Card>
          </div>

          <aside className="space-y-4">
            <Card className="border-[#dce5f1] bg-white">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Variables REMMAQ</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">{summarizeAvailability(variableSummaries)}</p>
                <div className="grid max-h-[520px] gap-2 overflow-y-auto pr-1">
                  {variableSummaries.map((summary) => (
                    <button
                      key={summary.variable_code}
                      type="button"
                      onClick={() => setSelectedVariable(summary.variable_code)}
                      className={`rounded-md border px-3 py-2 text-left transition hover:border-[#509EE3] ${
                        selectedVariable === summary.variable_code ? 'border-[#509EE3] bg-[#EDF6FF]' : 'bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2 text-sm font-medium">
                          {getVariableLabel(summary.variable_code)}
                          <InfoHint label={getVariableLabel(summary.variable_code)} text={VARIABLE_HELP[summary.variable_code] ?? summary.variable_name} />
                        </span>
                        <Badge className={summary.sample_count > 0 ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-600'}>
                          {summary.sample_count > 0 ? 'datos' : 'pendiente'}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {summary.sample_count > 0
                          ? `${formatVariableValue(summary.mean_value, summary.variable_code, summary.unit)} ${getUnitLabel(summary.unit)} | ${summary.station_count} estaciones`
                          : `${summary.variable_name} | sin mediciones cargadas`}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Ultima presencia: {formatDateTime(summary.latest_available_at)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Hoy: {summary.today_sample_count} | Total historico: {summary.total_sample_count}
                      </p>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="border-[#dce5f1] bg-white">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Lectura seleccionada</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="rounded-md bg-[#F9FBFC] p-3">
                  <p className="text-xs text-muted-foreground">Variable</p>
                  <p className="flex items-center gap-2 text-lg font-semibold">
                    {getVariableLabel(snapshot?.variable_code ?? selectedVariable)}
                    <InfoHint
                      label={getVariableLabel(snapshot?.variable_code ?? selectedVariable)}
                      text={VARIABLE_HELP[snapshot?.variable_code ?? selectedVariable] ?? 'Variable REMMAQ seleccionada'}
                    />
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground">Mínimo</p>
                    <p className="font-semibold">
                      {formatVariableValue(selectedVariableSummary?.min_value, snapshot?.variable_code, selectedVariableSummary?.unit)} {getUnitLabel(selectedVariableSummary?.unit)}
                    </p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground">Máximo</p>
                    <p className="font-semibold">
                      {formatVariableValue(selectedVariableSummary?.max_value, snapshot?.variable_code, selectedVariableSummary?.unit)} {getUnitLabel(selectedVariableSummary?.unit)}
                    </p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  La selección controla simultáneamente mapa, superficie IDW, serie, distribución y ranking.
                </p>
                <div className="rounded-md border bg-[#F9FBFC] p-3 text-xs text-muted-foreground">
                  <p>Ultima presencia global: {formatDateTime(selectedVariableSummary?.latest_available_at)}</p>
                  <p>Ultima ingesta global: {formatDateTime(selectedVariableSummary?.latest_ingested_at)}</p>
                  <p>Datos del dia en curso: {selectedVariableSummary?.today_sample_count ?? 0}</p>
                </div>
              </CardContent>
            </Card>
          </aside>
        </section>

        <section>
          <Card className="border-[#dce5f1] bg-white">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Snapshot de estaciones</CardTitle>
            </CardHeader>
            <CardContent>
              {stationSnapshot.length > 0 ? (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {stationSnapshot.map((station) => {
                    const band = getQualityBand(snapshot?.variable_code ?? selectedVariable, station.latest_value, values);
                    return (
                      <div key={station.station_code} className="rounded-md border bg-[#F9FBFC] p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-foreground">{station.station_name}</p>
                            <p className="text-xs uppercase text-muted-foreground">{station.station_code}</p>
                          </div>
                          <Badge className="border border-blue-200 bg-blue-50 text-blue-700">
                            {station.region ?? 'Quito'}
                          </Badge>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">Ultima lectura: {formatDateTime(station.latest_observed_at)}</p>
                        <div className="mt-3 flex items-end justify-between gap-3">
                          <div>
                            <p className="text-xs font-medium text-muted-foreground">{getVariableLabel(snapshot?.variable_code ?? selectedVariable)}</p>
                            <p className="text-xl font-semibold text-foreground">
                              {formatVariableValue(station.latest_value, snapshot?.variable_code, station.unit)}{' '}
                              <span className="text-xs font-normal">{getUnitLabel(station.unit)}</span>
                            </p>
                          </div>
                          <p className="text-xs font-medium" style={{ color: band.color }}>{band.label}</p>
                        </div>
                        {(station.variables ?? []).length > 0 ? (
                          <div className="mt-3 grid grid-cols-2 gap-2 border-t pt-3 text-xs text-muted-foreground">
                            {(station.variables ?? []).slice(0, 6).map((item) => (
                              <div key={item.variable_code} className="flex items-center justify-between gap-2">
                                <span>{getVariableLabel(item.variable_code)}</span>
                                <strong className="text-foreground">
                                  {formatVariableValue(item.value, item.variable_code, item.unit)} {getUnitLabel(item.unit)}
                                </strong>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-md border border-dashed bg-[#F9FBFC] p-6 text-sm text-muted-foreground">
                  No hay estaciones con lecturas para la variable y el rango seleccionados.
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr_0.8fr]">
          <Card className="border-[#dce5f1] bg-white">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Serie temporal</CardTitle>
            </CardHeader>
            <CardContent className="h-80">
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ left: 4, right: 12, top: 12, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5edf6" />
                    <XAxis dataKey="time" tick={{ fontSize: 11 }} minTickGap={28} />
                    <YAxis tick={{ fontSize: 11 }} width={44} />
                    <Tooltip />
                    <Area type="monotone" dataKey="max" stroke="none" fill="#dbeafe" fillOpacity={0.45} />
                    <Area type="monotone" dataKey="min" stroke="none" fill="#ffffff" fillOpacity={1} />
                    <Line type="monotone" dataKey="mean" stroke="#2563eb" strokeWidth={2} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  {error ? 'Conecta el backend actualizado para ver la serie.' : 'No hay serie disponible para el rango seleccionado.'}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-[#dce5f1] bg-white">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Distribución espacial</CardTitle>
            </CardHeader>
            <CardContent className="h-80">
              {histogramData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={histogramData} margin={{ left: 4, right: 12, top: 12, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5edf6" />
                    <XAxis dataKey="range" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={34} />
                    <Tooltip />
                    <Bar dataKey="stations" fill="#509EE3" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  No hay estaciones suficientes para calcular distribución.
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-[#dce5f1] bg-white">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Patrones meteorológicos</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {(snapshot?.meteorology ?? []).map((item) => (
                <MeteorologyItem key={item.variable_code} item={item} />
              ))}
              {!snapshot || snapshot.meteorology.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {error ? 'Conecta el backend actualizado para ver meteorologia.' : 'La base local no tiene variables meteorologicas cargadas para este rango.'}
                </p>
              ) : null}
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
          <Card className="border-[#dce5f1] bg-white">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Cobertura por variable</CardTitle>
            </CardHeader>
            <CardContent className="h-80">
              {variableCoverageData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={variableCoverageData} margin={{ left: 4, right: 14, top: 12, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5edf6" />
                    <XAxis dataKey="variable" tick={{ fontSize: 11 }} interval={0} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={44} />
                    <Tooltip />
                    <Bar dataKey="samples" name="Muestras" fill="#2563eb" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="stations" name="Estaciones" fill="#14b8a6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  No hay variables para evaluar cobertura.
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-[#dce5f1] bg-white">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Matriz estacion-variable</CardTitle>
            </CardHeader>
            <CardContent>
              {stationMatrixRows.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] border-separate border-spacing-0 text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground">
                        <th className="border-b py-2 pr-3 font-medium">Estacion</th>
                        {stationMatrixCodes.map((code) => (
                          <th key={code} className="border-b px-2 py-2 font-medium">
                            {getVariableLabel(code)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {stationMatrixRows.map(({ station, values: rowValues }) => (
                        <tr key={station.station_code}>
                          <td className="border-b py-2 pr-3 font-medium">{station.station_name}</td>
                          {rowValues.map((item, index) => (
                            <td key={item?.variable_code ?? index} className="border-b px-2 py-2">
                              {item ? (
                                <span className="inline-flex min-w-24 justify-center rounded-md bg-[#EDF6FF] px-2 py-1 text-xs font-medium text-[#1d4ed8]">
                                  {formatVariableValue(item.value, item.variable_code, item.unit)} {getUnitLabel(item.unit)}
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground">Sin dato</span>
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="rounded-md border border-dashed bg-[#F9FBFC] p-6 text-sm text-muted-foreground">
                  No hay lecturas multivariable por estacion para construir la matriz.
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1fr_1fr_1fr]">
          <Card className="border-[#dce5f1] bg-white">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Comparación por estación</CardTitle>
            </CardHeader>
            <CardContent className="h-80">
              {stationComparison.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stationComparison} layout="vertical" margin={{ left: 18, right: 16, top: 8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5edf6" />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis dataKey="station" type="category" tick={{ fontSize: 11 }} width={86} />
                    <Tooltip />
                    <Bar dataKey="mean" fill="#2563eb" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  No hay estaciones para comparar.
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-[#dce5f1] bg-white">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Estaciones con mayor promedio</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {[...(snapshot?.stations ?? [])]
                .sort((a, b) => b.mean_value - a.mean_value)
                .slice(0, 5)
                .map((station) => {
                  const band = getQualityBand(snapshot?.variable_code ?? selectedVariable, station.mean_value, values);
                  return (
                    <div key={station.station_code} className="flex items-center justify-between rounded-md border px-3 py-2">
                      <div>
                        <p className="text-sm font-medium text-foreground">{station.station_name}</p>
                        <p className="text-xs text-muted-foreground">{station.sample_count} muestras</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold">
                          {formatVariableValue(station.mean_value, snapshot?.variable_code, snapshot?.unit)} {getUnitLabel(snapshot?.unit)}
                        </p>
                        <p className="text-xs" style={{ color: band.color }}>{band.label}</p>
                      </div>
                    </div>
                  );
                })}
            </CardContent>
          </Card>

          <Card className="border-[#dce5f1] bg-white">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Base metodológica y lectura pública</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>
                REMMAQ se usa como fuente pública de contaminantes y meteorología; la vista prioriza información comprensible para ciudadanía y toma de decisiones.
              </p>
              <p>
                La capa espacial sigue el enfoque IDW: estima valores en ubicaciones no medidas usando estaciones cercanas con mayor peso por proximidad.
              </p>
              <p>
                Para PM2.5 se muestran bandas bajo, moderado y alto alineadas con clases usadas en estudios de modelado de Quito.
              </p>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
          <VariableGroupCard title="Contaminantes" summaries={pollutantSummaries} />
          <VariableGroupCard title="Meteorología" summaries={meteorologySummaries} />
        </section>
      </main>
    </div>
  );
}

function MeteorologyItem({ item }: { item: PublicMeteorologySummary }) {
  const Icon = METEOROLOGY_ICONS[item.variable_code] ?? Activity;
  return (
    <div className="rounded-md border bg-[#F9FBFC] p-3">
      <div className="mb-2 flex items-center gap-2">
        <Icon className="h-4 w-4 text-[#509EE3]" />
        <p className="text-sm font-medium">{getVariableLabel(item.variable_code)}</p>
      </div>
      <p className="text-xl font-semibold text-foreground">
        {formatVariableValue(item.mean_value, item.variable_code, item.unit)}{' '}
        <span className="text-sm font-normal">{getUnitLabel(item.unit)}</span>
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Ultimo: {formatVariableValue(item.latest_value, item.variable_code, item.unit)} {getUnitLabel(item.unit)}
      </p>
    </div>
  );
}

type InfoHintEvent = ReactMouseEvent<HTMLSpanElement> | ReactFocusEvent<HTMLSpanElement>;

function InfoHint({ label, text }: { label: string; text: string }) {
  const [tooltip, setTooltip] = useState<{ left: number; top: number; placement: 'top' | 'bottom' } | null>(null);

  const showTooltip = useCallback((event: InfoHintEvent) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const tooltipWidth = 320;
    const margin = 12;
    const left = Math.min(
      Math.max(rect.left + rect.width / 2, tooltipWidth / 2 + margin),
      window.innerWidth - tooltipWidth / 2 - margin,
    );
    const opensAbove = rect.bottom + 190 > window.innerHeight && rect.top > 190;
    setTooltip({
      left,
      top: opensAbove ? rect.top - 8 : rect.bottom + 8,
      placement: opensAbove ? 'top' : 'bottom',
    });
  }, []);

  return (
    <span
      className="inline-flex"
      onMouseEnter={showTooltip}
      onMouseLeave={() => setTooltip(null)}
      onFocus={showTooltip}
      onBlur={() => setTooltip(null)}
      tabIndex={0}
    >
      <Info className="h-3.5 w-3.5 text-muted-foreground" aria-label={`Informacion de ${label}`} />
      {tooltip
        ? createPortal(
            <span
              className={`pointer-events-none fixed z-[3000] w-80 -translate-x-1/2 rounded-md border border-[#dce5f1] bg-white p-3 text-xs font-normal leading-relaxed text-muted-foreground shadow-xl ${
                tooltip.placement === 'top' ? '-translate-y-full' : ''
              }`}
              style={{ left: tooltip.left, top: tooltip.top }}
              role="tooltip"
            >
              <span className="mb-1 block text-sm font-semibold text-foreground">{label}</span>
              {text}
            </span>,
            document.body,
          )
        : null}
      </span>
  );
}

function VariableGroupCard({ title, summaries }: { title: string; summaries: PublicVariableSummary[] }) {
  return (
    <Card className="border-[#dce5f1] bg-white">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {summaries.map((summary) => (
          <div key={summary.variable_code} className="rounded-md border bg-[#F9FBFC] p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold">
                  {getVariableLabel(summary.variable_code)}
                  <InfoHint label={getVariableLabel(summary.variable_code)} text={VARIABLE_HELP[summary.variable_code] ?? summary.variable_name} />
                </p>
                <p className="text-xs text-muted-foreground">{summary.variable_name}</p>
              </div>
              <Badge className={summary.sample_count > 0 ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-600'}>
                {summary.sample_count > 0 ? summary.station_count : 0}
              </Badge>
            </div>
            <p className="mt-3 text-xl font-semibold">
              {formatVariableValue(summary.mean_value, summary.variable_code, summary.unit)}{' '}
              <span className="text-sm font-normal">{getUnitLabel(summary.unit)}</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {summary.sample_count > 0 ? `${summary.sample_count} muestras` : 'Sin datos en el rango'}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Hoy: {summary.today_sample_count} | Historico: {summary.total_sample_count}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Ultima presencia: {formatDateTime(summary.latest_available_at)}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
