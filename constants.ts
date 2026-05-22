
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

export const MOCK_LOGS: TowLog[] = [
  { 
    id: '1', 
    dateTime: '2026-02-03 10:02', 
    tailNumber: 'N412EF', 
    duration: '23m', 
    operator: 'C. Lee', 
    status: 'online',
    details: { distance: '450 ft', maxSpeed: '3.4 mph', events: 1, batteryEnd: '84%', path: 'Hangar 1 -> Ramp' }
  },
  { 
    id: '2', 
    dateTime: '2026-02-02 15:48', 
    tailNumber: 'N715SD', 
    duration: '12m', 
    operator: 'H. Dossaji', 
    status: 'online',
    details: { distance: '320 ft', maxSpeed: '4.0 mph', events: 0, batteryEnd: '92%', path: 'Hangar 2 -> Hangar 3' }
  },
  { 
    id: '3', 
    dateTime: '2026-02-01 13:11', 
    tailNumber: 'N342AT', 
    duration: '15m', 
    operator: 'J. Taylor', 
    status: 'online',
    details: { distance: '410 ft', maxSpeed: '3.6 mph', events: 0, batteryEnd: '78%', path: 'Ramp -> Hangar 1' }
  },
  { 
    id: '4', 
    dateTime: '2026-02-01 06:58', 
    tailNumber: 'N102QX', 
    duration: '20m', 
    operator: 'D. Ladnier', 
    status: 'online',
    details: { distance: '500 ft', maxSpeed: '4.2 mph', events: 2, batteryEnd: '65%', path: 'Hangar 3 -> Ramp' }
  },
  { 
    id: '5', 
    dateTime: '2026-01-31 18:23', 
    tailNumber: 'N586BJ', 
    duration: '18m', 
    operator: 'J. Doe',
    status: 'online',
    details: { distance: '380 ft', maxSpeed: '3.1 mph', events: 0, batteryEnd: '88%', path: 'Hangar 1 -> Hangar 2' }
  },
  { 
    id: '6', 
    dateTime: '2026-01-31 14:12', 
    tailNumber: 'N994LL', 
    duration: '25m', 
    operator: 'M. Chen',
    status: 'online',
    details: { distance: '520 ft', maxSpeed: '3.8 mph', events: 0, batteryEnd: '72%', path: 'Hangar 2 -> Ramp' }
  },
  { 
    id: '7', 
    dateTime: '2026-01-31 09:45', 
    tailNumber: 'N812XP', 
    duration: '14m', 
    operator: 'S. Ramos', 
    status: 'online',
    details: { distance: '310 ft', maxSpeed: '3.3 mph', events: 0, batteryEnd: '91%', path: 'Ramp -> Hangar 3' }
  },
];

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
