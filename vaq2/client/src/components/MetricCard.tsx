import Gauge from "./Gauge";
import { getBand, levelLabel, METRICS, MetricKey, mapLegacyMetric } from "../thresholds";
import { MiniChart } from './MiniChart';

type Props = {
  room: string;
  metric: string; // legacy metric name (temperature, humidity, etc.)
  value: number;
  // 선택: 게이지 상단/하단 범위(없으면 자동)
  gaugeMax?: number;
};

function guessGaugeMax(metric: MetricKey) {
  // 멀리서 보이는 목적 → 범위 고정이 안정적
  // 원하시면 기준표 기반으로 자동 계산(veryBad.min * 1.2 등)으로 바꿀 수 있어요.
  switch (metric) {
    case "pm10": return 250;
    case "pm25": return 150;
    case "co2": return 2500;
    case "voc": return 1500;
    case "hcho": return 250;
    case "co": return 30;
    case "temp": return 40;
    case "hum": return 100;
  }
}

function MetricCard({ room, metric, value, gaugeMax }: Props) {
  const metricKey = mapLegacyMetric(metric);
  if (!metricKey) {
    // legacy metric (noise, airflow 등) 처리
    return null;
  }

  const spec = METRICS[metricKey];
  const band = getBand(metricKey, value);
  const max = gaugeMax ?? guessGaugeMax(metricKey);

  const cardClass = `metric-card ${band.blink ? "blink" : ""}`;

  return (
    <div className={cardClass} style={{ borderColor: band.color }}>
      <div className="metric-header">
        <div className="metric-title">{spec.label}</div>
        <div className="metric-level" style={{ background: band.color }}>
          {levelLabel(band.level)}
        </div>
      </div>

      <div className="metric-body">
        <Gauge
          value={value}
          min={0}
          max={max}
          color={band.color}
          size={190}          // ✅ 크게
          strokeWidth={18}    // ✅ 두껍게
        />

        <div className="metric-value-wrap">
          <div className="metric-value">{Number.isFinite(value) ? value.toFixed(0) : "-"}</div>
          <div className="metric-unit">{spec.unit}</div>
        </div>
      </div>

      {/* 미니 차트 */}
      <div className="metric-chart">
        <MiniChart room={room} metric={metric} />
      </div>
    </div>
  );
}

export default MetricCard;
