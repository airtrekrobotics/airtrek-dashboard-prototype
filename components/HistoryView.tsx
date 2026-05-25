import React, { useMemo, useState } from 'react';
import { TowLog } from '../types';
import LogsTable from './LogsTable';

interface Props {
  logs: TowLog[];
  onRowClick: (log: TowLog) => void;
}

const OPERATORS = ['Chris Lee', 'Huzefa Dossaji', 'Jon Taylor', 'David Ladnier'];

const toCsv = (logs: TowLog[]): string => {
  const headers = [
    'ID', 'Date / Time', 'Tail Number', 'Operator', 'Duration', 'Status',
    'Route', 'Distance', 'Max Speed', 'Events', 'Event Times', 'Battery (End)',
  ];
  const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  const rows = logs.map((l) =>
    [
      l.id, l.dateTime, l.tailNumber, l.operator, l.duration, l.status,
      l.details?.path ?? '', l.details?.distance ?? '', l.details?.maxSpeed ?? '',
      String(l.details?.events ?? 0), (l.details?.eventTimes ?? []).join(' '),
      l.details?.batteryEnd ?? '',
    ].map(esc).join(','),
  );
  return [headers.map(esc).join(','), ...rows].join('\n');
};

const HistoryView: React.FC<Props> = ({ logs, onRowClick }) => {
  const [query, setQuery] = useState('');
  const [operator, setOperator] = useState('All');
  const [eventsOnly, setEventsOnly] = useState(false);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return logs.filter((l) => {
      if (operator !== 'All' && l.operator !== operator) return false;
      if (eventsOnly && !(l.details?.events)) return false;
      if (!needle) return true;
      const hay = `${l.dateTime} ${l.tailNumber} ${l.operator} ${l.details?.path ?? ''}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [logs, query, operator, eventsOnly]);

  const exportCsv = () => {
    const blob = new Blob([toCsv(filtered)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `airtrek-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const inputCls =
    'bg-[#1C2128]/60 border border-gray-800 rounded-lg px-3 py-2.5 text-sm text-gray-200 focus:outline-none focus:border-[#FF4D00]/60';

  return (
    <main className="p-10 max-w-[1400px] w-full">
      <section>
        <div className="flex items-center space-x-3 mb-8">
          <h2 className="text-xl font-bold text-white tracking-tight mono uppercase text-sm">History</h2>
          <div className="h-px flex-1 bg-gray-800/50"></div>
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="relative flex-1 min-w-[220px]">
            <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-600 text-xs"></i>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tail #, operator, route, date…"
              className={`${inputCls} w-full pl-9 placeholder-gray-600`}
            />
          </div>
          <select value={operator} onChange={(e) => setOperator(e.target.value)} className={inputCls}>
            <option>All</option>
            {OPERATORS.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
          <button
            onClick={() => setEventsOnly((v) => !v)}
            className={`px-4 py-2.5 rounded-lg text-[10px] font-bold uppercase tracking-widest border transition-colors ${
              eventsOnly
                ? 'bg-[#FF4D00]/15 text-[#FF4D00] border-[#FF4D00]/40'
                : 'bg-[#1C2128]/60 text-gray-400 border-gray-800 hover:text-gray-200'
            }`}
          >
            <i className="fas fa-triangle-exclamation mr-2"></i>Events Only
          </button>
          <button
            onClick={exportCsv}
            className="bg-gray-800/40 text-[10px] font-bold px-5 py-2.5 rounded-lg text-gray-300 hover:text-white hover:bg-gray-800 transition-all border border-gray-700 uppercase tracking-widest"
          >
            <i className="fas fa-file-export mr-2"></i>Export Data
          </button>
        </div>

        <div className="text-[11px] text-gray-500 mb-3 mono">
          {filtered.length} of {logs.length} missions
        </div>

        <LogsTable logs={filtered} onRowClick={onRowClick} />
      </section>
    </main>
  );
};

export default HistoryView;
