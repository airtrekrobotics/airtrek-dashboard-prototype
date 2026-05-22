
import React from 'react';
import { TowLog } from '../types';
import { getTrajectory } from '../constants';

interface Props {
  log: TowLog | null;
  onClose: () => void;
}

const TowDetailDrawer: React.FC<Props> = ({ log, onClose }) => {
  if (!log) return null;

  const eventCount = log.details?.events || 0;
  const trajectory = getTrajectory(log.details?.path);

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] transition-opacity duration-300"
        onClick={onClose}
      />
      
      {/* Drawer */}
      <div className="fixed top-0 right-0 h-full w-full max-w-2xl bg-[#0B0E14] border-l border-gray-800 shadow-2xl z-[70] transform transition-transform duration-300 ease-in-out overflow-y-auto">
        <div className="p-6 flex flex-col min-h-full">
          
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-white mono uppercase tracking-tight">
              Tow Detail - <span className="text-[#FF4D00]">{log.tailNumber}</span>
            </h2>
            <div className="flex items-center space-x-4">
              <button className="px-4 py-1.5 border border-[#FF4D00] text-[#FF4D00] text-xs font-bold uppercase tracking-widest rounded hover:bg-[#FF4D00]/10 transition-colors">
                Flag for Review
              </button>
              <button onClick={onClose} className="text-gray-500 hover:text-white p-2">
                <i className="fas fa-times text-xl"></i>
              </button>
            </div>
          </div>

          {/* Video Placeholder */}
          <div className="relative aspect-video bg-[#161B22] rounded-xl overflow-hidden mb-6 border border-gray-800 shadow-inner">
            <div className="absolute inset-0 flex items-center justify-center">
              <img
                src={`${import.meta.env.BASE_URL}mission-footage.jpg`}
                className="w-full h-full object-cover opacity-90"
                alt="Mission footage"
              />
              <div className="absolute inset-0 bg-black/30" />
              <div className="w-16 h-16 bg-white/10 rounded-full flex items-center justify-center backdrop-blur-sm border border-white/20 hover:bg-white/20 transition-all cursor-pointer group">
                <i className="fas fa-play text-white text-2xl group-hover:scale-110 transition-transform ml-1"></i>
              </div>
            </div>
            
            {/* Playback Controls */}
            <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/90 to-transparent">
              <div className="flex items-center space-x-4">
                <i className="fas fa-pause text-white text-[10px]"></i>
                <div className="flex-1 h-1 bg-gray-800 rounded-full relative">
                   {/* Background progress */}
                   <div className="h-full bg-white/40 w-[62%] rounded-full"></div>
                   
                   {/* Event Markers (Linked to log.details.events) */}
                   {Array.from({ length: eventCount }).map((_, idx) => (
                      <div 
                        key={idx}
                        className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-yellow-400 rounded-sm transform rotate-45 shadow-[0_0_8px_rgba(250,204,21,0.6)] z-10"
                        style={{ left: `${20 + (idx * (40 / Math.max(1, eventCount)))}%` }}
                      ></div>
                   ))}
                </div>
                <div className="flex space-x-3 text-white text-[10px] mono">
                  <i className="fas fa-volume-up opacity-70"></i>
                  <i className="fas fa-expand opacity-70"></i>
                </div>
              </div>
              <div className="mt-2 flex justify-center">
                <span className="bg-[#1C2128] text-[9px] font-black text-gray-400 px-2 py-0.5 rounded border border-gray-700 uppercase tracking-tighter">
                  {eventCount > 0 ? `Analysis: ${eventCount} Event(s) Flagged` : 'Nominal Session Analysis'}
                </span>
              </div>
            </div>
          </div>

          {/* Camera Controls - Updated Labels and Styling */}
          <div className="flex space-x-2 mb-6">
            <button className="flex-1 py-2.5 bg-[#1E3A8A]/30 text-blue-300 text-[10px] font-black uppercase tracking-[0.15em] rounded-md border border-blue-500/40 shadow-[inset_0_0_10px_rgba(59,130,246,0.1)]">
              LEFT WING
            </button>
            <button className="flex-1 py-2.5 bg-gray-900/40 text-gray-500 text-[10px] font-black uppercase tracking-[0.15em] rounded-md border border-gray-800 hover:text-gray-300 hover:border-gray-700 transition-colors">
              RIGHT WING
            </button>
            <button className="flex-1 py-2.5 bg-gray-900/40 text-gray-500 text-[10px] font-black uppercase tracking-[0.15em] rounded-md border border-gray-800 hover:text-gray-300 hover:border-gray-700 transition-colors">
              SENSOR OVERLAY
            </button>
          </div>

          {/* Map Section — facility map with this mission's GPS trajectory */}
          <div className="relative w-full aspect-[1672/941] bg-[#1A1D23] rounded-xl border border-gray-800 overflow-hidden mb-10 shadow-2xl">
            <img
              src={`${import.meta.env.BASE_URL}facility-map.jpg`}
              alt="Facility map"
              className="absolute inset-0 w-full h-full object-cover"
            />

            {/* Trajectory line (coords are % of the map) */}
            {trajectory.length > 1 && (
              <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                <polyline
                  points={trajectory.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke="#00D1FF"
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeLinejoin="miter"
                  vectorEffect="non-scaling-stroke"
                  className="drop-shadow-[0_0_6px_#00D1FF]"
                />
              </svg>
            )}

            {/* Origin dot + robot marker (HTML so they stay perfectly round) */}
            {trajectory.length > 1 && (
              <>
                <div
                  className="absolute w-2 h-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#00D1FF]/70 border border-white/50"
                  style={{ left: `${trajectory[0].x}%`, top: `${trajectory[0].y}%` }}
                />
                <div
                  className="absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${trajectory[trajectory.length - 1].x}%`, top: `${trajectory[trajectory.length - 1].y}%` }}
                >
                  <span className="absolute left-1/2 top-1/2 w-9 h-9 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#007BFF]/30 animate-ping" />
                  <span className="relative block w-5 h-5 rounded-full bg-[#007BFF] border-2 border-[#00D1FF] shadow-[0_0_10px_#00D1FF] flex items-center justify-center">
                    <i className="fas fa-location-arrow text-white text-[8px]"></i>
                  </span>
                </div>
              </>
            )}

            {/* Labels */}
            <div className="absolute top-4 left-4 flex flex-col space-y-2 pointer-events-none">
              <div className="flex items-center space-x-2 bg-black/40 backdrop-blur-md px-2 py-1 rounded border border-white/10">
                <div className="w-2 h-2 rounded-full bg-[#00D1FF]"></div>
                <span className="text-[9px] font-black text-white uppercase tracking-widest">Robot Active</span>
              </div>
              <div className="flex items-center space-x-2 bg-black/40 backdrop-blur-md px-2 py-1 rounded border border-white/10">
                <div className="w-2 h-2 rounded-full bg-[#007BFF]"></div>
                <span className="text-[9px] font-black text-white uppercase tracking-widest">{log.tailNumber} Pos</span>
              </div>
            </div>

            {/* Route caption */}
            <div className="absolute bottom-3 right-3 bg-black/50 backdrop-blur-md px-3 py-1 rounded border border-white/10 pointer-events-none">
              <span className="text-[9px] font-bold text-[#00D1FF] uppercase tracking-widest mono">{log.details?.path}</span>
            </div>
          </div>

          {/* Stats Section - Refined sizes and alignment based on photo */}
          <div className="w-full mb-8 px-2">
            <div className="grid grid-cols-4 gap-4 items-start">
              <div className="flex flex-col">
                <span className="text-[#4F5B6B] text-[10px] font-bold uppercase tracking-[0.1em] mb-4 h-8 flex items-end">Total<br/>Distance</span>
                <span className="text-white text-2xl mono font-bold tracking-tight">{log.details?.distance}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[#4F5B6B] text-[10px] font-bold uppercase tracking-[0.1em] mb-4 h-8 flex items-end">Max<br/>Velocity</span>
                <span className="text-white text-2xl mono font-bold tracking-tight">{log.details?.maxSpeed}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[#4F5B6B] text-[10px] font-bold uppercase tracking-[0.1em] mb-4 h-8 flex items-end">Event<br/>Detected</span>
                <span className="text-white text-2xl mono font-bold tracking-tight">{log.details?.events}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[#4F5B6B] text-[10px] font-bold uppercase tracking-[0.1em] mb-4 h-8 flex items-end">Battery<br/>End</span>
                <span className="text-[#00D100] text-2xl mono font-bold tracking-tight">{log.details?.batteryEnd}</span>
              </div>
            </div>
          </div>

          {/* Route Section */}
          <div className="px-5 py-4 bg-[#1C2128]/40 rounded-xl border border-gray-800/60 flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="w-9 h-9 bg-gray-900 rounded-lg flex items-center justify-center text-gray-500 border border-gray-800">
                <i className="fas fa-route text-xs"></i>
              </div>
              <div>
                <h4 className="text-gray-500 text-[10px] font-black uppercase tracking-[0.2em] mb-0.5">Assigned Route</h4>
                <p className="text-gray-200 text-sm mono font-bold tracking-tight">{log.details?.path}</p>
              </div>
            </div>
            <div className="flex items-center space-x-2 px-3 py-1 bg-[#00D100]/5 border border-[#00D100]/20 rounded-lg">
               <div className="w-1.5 h-1.5 rounded-full bg-[#00D100] animate-pulse"></div>
               <span className="text-[10px] font-bold text-[#00D100] uppercase tracking-widest">Nominal</span>
            </div>
          </div>

          {/* Footer Copy */}
          <div className="mt-auto pt-8 flex justify-center pb-2 opacity-10">
            <p className="text-[9px] font-black text-gray-400 uppercase tracking-[0.4em]">AIRTREK MISSION CONTROL - {log.id}</p>
          </div>

        </div>
      </div>
    </>
  );
};

export default TowDetailDrawer;
