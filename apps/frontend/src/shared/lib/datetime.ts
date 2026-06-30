const ECUADOR_TIME_ZONE = 'America/Guayaquil';

const TIME_ZONE_PATTERN = /(?:Z|[+-]\d{2}:?\d{2})$/;

export const parseBackendDateInEcuador = (value: string): Date => {
  const normalized = TIME_ZONE_PATTERN.test(value) ? value : `${value}-05:00`;
  return new Date(normalized);
};

export const formatEcuadorDateTime = (value: string | null | undefined, fallback = 'Sin actualizacion') => {
  if (!value) return fallback;

  return new Intl.DateTimeFormat('es-EC', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: ECUADOR_TIME_ZONE,
  }).format(parseBackendDateInEcuador(value));
};

export const formatEcuadorShortDateTime = (value: string | null | undefined, fallback = 'Sin actualizacion') => {
  if (!value) return fallback;

  return new Intl.DateTimeFormat('es-EC', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    timeZone: ECUADOR_TIME_ZONE,
  }).format(parseBackendDateInEcuador(value));
};
