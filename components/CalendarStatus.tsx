import React, { useMemo, useState } from 'react';

interface CalendarStatusProps {
  datesWithSheets: Set<string>;
}

const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const monthsToShow = 3;

const CalendarStatus: React.FC<CalendarStatusProps> = ({ datesWithSheets }) => {
  const today = new Date();
  const [monthOffset, setMonthOffset] = useState(0);

  const months = useMemo(() => {
    return Array.from({ length: monthsToShow }, (_, idx) => {
      const base = new Date(today.getFullYear(), today.getMonth() + monthOffset + idx, 1);
      return {
        label: base.toLocaleString('default', { month: 'long', year: 'numeric' }),
        days: buildMonth(base.getFullYear(), base.getMonth()),
      };
    });
  }, [monthOffset, today]);

  const changeMonth = (delta: number) => setMonthOffset((prev) => prev + delta);

  return (
    <div className="bg-white shadow rounded-lg p-4 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-800">Day Sheet Coverage</h3>
          <p className="text-xs text-gray-500">Green = day sheet imported. Red = missing (Mon-Fri).</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => changeMonth(-monthsToShow)}
            className="px-2 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded"
            aria-label="Previous months"
          >
            ‹
          </button>
          <button
            onClick={() => setMonthOffset(0)}
            className="px-2 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded"
          >
            Today
          </button>
          <button
            onClick={() => changeMonth(monthsToShow)}
            className="px-2 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded"
            aria-label="Next months"
          >
            ›
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-4">
        {months.map(({ label, days }) => (
          <div key={label} className="border rounded-lg p-3 w-full md:w-[calc(33%-0.5rem)] min-w-[260px] bg-gray-50">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold text-gray-800">{label}</div>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-gray-500 mb-1">
              {weekdayNames.map((d) => (
                <div key={d} className="py-1">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1 text-xs">
              {days.map((day, idx) => {
                if (!day) return <div key={`pad-${idx}`} />;
                const iso = day.iso;
                const isWeekend = day.date.getDay() === 0 || day.date.getDay() === 6;
                const isFuture = day.date > today;
                const hasSheet = datesWithSheets.has(iso);
                let bg = 'bg-gray-100 text-gray-600';
                if (!isWeekend && !isFuture) {
                  bg = hasSheet ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700';
                } else if (isFuture) {
                  bg = 'bg-gray-50 text-gray-400';
                }
                return (
                  <div key={iso} className={`p-1.5 rounded text-center ${bg}`}>
                    <div className="text-sm font-semibold">{day.date.getDate()}</div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-4 mt-3 text-xs text-gray-600 flex-wrap">
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-200 inline-block" /> Imported</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-200 inline-block" /> Missing (Mon-Fri)</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-gray-200 inline-block" /> Weekend/Future</span>
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
