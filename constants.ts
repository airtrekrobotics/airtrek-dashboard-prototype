import { TowLog } from './types';

export const COLORS = {
  primary: '#FF4D00',
  bg: '#0B0E14',
  card: '#161B22',
  text: '#E2E8F0',
  success: '#00D100',
  warning: '#FBBF24',
  error: '#EF4444',
};

export interface MapPoint {
  x: number;
  y: number;
}

// Hangar CENTER positions on public/facility-map.jpg, as percentages.
// Aircraft park inside the hangar (its center) and are towed north out the
// door, so trajectories run from the center up to a lane north of the hangars.
const HANGAR_ZONES: Record<string, MapPoint> = {
  'Hangar 1': { x: 14, y: 64 },
  'Hangar 2': { x: 35, y: 63 },
  'Hangar 3': { x: 56, y: 69 },
  'Hangar 4': { x: 70, y: 69 },
  'Hangar 5': { x: 85, y: 69 },
};

const TRAVEL_LANE_Y = 42; // east-west taxi lane, north of every hangar
const RAMP_APRON_Y = 24; // parking apron, further north

// "Ramp" resolves to an apron spot offset to the side of its partner hangar,
// so the route bends into an L (with 90-degree turns) instead of going
// straight, and different missions land on different spots.
const resolveZone = (name: string, partner: string): MapPoint => {
  const zone = HANGAR_ZONES[name];
  if (zone) return zone;
  const partnerZone = HANGAR_ZONES[partner];
  const px = partnerZone ? partnerZone.x : 50;
  const rampX = px < 50 ? Math.min(px + 18, 82) : Math.max(px - 18, 18);
  return { x: rampX, y: RAMP_APRON_Y };
};

// Build the GPS trajectory for a route string like "Hangar 1 -> Ramp".
// Path: out of the start, north to the travel lane, across, into the end.
export const getTrajectory = (path?: string): MapPoint[] => {
  if (!path) return [];
  const [from, to] = path.split('->').map((s) => s.trim());
  if (!from || !to) return [];
  const start = resolveZone(from, to);
  const end = resolveZone(to, from);
  return [
    start,
    { x: start.x, y: TRAVEL_LANE_Y },
    { x: end.x, y: TRAVEL_LANE_Y },
    end,
  ];
};

// Daily tow counts for the last 30 days (oldest -> newest). Sums to 538 to
// match the "Total Tows (30D)" metric card.
export const DAILY_30D: number[] = [22, 19, 23, 27, 17, 8, 14, 17, 21, 25, 16, 24, 9, 6, 17, 22, 22, 17, 19, 7, 14, 22, 16, 25, 17, 19, 16, 16, 25, 16];

// Average tows per hour across the 30 days, index = hour 0..23. Bimodal:
// peaks in the morning (06:00-09:00) and afternoon (16:00-19:00).
export const HOURLY_AVG: number[] = [0.1, 0.1, 0.1, 0.1, 0.1, 0.5, 1.4, 1.7, 1.7, 1.4, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 1.3, 1.6, 1.6, 1.3, 0.4, 0.4, 0.4, 0.1];

// ---------------------------------------------------------------------------
// Mock database. Generated deterministically (seeded) so the dataset — and the
// metrics derived from it — are identical on every load. Date range Apr 1 ->
// May 25 2026; the last 30 days follow DAILY_30D and hours follow HOURLY_AVG,
// so the dataset matches both charts.
// ---------------------------------------------------------------------------

// mulberry32 PRNG
const makeRng = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const OPERATORS = ['Chris Lee', 'Huzefa Dossaji', 'Jon Taylor', 'David Ladnier'];
const ZONES = ['Hangar 1', 'Hangar 2', 'Hangar 3', 'Hangar 4', 'Hangar 5', 'Ramp'];

const MS_DAY = 86400000;
const TODAY = new Date(2026, 4, 25); // May 25, 2026
const START = new Date(2026, 3, 1); // Apr 1, 2026

const pad = (n: number) => String(n).padStart(2, '0');
const fmtDateTime = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

// Realistic FAA-style tail numbers (no I/O letters), reused across missions.
const buildTails = (rng: () => number, count: number): string[] => {
  const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const tails = new Set<string>();
  while (tails.size < count) {
    const num = 100 + Math.floor(rng() * 900);
    const a = L[Math.floor(rng() * L.length)];
    const b = L[Math.floor(rng() * L.length)];
    tails.add(`N${num}${a}${b}`);
  }
  return [...tails];
};

