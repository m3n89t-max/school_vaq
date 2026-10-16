type Props = {
  value: number;
  min?: number;
  max?: number;
  color: string;
  size?: number; // px
  strokeWidth?: number;
  label?: string;
};

export default function Gauge({
  value,
  min = 0,
  max = 100,
  color,
  size = 180,
  strokeWidth = 18,
  label,
}: Props) {
  const clamped = Math.max(min, Math.min(max, value));
  const pct = (clamped - min) / (max - min); // 0..1

  // 반원(180도) 게이지: 보기 좋고 큰 숫자와 조합이 깔끔함
  const r = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const startAngle = 180; // 왼쪽
  const endAngle = 0; // 오른쪽
  const angle = startAngle + (endAngle - startAngle) * pct;

  const polarToXY = (angleDeg: number) => {
    const rad = (Math.PI / 180) * angleDeg;
    return {
      x: cx + r * Math.cos(rad),
      y: cy + r * Math.sin(rad),
    };
  };

  const start = polarToXY(startAngle);
  const end = polarToXY(endAngle);
  const valPt = polarToXY(angle);

  const largeArc = 0; // 180도는 largeArc=0
  const sweep = 0;

  // background arc (semi-circle)
  const bgPath = `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} ${sweep} ${end.x} ${end.y}`;

  // value arc: start -> value point
  const valuePath = `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} ${sweep} ${valPt.x} ${valPt.y}`;

  return (
    <div style={{ width: size, height: size * 0.62, position: "relative" }}>
      <svg width={size} height={size} style={{ overflow: "visible" }}>
        <path d={bgPath} stroke="rgba(255,255,255,0.18)" strokeWidth={strokeWidth} fill="none" strokeLinecap="round" />
        <path d={valuePath} stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinecap="round" />

        {/* needle dot */}
        <circle cx={valPt.x} cy={valPt.y} r={strokeWidth * 0.35} fill={color} opacity={0.95} />
      </svg>

      {label ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: -6,
            textAlign: "center",
            fontSize: 14,
            opacity: 0.9,
          }}
        >
          {label}
        </div>
      ) : null}
    </div>
  );
}
