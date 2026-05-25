
import React, { useState } from 'react';
import Sidebar, { View } from './components/Sidebar';
import MetricCard from './components/MetricCard';
import LogsTable from './components/LogsTable';
import AIChat from './components/AIChat';
import TowDetailDrawer from './components/TowDetailDrawer';
import TowTrendChart from './components/TowTrendChart';
import HistoryView from './components/HistoryView';
import { MOCK_LOGS, DASHBOARD_METRICS, LAST_30_DAYS_LOGS } from './constants';
import { TowLog } from './types';

const App: React.FC = () => {
  const [view, setView] = useState<View>('dashboard');
  const [logs] = useState(MOCK_LOGS);
  const [selectedTow, setSelectedTow] = useState<TowLog | null>(null);

  const handleRowClick = (log: TowLog) => {
    setSelectedTow(log);
  };

  const closeDrawer = () => {
    setSelectedTow(null);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[#0B0E14] text-[#E2E8F0]">
      {/* Sidebar Navigation */}
      <Sidebar view={view} onNavigate={setView} />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-y-auto">
        
        {/* Top Header Bar */}
        <header className="h-16 border-b border-gray-800/40 flex items-center justify-between px-10 bg-[#0B0E14]/80 backdrop-blur-md sticky top-0 z-10">
          <div className="flex items-center lg:hidden">
            <img
              src={`${import.meta.env.BASE_URL}logo.png`}
              alt="Airtrek Robotics"
              className="h-8 w-auto object-contain"
            />
          </div>
          
          <div className="hidden lg:flex items-center space-x-2 text-gray-500">
            <i className="fas fa-terminal text-[10px]"></i>
            <span className="text-[10px] font-bold uppercase tracking-[0.2em]">Live Telemetry Feed</span>
          </div>
          
          <div className="flex items-center space-x-6">
            <div className="flex items-center space-x-3 pr-4 border-r border-gray-800">
              <span className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">V2.4.0-Stable</span>
            </div>
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center text-[10px] font-bold text-gray-400">
                ADMIN
              </div>
            </div>
          </div>
        </header>

        {/* Main content switches by sidebar view */}
        {view === 'dashboard' && (
        <main className="p-10 max-w-[1400px] w-full">
          
          <section className="mb-12">
            <div className="flex items-center space-x-3 mb-8">
              <h2 className="text-xl font-bold text-white tracking-tight mono uppercase text-sm">Key Metrics</h2>
              <div className="h-px flex-1 bg-gray-800/50"></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <MetricCard 
                label="Total Tows (MTD)" 
                value={String(DASHBOARD_METRICS.mtd)}
              />
              <MetricCard 
                label="Total Tows (30D)" 
                value={String(DASHBOARD_METRICS.last30)}
                subValue="5%" 
                trend="up" 
              />
              <MetricCard
                label="Avg. Tow Time"
                value={DASHBOARD_METRICS.avgTowTime}
                accent={true}
              />
            </div>

            <TowTrendChart />
          </section>

          <section className="mb-12">
            <div className="flex items-center space-x-3 mb-8">
              <h2 className="text-xl font-bold text-white tracking-tight mono uppercase text-sm">Last 30 Days</h2>
              <div className="h-px flex-1 bg-gray-800/50"></div>
            </div>
            <LogsTable logs={LAST_30_DAYS_LOGS} onRowClick={handleRowClick} />
          </section>

          {/* System Announcement Footer Area */}
          <footer className="mt-12 pt-8 border-t border-gray-800/50 flex flex-col md:flex-row md:items-center justify-between gap-6 opacity-60 hover:opacity-100 transition-opacity">
            <div className="flex items-center space-x-4">
               <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center text-[#FF4D00]">
                 <i className="fas fa-shield-alt text-lg"></i>
               </div>
               <div>
                 <h4 className="text-xs font-bold text-white uppercase tracking-wider">Automated Safety Protocol</h4>
                 <p className="text-[11px] text-gray-500">All autonomous towing operations are monitored 24/7 by our central command.</p>
               </div>
            </div>
            <div className="text-[10px] font-bold text-gray-600 tracking-widest uppercase">
              &copy; 2026 Airtrek Robotics Inc.
            </div>
          </footer>

        </main>
        )}

        {view === 'history' && <HistoryView logs={logs} onRowClick={handleRowClick} />}

        {(view === 'fleet' || view === 'settings') && (
          <main className="flex-1 flex items-center justify-center p-10">
            <div className="text-center">
              <i className="fas fa-screwdriver-wrench text-gray-700 text-4xl mb-4"></i>
              <p className="text-gray-500 text-sm font-bold uppercase tracking-widest">
                {view === 'fleet' ? 'Robot Fleet' : 'Settings'} — Coming Soon
              </p>
            </div>
          </main>
        )}
      </div>

      {/* Detail Popup Drawer */}
      <TowDetailDrawer log={selectedTow} onClose={closeDrawer} />

      {/* AI Assistant Chatbot Overlay */}
      <AIChat logs={logs} />
    </div>
  );
};

export default App;
