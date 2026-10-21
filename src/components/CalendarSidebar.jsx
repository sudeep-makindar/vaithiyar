import React, { useState, useEffect } from 'react';
import { useCalendarStore } from '../stores/calendarStore';
import { useUserStore } from '../stores/userStore';
import { greeting, isSameDay } from '../utils/time';

const CalendarSidebar = ({ showGreeting = true, className = '', isSidebar = true }) => {
  const { selectedDate, setSelectedDate, events, addEvent, loadEvents } = useCalendarStore();
  const { doctorName } = useUserStore();
  const [currentMonth, setCurrentMonth] = useState(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
  const [showAddModal, setShowAddModal] = useState(false);
  const [eventTime, setEventTime] = useState('10:00');
  const [eventTitle, setEventTitle] = useState('');
  const [eventDesc, setEventDesc] = useState('');
  const [eventType, setEventType] = useState('consult');

  useEffect(() => {
    loadEvents(currentMonth);
  }, [currentMonth, loadEvents]);

  // Month navigation
  const prevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };
  const nextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  // Calendar calculations
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const numDays = new Date(year, month + 1, 0).getDate();
  const startDayOfWeek = new Date(year, month, 1).getDay(); // 0 is Sunday, 1 is Monday...
  const startDayIdx = startDayOfWeek === 0 ? 6 : startDayOfWeek - 1; // Adjust Monday to 0

  const days = [];
  // Prev month padding
  const prevMonthNumDays = new Date(year, month, 0).getDate();
  for (let i = startDayIdx - 1; i >= 0; i--) {
    days.push({
      day: prevMonthNumDays - i,
      isCurrentMonth: false,
      date: new Date(year, month - 1, prevMonthNumDays - i)
    });
  }
  // Current month days
  for (let d = 1; d <= numDays; d++) {
    days.push({
      day: d,
      isCurrentMonth: true,
      date: new Date(year, month, d)
    });
  }
  // Next month padding
  const totalSlots = days.length;
  const nextMonthPadding = totalSlots <= 35 ? 35 - totalSlots : 42 - totalSlots;
  for (let d = 1; d <= nextMonthPadding; d++) {
    days.push({
      day: d,
      isCurrentMonth: false,
      date: new Date(year, month + 1, d)
    });
  }

  // Check if a day has events
  const getEventsForDate = (dateObj) => {
    const dateStr = formatDateStr(dateObj);
    return events.filter(e => e.date === dateStr).sort((a, b) => a.time.localeCompare(b.time));
  };

  const formatDateStr = (dateObj) => {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const handleDayClick = (dateObj) => {
    setSelectedDate(dateObj);
  };

  const handleAddEventSubmit = (e) => {
    e.preventDefault();
    if (!eventTitle.trim()) return;

    addEvent({
      time: eventTime,
      title: eventTitle,
      description: eventDesc,
      type: eventType,
      date: formatDateStr(selectedDate)
    });

    // Reset and close
    setEventTitle('');
    setEventDesc('');
    setShowAddModal(false);
  };

  const selectedDateStr = formatDateStr(selectedDate);
  const selectedDateEvents = events.filter(e => e.date === selectedDateStr).sort((a, b) => a.time.localeCompare(b.time));

  const isToday = (dateObj) => {
    return isSameDay(dateObj, new Date());
  };

  const isSelected = (dateObj) => {
    return dateObj.getFullYear() === selectedDate.getFullYear() &&
           dateObj.getMonth() === selectedDate.getMonth() &&
           dateObj.getDate() === selectedDate.getDate();
  };

  const sidebarContent = (
    <>
      {showGreeting && (
        /* Greeting */
        <div className="flex justify-between items-center shrink-0">
          <div>
            <p className="text-xs text-gray-500 font-bold">{greeting()},</p>
            <h2 className="text-xl font-extrabold text-brand-sidebar tracking-tight leading-none mt-1">{doctorName}</h2>
          </div>
          <button className="w-10 h-10 rounded-full bg-white border border-gray-200/80 shadow-sm flex items-center justify-center hover:bg-gray-50 transition-colors">
            <span className="material-symbols-outlined text-brand-sidebar">more_vert</span>
          </button>
        </div>
      )}

      {/* Calendar Widget */}
      <div className="bg-white border border-gray-200 rounded-[24px] p-5 shadow-sm shrink-0">
        <div className="flex justify-between items-center mb-5">
          <span onClick={prevMonth} className="material-symbols-outlined text-gray-400 cursor-pointer hover:text-gray-650 select-none">chevron_left</span>
          <span className="bg-[#FFDCE6] text-black px-4 py-1.5 rounded-full font-bold text-xs select-none">
            {monthNames[month]} {year}
          </span>
          <span onClick={nextMonth} className="material-symbols-outlined text-gray-400 cursor-pointer hover:text-gray-650 select-none">chevron_right</span>
        </div>

        <div className="grid grid-cols-7 gap-y-2 text-center text-[10px] font-black text-gray-400 uppercase mb-2">
          <div>MO</div><div>TU</div><div>WE</div><div>TH</div><div>FR</div><div>SA</div><div>SU</div>
        </div>

        <div className="grid grid-cols-7 gap-y-2.5 text-center text-xs font-bold text-gray-700">
          {days.map((item, idx) => {
            const dateEvents = getEventsForDate(item.date);
            const activeClass = isSelected(item.date)
              ? 'bg-brand-pink text-white rounded-full w-7 h-7 flex items-center justify-center mx-auto shadow-sm shadow-brand-pink/50'
              : isToday(item.date)
              ? 'border-2 border-brand-pink text-brand-pink rounded-full w-7 h-7 flex items-center justify-center mx-auto font-black'
              : item.isCurrentMonth
              ? 'cursor-pointer hover:bg-gray-100 rounded-full w-7 h-7 flex items-center justify-center mx-auto'
              : 'text-gray-200 w-7 h-7 flex items-center justify-center mx-auto';

            return (
              <div key={idx} className="relative flex flex-col items-center justify-center h-8">
                <span onClick={() => handleDayClick(item.date)} className={`${activeClass}`}>
                  {item.day}
                </span>
                {dateEvents.length > 0 && !isSelected(item.date) && (
                  <span className="absolute bottom-0 w-1.5 h-1.5 rounded-full bg-brand-pink"></span>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-5 flex gap-3">
          <button 
            onClick={() => setShowAddModal(true)}
            className="flex-grow bg-black text-white font-bold text-xs py-3 rounded-full hover:bg-gray-800 transition-colors shadow-sm cursor-pointer uppercase tracking-wider"
          >
            Add event
          </button>
        </div>
      </div>

      {/* Timeline Widget */}
      <div className="bg-white border border-gray-200 rounded-[24px] p-5 flex-1 flex flex-col shadow-sm overflow-hidden min-h-[280px]">
        <div className="flex justify-between items-end mb-4 shrink-0">
          <div>
            <h3 className="font-extrabold text-base text-brand-sidebar">
              {monthNames[selectedDate.getMonth()]} {selectedDate.getDate()}
            </h3>
            <p className="text-[10px] text-gray-400 font-bold uppercase mt-0.5">
              {isToday(selectedDate) ? "Today's timeline" : "Selected Date Timeline"}
            </p>
          </div>
          <span className="bg-gray-100 border border-gray-250 text-gray-600 px-3 py-1 rounded-full text-[10px] font-black flex items-center gap-1 cursor-pointer hover:bg-gray-200">
            All <span className="material-symbols-outlined text-xs">expand_more</span>
          </span>
        </div>

        <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-6 relative before:absolute before:left-[19px] before:top-2 before:bottom-0 before:w-px before:bg-gray-100">
          {selectedDateEvents.map((evt, eIdx) => {
            let icon = 'stethoscope';
            let iconBg = 'bg-brand-pink/20 text-brand-pink';
            if (evt.type === 'emergency') {
              icon = 'local_hospital';
              iconBg = 'bg-red-50 text-red-500';
            } else if (evt.type === 'video' || evt.type === 'telehealth') {
              icon = 'videocam';
              iconBg = 'bg-blue-50 text-blue-500';
            } else if (evt.type === 'consult') {
              icon = 'group';
              iconBg = 'bg-brand-yellow/20 text-brand-yellow-dark';
            }

            return (
              <div key={evt.id || eIdx} className="relative">
                <span className="absolute -left-[45px] top-2 text-[10px] font-bold text-gray-400 font-mono bg-gray-100 border border-gray-200/50 px-1.5 py-0.5 rounded">
                  {evt.time}
                </span>
                <div className="absolute -left-[27px] top-3 w-3 h-3 rounded-full bg-gray-300 border-2 border-white z-10 shadow-sm"></div>
                <div className="flex gap-3 bg-gray-50/70 p-3 rounded-xl border border-gray-150 shadow-sm hover:shadow-md transition-shadow">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${iconBg}`}>
                    <span className="material-symbols-outlined text-[16px]">{icon}</span>
                  </div>
                  <div>
                    <h4 className="font-extrabold text-xs text-brand-sidebar">{evt.title}</h4>
                    <p className="text-[9px] text-gray-450 font-bold mt-0.5">{evt.description}</p>
                  </div>
                </div>
              </div>
            );
          })}
          {selectedDateEvents.length === 0 && (
            <div className="text-center p-8 text-gray-400 font-medium text-xs">
              No events scheduled for this date.
            </div>
          )}
        </div>
      </div>

      {/* Add Event Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[10000] flex items-center justify-center p-4">
          <div className="bg-white rounded-[32px] p-8 max-w-sm w-full border border-gray-200 shadow-2xl animate-fade-in-up text-black">
            <h3 className="text-lg font-black text-brand-sidebar mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-brand-pink">event</span>
              Add Calendar Event
            </h3>
            <p className="text-xs text-gray-500 mb-6 font-semibold">
              Scheduling for {monthNames[selectedDate.getMonth()]} {selectedDate.getDate()}, {selectedDate.getFullYear()}
            </p>
            
            <form onSubmit={handleAddEventSubmit} className="space-y-4">
              <div>
                <label className="text-[10px] font-black uppercase text-gray-400 block mb-1">Time</label>
                <input 
                  type="text" 
                  value={eventTime}
                  onChange={e => setEventTime(e.target.value)}
                  placeholder="e.g. 10:30"
                  className="w-full bg-gray-50 rounded-full border border-gray-200 px-4 py-2 text-sm focus:outline-none focus:border-brand-pink font-bold"
                  required
                />
              </div>

              <div>
                <label className="text-[10px] font-black uppercase text-gray-400 block mb-1">Event Title</label>
                <input 
                  type="text" 
                  value={eventTitle}
                  onChange={e => setEventTitle(e.target.value)}
                  placeholder="e.g. Clinical Audit"
                  className="w-full bg-gray-50 rounded-full border border-gray-200 px-4 py-2 text-sm focus:outline-none focus:border-brand-pink font-bold"
                  required
                />
              </div>

              <div>
                <label className="text-[10px] font-black uppercase text-gray-400 block mb-1">Description / Location</label>
                <input 
                  type="text" 
                  value={eventDesc}
                  onChange={e => setEventDesc(e.target.value)}
                  placeholder="e.g. Conference Hall A"
                  className="w-full bg-gray-50 rounded-full border border-gray-200 px-4 py-2 text-sm focus:outline-none focus:border-brand-pink font-bold"
                />
              </div>

              <div>
                <label className="text-[10px] font-black uppercase text-gray-400 block mb-1">Event Type</label>
                <select 
                  value={eventType}
                  onChange={e => setEventType(e.target.value)}
                  className="w-full bg-gray-50 rounded-full border border-gray-200 px-4 py-2 text-sm focus:outline-none focus:border-brand-pink font-bold"
                >
                  <option value="consult">Consultation / Visit</option>
                  <option value="emergency">Emergency</option>
                  <option value="video">Telehealth Video</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div className="flex gap-3 pt-4">
                <button 
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs py-3 rounded-full cursor-pointer uppercase tracking-wider"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="flex-1 bg-black text-white font-bold text-xs py-3 rounded-full hover:bg-gray-800 cursor-pointer uppercase tracking-wider"
                >
                  Save Event
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );

  if (isSidebar) {
    return (
      <aside className={`w-80 shrink-0 hidden lg:flex flex-col gap-6 sticky top-[140px] h-[calc(100vh-160px)] px-4 ${className}`}>
        {sidebarContent}
      </aside>
    );
  }

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {sidebarContent}
    </div>
  );
};

export default CalendarSidebar;
