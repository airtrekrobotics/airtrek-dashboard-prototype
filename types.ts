
export interface TowLog {
  id: string;
  dateTime: string;
  tailNumber: string;
  duration: string;
  operator: string;
  tug: string;
  status: 'online' | 'offline' | 'warning';
  details?: {
    distance: string;
    maxSpeed: string;
    events: number;
    eventTimes?: string[];
    batteryEnd: string;
    path: string;
  };
}

export interface Metric {
  label: string;
  value: string | number;
  subValue?: string;
  trend?: 'up' | 'down';
  accent?: boolean;
}