// Pick an hour weighted by the bimodal HOURLY_AVG distribution.
const pickHour = (rng: () => number): number => {
  const total = HOURLY_AVG.reduce((s, v) => s + v, 0);
  let r = rng() * total;
  for (let h = 0; h < 24; h++) {
    r -= HOURLY_AVG[h];
    if (r <= 0) return h;
  }
  return 23;
};

// Manhattan length of a route's trajectory, in map-percent units.
const trajLength = (route: string): number => {
  const pts = getTrajectory(route);
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.abs(pts[i].x - pts[i - 1].x) + Math.abs(pts[i].y - pts[i - 1].y);
  }
  return len;
};

const generateLogs = (): TowLog[] => {
  const rngCount = makeRng(99); // drives only the earlier-period daily counts
  const rng = makeRng(20260525); // drives all per-mission fields
  const tails = buildTails(rng, 32);
  const logs: TowLog[] = [];
  let id = 0;

  for (let d = new Date(START); d <= TODAY; d = new Date(d.getTime() + MS_DAY)) {
    const daysAgo = Math.round((TODAY.getTime() - d.getTime()) / MS_DAY);
    let count: number;
    if (daysAgo <= 29) {
      count = DAILY_30D[29 - daysAgo]; // last 30 days follow the chart exactly
    } else {
      const dow = d.getDay();
      const base = dow === 0 || dow === 6 ? 11 : 19;
      count = Math.max(5, base + Math.floor(rngCount() * 9) - 4);
    }

    for (let k = 0; k < count; k++) {
      id++;
      const dt = new Date(d);
      dt.setHours(pickHour(rng), Math.floor(rng() * 60), 0, 0);

      const durMin = 15 + Math.floor(rng() * 11); // 15..25 min
      const operator = OPERATORS[Math.floor(rng() * OPERATORS.length)];
      const tail = tails[Math.floor(rng() * tails.length)];

      const from = ZONES[Math.floor(rng() * ZONES.length)];
      let to = ZONES[Math.floor(rng() * ZONES.length)];
      while (to === from) to = ZONES[Math.floor(rng() * ZONES.length)];
      const route = `${from} -> ${to}`;

      const maxSpeed = (2.5 + rng() * 1.5).toFixed(1); // 2.5..4.0 mph
      const distance = Math.min(1000, Math.round(trajLength(route) * 8 + rng() * 60 - 20));
      const battery = 60 + Math.floor(rng() * 36); // 60..95 %

      const er = rng();
      const nEvents = er < 0.58 ? 0 : er < 0.82 ? 1 : er < 0.93 ? 2 : 3;
      const durSec = durMin * 60;
      const eventTimes = Array.from({ length: nEvents }, () => Math.floor(rng() * durSec))
        .sort((x, y) => x - y)
        .map((s) => `${pad(Math.floor(s / 60))}:${pad(s % 60)}`);

      logs.push({
        id: String(id),
        dateTime: fmtDateTime(dt),
        tailNumber: tail,
        duration: `${durMin}m`,
        operator,
        status: 'online',
        details: {
          distance: `${distance} ft`,
          maxSpeed: `${maxSpeed} mph`,
          events: nEvents,
          eventTimes,
          batteryEnd: `${battery}%`,
          path: route,
        },
      });
    }
  }

  logs.sort((a, b) => b.dateTime.localeCompare(a.dateTime)); // newest first
  return logs;
};

export const MOCK_LOGS: TowLog[] = generateLogs();

// Metrics derived from the generated database so the cards always match it.
const computeMetrics = (logs: TowLog[]) => {
  const may1 = new Date(2026, 4, 1).getTime();
  const cutoff30 = TODAY.getTime() - 29 * MS_DAY; // Apr 26 00:00
  let mtd = 0;
  let last30 = 0;
  let durSum = 0;
  for (const l of logs) {
    const t = new Date(l.dateTime.replace(' ', 'T')).getTime();
    if (t >= may1) mtd++;
    if (t >= cutoff30) {
      last30++;
      durSum += parseInt(l.duration, 10) || 0;
    }
  }
  const avgMin = last30 ? durSum / last30 : 0;
  const m = Math.floor(avgMin);
  const s = Math.round((avgMin - m) * 60);
  return { mtd, last30, avgTowTime: `${m}m ${pad(s)}s`, total: logs.length };
};

export const DASHBOARD_METRICS = computeMetrics(MOCK_LOGS);
