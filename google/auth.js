import { google } from "googleapis";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs/promises";

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
  // Save to file as backup
  await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  // Print to logs so we can copy it into Render env vars
  console.log("[google] GOOGLE_TOKEN=" + JSON.stringify(JSON.stringify(tokens)));
  return tokens;
}

export async function getAuthenticatedClient() {
  const client = getOAuthClient();
  let tokens;

  // First try environment variable (works on Render after restart)
  if (process.env.GOOGLE_TOKEN) {
    try {
      tokens = JSON.parse(process.env.GOOGLE_TOKEN);
    } catch {
      throw new Error("Google not connected yet. Open this in your browser:\n" + process.env.GOOGLE_REDIRECT_BASE + "/google/auth");
    }
  } else {
    // Fall back to file (works locally)
    try {
      const raw = await fs.readFile(TOKEN_PATH, "utf8");
      tokens = JSON.parse(raw);
    } catch {
      throw new Error("Google not connected yet. Open this in your browser:\n" + process.env.GOOGLE_REDIRECT_BASE + "/google/auth");
    }
  }

  client.setCredentials(tokens);
  client.on("tokens", async (newTokens) => {
    const merged = { ...tokens, ...newTokens };
    // Update env var value in memory
    process.env.GOOGLE_TOKEN = JSON.stringify(merged);
    tokens = merged;
  });
  return client;
}
