
import React from 'react';
import { Metric } from '../types';

const MetricCard: React.FC<Metric> = ({ label, value, subValue, trend, accent }) => {
  return (
    <div className="bg-[#1C2128] border border-gray-800/50 p-6 rounded-xl flex flex-col justify-between shadow-xl min-h-[160px]">
      <h3 className="text-gray-500 text-[11px] font-bold uppercase tracking-[0.15em] mb-4">{label}</h3>
      <div className="flex items-baseline space-x-3">
        <span className={`text-6xl font-bold mono tracking-tighter ${accent ? 'text-[#00D100]' : 'text-gray-100'}`}>
          {value}
        </span>
        {subValue && (
          <div className={`flex items-center space-x-1 pb-2 ${trend === 'down' ? 'text-[#EF4444]' : 'text-[#00D100]'}`}>
            {trend === 'up' && <i className="fas fa-arrow-up text-xs"></i>}
            {trend === 'down' && <i className="fas fa-arrow-down text-xs"></i>}
            <span className="text-base font-bold mono">{subValue}</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default MetricCard;
