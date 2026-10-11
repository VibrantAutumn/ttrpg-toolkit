import type { ItemTypeDefinition } from "../../registry/types";
import { CalendarEditor } from "./CalendarEditor";
import { EventEditor } from "./EventEditor";
import { SessionView } from "./SessionView";
import { TimelineView } from "./TimelineView";

export const calendarType: ItemTypeDefinition = {
  id: "calendar",
  label: "Calendar",
  icon: "🗓️",
  toolId: "calendar",
  plain: true,
  editor: CalendarEditor,
};

export const eventType: ItemTypeDefinition = {
  id: "event",
  label: "Event",
  icon: "📌",
  toolId: "calendar",
  editor: EventEditor,
};

export const noteType: ItemTypeDefinition = {
  id: "note",
  label: "DM note",
  icon: "📝",
  toolId: "calendar",
  editor: EventEditor,
};

export const timelineType: ItemTypeDefinition = {
  id: "timeline",
  label: "Timeline",
  icon: "📈",
  toolId: "calendar",
  editor: TimelineView,
};

/** A session is a page (library `worldbuilding`) with dates, a status and a Log tab; made from the status bar or the Sessions tab. */
export const sessionType: ItemTypeDefinition = {
  id: "session",
  label: "Session",
  icon: "📖",
  toolId: "worldbuilding",
  creatable: false,
  tabs: true,
  editor: SessionView,
};
