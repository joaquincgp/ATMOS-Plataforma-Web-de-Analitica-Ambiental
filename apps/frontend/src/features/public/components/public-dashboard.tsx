import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FocusEvent as ReactFocusEvent, MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  CloudRain,
  Gauge,
  Home,
  Info,
  LogIn,
  MapPin,
  Thermometer,
  Waves,
  Wind,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import L from 'leaflet';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
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
import { formatEcuadorDateTime, formatEcuadorShortDateTime } from '@/shared/lib/datetime';
import atmosLogo from '@/assets/brand/atmos-logo.png';
import quitoLogo from '@/assets/brand/quito-logo.png';

interface PublicDashboardProps {
  onGoToLogin?: () => void;
  onGoToLanding?: () => void;
  embedded?: boolean;
  showLandingAction?: boolean;
  showLoginAction?: boolean;
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

const METEO_CELLS: { code: string; icon: LucideIcon; label: string }[] = [
  { code: 'TMP', icon: Thermometer, label: 'Temp' },
  { code: 'HUM', icon: CloudRain, label: 'Hum' },
  { code: 'VEL', icon: Wind, label: 'Viento' },
  { code: 'LLU', icon: CloudRain, label: 'Lluvia' },
];

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
    [-0.002, -78.452],
    [-0.006, -78.435],
    [-0.035, -78.427],
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

const RANGE_OPTIONS: { value: RangePreset; label: string }[] = [
  { value: 'latest', label: '1h' },
  { value: 'today', label: 'Hoy' },
  { value: '72h', label: '72h' },
  { value: 'week', label: '7d' },
  { value: 'month', label: 'Mes' },
];

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
    return 'Sin actualizacion';
  }
  return formatEcuadorDateTime(value);
};

