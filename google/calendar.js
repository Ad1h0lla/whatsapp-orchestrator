import { google } from "googleapis";
import { getAuthenticatedClient } from "./auth.js";

async function getCalendar() {
  const auth = await getAuthenticatedClient();
  return google.calendar({ version: "v3", auth });
}

export async function listEvents({ date, maxResults = 10 }) {
  const cal = await getCalendar();
  const day = date ? new Date(date) : new Date();
  const start = new Date(day.setHours(0,0,0,0)).toISOString();
  const end = new Date(day.setHours(23,59,59,999)).toISOString();
  const res = await cal.events.list({
    calendarId: "primary", timeMin: start, timeMax: end,
    maxResults, singleEvents: true, orderBy: "startTime",
  });
  const events = res.data.items || [];
  if (!events.length) return "No events found for that day.";
  return events.map((e) => {
    const start = e.start.dateTime || e.start.date;
    const time = new Date(start).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    return `• ${time} — ${e.summary || "(no title)"}`;
  }).join("\n");
}

export async function addEvent({ title, date, time, durationMinutes = 60, description = "" }) {
  const cal = await getCalendar();
  const startDateTime = new Date(`${date} ${time}`);
  const endDateTime = new Date(startDateTime.getTime() + durationMinutes * 60000);
  await cal.events.insert({
    calendarId: "primary",
    resource: {
      summary: title, description,
      start: { dateTime: startDateTime.toISOString(), timeZone: "Asia/Kolkata" },
      end: { dateTime: endDateTime.toISOString(), timeZone: "Asia/Kolkata" },
    },
  });
  return `Added "${title}" on ${date} at ${time}.`;
}

export async function clearDay({ date }) {
  const cal = await getCalendar();
  const day = new Date(date);
  const start = new Date(day.setHours(0,0,0,0)).toISOString();
  const end = new Date(day.setHours(23,59,59,999)).toISOString();
  const res = await cal.events.list({ calendarId: "primary", timeMin: start, timeMax: end, singleEvents: true });
  const events = res.data.items || [];
  if (!events.length) return "No events to clear.";
  await Promise.all(events.map((e) => cal.events.delete({ calendarId: "primary", eventId: e.id })));
  return `Cleared ${events.length} event(s) from ${date}.`;
}

export async function deleteEvent({ title, date }) {
  const cal = await getCalendar();
  const day = new Date(date);
  const start = new Date(day.setHours(0,0,0,0)).toISOString();
  const end = new Date(day.setHours(23,59,59,999)).toISOString();
  const res = await cal.events.list({ calendarId: "primary", timeMin: start, timeMax: end, singleEvents: true });
  const match = (res.data.items || []).find((e) => e.summary?.toLowerCase().includes(title.toLowerCase()));
  if (!match) return `No event matching "${title}" found.`;
  await cal.events.delete({ calendarId: "primary", eventId: match.id });
  return `Deleted "${match.summary}".`;
}
