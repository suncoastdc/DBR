import React, { useMemo, useState } from 'react';

interface CalendarStatusProps {
  datesWithSheets: Set<string>;
  viewScope: 'year' | 'month';
  selectedDate: Date;
  onSelectMonth: (date: Date) => void;
  onBackToYear: () => void;
}

const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const CalendarStatus: React.FC<CalendarStatusProps> = ({
  datesWithSheets,
  viewScope,
  selectedDate,
  onSelectMonth,
  onBackToYear
}) => {
  const today = new Date();
  const [displayYear, setDisplayYear] = useState(today.getFullYear());

  // --- Year View Logic ---
  const yearMonths = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const date = new Date(displayYear, i, 1);
      const daysInMonth = new Date(displayYear, i + 1, 0).getDate();
      let importedCount = 0;
      let missingCount = 0;

      for (let d = 1; d <= daysInMonth; d++) {
        const dayDate = new Date(displayYear, i, d);
        const iso = toIso(dayDate);
        const isWeekend = dayDate.getDay() === 0 || dayDate.getDay() === 6;
        if (dayDate > today) continue; // Future

        if (datesWithSheets.has(iso)) {
          importedCount++;
        } else if (!isWeekend) {
          missingCount++;
        }
      }

      let status: 'green' | 'orange' | 'red' = 'red';
      if (importedCount === 0) {
        status = 'red'; // Not started / No data
      } else if (missingCount > 0) {
        status = 'orange'; // In progress / Partial
      } else {
        status = 'green'; // Complete (dates covered)
      }

      return { date, label: date.toLocaleString('default', { month: 'long' }), status, importedCount, missingCount };
    });
  }, [displayYear, datesWithSheets, today]);


  // --- Month View Logic ---
  const monthDays = useMemo(() => {
    if (viewScope !== 'month') return [];
    return buildMonth(selectedDate.getFullYear(), selectedDate.getMonth());
  }, [selectedDate, viewScope]);

  // --- Render ---

  if (viewScope === 'year') {
    return (
      <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6 mb-6 transition-colors duration-200">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold text-gray-800 dark:text-white">Annual Overview - {displayYear}</h3>
          <div className="flex gap-2">
            <button onClick={() => setDisplayYear(prev => prev - 1)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-700 dark:text-gray-300">‹</button>
            <span className="font-semibold text-gray-700 dark:text-gray-300 self-center">{displayYear}</span>
            <button onClick={() => setDisplayYear(prev => prev + 1)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-700 dark:text-gray-300">›</button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {yearMonths.map(m => (
            <button
              key={m.label}
              onClick={() => onSelectMonth(m.date)}
              className={`p-4 rounded-lg border-2 text-left transition-all hover:shadow-md dark:hover:shadow-lg
                            ${m.status === 'green' ? 'border-green-200 bg-green-50 dark:bg-green-900/20 dark:border-green-800 hover:border-green-400 dark:hover:border-green-600' : ''}
                            ${m.status === 'orange' ? 'border-orange-200 bg-orange-50 dark:bg-orange-900/20 dark:border-orange-800 hover:border-orange-400 dark:hover:border-orange-600' : ''}
                            ${m.status === 'red' ? 'border-red-100 bg-white dark:bg-gray-700 dark:border-gray-600 hover:border-red-300 dark:hover:border-red-500' : ''}
                        `}
            >
              <div className="flex justify-between items-start mb-2">
                <span className="font-bold text-gray-700 dark:text-gray-200">{m.label}</span>
                <div className={`w-3 h-3 rounded-full 
                                ${m.status === 'green' ? 'bg-green-500' : ''}
                                ${m.status === 'orange' ? 'bg-orange-400' : ''}
                                ${m.status === 'red' ? 'bg-gray-300 dark:bg-gray-500' : ''}
                            `}></div>
              </div>
              <div className="text-xs space-y-1">
                {m.status === 'red' && <span className="text-gray-400 dark:text-gray-500">Not Started</span>}
                {m.status !== 'red' && (
                  <>
                    <div className="text-gray-600 dark:text-gray-300">Imported: <b>{m.importedCount}</b></div>
                    {m.missingCount > 0 && <div className="text-red-500 dark:text-red-400">Missing: <b>{m.missingCount}</b></div>}
                  </>
                )}
              </div>
            </button>
          ))}
        </div>
        <div className="flex gap-4 mt-6 text-sm text-gray-600 dark:text-gray-400 justify-center">
          <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-green-500"></span> Completed</span>
          <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-orange-400"></span> In Progress</span>
          <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-gray-300 dark:bg-gray-500"></span> Not Started</span>
        </div>
      </div>
    );
  }

  // Month View
  return (
    <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-4 mb-6 transition-colors duration-200">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <button onClick={onBackToYear} className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium text-sm">
            ← Back to Year
          </button>
          <h3 className="text-lg font-bold text-gray-800 dark:text-white">
            {selectedDate.toLocaleString('default', { month: 'long', year: 'numeric' })}
          </h3>
        </div>
        <div className="flex gap-2">
          <button onClick={() => onSelectMonth(new Date(selectedDate.getFullYear(), selectedDate.getMonth() - 1, 1))} className="px-3 py-1 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300">Prev</button>
          <button onClick={() => onSelectMonth(new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 1))} className="px-3 py-1 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300">Next</button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto">
        <div className="grid grid-cols-7 gap-1 text-center text-xs font-bold text-gray-500 dark:text-gray-400 mb-2">
          {weekdayNames.map((d) => <div key={d}>{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1 text-sm">
          {monthDays.map((day, idx) => {
            if (!day) return <div key={`pad-${idx}`} />;
            const iso = day.iso;
            const isWeekend = day.date.getDay() === 0 || day.date.getDay() === 6;
            const isFuture = day.date > today;
            const hasSheet = datesWithSheets.has(iso);

            let bg = 'bg-gray-50 dark:bg-gray-900/50 text-gray-400 dark:text-gray-600';
            if (!isWeekend && !isFuture) {
              bg = hasSheet ? 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800' : 'bg-red-50 text-red-400 border-red-100 dark:bg-red-900/20 dark:text-red-400 dark:border-red-900';
            }

            return (
              <div key={iso} className={`h-10 flex items-center justify-center rounded border dark:border-gray-700 ${bg}`}>
                {day.date.getDate()}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default CalendarStatus;

type DayCell = { date: Date; iso: string } | null;

function buildMonth(year: number, month: number) {
  const result: DayCell[] = [];
  const first = new Date(year, month, 1);
  const startPad = first.getDay();
  for (let i = 0; i < startPad; i++) result.push(null);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    result.push({ date, iso: toIso(date) });
  }
  return result;
}

function toIso(d: Date) {
  return d.toISOString().split('T')[0];
}
