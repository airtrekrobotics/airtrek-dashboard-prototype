
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
    details: { distance: '450 ft', maxSpeed: '2.1 mph', events: 1, batteryEnd: '84%', path: 'Hangar 1 -> Ramp' }
  },
  { 
    id: '2', 
    dateTime: '2026-02-02 15:48', 
    tailNumber: 'N715SD', 
    duration: '12m', 
    operator: 'H. Dossaji', 
    status: 'online',
    details: { distance: '320 ft', maxSpeed: '1.8 mph', events: 0, batteryEnd: '92%', path: 'Hangar 2 -> Hangar 3' }
  },
  { 
    id: '3', 
    dateTime: '2026-02-01 13:11', 
    tailNumber: 'N342AT', 
    duration: '15m', 
    operator: 'J. Taylor', 
    status: 'online',
    details: { distance: '410 ft', maxSpeed: '2.0 mph', events: 0, batteryEnd: '78%', path: 'Ramp -> Hangar 1' }
  },
  { 
    id: '4', 
    dateTime: '2026-02-01 06:58', 
    tailNumber: 'N102QX', 
    duration: '20m', 
    operator: 'D. Ladnier', 
    status: 'online',
    details: { distance: '500 ft', maxSpeed: '2.2 mph', events: 2, batteryEnd: '65%', path: 'Hangar 3 -> Ramp' }
  },
  { 
    id: '5', 
    dateTime: '2026-01-31 18:23', 
    tailNumber: 'N586BJ', 
    duration: '18m', 
    operator: 'J. Doe',
    status: 'online',
    details: { distance: '380 ft', maxSpeed: '1.9 mph', events: 0, batteryEnd: '88%', path: 'Hangar 1 -> Hangar 2' }
  },
  { 
    id: '6', 
    dateTime: '2026-01-31 14:12', 
    tailNumber: 'N994LL', 
    duration: '25m', 
    operator: 'M. Chen',
    status: 'online',
    details: { distance: '520 ft', maxSpeed: '2.3 mph', events: 0, batteryEnd: '72%', path: 'Hangar 2 -> Ramp' }
  },
  { 
    id: '7', 
    dateTime: '2026-01-31 09:45', 
    tailNumber: 'N812XP', 
    duration: '14m', 
    operator: 'S. Ramos', 
    status: 'online',
    details: { distance: '310 ft', maxSpeed: '1.7 mph', events: 0, batteryEnd: '91%', path: 'Ramp -> Hangar 3' }
  },
];

export interface MapPoint {
  x: number;
  y: number;
}

// Positions on public/facility-map.jpg, as percentages (x = left%, y = top%).
// Each hangar point is its north-facing door; aircraft stay north of the
// hangars, so trajectories travel along a lane north of these doors.
const HANGAR_ZONES: Record<string, MapPoint> = {
  'Hangar 1': { x: 14, y: 52 },
  'Hangar 2': { x: 35, y: 52 },
  'Hangar 3': { x: 56, y: 57 },
  'Hangar 4': { x: 70, y: 57 },
  'Hangar 5': { x: 85, y: 57 },
};

const TRAVEL_LANE_Y = 45; // east-west lane, north of every hangar door
const RAMP_APRON_Y = 22; // open apron, further north

// "Ramp" isn't a fixed point — it resolves to the open apron directly north of
// its partner hangar, so each route reads as pulling straight out / in.
const resolveZone = (name: string, partner: string): MapPoint => {
  const zone = HANGAR_ZONES[name];
  if (zone) return zone;
  const partnerZone = HANGAR_ZONES[partner];
  return { x: partnerZone ? partnerZone.x : 50, y: RAMP_APRON_Y };
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
