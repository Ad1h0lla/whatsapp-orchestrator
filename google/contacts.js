import { google } from "googleapis";
import { getAuthenticatedClient } from "./auth.js";

async function getPeople() {
  const auth = await getAuthenticatedClient();
  return google.people({ version: "v1", auth });
}

export async function searchContacts({ name }) {
  const people = await getPeople();
  const res = await people.people.searchContacts({
    query: name, readMask: "names,phoneNumbers,emailAddresses", pageSize: 5,
  });
  const results = res.data.results || [];
  if (!results.length) return `No contacts found matching "${name}".`;
  return results.map((r) => {
    const p = r.person;
    const displayName = p.names?.[0]?.displayName || "Unknown";
    const phones = (p.phoneNumbers || []).map((ph) => ph.value).join(", ");
    const emails = (p.emailAddresses || []).map((e) => e.value).join(", ");
    return [`👤 ${displayName}`, phones ? `📞 ${phones}` : null, emails ? `✉️ ${emails}` : null]
      .filter(Boolean).join("\n");
  }).join("\n\n");
}

export async function listContacts({ maxResults = 20 }) {
  const people = await getPeople();
  const res = await people.people.connections.list({
    resourceName: "people/me", pageSize: maxResults,
    personFields: "names,phoneNumbers", sortOrder: "FIRST_NAME_ASCENDING",
  });
  const connections = res.data.connections || [];
  if (!connections.length) return "No contacts found.";
  return connections.map((p) => {
    const name = p.names?.[0]?.displayName || "Unknown";
    const phone = p.phoneNumbers?.[0]?.value || "";
    return `• ${name}${phone ? " — " + phone : ""}`;
  }).join("\n");
}
