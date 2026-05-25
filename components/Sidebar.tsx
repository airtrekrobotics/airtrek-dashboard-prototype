
import React from 'react';

export type View = 'dashboard' | 'fleet' | 'history' | 'settings';

interface Props {
  view: View;
  onNavigate: (view: View) => void;
}

const NAV_ITEMS: { icon: string; label: string; key: View }[] = [
  { icon: 'fa-chart-pie', label: 'Dashboard', key: 'dashboard' },
  { icon: 'fa-robot', label: 'Robot Fleet', key: 'fleet' },
  { icon: 'fa-history', label: 'History', key: 'history' },
  { icon: 'fa-cog', label: 'Settings', key: 'settings' },
];

const Sidebar: React.FC<Props> = ({ view, onNavigate }) => {

  return (
    <div className="w-64 bg-[#0B0E14] border-r border-gray-800 flex flex-col h-full hidden lg:flex">
      <div className="p-6">
        <img
          src={`${import.meta.env.BASE_URL}logo.png`}
          alt="Airtrek Robotics"
          className="w-full h-auto object-contain"
        />
      </div>
      
      <nav className="flex-1 mt-6 px-4 space-y-1">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.key}
            onClick={() => onNavigate(item.key)}
            className={`w-full flex items-center space-x-4 px-4 py-3 rounded-lg transition-all ${
              view === item.key
                ? 'bg-gray-800/40 text-white'
                : 'text-gray-500 hover:bg-gray-800/20 hover:text-gray-300'
            }`}
          >
            <i className={`fas ${item.icon} w-5 text-sm`}></i>
            <span className="font-semibold text-sm">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="p-6">
        <div className="bg-gray-800/20 p-4 rounded-xl border border-gray-800/50">
            <p className="text-[10px] text-gray-500 uppercase font-black mb-2 tracking-widest">System Status</p>
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              <span className="text-xs text-gray-400 font-medium">Ops Online</span>
            </div>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
