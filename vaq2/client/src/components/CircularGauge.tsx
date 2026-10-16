import { getBand, METRICS, mapLegacyMetric } from '../thresholds';

interface Props {
  metric: string; // legacy metric name
  value: number;
}

export default function CircularGauge({ metric, value }: Props) {
  const metricKey = mapLegacyMetric(metric);
  if (!metricKey) return null;

  const spec = METRICS[metricKey];
  const band = getBand(metricKey, value);

  // 게이지 최대값 결정
  const maxValue = (() => {
    switch (metricKey) {
      case 'pm10': return 250;
      case 'pm25': return 150;
      case 'co2': return 2500;
      case 'voc': return 1500;
      case 'hcho': return 250;
      case 'co': return 30;
      case 'temp': return 40;
      case 'hum': return 100;
      default: return 100;
    }
  })();

  // SVG 원형 게이지 계산
  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  const percentage = Math.min(Math.max(value / maxValue, 0), 1);
  const strokeDashoffset = circumference * (1 - percentage);

  return (
    <div className="gauge-card">
      <div className="gauge-title">{spec.label}</div>
      <div className="gauge-container">
        <svg className="gauge-svg" width="140" height="140" viewBox="0 0 140 140">
          {/* 배경 원 */}
          <circle
            className="gauge-bg"
            cx="70"
            cy="70"
            r={radius}
          />
          {/* 진행 원 */}
          <circle
            className="gauge-fill"
            cx="70"
            cy="70"
            r={radius}
            stroke={band.color}
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
          />
        </svg>
        <div className="gauge-value">
          <div className={`gauge-number status-${band.level}`}>
            {Math.round(value)}
          </div>
          <div className="gauge-unit">{spec.unit}</div>
        </div>
      </div>
    </div>
  );
}

