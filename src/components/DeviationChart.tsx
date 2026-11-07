import { GOOD_MS, PERFECT_MS, grade } from '../core/timing';

const RANGE = 150; // ms shown on each side
const W = 320;
const H = 64;

const x = (ms: number) => W / 2 + (Math.max(-RANGE, Math.min(RANGE, ms)) / RANGE) * (W / 2 - 8);

export function DeviationChart({ deviations }: { deviations: readonly number[] }) {
  const recent = deviations.slice(-24);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Отклонения тапов">
      <rect className="zone-good" x={x(-GOOD_MS)} y={6} width={x(GOOD_MS) - x(-GOOD_MS)} height={40} rx={4} />
      <rect
        className="zone-perfect"
        x={x(-PERFECT_MS)}
        y={6}
        width={x(PERFECT_MS) - x(-PERFECT_MS)}
        height={40}
        rx={4}
      />
      <line className="center" x1={W / 2} x2={W / 2} y1={2} y2={50} />
      {recent.map((d, i) => {
        const last = i === recent.length - 1;
        return (
          <circle
            key={deviations.length - recent.length + i}
            className={`dot ${grade(d)}`}
            cx={x(d)}
            cy={26}
            r={last ? 7 : 4.5}
            opacity={last ? 1 : 0.25 + (0.6 * i) / recent.length}
          />
        );
      })}
      <text className="axis" x={8} y={62}>
        рано −{RANGE}
      </text>
      <text className="axis" x={W / 2} y={62} textAnchor="middle">
        0
      </text>
      <text className="axis" x={W - 8} y={62} textAnchor="end">
        +{RANGE} поздно
      </text>
    </svg>
  );
}
