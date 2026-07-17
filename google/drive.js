import { google } from "googleapis";
import { getAuthenticatedClient } from "./auth.js";

async function getDrive() {
  const auth = await getAuthenticatedClient();
  return google.drive({ version: "v3", auth });
}

export async function searchFiles({ query, maxResults = 8 }) {
  const drive = await getDrive();
  const res = await drive.files.list({
    q: `name contains '${query}' and trashed = false`,
    pageSize: maxResults,
    fields: "files(id,name,mimeType,modifiedTime,webViewLink)",
    orderBy: "modifiedTime desc",
  });
  const files = res.data.files || [];
  if (!files.length) return `No files found matching "${query}".`;
  return files.map((f) => {
    const type = f.mimeType.includes("folder") ? "📁" : "📄";
    const date = new Date(f.modifiedTime).toLocaleDateString("en-IN");
    return `${type} ${f.name} (${date})\n   ${f.webViewLink}`;
  }).join("\n\n");
}

export async function recentFiles({ days = 1, maxResults = 10 }) {
  const drive = await getDrive();
  const since = new Date();
  since.setDate(since.getDate() - days);
  const res = await drive.files.list({
    q: `modifiedTime > '${since.toISOString()}' and trashed = false`,
    pageSize: maxResults,
    fields: "files(id,name,mimeType,modifiedTime,webViewLink)",
    orderBy: "modifiedTime desc",
  });
  const files = res.data.files || [];
  if (!files.length) return `No files modified in the last ${days} day(s).`;
  return files.map((f) => {
    const type = f.mimeType.includes("folder") ? "📁" : "📄";
    return `${type} ${f.name}\n   ${f.webViewLink}`;
  }).join("\n\n");
}

export async function readDoc({ fileId }) {
  const auth = await getAuthenticatedClient();
  const docs = google.docs({ version: "v1", auth });
  const res = await docs.documents.get({ documentId: fileId });
  const text = (res.data.body.content || [])
    .flatMap((b) => b.paragraph?.elements || [])
    .map((el) => el.textRun?.content || "")
    .join("").trim();
  return text.length > 2000 ? text.slice(0, 2000) + "\n...(truncated)" : text;
}
