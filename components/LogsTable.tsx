
import React from 'react';
import { TowLog } from '../types';
import { downloadLogPackage } from '../services/logDownload';

interface Props {
  logs: TowLog[];
  onRowClick: (log: TowLog) => void;
  flaggedIds: Set<string>;
}

const LogsTable: React.FC<Props> = ({ logs, onRowClick, flaggedIds }) => {
  return (
    <div className="overflow-auto max-h-[600px] rounded-xl border border-gray-800/50 bg-[#1C2128]/40 shadow-2xl">
      <table className="w-full text-left">
        <thead className="bg-[#1C2128] sticky top-0 z-10">
          <tr className="text-gray-500 text-[11px] font-bold uppercase tracking-[0.1em]">
            <th className="px-8 py-5">Date/Time</th>
            <th className="px-8 py-5">Tail Number</th>
            <th className="px-8 py-5">Duration</th>
            <th className="px-8 py-5">Operator</th>
            <th className="px-8 py-5">Tug</th>
            <th className="px-8 py-5">Events</th>
            <th className="px-8 py-5 text-right">Download</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800/30">
          {logs.map((log) => (
            <tr
              key={log.id}
              onClick={() => onRowClick(log)}
              className={`hover:bg-gray-800/30 cursor-pointer transition-colors text-[13px] text-gray-300 group ${
                flaggedIds.has(log.id) ? 'bg-[#FF4D00]/5' : ''
              }`}
            >
              <td className="px-8 py-5 mono text-gray-400 group-hover:text-gray-200">
                {flaggedIds.has(log.id) && <i className="fas fa-flag text-[#FF4D00] mr-2 text-[10px]"></i>}
                {log.dateTime}
              </td>
              <td className="px-8 py-5 font-black text-white text-base tracking-tight group-hover:scale-[1.02] transition-transform">{log.tailNumber}</td>
              <td className="px-8 py-5 mono group-hover:text-gray-200">{log.duration}</td>
              <td className="px-8 py-5 group-hover:text-gray-200">{log.operator}</td>
              <td className="px-8 py-5 group-hover:text-gray-200">{log.tug}</td>
              <td className="px-8 py-5">
                {log.details && log.details.events > 0 ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[#FF4D00]/40 bg-[#FF4D00]/10 px-2.5 py-1 text-[11px] font-bold text-[#FF4D00]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#FF4D00]"></span>
                    {log.details.events}
                  </span>
                ) : (
                  <span className="text-gray-600">—</span>
                )}
              </td>
              <td className="px-8 py-5">
                <div className="flex justify-end">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      downloadLogPackage(log);
                    }}
                    className="bg-gray-800/60 hover:bg-gray-700 text-gray-300 hover:text-white px-4 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-[0.1em] transition-colors border border-gray-700 hover:border-gray-500"
                  >
                    <i className="fas fa-download mr-1.5 opacity-70"></i>
                    Download
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default LogsTable;
