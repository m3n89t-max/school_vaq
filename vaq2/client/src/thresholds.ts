export type Level = "veryGood" | "good" | "normal" | "bad" | "veryBad";

export type MetricKey =
  | "pm10"
  | "pm25"
  | "co2"
  | "voc"
  | "hcho"
  | "co"
  | "temp"
  | "hum";

export type Band = {
  level: Level;
  /** 이 값 이상이면 해당 단계로 판정 (최소값 기준) */
  min: number;
  color: string;
  blink?: boolean; // 매우나쁨 점멸
};

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

/**
 * 기준표(조리실공기질기준표.xlsx) 기반: 단계별 최소값(min) 기준
 * 값이 커질수록 상태가 나빠지는(오염형) 지표에 적합
 */
export const METRICS: Record<MetricKey, MetricSpec> = {
  pm25: {
    label: "PM2.5",
    unit: "µg/m³", // ✅ 확정
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
    unit: "µg/m³", // ✅ 확정
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
    unit: "ppm", // ✅ 확정
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
    unit: "ppb", // ✅ 확정
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
    unit: "ppb", // ✅ 확정
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
    unit: "ppm", // ✅ 확정
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
    unit: "°C", // ✅ 확정
    // ⚠️ 온도/습도는 기준표가 없어서 임시값(원하시면 기준표/현장 기준으로 조정)
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
    unit: "%RH", // ✅ 확정
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
  // min 기준이므로 큰 min부터 매칭
  for (const b of [...bands].sort((a, b) => b.min - a.min)) {
    if (value >= b.min) return b;
  }
  return bands[0];
}

export function levelLabel(level: Level): string {
  switch (level) {
    case "veryGood": return "매우좋음";
    case "good": return "좋음";
    case "normal": return "보통";
    case "bad": return "나쁨";
    case "veryBad": return "매우나쁨";
  }
}

// 기존 지표명을 새로운 MetricKey로 매핑
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

// 호환성을 위한 함수들
export function getStatus(metricName: string, value: number): Level {
  const metricKey = mapLegacyMetric(metricName);
  if (!metricKey) return 'veryGood';
  return getBand(metricKey, value).level;
}

export function getStatusLabel(level: Level): string {
  return levelLabel(level);
}

export function getMetricLabel(metricName: string): string {
  const metricKey = mapLegacyMetric(metricName);
  if (metricKey && METRICS[metricKey]) {
    return METRICS[metricKey].label;
  }
  // 기존 매핑 (noise, airflow 등)
  const legacyLabels: Record<string, string> = {
    noise: '소음',
    airflow: '기류'
  };
  return legacyLabels[metricName] || metricName;
}

export function getMetricUnit(metricName: string): string {
  const metricKey = mapLegacyMetric(metricName);
  if (metricKey && METRICS[metricKey]) {
    return METRICS[metricKey].unit;
  }
  // 기존 매핑
  const legacyUnits: Record<string, string> = {
    noise: 'dB',
    airflow: '%'
  };
  return legacyUnits[metricName] || '';
}