const formatShortTime = (value: string) => formatEcuadorShortDateTime(value);

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
  const thresholds = TULSMA_THRESHOLDS[variableCode];
  if (!thresholds) {
    return {
      min,
      max,
      lowLabel: min !== null ? `${roundValue(min)} ${formattedUnit}`.trim() : 'Menor',
      midLabel: 'Valor medio',
      highLabel: max !== null ? `${roundValue(max)} ${formattedUnit}`.trim() : 'Mayor',
      scaleLabel: 'Escala de lectura',
      description: 'Sin umbral TULSMA definido para esta variable.',
    };
  }
  const [t1, t2] = thresholds;
  return {
    min,
    max,
    lowLabel: `Bueno < ${t1} ${formattedUnit}`.trim(),
    midLabel: `Mod. ${t1}–${t2} ${formattedUnit}`.trim(),
    highLabel: `Alto ≥ ${t2} ${formattedUnit}`.trim(),
    scaleLabel: 'Norma TULSMA Anexo 4',
    description: 'Colores segun limites oficiales del Acuerdo Ministerial 097-A (TULSMA, Libro VI, Anexo 4).',
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

// ── Umbrales TULSMA Anexo 4 / Acuerdo Ministerial 097-A ──────────────────────
// [moderado, alto, muyAlto] — por debajo del primero = Bueno
const TULSMA_THRESHOLDS: Record<string, [number, number, number]> = {
  PM25: [15,  50,  75],  // µg/m³  anual:15 | 24h:50
  PM10: [50, 100, 200],  // µg/m³  anual:50 | 24h:100
  NO2:  [40, 200, 400],  // µg/m³  anual:40 | 1h:200
  O3:   [60, 100, 200],  // µg/m³  8h:100
  CO:   [ 5,  10,  30],  // mg/m³  8h≈10 | 1h≈30
  SO2:  [40, 125, 350],  // µg/m³  24h:125
  TMP:  [10,  28,  35],  // °C    confort térmico Quito
  HUM:  [30,  70,  90],  // %     humedad relativa
  VEL:  [ 2,   8,  15],  // m/s   Beaufort simplificado
  IUV:  [ 3,   6,   8],  // índice UV (OMS)
  RS:   [200, 600, 900], // W/m²  radiación solar
  LLU:  [ 1,  10,  30],  // mm    precipitación
};

const TULSMA_BAND_LABELS = ['Bueno', 'Moderado', 'Alto', 'Muy alto'] as const;
const TULSMA_BAND_COLORS = [
  { color: '#15803d', background: '#dcfce7' }, // Bueno — verde
  { color: '#a16207', background: '#fef9c3' }, // Moderado — ámbar
  { color: '#c2410c', background: '#ffedd5' }, // Alto — naranja
  { color: '#b91c1c', background: '#fee2e2' }, // Muy alto — rojo
] as const;

const getQualityBand = (variableCode: string, value: number): QualityBand => {
  const thresholds = TULSMA_THRESHOLDS[variableCode];
  if (!thresholds || !Number.isFinite(value)) {
    return { label: 'Sin datos', color: '#64748b', background: '#f1f5f9', description: 'Sin umbral definido para esta variable' };
  }
  const [t1, t2, t3] = thresholds;
  let idx = 0;
  if (value >= t3) idx = 3;
  else if (value >= t2) idx = 2;
  else if (value >= t1) idx = 1;
  const { color, background } = TULSMA_BAND_COLORS[idx];
  const label = TULSMA_BAND_LABELS[idx];
  const unitStr = variableCode === 'CO' ? 'mg/m³' : variableCode === 'TMP' ? '°C' : (variableCode === 'HUM' || variableCode === 'IUV') ? '' : 'µg/m³';
  const descriptions: Record<number, string> = {
    0: `${variableCode} dentro del limite TULSMA (< ${t1} ${unitStr})`,
    1: `${variableCode} sobre referencia anual TULSMA (${t1}–${t2} ${unitStr})`,
    2: `${variableCode} sobre limite 24h/8h TULSMA (${t2}–${t3} ${unitStr})`,
    3: `${variableCode} supera ampliamente el limite TULSMA (> ${t3} ${unitStr})`,
  };
  return { label, color, background, description: descriptions[idx] };
};

const hexToRgb = (hex: string): [number, number, number] => {
  const clean = hex.replace('#', '');
  return [
    Number.parseInt(clean.slice(0, 2), 16),
    Number.parseInt(clean.slice(2, 4), 16),
    Number.parseInt(clean.slice(4, 6), 16),
  ];
};

const mixRgb = (from: [number, number, number], to: [number, number, number], ratio: number): [number, number, number] => {
  const t = Math.max(0, Math.min(1, ratio));
  return [
    Math.round(from[0] + (to[0] - from[0]) * t),
    Math.round(from[1] + (to[1] - from[1]) * t),
    Math.round(from[2] + (to[2] - from[2]) * t),
  ];
};

const interpolateSurfaceColor = (variableCode: string, value: number, values: number[]): [number, number, number] => {
  const green = hexToRgb('#16a34a');
  const yellow = hexToRgb('#facc15');
  const orange = hexToRgb('#f97316');
  const red = hexToRgb('#dc2626');
  const thresholds = TULSMA_THRESHOLDS[variableCode];
  if (thresholds) {
    const [t1, t2, t3] = thresholds;
    if (value < t1) return mixRgb(green, yellow, value / Math.max(t1, 1));
    if (value < t2) return mixRgb(yellow, orange, (value - t1) / Math.max(t2 - t1, 1));
    if (value < t3) return mixRgb(orange, red, (value - t2) / Math.max(t3 - t2, 1));
    return red;
  }

  const finiteValues = values.filter(Number.isFinite);
  const min = Math.min(...finiteValues);
  const max = Math.max(...finiteValues);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return green;
  const ratio = (value - min) / (max - min);
  return ratio < 0.5 ? mixRgb(green, yellow, ratio * 2) : mixRgb(yellow, red, (ratio - 0.5) * 2);
};

const distanceMeters = (latA: number, lngA: number, latB: number, lngB: number) => {
  const latMeters = (latA - latB) * 111_320;
  const lngMeters = (lngA - lngB) * 111_320 * Math.cos((((latA + latB) / 2) * Math.PI) / 180);
  return Math.hypot(latMeters, lngMeters);
};

const computeIdw = (lat: number, lng: number, stations: PublicStationObservation[]) => {
  let weightedSum = 0;
  let weightTotal = 0;
  for (const station of stations) {
    const distance = distanceMeters(lat, lng, station.latitude, station.longitude);
    if (distance < 30) return station.mean_value;
    const weight = 1 / distance ** 2.2;
    weightedSum += station.mean_value * weight;
    weightTotal += weight;
  }
  return weightTotal > 0 ? weightedSum / weightTotal : 0;
};

const SURFACE_FULL_OPACITY_RADIUS_M = 4_800;
const SURFACE_MAX_RADIUS_M = 11_500;
const SURFACE_CANVAS_WIDTH = 520;

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

const getSurfaceBounds = (stations: PublicStationObservation[]) => {
  const polygonBounds = getPolygonBounds(QUITO_PUBLIC_MAP_POLYGONS);
  const midLat = stations.reduce((sum, station) => sum + station.latitude, 0) / stations.length;
  const latMargin = SURFACE_MAX_RADIUS_M / 111_320;
  const lngMargin = SURFACE_MAX_RADIUS_M / (111_320 * Math.cos((midLat * Math.PI) / 180));
  return {
    minLat: Math.max(polygonBounds.minLat, Math.min(...stations.map((station) => station.latitude)) - latMargin),
    maxLat: Math.min(polygonBounds.maxLat, Math.max(...stations.map((station) => station.latitude)) + latMargin),
    minLng: Math.max(polygonBounds.minLng, Math.min(...stations.map((station) => station.longitude)) - lngMargin),
    maxLng: Math.min(polygonBounds.maxLng, Math.max(...stations.map((station) => station.longitude)) + lngMargin),
  };
};

const smoothStep = (edge0: number, edge1: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

const distanceToNearestStationMeters = (lat: number, lng: number, stations: PublicStationObservation[]) =>
  Math.min(...stations.map((station) => distanceMeters(lat, lng, station.latitude, station.longitude)));

const buildSurfaceOverlay = (
  stations: PublicStationObservation[],
  selectedVariable: string,
  values: number[],
): { dataUrl: string; bounds: L.LatLngBoundsExpression } | null => {
  const { minLat, maxLat, minLng, maxLng } = getSurfaceBounds(stations);
  if (minLat >= maxLat || minLng >= maxLng) return null;

  const surfaceWidthMeters = distanceMeters((minLat + maxLat) / 2, minLng, (minLat + maxLat) / 2, maxLng);
  const surfaceHeightMeters = distanceMeters(minLat, (minLng + maxLng) / 2, maxLat, (minLng + maxLng) / 2);
  const width = SURFACE_CANVAS_WIDTH;
  const height = Math.max(180, Math.min(620, Math.round(width * (surfaceHeightMeters / Math.max(surfaceWidthMeters, 1)))));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;

  const image = context.createImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    const lat = maxLat - ((y + 0.5) / height) * (maxLat - minLat);
    for (let x = 0; x < width; x += 1) {
      const lng = minLng + ((x + 0.5) / width) * (maxLng - minLng);
      if (!pointInAnyPolygon(lat, lng, QUITO_PUBLIC_MAP_POLYGONS)) continue;

      const nearestDistance = distanceToNearestStationMeters(lat, lng, stations);
      if (nearestDistance > SURFACE_MAX_RADIUS_M) continue;

      const value = computeIdw(lat, lng, stations);
      const [red, green, blue] = interpolateSurfaceColor(selectedVariable, value, values);
      const fade = 1 - smoothStep(SURFACE_FULL_OPACITY_RADIUS_M, SURFACE_MAX_RADIUS_M, nearestDistance);
      const index = (y * width + x) * 4;
      image.data[index] = red;
      image.data[index + 1] = green;
      image.data[index + 2] = blue;
      image.data[index + 3] = Math.round(150 * fade);
    }
  }

  context.putImageData(image, 0, 0);
  return {
    dataUrl: canvas.toDataURL('image/png'),
    bounds: [
      [minLat, minLng],
      [maxLat, maxLng],
    ],
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
    const overlay = buildSurfaceOverlay(stations, selectedVariable, values);
    if (overlay) {
      L.imageOverlay(overlay.dataUrl, overlay.bounds, {
        className: 'public-idw-surface',
        interactive: false,
        opacity: 1,
      }).addTo(surfaceLayer);
    }
  }

  if (showStations) {
    for (const station of stations) {
      const band = getQualityBand(selectedVariable, station.mean_value);
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

// ─── Descripciones de cada banda por variable para el tooltip ────────────────
const TULSMA_BAND_DESCRIPTIONS: Record<string, [string, string, string, string]> = {
  PM25: [
    'Bueno: PM2.5 < 15 µg/m³. Dentro del límite anual TULSMA. Sin riesgo para la salud general.',
    'Moderado: PM2.5 15–50 µg/m³. Entre el límite anual y el límite de 24h TULSMA. Grupos sensibles podrían sentir leve molestia.',
    'Alto: PM2.5 50–75 µg/m³. Supera el límite de 24h TULSMA (50 µg/m³). Se recomienda reducir actividad física al aire libre.',
    'Muy alto: PM2.5 > 75 µg/m³. Supera ampliamente el límite TULSMA. Riesgo significativo para toda la población.',
  ],
  PM10: [
    'Bueno: PM10 < 50 µg/m³. Dentro del límite anual TULSMA. Calidad de aire aceptable.',
    'Moderado: PM10 50–100 µg/m³. Supera el límite anual (50 µg/m³) pero no el de 24h (100 µg/m³). Posibles molestias en personas sensibles.',
    'Alto: PM10 100–200 µg/m³. Supera el límite de 24h TULSMA. Evitar exposición prolongada.',
    'Muy alto: PM10 > 200 µg/m³. Nivel crítico. Riesgo serio para toda la población.',
  ],
  NO2: [
    'Bueno: NO₂ < 40 µg/m³. Dentro del límite anual TULSMA. Sin efecto sobre salud respiratoria.',
    'Moderado: NO₂ 40–200 µg/m³. Supera el límite anual. Puede afectar pulmones en exposición prolongada.',
    'Alto: NO₂ 200–400 µg/m³. Supera el límite de 1 hora TULSMA. Irritación de vías respiratorias.',
    'Muy alto: NO₂ > 400 µg/m³. Nivel de emergencia. Peligroso en exposición corta.',
  ],
  O3: [
    'Bueno: O₃ < 60 µg/m³. Sin efectos observados en la salud. Nivel de referencia.',
    'Moderado: O₃ 60–100 µg/m³. Cerca o sobre el límite de 8h TULSMA. Afecta sensibilidad respiratoria.',
    'Alto: O₃ 100–200 µg/m³. Supera el límite de 8h TULSMA (100 µg/m³). Reducir actividad al aire libre.',
    'Muy alto: O₃ > 200 µg/m³. Nivel peligroso. Afecta a toda la población.',
  ],
  CO: [
    'Bueno: CO < 5 mg/m³. Concentración baja. Sin riesgo para salud.',
    'Moderado: CO 5–10 mg/m³. Cerca del límite de 8h TULSMA. Personas con enfermedades cardíacas deben tener precaución.',
    'Alto: CO 10–30 mg/m³. Supera el límite de 8h TULSMA. Peligroso en espacios cerrados.',
    'Muy alto: CO > 30 mg/m³. Riesgo severo de intoxicación. Evacuación recomendada.',
  ],
  SO2: [
    'Bueno: SO₂ < 40 µg/m³. Dentro del límite anual TULSMA. Sin impacto relevante.',
    'Moderado: SO₂ 40–125 µg/m³. Posible irritación en personas asmáticas.',
    'Alto: SO₂ 125–350 µg/m³. Supera el límite de 24h TULSMA. Irritación de mucosas.',
    'Muy alto: SO₂ > 350 µg/m³. Nivel de emergencia. Afecta vías respiratorias gravemente.',
  ],
  TMP: [
    'Confort: temperatura < 10 °C. Fresco. Se recomienda abrigo.',
    'Confort: temperatura 10–28 °C. Rango cómodo para Quito.',
    'Cálido: temperatura 28–35 °C. Por encima del confort térmico habitual de Quito.',
    'Muy cálido: temperatura > 35 °C. Temperatura inusualmente alta para la zona.',
  ],
  HUM: [
    'Bajo: humedad relativa < 30%. Ambiente seco. Posible irritación de mucosas.',
    'Confort: humedad 30–70%. Rango óptimo de bienestar.',
    'Húmedo: humedad 70–90%. Sensación de bochorno.',
    'Muy húmedo: humedad > 90%. Malestar térmico y favorece hongos.',
  ],
  VEL: [
    'Calma: viento < 2 m/s. Baja dispersión de contaminantes.',
    'Brisa: viento 2–8 m/s. Dispersión moderada. Condiciones normales.',
    'Viento fuerte: 8–15 m/s. Alta dispersión. Posibles molestias.',
    'Temporal: viento > 15 m/s. Viento muy intenso.',
  ],
  IUV: [
    'Bajo: UV < 3. Sin necesidad de protección especial.',
    'Moderado: UV 3–6. Se recomienda protector solar.',
    'Alto: UV 6–8. Protección solar obligatoria. Reducir exposición al mediodía.',
    'Muy alto: UV > 8. Riesgo elevado. Evitar exposición directa.',
  ],
  RS: [
    'Baja: radiación < 200 W/m². Condiciones nubladas o de alba/crepúsculo.',
    'Moderada: 200–600 W/m². Día parcialmente soleado.',
    'Alta: 600–900 W/m². Irradiación intensa. Protección UV necesaria.',
    'Muy alta: > 900 W/m². Irradiación máxima. Riesgo UV extremo.',
  ],
  LLU: [
    'Sin lluvia o llovizna: < 1 mm. Precipitación despreciable.',
    'Lluvia leve: 1–10 mm. Precipitación normal.',
    'Lluvia moderada: 10–30 mm. Posibles charcos y reducción de visibilidad.',
    'Lluvia intensa: > 30 mm. Riesgo de inundaciones locales.',
  ],
};

const ALL_TULSMA_ROWS = [
  { code: 'PM25', label: 'PM2.5', unit: 'µg/m³', thresholds: TULSMA_THRESHOLDS.PM25 },
  { code: 'PM10', label: 'PM10', unit: 'µg/m³', thresholds: TULSMA_THRESHOLDS.PM10 },
  { code: 'NO2', label: 'NO₂', unit: 'µg/m³', thresholds: TULSMA_THRESHOLDS.NO2 },
  { code: 'O3', label: 'O₃', unit: 'µg/m³', thresholds: TULSMA_THRESHOLDS.O3 },
  { code: 'CO', label: 'CO', unit: 'mg/m³', thresholds: TULSMA_THRESHOLDS.CO },
  { code: 'SO2', label: 'SO₂', unit: 'µg/m³', thresholds: TULSMA_THRESHOLDS.SO2 },
  { code: 'TMP', label: 'Temp.', unit: '°C', thresholds: TULSMA_THRESHOLDS.TMP },
  { code: 'HUM', label: 'Hum.', unit: '%', thresholds: TULSMA_THRESHOLDS.HUM },
  { code: 'VEL', label: 'Viento', unit: 'm/s', thresholds: TULSMA_THRESHOLDS.VEL },
  { code: 'IUV', label: 'UV', unit: 'idx', thresholds: TULSMA_THRESHOLDS.IUV },
  { code: 'RS', label: 'RS', unit: 'W/m²', thresholds: TULSMA_THRESHOLDS.RS },
  { code: 'LLU', label: 'Lluvia', unit: 'mm', thresholds: TULSMA_THRESHOLDS.LLU },
];

function TulsmaLegendPanel({
  variableCode,
  unit,
  idwLegend,
}: {
  variableCode: string;
  unit: string | null | undefined;
  idwLegend: IdwLegendData;
}) {
  const [tableOpen, setTableOpen] = useState(false);
  const [hoveredBand, setHoveredBand] = useState<number | null>(null);
  const thresholds = TULSMA_THRESHOLDS[variableCode];
  const descriptions = TULSMA_BAND_DESCRIPTIONS[variableCode];
  const formattedUnit = getUnitLabel(unit);

  // Segmentos de la barra: 4 bloques con sus colores y labels
  const segments = [
    { color: TULSMA_BAND_COLORS[0].color, bg: TULSMA_BAND_COLORS[0].background, label: idwLegend.lowLabel },
    { color: TULSMA_BAND_COLORS[1].color, bg: TULSMA_BAND_COLORS[1].background, label: idwLegend.midLabel },
    { color: TULSMA_BAND_COLORS[2].color, bg: TULSMA_BAND_COLORS[2].background, label: thresholds ? `Alto ≥ ${thresholds[1]} ${formattedUnit}`.trim() : 'Alto' },
    { color: TULSMA_BAND_COLORS[3].color, bg: TULSMA_BAND_COLORS[3].background, label: thresholds ? `Muy alto ≥ ${thresholds[2]} ${formattedUnit}`.trim() : 'Muy alto' },
  ];

  return (
    <div className="public-legend-panel public-glass-panel pointer-events-auto absolute bottom-6 left-1/2 z-[520] w-[min(800px,calc(100%-2rem))] -translate-x-1/2 overflow-visible rounded-2xl px-5 pb-3 pt-3">
      {/* Tabla expandida — se despliega hacia arriba */}
      {tableOpen && (
        <div className="mb-3 overflow-hidden rounded-xl border border-slate-200/80 bg-white/97 shadow-xl">
          <div className="px-3 py-2 text-[10px] font-extrabold uppercase tracking-[0.08em] text-slate-400">
            Umbrales TULSMA — Acuerdo Ministerial 097-A, Libro VI Anexo 4
          </div>
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="px-3 py-1.5 text-left font-semibold text-slate-500">Variable</th>
                {(['Bueno', 'Moderado', 'Alto', 'Muy alto'] as const).map((label, i) => (
                  <th key={label} className="px-3 py-1.5 text-left font-semibold" style={{ color: TULSMA_BAND_COLORS[i].color }}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ALL_TULSMA_ROWS.map((row) => {
                const [t1, t2, t3] = row.thresholds;
                const rowDescs = TULSMA_BAND_DESCRIPTIONS[row.code];
                const isActive = row.code === variableCode;
                return (
                  <tr key={row.code} className={`border-b border-slate-50 transition-colors ${isActive ? 'bg-[#EDF6FF]' : 'hover:bg-slate-50'}`}>
                    <td className={`px-3 py-1.5 font-bold ${isActive ? 'text-[#1f5f96]' : 'text-slate-700'}`}>
                      {row.label} <span className="font-normal text-slate-400">({row.unit})</span>
                    </td>
                    {([
                      { range: `< ${t1}`, desc: rowDescs?.[0] ?? '' },
                      { range: `${t1}–${t2}`, desc: rowDescs?.[1] ?? '' },
                      { range: `${t2}–${t3}`, desc: rowDescs?.[2] ?? '' },
                      { range: `> ${t3}`, desc: rowDescs?.[3] ?? '' },
                    ] as const).map((cell, ci) => (
                      <td
                        key={ci}
                        className="group relative cursor-default px-3 py-1.5"
                        style={{ color: TULSMA_BAND_COLORS[ci].color }}
                        title={cell.desc}
                      >
                        <span className="font-semibold">{cell.range}</span>
                        {/* Tooltip hover */}
                        {cell.desc && (
                          <span className="pointer-events-none absolute bottom-full left-1/2 z-[600] mb-1.5 hidden w-52 -translate-x-1/2 rounded-lg border border-slate-200 bg-white/97 px-3 py-2 text-[10px] leading-relaxed text-slate-600 shadow-xl group-hover:block">
                            {cell.desc}
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Barra principal de leyenda */}
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-[10px] font-extrabold uppercase tracking-[0.08em] text-slate-400">
          {idwLegend.scaleLabel}
        </span>
        <div className="flex flex-1 overflow-hidden rounded-full border border-slate-200/60">
          {segments.map((seg, i) => (
            <div
              key={i}
              className="relative flex-1 cursor-default py-1.5 text-center transition-opacity"
              style={{ background: seg.bg, borderRight: i < 3 ? '1px solid rgba(255,255,255,0.6)' : undefined }}
              onMouseEnter={() => setHoveredBand(i)}
              onMouseLeave={() => setHoveredBand(null)}
            >
              <span className="text-[10px] font-semibold leading-none" style={{ color: seg.color }}>
                {seg.label}
              </span>
              {/* Tooltip por segmento */}
              {hoveredBand === i && descriptions?.[i] && (
                <div className="absolute bottom-full left-1/2 z-[600] mb-2 w-56 -translate-x-1/2 rounded-xl border border-slate-200 bg-white/97 px-3 py-2 text-left text-[10px] leading-relaxed text-slate-600 shadow-xl">
                  {descriptions[i]}
                </div>
              )}
            </div>
          ))}
        </div>
        {/* Botón toggle tabla completa */}
        <button
          type="button"
          onClick={() => setTableOpen((prev) => !prev)}
          className={`shrink-0 flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-bold transition ${
            tableOpen
              ? 'border-[#509EE3] bg-[#509EE3] text-white'
              : 'border-slate-300 bg-white/80 text-slate-500 hover:border-[#509EE3] hover:text-[#509EE3]'
          }`}
          title="Ver tabla completa de umbrales TULSMA"
          aria-label="Ver tabla TULSMA"
        >
          ?
        </button>
      </div>
    </div>
  );
}

export function PublicDashboard({

  onGoToLogin,
  onGoToLanding,
  embedded = false,
  showLandingAction = true,
  showLoginAction = true,
}: PublicDashboardProps) {
  const [snapshot, setSnapshot] = useState<PublicAirQualityResponse | null>(null);
  const [trendSnapshot, setTrendSnapshot] = useState<PublicAirQualityResponse | null>(null);
  const [selectedVariable, setSelectedVariable] = useState(DEFAULT_VARIABLE);
  const [rangePreset, setRangePreset] = useState<RangePreset>('latest');
  const [selectedStation, setSelectedStation] = useState(ALL_STATIONS);
  const [selectedHour, setSelectedHour] = useState<string>(ALL_STATIONS);
  const [expandedVariableInfo, setExpandedVariableInfo] = useState<string | null>(null);
  const [stationOptionsByKey, setStationOptionsByKey] = useState<Record<string, { code: string; name: string }[]>>({});
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
  const stationOptionsKey = useMemo(
    () => `${rangePreset}|${selectedHour}|${selectedVariable}`,
    [rangePreset, selectedHour, selectedVariable],
  );

  const cacheSnapshot = useCallback((response: PublicAirQualityResponse) => {
    const hourKey = requestParams.hour ?? ALL_STATIONS;
    const stationKey = requestParams.station_code ?? ALL_STATIONS;
    snapshotCacheRef.current.set(`${requestParams.period}|${hourKey}|${stationKey}|${response.variable_code}`, response);
    if (!requestParams.station_code) {
      const nextStations = response.stations
        .map((station) => ({ code: station.station_code, name: station.station_name }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setStationOptionsByKey((current) => ({
        ...current,
        [`${requestParams.period}|${hourKey}|${response.variable_code}`]: nextStations,
      }));
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
    let cancelled = false;
    async function loadTrendSnapshot() {
      try {
        const response = await getPublicAirQuality({
          variable_code: selectedVariable,
          period: '72h',
          station_code: selectedStation !== ALL_STATIONS ? selectedStation : undefined,
          sync: false,
          force_sync: false,
        });
        if (!cancelled) {
          setTrendSnapshot(response);
        }
      } catch {
        if (!cancelled) {
          setTrendSnapshot(null);
        }
      }
    }
    void loadTrendSnapshot();
    return () => {
      cancelled = true;
    };
  }, [selectedStation, selectedVariable]);

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

  useEffect(() => {
    setSelectedStation(ALL_STATIONS);
  }, [selectedVariable]);

  const values = snapshot?.stations.map((station) => station.mean_value) ?? [];
  const selectedMin = values.length > 0 ? Math.min(...values) : null;
  const selectedMax = values.length > 0 ? Math.max(...values) : null;
  const idwLegend = getLegendData(snapshot?.variable_code ?? selectedVariable, selectedMin, selectedMax, snapshot?.unit);
  const cityMean = values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const periodSummary = snapshot?.period_summary;
  const periodUnit = periodSummary?.unit ?? snapshot?.unit;
  const displayMean = periodSummary?.avg_value ?? cityMean;
  const cityBand = displayMean !== null && displayMean !== undefined && snapshot ? getQualityBand(snapshot.variable_code, displayMean) : null;
  const chartSource = trendSnapshot?.variable_code === (snapshot?.variable_code ?? selectedVariable) ? trendSnapshot : snapshot;
  const chartData: ChartPoint[] = useMemo(
    () =>
      chartSource?.time_series.map((point) => ({
        time: formatShortTime(point.timestamp),
        mean: Number(point.mean_value.toFixed(2)),
        min: Number(point.min_value.toFixed(2)),
        max: Number(point.max_value.toFixed(2)),
      })) ?? [],
    [chartSource],
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
  const stationOptions = useMemo(() => {
    const cachedOptions = stationOptionsByKey[stationOptionsKey];
    if (cachedOptions) {
      return cachedOptions;
    }
    if (selectedStation === ALL_STATIONS) {
      return [...(snapshot?.stations ?? [])]
        .map((station) => ({ code: station.station_code, name: station.station_name }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    return [];
  }, [selectedStation, snapshot, stationOptionsByKey, stationOptionsKey]);
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
  const selectedStationDetail = selectedStation === ALL_STATIONS ? null : (snapshot?.stations[0] ?? null);
  const selectedStationBand = selectedStationDetail
    ? getQualityBand(snapshot?.variable_code ?? selectedVariable, selectedStationDetail.latest_value)
    : null;

  return (
    <div className={`relative w-full overflow-hidden bg-[#dbe5ef] ${embedded ? 'h-full' : 'h-screen'}`}>
      <style>{`
        .public-glass-panel {
          background: rgba(255,255,255,0.93);
          backdrop-filter: blur(22px);
          -webkit-backdrop-filter: blur(22px);
          border: 1px solid rgba(255,255,255,0.7);
          box-shadow: 0 12px 36px rgba(15,23,42,0.14);
        }
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
        .leaflet-control-zoom {
          border: none !important;
          box-shadow: none !important;
        }
        .leaflet-control-zoom a {
          background: rgba(255,255,255,0.94) !important;
          border: 1px solid rgba(220,229,241,0.9) !important;
          color: #334155 !important;
        }
        @media (max-width: 1023px) {
          .public-dashboard-shell {
            overflow: auto;
          }
          .public-map-canvas {
            position: relative !important;
            height: 62vh !important;
          }
          .public-left-panel,
          .public-right-panel,
          .public-legend-panel {
            position: relative !important;
            inset: auto !important;
            width: auto !important;
            transform: none !important;
            margin: 12px;
          }
        }
      `}</style>

      <div ref={mapContainerRef} className="public-map-canvas absolute inset-0 z-0 h-full w-full" />

      <div className="public-dashboard-shell pointer-events-none absolute inset-0 z-[500]">
        <aside className="public-left-panel public-glass-panel pointer-events-auto absolute bottom-4 left-4 top-4 flex w-[316px] flex-col overflow-x-hidden overflow-y-auto rounded-[20px]">
          <div className="border-b border-slate-200/80 px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] bg-white shadow-sm ring-1 ring-slate-200/80">
                <img src={atmosLogo} alt="ATMOS" className="h-10 w-10 object-contain" decoding="async" />
              </div>
              <div className="min-w-0">
                <h1 className="text-md font-extrabold tracking-tight text-slate-950">ATMOS</h1>
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">Monitoreo de Calidad de Aire</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
              <span>Consulta: {formatDateTime(lastFetchedAt)}</span>
              <div className="flex items-center gap-1">
                {showLandingAction && onGoToLanding ? (
                  <Button variant="ghost" size="sm" onClick={onGoToLanding} className="h-7 gap-1 px-2 text-xs">
                    <Home className="h-3.5 w-3.5" />
                    Inicio
                  </Button>
                ) : null}
                <Button variant="ghost" size="sm" onClick={() => void loadSnapshot(true)} disabled={loading} className="h-7 gap-1 px-2 text-xs">
                  {loading ? 'Actualizando...' : 'Actualizar'}
                </Button>
              </div>
            </div>
          </div>

          <div className="border-b border-slate-200/80 px-5 py-4 text-center">
            <SemiGauge
              value={displayMean}
              variableCode={snapshot?.variable_code ?? selectedVariable}
              unit={snapshot?.unit}
              band={cityBand}
            />
          </div>

          <div className="border-b border-slate-200/80 px-5 py-4">
            <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">Estados actuales</div>
            <div className="grid grid-cols-4 gap-2">
              {METEO_CELLS.map(({ code, icon: Icon, label }) => {
                const meteo = snapshot?.meteorology.find((item) => item.variable_code === code);
                return (
                  <div key={code} className="flex min-w-0 flex-col items-center gap-1 rounded-lg bg-[#F9FBFC] px-1 py-2 text-center">
                    <Icon className="h-4 w-4 text-[#509EE3]" />
                    <div className="max-w-full truncate text-sm font-bold text-slate-950">
                      {formatVariableValue(meteo?.latest_value ?? meteo?.mean_value, code, meteo?.unit)}
                    </div>
                    <div className="text-[9px] text-slate-400">{label}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="border-b border-slate-200/80 px-5 py-4">
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
              <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">Alertas</span>
              <Badge className="ml-auto bg-red-50 text-red-600 hover:bg-red-50">{topRelativeStations.length}</Badge>
            </div>
            <div className="space-y-2">
              {topRelativeStations.length > 0 ? (
                topRelativeStations.map((station) => {
                  const band = getQualityBand(snapshot?.variable_code ?? selectedVariable, station.mean_value);
                  return (
                    <button
                      key={station.station_code}
                      type="button"
                      onClick={() => setSelectedStation(station.station_code)}
                      className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs"
                      style={{ backgroundColor: band.background, color: band.color }}
                    >
                      <span className="font-medium">{station.station_name}</span>
                      <span className="font-bold">{formatVariableValue(station.mean_value, snapshot?.variable_code, snapshot?.unit)}</span>
                    </button>
                  );
                })
              ) : (
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">Sin estaciones para evaluar.</p>
              )}
            </div>
          </div>

          <div className="mt-auto px-5 py-4">
            <div className="mb-3 flex items-center gap-2">
              <Gauge className="h-3.5 w-3.5 text-[#509EE3]" />
              <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">Controles</span>
            </div>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label className="text-[11px] text-slate-500">Variable</Label>
                <div className="grid grid-cols-4 gap-1.5">
                  {(variableOptions.length > 0 ? variableOptions : [{ code: DEFAULT_VARIABLE, name: DEFAULT_VARIABLE, category: 'pollutant', unit: null }]).map((variable) => (
                    <button
                      key={variable.code}
                      type="button"
                      onClick={() => setSelectedVariable(variable.code)}
                      className={`rounded-md border px-2 py-1.5 text-[10px] font-bold transition ${selectedVariable === variable.code
                        ? 'border-[#509EE3] bg-[#EDF6FF] text-[#1f5f96]'
                        : 'border-slate-200 bg-white/75 text-slate-600 hover:border-[#509EE3]/50'
                        }`}
                    >
                      {getVariableLabel(variable.code)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-[11px] text-slate-500">Rango</Label>
                <div className="grid grid-cols-5 gap-1.5">
                  {RANGE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setRangePreset(option.value)}
                      title={RANGE_LABELS[option.value]}
                      className={`rounded-md border px-2 py-1.5 text-[10px] font-bold transition ${rangePreset === option.value
                        ? 'border-[#509EE3] bg-[#EDF6FF] text-[#1f5f96]'
                        : 'border-slate-200 bg-white/75 text-slate-600 hover:border-[#509EE3]/50'
                        }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              {rangePreset === 'today' ? (
                <div className="space-y-2">
                  <Label className="text-[11px] text-slate-500">Hora</Label>
                  <div className="grid max-h-20 grid-cols-6 gap-1 overflow-y-auto pr-1">
                    <button
                      type="button"
                      onClick={() => setSelectedHour(ALL_STATIONS)}
                      className={`rounded-md border px-1.5 py-1 text-[10px] font-bold ${selectedHour === ALL_STATIONS ? 'border-[#509EE3] bg-[#EDF6FF] text-[#1f5f96]' : 'border-slate-200 bg-white/75 text-slate-600'
                        }`}
                    >
                      Todas
                    </button>
                    {HOUR_OPTIONS.map((hour) => (
                      <button
                        key={hour}
                        type="button"
                        onClick={() => setSelectedHour(String(hour))}
                        className={`rounded-md border px-1.5 py-1 text-[10px] font-bold ${selectedHour === String(hour) ? 'border-[#509EE3] bg-[#EDF6FF] text-[#1f5f96]' : 'border-slate-200 bg-white/75 text-slate-600'
                          }`}
                      >
                        {String(hour).padStart(2, '0')}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="space-y-2">
                <Label className="text-[11px] text-slate-500">Estacion</Label>
                <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto pr-1">
                  <button
                    type="button"
                    onClick={() => setSelectedStation(ALL_STATIONS)}
                    className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${selectedStation === ALL_STATIONS ? 'border-[#509EE3] bg-[#EDF6FF] text-[#1f5f96]' : 'border-slate-200 bg-white/75 text-slate-600'
                      }`}
                  >
                    Todas
                  </button>
                  {stationOptions.map((station) => (
                    <button
                      key={station.code}
                      type="button"
                      onClick={() => setSelectedStation(station.code)}
                      className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${selectedStation === station.code ? 'border-[#509EE3] bg-[#EDF6FF] text-[#1f5f96]' : 'border-slate-200 bg-white/75 text-slate-600'
                        }`}
                    >
                      {station.name}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2 rounded-lg bg-white/70 p-3">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="surface-layer" className="text-xs text-slate-600">Mapa de calor IDW</Label>
                  <Switch id="surface-layer" checked={showSurface} onCheckedChange={setShowSurface} />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="station-layer" className="text-xs text-slate-600">Estaciones observadas</Label>
                  <Switch id="station-layer" checked={showStations} onCheckedChange={setShowStations} />
                </div>
              </div>
            </div>
          </div>
        </aside>

        <aside className="public-right-panel public-glass-panel pointer-events-auto absolute bottom-4 right-4 top-4 flex w-[360px] flex-col overflow-y-auto rounded-[20px]">
          {selectedStationDetail ? (
            <StationDetailPanel
              station={selectedStationDetail}
              selectedVariable={snapshot?.variable_code ?? selectedVariable}
              unit={snapshot?.unit}
              band={selectedStationBand}
              onClose={() => setSelectedStation(ALL_STATIONS)}
            />
          ) : (
            <>
              <div className="border-b border-slate-200/80 px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-extrabold text-slate-950">Resumen operativo</h2>
                    <p className="mt-1 text-[11px] text-slate-400">{RANGE_LABELS[rangePreset]} · {snapshot?.station_count ?? 0} estaciones</p>
                  </div>
                  {showLoginAction && onGoToLogin ? (
                    <Button onClick={onGoToLogin} size="sm" className="h-8 gap-1 bg-[#509EE3] text-white hover:bg-[#509EE3]/90">
                      <LogIn className="h-3.5 w-3.5" />
                      Ingresar
                    </Button>
                  ) : null}
                </div>
                {error ? <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
              </div>

              <div className="border-b border-slate-200/80 px-5 py-4">
                <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">Trazabilidad de carga</div>
                <div className="grid gap-2 text-xs text-slate-600">
                  <TraceRow label="Estado sync" value={snapshot?.sync?.status ?? 'unknown'} />
                  <TraceRow label="Corrida inicio" value={formatDateTime(snapshot?.sync?.latest_run_started_at)} />
                  <TraceRow label="Corrida fin" value={formatDateTime(snapshot?.sync?.latest_run_finished_at)} />
                  <TraceRow label="Fuente descargada" value={formatDateTime(snapshot?.sync?.latest_source_downloaded_at)} />
                  <TraceRow label="Fuente procesada" value={formatDateTime(snapshot?.sync?.latest_source_processed_at)} />
                  <TraceRow label="Ultima ingesta" value={formatDateTime(latestIngestedAt)} />
                  <TraceRow label="Registros hoy" value={`${snapshot?.sync?.records_today ?? snapshot?.today_observation_count ?? 0}`} />
                  <TraceRow label="Insertados / actualizados" value={`${snapshot?.sync?.records_inserted ?? 0} / ${snapshot?.sync?.records_updated ?? 0}`} />
                </div>
              </div>

              <div className="border-b border-slate-200/80 px-5 py-4">
                <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">Tendencia y ranking</div>
                <div className="h-40">
                  {chartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData} margin={{ left: -18, right: 6, top: 4, bottom: 0 }}>
                        <defs>
                          <linearGradient id="publicTrendMean" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#509EE3" stopOpacity={0.22} />
                            <stop offset="95%" stopColor="#509EE3" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(203,213,225,0.55)" />
                        <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#94a3b8' }} minTickGap={28} />
                        <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} />
                        <Tooltip />
                        <Area type="monotone" dataKey="mean" stroke="#509EE3" strokeWidth={2} fill="url(#publicTrendMean)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center rounded-lg bg-slate-50 text-xs text-slate-500">
                      Sin serie disponible para este rango.
                    </div>
                  )}
                </div>
                <div className="mt-4 space-y-3">
                  {stationComparison.slice(0, 5).map((station) => {
                    const width = selectedMax && selectedMax > 0 ? Math.min((station.mean / selectedMax) * 100, 100) : 0;
                    return (
                      <div key={station.station}>
                        <div className="mb-1 flex justify-between text-[11px] text-slate-500">
                          <span>{station.station}</span>
                          <strong className="text-slate-800">{station.mean}</strong>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                          <div className="h-full rounded-full bg-[#509EE3]" style={{ width: `${width}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="border-b border-slate-200/80 px-5 py-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">Variables REMMAQ</span>
                  <img src={quitoLogo} alt="Municipio de Quito" className="h-6 max-w-[104px] object-contain" decoding="async" />
                  <Badge className={coveragePercent === 100 ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}>
                    {coveragePercent}%
                  </Badge>
                </div>
                <p className="mb-3 text-xs text-slate-500">{summarizeAvailability(variableSummaries)}</p>
                <div className="grid gap-2">
                  {variableSummaries.map((summary) => (
                    <div
                      key={summary.variable_code}
                      className={`rounded-lg border px-3 py-2 text-left transition ${selectedVariable === summary.variable_code ? 'border-[#509EE3] bg-[#EDF6FF]' : 'border-slate-200 bg-white/70'
                        }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedVariable(summary.variable_code)}
                          className="min-w-0 text-left"
                        >
                          <span className="block truncate text-xs font-bold text-slate-900">{getVariableLabel(summary.variable_code)}</span>
                        </button>
                        <div className="flex shrink-0 items-center gap-2">
                          <Badge className={summary.sample_count > 0 ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'}>
                            {summary.sample_count > 0 ? 'datos' : 'sin datos'}
                          </Badge>
                          <button
                            type="button"
                            onClick={() => setExpandedVariableInfo((current) => (current === summary.variable_code ? null : summary.variable_code))}
                            className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                            aria-label={`Informacion de ${getVariableLabel(summary.variable_code)}`}
                          >
                            <Info className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedVariable(summary.variable_code)}
                        className="mt-1 block w-full text-left text-[11px] text-slate-500"
                      >
                        {summary.sample_count > 0
                          ? `${formatVariableValue(summary.mean_value, summary.variable_code, summary.unit)} ${getUnitLabel(summary.unit)} | ${summary.station_count} estaciones`
                          : 'Sin datos'}
                      </button>
                      <p className="mt-1 text-[10px] text-slate-400">
                        Ultima presencia: {formatDateTime(summary.latest_observed_at ?? summary.latest_available_at)}
                      </p>
                      <p className="text-[10px] text-slate-400">
                        Hoy: {summary.today_sample_count} | Total historico: {summary.total_sample_count}
                      </p>
                      {expandedVariableInfo === summary.variable_code ? (
                        <div className="mt-2 rounded-md bg-white/75 p-2 text-[11px] leading-relaxed text-slate-600">
                          <p>{VARIABLE_HELP[summary.variable_code] ?? summary.variable_name}</p>
                          <p className="mt-1 font-medium text-slate-700">
                            {VARIABLE_RECOMMENDATIONS[summary.variable_code] ?? 'Use esta variable para interpretar el contexto REMMAQ seleccionado.'}
                          </p>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
                {missingVariableSummaries.length > 0 ? (
                  <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{coverageMessage}</p>
                ) : null}
              </div>

              <div className="border-b border-slate-200/80 px-5 py-4">
                <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">Estaciones</div>
                <div className="space-y-2">
                  {stationSnapshot.length > 0 ? (
                    stationSnapshot.map((station) => {
                      const band = getQualityBand(snapshot?.variable_code ?? selectedVariable, station.latest_value);
                      return (
                        <button
                          key={station.station_code}
                          type="button"
                          onClick={() => setSelectedStation(station.station_code)}
                          className="w-full rounded-lg border border-slate-200 bg-white/70 p-3 text-left"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-xs font-bold text-slate-950">{station.station_name}</p>
                              <p className="text-[10px] uppercase text-slate-400">{station.station_code}</p>
                            </div>
                            <span className="text-xs font-bold" style={{ color: band.color }}>
                              {formatVariableValue(station.latest_value, snapshot?.variable_code, station.unit)}
                            </span>
                          </div>
                          <p className="mt-2 text-[10px] text-slate-500">Ultima lectura: {formatDateTime(station.latest_observed_at)}</p>
                        </button>
                      );
                    })
                  ) : (
                    <p className="rounded-lg bg-slate-50 px-3 py-3 text-xs text-slate-500">No hay estaciones para el rango seleccionado.</p>
                  )}
                </div>
              </div>

              <div className="px-5 py-4">
                <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">Resumen tecnico</div>
                <div className="grid grid-cols-3 gap-2">
                  <MiniStat label="MAX" value={formatVariableValue(periodSummary?.max_value, snapshot?.variable_code, periodUnit)} />
                  <MiniStat label="AVG" value={formatVariableValue(periodSummary?.avg_value, snapshot?.variable_code, periodUnit)} />
                  <MiniStat label="RDS" value={`${periodSummary?.rds ?? 0}`} />
                </div>
                <div className="mt-3 grid gap-3">
                  <div className="h-32 rounded-lg bg-white/60 p-2">
                    {histogramData.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={histogramData} margin={{ left: -18, right: 4, top: 4, bottom: 0 }}>
                          <XAxis dataKey="range" tick={{ fontSize: 8, fill: '#94a3b8' }} />
                          <YAxis allowDecimals={false} tick={{ fontSize: 8, fill: '#94a3b8' }} />
                          <Tooltip />
                          <Bar dataKey="stations" fill="#509EE3" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs text-slate-500">Sin distribucion.</div>
                    )}
                  </div>
                  <div className="max-h-44 overflow-auto rounded-lg bg-white/60 p-2">
                    <table className="w-full text-[10px]">
                      <thead className="text-left text-slate-400">
                        <tr>
                          <th className="py-1">Estacion</th>
                          {stationMatrixCodes.slice(0, 4).map((code) => (
                            <th key={code} className="py-1">{getVariableLabel(code)}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {stationMatrixRows.slice(0, 5).map(({ station, values: rowValues }) => (
                          <tr key={station.station_code} className="border-t border-slate-100">
                            <td className="py-1 pr-2 font-medium text-slate-700">{station.station_name}</td>
                            {rowValues.slice(0, 4).map((item, index) => (
                              <td key={item?.variable_code ?? index} className="py-1 text-slate-500">
                                {item ? formatVariableValue(item.value, item.variable_code, item.unit) : '-'}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </>
          )}
        </aside>

        <TulsmaLegendPanel
          variableCode={snapshot?.variable_code ?? selectedVariable}
          unit={snapshot?.unit}
          idwLegend={idwLegend}
        />
      </div>
    </div>
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
              {loading ? 'Actualizando...' : 'Actualizar'}
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
              {cityBand ? <p className="mt-2 text-xs font-medium" style={{ color: cityBand?.color ?? '#509EE3' }}>{cityBand?.label}</p> : null}
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
                      style={{
                        color: cityBand?.color ?? '#509EE3',
                        backgroundColor: cityBand?.background ?? '#EDF6FF',
                        borderColor: cityBand?.color ?? '#509EE3',
                      }}
                    >
                      {cityBand?.label}
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
                      className={`rounded-md border px-3 py-2 text-left transition hover:border-[#509EE3] ${selectedVariable === summary.variable_code ? 'border-[#509EE3] bg-[#EDF6FF]' : 'bg-white'
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
                    const band = getQualityBand(snapshot?.variable_code ?? selectedVariable, station.latest_value);
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
              {(snapshot?.meteorology.length ?? 0) === 0 ? (
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
                  const band = getQualityBand(snapshot?.variable_code ?? selectedVariable, station.mean_value);
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

function TraceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg bg-white/60 px-3 py-2">
      <span className="text-slate-400">{label}</span>
      <span className="text-right font-semibold text-slate-700">{value}</span>
    </div>
  );
}

function gaugeMaxForVariable(variableCode: string) {
  // Topes alineados con umbral "Muy alto" TULSMA Anexo 4
  if (variableCode === 'PM25') return 75;   // µg/m³
  if (variableCode === 'PM10') return 200;  // µg/m³
  if (variableCode === 'NO2')  return 400;  // µg/m³
  if (variableCode === 'O3')   return 200;  // µg/m³
  if (variableCode === 'SO2')  return 350;  // µg/m³
  if (variableCode === 'CO')   return 30;   // mg/m³
  if (variableCode === 'TMP')  return 40;   // °C
  if (variableCode === 'HUM')  return 100;  // %
  if (variableCode === 'VEL')  return 20;   // m/s
  if (variableCode === 'IUV')  return 11;   // índice UV extremo
  if (variableCode === 'RS')   return 1000; // W/m²
  return 100;
}

function SemiGauge({
  value,
  variableCode,
  unit,
  band,
}: {
  value: number | null | undefined;
  variableCode: string;
  unit: string | null | undefined;
  band: QualityBand | null;
}) {
  const numericValue = Number.isFinite(value ?? NaN) ? Number(value) : 0;
  const max = gaugeMaxForVariable(variableCode);
  const pct = Math.max(0, Math.min(numericValue / max, 1));
  const cx = 88;
  const cy = 86;
  const radius = 68;
  const toPoint = (angle: number, r = radius) => ({
    x: cx + r * Math.cos(angle),
    y: cy + r * Math.sin(angle),
  });
  const arcPath = (start: number, end: number, r = radius) => {
    const startPoint = toPoint(start, r);
    const endPoint = toPoint(end, r);
    return `M ${startPoint.x} ${startPoint.y} A ${r} ${r} 0 ${end - start > Math.PI ? 1 : 0} 1 ${endPoint.x} ${endPoint.y}`;
  };
  const startAngle = Math.PI;
  const endAngle = Math.PI * 2;
  const valueAngle = startAngle + pct * Math.PI;
  const color = band?.color ?? '#EAB308';
  const segmentColors = ['#BDECCF', '#FDE7B9', '#FED3BF', '#E8C7F4', '#D7B5B4'];

  return (
    <div className="flex flex-col items-center">
      <svg width="176" height="112" viewBox="0 0 176 112" aria-hidden="true">
        {segmentColors.map((segmentColor, index) => {
          const segmentStart = startAngle + (index / segmentColors.length) * Math.PI;
          const segmentEnd = startAngle + ((index + 0.78) / segmentColors.length) * Math.PI;
          const dot = toPoint(segmentStart + 0.08, radius + 9);
          return (
            <g key={segmentColor}>
              <path
                d={arcPath(segmentStart, segmentEnd, radius + 9)}
                fill="none"
                stroke={segmentColor}
                strokeWidth="7"
                strokeLinecap="round"
                opacity="0.72"
              />
              <circle cx={dot.x} cy={dot.y} r="3.5" fill={segmentColor} opacity="0.95" />
            </g>
          );
        })}
        <path d={arcPath(startAngle, endAngle)} fill="none" stroke="#E5E7EB" strokeWidth="16" strokeLinecap="round" />
        {numericValue > 0 ? (
          <path d={arcPath(startAngle, valueAngle)} fill="none" stroke={color} strokeWidth="16" strokeLinecap="round" />
        ) : null}
        <line
          x1={cx}
          y1={cy}
          x2={cx + (radius - 18) * Math.cos(valueAngle)}
          y2={cy + (radius - 18) * Math.sin(valueAngle)}
          stroke={color}
          strokeWidth="4"
          strokeLinecap="round"
        />
        <circle cx={cx} cy={cy} r="8" fill={color} />
      </svg>
      <div className="-mt-2 text-center">
        <div className="text-5xl font-extrabold leading-none" style={{ color }}>
          {formatVariableValue(value, variableCode, unit)}
        </div>
        <div className="mt-1 text-sm font-extrabold uppercase tracking-[0.08em]" style={{ color }}>
          {band?.label ?? 'Sin datos'}
        </div>
        <div className="mt-2 text-xs font-semibold text-slate-400">
          {getVariableLabel(variableCode)} — Quito
        </div>
      </div>
    </div>
  );
}

function StationDetailPanel({
  station,
  selectedVariable,
  unit,
  band,
  onClose,
}: {
  station: PublicStationObservation;
  selectedVariable: string;
  unit: string | null | undefined;
  band: QualityBand | null;
  onClose: () => void;
}) {
  const pollutantValues = (station.variables ?? []).filter((item) => item.category === 'pollutant');
  const meteorologyValues = (station.variables ?? []).filter((item) => item.category === 'meteorological');
  const limits: Record<string, number> = { PM25: 25, PM10: 50, NO2: 40, O3: 70, CO: 10, SO2: 20 };
  const radarData = ['PM25', 'PM10', 'NO2', 'O3', 'CO', 'SO2']
    .map((code) => {
      const item = pollutantValues.find((candidate) => candidate.variable_code === code);
      if (!item) return null;
      const current = code === 'CO' ? item.value * 10 : item.value;
      return {
        subject: code === 'CO' ? 'CO×10' : getVariableLabel(code),
        current,
        limit: limits[code] ?? current,
      };
    })
    .filter((item): item is { subject: string; current: number; limit: number } => item !== null);

  return (
    <>
      <div className="border-b border-slate-200/80 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-extrabold text-slate-950">{station.station_name}</h2>
            <p className="mt-1 flex items-center gap-2 text-sm font-bold" style={{ color: band?.color ?? '#509EE3' }}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: band?.color ?? '#509EE3' }} />
              {getVariableLabel(selectedVariable)} {formatVariableValue(station.latest_value, selectedVariable, unit)} · {band?.label ?? 'Sin clasificar'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 hover:bg-slate-200"
            aria-label="Volver a todas las estaciones"
          >
            <X className="h-6 w-6" />
          </button>
        </div>
      </div>

      <div className="border-b border-slate-200/80 px-5 py-4">
        <div className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.08em] text-slate-400">Pollutant profile</div>
        <div className="h-56">
          {radarData.length > 2 ? (
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData} outerRadius={78}>
                <PolarGrid stroke="#E5E7EB" />
                <PolarAngleAxis dataKey="subject" tick={{ fontSize: 12, fill: '#64748b' }} />
                <Radar name="Current" dataKey="current" stroke="#509EE3" fill="#509EE3" fillOpacity={0.22} strokeWidth={2} />
                <Radar name="Limit" dataKey="limit" stroke="#EF4444" fill="transparent" strokeWidth={1.5} strokeDasharray="4 3" />
                <Legend iconSize={8} wrapperStyle={{ fontSize: 12 }} />
              </RadarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center rounded-lg bg-slate-50 text-xs text-slate-500">
              Sin suficientes contaminantes para el perfil.
            </div>
          )}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {pollutantValues.map((item) => (
            <div key={item.variable_code} className="rounded-xl bg-[#F9FBFC] p-3">
              <div className="text-xs font-bold text-slate-400">{getVariableLabel(item.variable_code)}</div>
              <div className="mt-2 text-2xl font-extrabold leading-none text-slate-950">
                {formatVariableValue(item.value, item.variable_code, item.unit)}
              </div>
              <div className="mt-1 text-[11px] text-slate-300">{getUnitLabel(item.unit)}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="px-5 py-4">
        <div className="mb-3 text-[11px] font-extrabold uppercase tracking-[0.08em] text-slate-400">Meteorology</div>
        <div className="grid grid-cols-2 gap-2">
          {meteorologyValues.map((item) => (
            <div key={item.variable_code} className="rounded-xl bg-[#F9FBFC] p-4">
              <div className="text-sm text-slate-400">{item.variable_name}</div>
              <div className="mt-2 text-xl font-extrabold text-slate-700">
                {formatVariableValue(item.value, item.variable_code, item.unit)} {getUnitLabel(item.unit)}
              </div>
            </div>
          ))}
          {meteorologyValues.length === 0 ? (
            <p className="col-span-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">Sin meteorologia reciente para esta estacion.</p>
          ) : null}
        </div>
        <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs text-slate-500">
          Ultima lectura de {getVariableLabel(selectedVariable)}: {formatDateTime(station.latest_observed_at)} · {station.sample_count} muestras en el rango.
        </div>
      </div>
    </>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/70 px-3 py-2 text-center">
      <div className="text-[9px] font-bold uppercase tracking-[0.08em] text-slate-400">{label}</div>
      <div className="mt-1 truncate text-sm font-extrabold text-slate-900">{value}</div>
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
            className={`pointer-events-none fixed z-[3000] w-80 -translate-x-1/2 rounded-md border border-[#dce5f1] bg-white p-3 text-xs font-normal leading-relaxed text-muted-foreground shadow-xl ${tooltip.placement === 'top' ? '-translate-y-full' : ''
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
