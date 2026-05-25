import React, { useState } from 'react';
import { DAILY_30D, HOURLY_AVG } from '../constants';

type Mode = '30d' | 'daily';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// Catmull-Rom -> cubic bezier, with control points clamped to the plot box so
// the smoothed curve never overshoots below the baseline or above the top.
const smoothPath = (pts: { x: number; y: number }[]): string => {
  if (pts.length < 2) return '';
  const t = 0.16;
  let d = `M ${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) * t;
    const c1y = clamp(p1.y + (p2.y - p0.y) * t, 0, 100);
    const c2x = p2.x - (p3.x - p1.x) * t;
    const c2y = clamp(p2.y - (p3.y - p1.y) * t, 0, 100);
    d += ` C ${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`;
  }
  return d;
};

const TowTrendChart: React.FC = () => {
  const [mode, setMode] = useState<Mode>('30d');
  const [hover, setHover] = useState<number | null>(null);

  const data = mode === '30d' ? DAILY_30D : HOURLY_AVG;
  const n = data.length;
  const rawMax = Math.max(...data);
  const yMax = mode === '30d' ? Math.ceil(rawMax / 4) * 4 : Math.ceil(rawMax * 2) / 2;
  const gridFractions = [1, 0.75, 0.5, 0.25, 0];

  const X = (i: number) => (i / (n - 1)) * 100;
  const Y = (v: number) => (1 - v / yMax) * 100;
  const points = data.map((v, i) => ({ x: X(i), y: Y(v) }));
  const linePath = smoothPath(points);
  const areaPath = `${linePath} L 100,100 L 0,100 Z`;

  const today = new Date();
  const dateLabel = (i: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (DAILY_30D.length - 1 - i));
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };
  const xLabel = (i: number) => (mode === '30d' ? dateLabel(i) : `${String(i).padStart(2, '0')}:00`);
  const valLabel = (i: number) =>
    mode === '30d' ? `${data[i]} tows` : `${data[i].toFixed(1)} tows/hr`;
  const fmtGrid = (v: number) => (mode === '30d' ? Math.round(v).toString() : v.toFixed(1));
  const ticks = mode === '30d' ? [0, 7, 14, 21, 29] : [0, 6, 12, 18, 23];
  const total30 = DAILY_30D.reduce((a, b) => a + b, 0);

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    setHover(clamp(Math.round(ratio * (n - 1)), 0, n - 1));
  };

  return (
    <div className="bg-[#161B22]/60 border border-gray-800/60 rounded-2xl p-6 mt-8">
      {/* Header + toggle */}
      <div className="flex items-end justify-between gap-4 flex-wrap mb-6">
        <div>
          <h3 className="text-white text-sm font-bold mono uppercase tracking-tight">
            {mode === '30d' ? 'Last 30 Days' : 'Daily Pattern'}
          </h3>
          <p className="text-gray-500 text-[11px] mt-1">
            {mode === '30d'
              ? `Daily tow counts · ${total30} total`
              : 'Avg tows per hour · 30-day average'}
          </p>
        </div>
        <div className="flex bg-gray-900/60 rounded-lg p-1 border border-gray-800">
          {([['30d', '30 Days'], ['daily', 'Daily']] as [Mode, string][]).map(([m, label]) => (
            <button
              key={m}
              onClick={() => {
                setMode(m);
                setHover(null);
              }}
              className={`px-4 py-1.5 text-[10px] font-black uppercase tracking-[0.12em] rounded-md transition-colors ${
                mode === m ? 'bg-[#FF4D00] text-white' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="flex gap-3">
        {/* Y-axis labels */}
        <div className="flex flex-col justify-between h-56 text-[9px] text-gray-600 mono text-right w-7 shrink-0">
          {gridFractions.map((f, i) => (
            <span key={i}>{fmtGrid(yMax * f)}</span>
          ))}
        </div>

        {/* Plot */}
        <div className="flex-1 min-w-0">
          <div
            className="relative h-56"
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
          >
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
              <defs>
                <linearGradient id="towArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#00D1FF" stopOpacity="0.18" />
                  <stop offset="100%" stopColor="#00D1FF" stopOpacity="0" />
                </linearGradient>
              </defs>

              {/* Gridlines */}
              {gridFractions.map((f, i) => (
                <line
                  key={i}
                  x1={0}
                  x2={100}
                  y1={(1 - f) * 100}
                  y2={(1 - f) * 100}
                  stroke="#374151"
                  strokeOpacity={0.35}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              ))}

              {/* Area + line */}
              <path d={areaPath} fill="url(#towArea)" />
              <path
                d={linePath}
                fill="none"
                stroke="#00D1FF"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />

              {/* Hover crosshair */}
              {hover !== null && (
                <line
                  x1={X(hover)}
                  x2={X(hover)}
                  y1={0}
                  y2={100}
                  stroke="#FFFFFF"
                  strokeOpacity={0.25}
                  strokeWidth={1}
                  strokeDasharray="2 2"
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </svg>

            {/* Hover dot (HTML so it stays round) */}
            {hover !== null && (
              <div
                className="absolute w-2.5 h-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white border-2 border-[#00D1FF] shadow-[0_0_8px_#00D1FF] pointer-events-none"
                style={{ left: `${X(hover)}%`, top: `${Y(data[hover])}%` }}
              />
            )}

            {/* Tooltip */}
            {hover !== null && (
              <div
                className="absolute z-20 -translate-x-1/2 -translate-y-full mb-0 whitespace-nowrap bg-[#0B0E14] border border-gray-700 rounded px-2 py-1 text-[9px] mono shadow-lg pointer-events-none"
                style={{
                  left: `${clamp(X(hover), 8, 92)}%`,
                  top: `calc(${Y(data[hover])}% - 8px)`,
                }}
              >
                <span className="text-gray-400">{xLabel(hover)}</span>{' '}
                <span className="text-white font-bold">{valLabel(hover)}</span>
              </div>
            )}
          </div>

          {/* X-axis ticks */}
          <div className="relative mt-2 h-3">
            {ticks.map((i) => (
              <span
                key={i}
                className="absolute -translate-x-1/2 text-[9px] text-gray-600 mono"
                style={{ left: `${clamp(X(i), 3, 97)}%` }}
              >
                {xLabel(i)}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TowTrendChart;
