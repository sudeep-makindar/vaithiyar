import { create } from 'zustand';
import { fetchCalendarEvents, createCalendarEvent } from '../api';

const isoDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// The physician's schedule comes from the backend: generated from the live patient list,
// plus any events the doctor adds (persisted in DynamoDB).
export const useCalendarStore = create((set, get) => ({
  selectedDate: new Date(),
  events: [],
  loadedFrom: null,

  loadEvents: async (aroundDate = new Date()) => {
    const start = new Date(aroundDate.getFullYear(), aroundDate.getMonth(), 1);
    start.setDate(start.getDate() - 7);
    const key = isoDate(start);
    if (get().loadedFrom === key) return;
    const { events = [] } = await fetchCalendarEvents(key, 49);
    set({ events, loadedFrom: key });
  },
  setSelectedDate: (date) => {
    set({ selectedDate: date });
    get().loadEvents(date);
  },
  addEvent: async (event) => {
    const optimistic = { ...event, id: `evt-${Date.now()}` };
    set((state) => ({ events: [...state.events, optimistic] }));
    try {
      const saved = await createCalendarEvent(event);
      set((state) => ({ events: state.events.map((e) => (e.id === optimistic.id ? saved : e)) }));
    } catch (err) {
      console.warn('Calendar event saved locally only', err);
    }
  },
}));
