import { listEvents, addEvent, clearDay, deleteEvent } from "./calendar.js";
import { searchFiles, recentFiles, readDoc } from "./drive.js";
import { searchContacts, listContacts } from "./contacts.js";

export async function runGoogleAction(action, args) {
  switch (action) {
    case "calendar_list":   return listEvents(args);
    case "calendar_add":    return addEvent(args);
    case "calendar_clear":  return clearDay(args);
    case "calendar_delete": return deleteEvent(args);
    case "drive_search":    return searchFiles(args);
    case "drive_recent":    return recentFiles(args);
    case "drive_read":      return readDoc(args);
    case "contacts_search": return searchContacts(args);
    case "contacts_list":   return listContacts(args);
    default: return `Unknown action: ${action}`;
  }
}

export function todayString() {
  return new Date().toLocaleDateString("en-CA");
}
