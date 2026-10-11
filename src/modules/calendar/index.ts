import type { ModuleDefinition } from "../../registry/types";
import { CalendarScreen } from "./CalendarScreen";
import { calendarType, eventType, noteType, sessionType, timelineType } from "./itemTypes";

/**
 * Time: calendars (the builder), the month view, events and dated notes, sessions and timelines. The project's
 * "now" and the status bar are in the app shell (they read the same state, `state/timeState.tsx`).
 */
export const calendarModule: ModuleDefinition = {
  id: "calendar",
  tools: [
    {
      id: "calendar",
      label: "Calendar",
      icon: "📅",
      order: 35,
      component: CalendarScreen,
    },
  ],
  itemTypes: [calendarType, eventType, noteType, timelineType, sessionType],
  commands: [
    {
      id: "calendar.open",
      label: "Go to the Calendar",
      keywords: ["calendar", "month", "date", "time", "event", "timeline", "session", "weather", "moon"],
      run: (ctx) => ctx.openTool("calendar"),
    },
  ],
};
