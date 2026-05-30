import { describe, expect, it } from 'vitest';

import type { AnalyticsDataRow } from '@/api/modules/analytics';
import {
  addDays,
  buildLocalSummary,
  formatDate,
  getLabSectionDescription,
  isTimeNavigableSection,
  normalizeDateRange,
  round,
  toIsoDate,
} from '@/features/analysis/lib/analytical-workspace-config';

function row(value: number): AnalyticsDataRow {
  return {
    observed_at: '2025-01-01T00:00:00Z',
    value,
    variable_code: 'PM25',
    variable_name: 'PM2.5',
    station_code: 'A',
    station_name: 'Station A',
    unit: 'ug/m3',
    source_file_id: 1,
    source_file_name: 'Source',
    source_type: 'manual',
  };
}

describe('analytical workspace config helpers', () => {
  it('normalizes inverted date ranges', () => {
    expect(normalizeDateRange('2025-02-01', '2025-01-01')).toEqual({
      from: '2025-01-01',
      to: '2025-02-01',
    });
    expect(normalizeDateRange('2025-01-01', '2025-02-01')).toEqual({
      from: '2025-01-01',
      to: '2025-02-01',
    });
    expect(normalizeDateRange('', '2025-02-01')).toEqual({
      from: undefined,
      to: '2025-02-01',
    });
    expect(normalizeDateRange('2025-01-01', '')).toEqual({
      from: '2025-01-01',
      to: undefined,
    });
  });

  it('formats and shifts UTC dates deterministically', () => {
    expect(formatDate(new Date('2025-01-05T20:30:00Z'))).toBe('2025-01-05');
    expect(addDays('2025-01-05', 3)).toBe('2025-01-08');
  });

  it('extracts ISO date and rounds numbers', () => {
    expect(toIsoDate('2025-01-05T20:30:00Z')).toBe('2025-01-05');
    expect(toIsoDate(null)).toBe('');
    expect(round(1.236, 2)).toBe(1.24);
  });

  it('builds a local summary with trend classification', () => {
    const summary = buildLocalSummary([row(10), row(12), row(14)]);

    expect(summary.samples).toBe(3);
    expect(summary.mean).toBe(12);
    expect(summary.min).toBe(10);
    expect(summary.max).toBe(14);
    expect(summary.trend).toBe('Rising');
  });

  it('builds empty, falling and stable local summaries', () => {
    expect(buildLocalSummary([])).toEqual({
      samples: 0,
      mean: 0,
      min: 0,
      max: 0,
      trend: 'Stable',
    });

    expect(buildLocalSummary([row(10), row(9)]).trend).toBe('Falling');
    expect(buildLocalSummary([row(10), row(10.2)]).trend).toBe('Stable');
    expect(buildLocalSummary([{ ...row(10), value: undefined as unknown as number }]).trend).toBe('Stable');
  });

  it('identifies time navigable analysis sections', () => {
    expect(isTimeNavigableSection('rolling')).toBe(true);
    expect(isTimeNavigableSection('summary')).toBe(false);
  });

  it('returns section descriptions only for analysis sections', () => {
    expect(getLabSectionDescription('load-data')).toBeNull();
    expect(getLabSectionDescription('summary')).toContain('descriptive statistics');
  });
});
