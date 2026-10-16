export type Level = "veryGood" | "good" | "normal" | "bad" | "veryBad";

export type Band = {
  level: Level;
  min: number;
  color: string;
  blink?: boolean;
};

export type MetricKey =
  | "pm10"
  | "pm25"
  | "co2"
  | "voc"
  | "hcho"
  | "co"
  | "temp"
  | "hum";

export type MetricSpec = {
  label: string;
  unit: string;
  bands: Band[];
};

const COLORS = {
  veryGood: "rgb(146,208,80)",
  good: "rgb(240,239,0)",
  normal: "rgb(255,192,0)",
  bad: "rgb(240,0,0)",
} as const;

export const METRICS: Record<MetricKey, MetricSpec> = {
  pm25: {
    label: "PM2.5",
    unit: "µg/m³",
    bands: [
      { level: "veryGood", min: 1, color: COLORS.veryGood },
      { level: "good", min: 36, color: COLORS.good },
      { level: "normal", min: 76, color: COLORS.normal },
      { level: "bad", min: 100, color: COLORS.bad },
      { level: "veryBad", min: 110, color: COLORS.bad, blink: true },
    ],
  },
  pm10: {
    label: "PM10",
    unit: "µg/m³",
    bands: [
      { level: "veryGood", min: 1, color: COLORS.veryGood },
      { level: "good", min: 81, color: COLORS.good },
      { level: "normal", min: 150, color: COLORS.normal },
      { level: "bad", min: 200, color: COLORS.bad },
      { level: "veryBad", min: 220, color: COLORS.bad, blink: true },
    ],
  },
  co2: {
    label: "CO₂",
    unit: "ppm",
    bands: [
      { level: "veryGood", min: 1, color: COLORS.veryGood },
      { level: "good", min: 1001, color: COLORS.good },
      { level: "normal", min: 1501, color: COLORS.normal },
      { level: "bad", min: 2001, color: COLORS.bad },
      { level: "veryBad", min: 2200, color: COLORS.bad, blink: true },
    ],
  },
  voc: {
    label: "VOC",
    unit: "ppb",
    bands: [
      { level: "veryGood", min: 1, color: COLORS.veryGood },
      { level: "good", min: 401, color: COLORS.good },
      { level: "normal", min: 1001, color: COLORS.normal },
      { level: "bad", min: 1200, color: COLORS.bad },
      { level: "veryBad", min: 1320, color: COLORS.bad, blink: true },
    ],
  },
  hcho: {
    label: "포름알데히드(HCHO)",
    unit: "ppb",
    bands: [
      { level: "veryGood", min: 1, color: COLORS.veryGood },
      { level: "good", min: 61, color: COLORS.good },
      { level: "normal", min: 101, color: COLORS.normal },
      { level: "bad", min: 200, color: COLORS.bad },
      { level: "veryBad", min: 220, color: COLORS.bad, blink: true },
    ],
  },
  co: {
    label: "일산화탄소(CO)",
    unit: "ppm",
    bands: [
      { level: "veryGood", min: 1, color: COLORS.veryGood },
      { level: "good", min: 11, color: COLORS.good },
      { level: "normal", min: 21, color: COLORS.normal },
      { level: "bad", min: 25, color: COLORS.bad },
      { level: "veryBad", min: 27, color: COLORS.bad, blink: true },
    ],
  },
  temp: {
    label: "온도",
    unit: "°C",
    bands: [
      { level: "veryGood", min: -999, color: COLORS.veryGood },
      { level: "good", min: 18, color: COLORS.good },
      { level: "normal", min: 26, color: COLORS.normal },
      { level: "bad", min: 30, color: COLORS.bad },
      { level: "veryBad", min: 33, color: COLORS.bad, blink: true },
    ],
  },
  hum: {
    label: "습도",
    unit: "%RH",
    bands: [
      { level: "veryGood", min: -999, color: COLORS.veryGood },
      { level: "good", min: 40, color: COLORS.good },
      { level: "normal", min: 60, color: COLORS.normal },
      { level: "bad", min: 75, color: COLORS.bad },
      { level: "veryBad", min: 85, color: COLORS.bad, blink: true },
    ],
  },
};

export function getBand(metric: MetricKey, value: number): Band {
  const bands = METRICS[metric].bands;
  const sorted = [...bands].sort((a, b) => b.min - a.min);
  return sorted.find((b) => value >= b.min) ?? sorted[sorted.length - 1];
}

export function mapLegacyMetric(metricName: string): MetricKey | null {
  const mapping: Record<string, MetricKey> = {
    temperature: 'temp',
    temp: 'temp',
    humidity: 'hum',
    hum: 'hum',
    co: 'co',
    co2: 'co2',
    pm25: 'pm25',
    pm10: 'pm10',
    voc: 'voc',
    hcho: 'hcho',
  };
  return mapping[metricName] || null;
}

export function getStatus(metricName: string, value: number): Level {
  const metricKey = mapLegacyMetric(metricName);
  if (!metricKey) return 'veryGood';
  return getBand(metricKey, value).level;
}
