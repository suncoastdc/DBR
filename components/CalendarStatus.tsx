import React, { useMemo } from 'react';

interface CalendarStatusProps {
  datesWithSheets: Set<string>;
}

const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const CalendarStatus: React.FC<CalendarStatusProps> = ({ datesWithSheets }) => {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const days = useMemo(() => buildMonth(year, month), [year, month]);

  return (
    <div className="bg-white shadow rounded-lg p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-800">
            {today.toLocaleString('default', { month: 'long' })} {year}
          </h3>
          <p className="text-xs text-gray-500">Green = day sheet imported. Red = missing (Mon–Fri).</p>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-gray-500 mb-1">
        {weekdayNames.map((d) => (
          <div key={d} className="py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          if (!day) return <div key={Math.random()} />;
          const iso = day.iso;
          const isWeekend = day.date.getDay() === 0 || day.date.getDay() === 6;
          const isFuture = day.date > today;
          const hasSheet = datesWithSheets.has(iso);
          let bg = 'bg-gray-100 text-gray-500';
          if (!isWeekend && !isFuture) {
            bg = hasSheet ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700';
          } else if (isFuture) {
            bg = 'bg-gray-50 text-gray-400';
          }
          return (
            <div key={iso} className={`p-2 rounded ${bg}`}>
              <div className="text-sm font-semibold">{day.date.getDate()}</div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-4 mt-3 text-xs text-gray-600">
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-200 inline-block" /> Imported</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-200 inline-block" /> Missing (Mon–Fri)</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-gray-200 inline-block" /> Weekend/Future</span>
      </div>
    </div>
  );
};

export default CalendarStatus;

function buildMonth(year: number, month: number) {
  const result: { date: Date; iso: string }[] = [];
  const first = new Date(year, month, 1);
  const startPad = first.getDay();
  for (let i = 0; i < startPad; i++) result.push(null as any);
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
