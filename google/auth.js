import { google } from "googleapis";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_PATH = path.join(__dirname, "token.json");

export function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

export function getAuthUrl() {
  const client = getOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/contacts.readonly",
    ],
  });
}

export async function saveToken(code) {
  const client = getOAuthClient();
  const { tokens } = await client.getToken(code);
  await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  console.log("[google] token saved to:", TOKEN_PATH);
  return tokens;
}

export async function getAuthenticatedClient() {
  const client = getOAuthClient();
  let tokens;
  try {
    const raw = await fs.readFile(TOKEN_PATH, "utf8");
    tokens = JSON.parse(raw);
    console.log("[google] token loaded from:", TOKEN_PATH);
  } catch {
    throw new Error("Google not connected yet.");
  }
  client.setCredentials(tokens);
  client.on("tokens", async (newTokens) => {
    const merged = { ...tokens, ...newTokens };
    await fs.writeFile(TOKEN_PATH, JSON.stringify(merged, null, 2));
    tokens = merged;
  });
  return client;
}
