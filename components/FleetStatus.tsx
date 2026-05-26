import React, { useMemo } from 'react';
import { TowLog } from '../types';
import { TUGS } from '../constants';

interface Props {
  logs: TowLog[];
}

const ROBOTS = [
  { name: 'Robot 01', battery: 94 },
  { name: 'Robot 02', battery: 88 },
];

const TUG_IMAGES: Record<string, string> = {
  Lektro: 'lektro.png',
  Mototok: 'mototok.png',
  Harlan: 'harlan.png',
  Towflexx: 'towflexx.png',
};

const TUG_LOCATIONS: Record<string, string> = {
  Lektro: 'Hangar 3',
  Mototok: 'Hangar 3',
  Harlan: 'Hangar 1',
  Towflexx: 'Hangar 3',
};

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-center justify-between">
    <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#4F5B6B]">{label}</span>
    {children}
  </div>
);

const FleetStatus: React.FC<Props> = ({ logs }) => {
  const base = import.meta.env.BASE_URL;
  const total = logs.length;

  const tugCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const l of logs) counts[l.tug] = (counts[l.tug] || 0) + 1;
    return counts;
  }, [logs]);

  return (
    <main className="p-10 max-w-[1400px] w-full">
      {/* Robots */}
      <section className="mb-12">
        <div className="flex items-center space-x-3 mb-8">
          <h2 className="text-xl font-bold text-white tracking-tight mono uppercase text-sm">Robots</h2>
          <div className="h-px flex-1 bg-gray-800/50"></div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {ROBOTS.map((r) => (
            <div
              key={r.name}
              className="bg-[#161B22]/60 border border-gray-800/60 rounded-2xl p-6 flex items-center gap-6"
            >
              <img
                src={`${base}robot.png`}
                alt="Wingwalking robot"
                className="w-[140px] h-[140px] object-contain shrink-0"
              />
              <div className="flex-1 min-w-0">
                <h3 className="text-white font-bold mono uppercase tracking-tight mb-5">{r.name}</h3>
                <div className="space-y-3">
                  <Row label="Battery">
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                        <div className="h-full bg-[#00D100]" style={{ width: `${r.battery}%` }} />
                      </div>
                      <span className="text-white mono text-sm font-bold w-10 text-right">{r.battery}%</span>
                    </div>
                  </Row>
                  <Row label="Number of Tows">
                    <span className="text-white mono text-sm font-bold">{total.toLocaleString()}</span>
                  </Row>
                  <Row label="Condition">
                    <span className="text-[#00D100] text-sm font-bold">Good</span>
                  </Row>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Tugs */}
      <section>
        <div className="flex items-center space-x-3 mb-8">
          <h2 className="text-xl font-bold text-white tracking-tight mono uppercase text-sm">Tugs</h2>
          <div className="h-px flex-1 bg-gray-800/50"></div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {TUGS.map((name) => {
            const big = name === 'Harlan'; // shown 25% larger
            return (
              <div key={name} className="bg-[#161B22]/60 border border-gray-800/60 rounded-2xl p-6">
                <div className={`${big ? 'h-[140px]' : 'h-28'} flex items-center justify-center mb-4`}>
                  <img
                    src={`${base}${TUG_IMAGES[name]}`}
                    alt={name}
                    className={`${big ? 'max-h-[140px]' : 'max-h-28'} max-w-full object-contain`}
                  />
                </div>
                <h3 className="text-white font-bold mono uppercase tracking-tight mb-4">{name}</h3>
                <div className="space-y-3">
                  <Row label="Number of Tows">
                    <span className="text-white mono text-sm font-bold">
                      {(tugCounts[name] || 0).toLocaleString()}
                    </span>
                  </Row>
                  <Row label="Location">
                    <span className="text-gray-300 text-sm font-bold">{TUG_LOCATIONS[name]}</span>
                  </Row>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
};

export default FleetStatus;
