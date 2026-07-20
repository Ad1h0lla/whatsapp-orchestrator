import "dotenv/config";
import express from "express";
import http from "http";
import twilio from "twilio";
import { attachLaptopAgentServer } from "./laptopAgentBridge.js";
import { handleIncomingMessage } from "./routes/router.js";
import { getAuthUrl, saveToken } from "./google/auth.js";

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const allowedNumbers = (process.env.ALLOWED_NUMBERS || "")
  .split(",").map((n) => n.trim()).filter(Boolean);

app.get("/google/auth", (req, res) => {
  res.redirect(getAuthUrl());
});

app.get("/google/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send("Missing code.");
  try {
    await saveToken(code);
    res.send("Google connected! You can close this tab.");
  } catch (err) {
    res.status(500).send(`OAuth error: ${err.message}`);
  }
});

app.post("/webhook/whatsapp", async (req, res) => {
  const from = (req.body.From || "").replace("whatsapp:", "");
  const body = req.body.Body || "";
  if (allowedNumbers.length > 0 && !allowedNumbers.includes(from)) {
    res.status(200).send("");
    return;
  }
  res.status(200).send("");
  try {
    const reply = await handleIncomingMessage(from, body);
    await sendWhatsAppMessage(from, reply);
  } catch (err) {
    console.error("[whatsapp] error:", err);
    await sendWhatsAppMessage(from, "Something went wrong — try again.").catch(() => {});
  }
});

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

async function sendWhatsAppMessage(toNumber, body) {
  console.log(`[twilio] sending to ${toNumber}: ${body.slice(0, 100)}`);
  const chunks = chunkText(body, 1500);
  for (const chunk of chunks) {
    try {
      const msg = await twilioClient.messages.create({
        from: process.env.TWILIO_WHATSAPP_FROM,
        to: `whatsapp:${toNumber}`,
        body: chunk,
      });
      console.log(`[twilio] sent successfully, SID: ${msg.sid}`);
    } catch (err) {
      console.error(`[twilio] FAILED:`, err.message);
    }
  }
}

function chunkText(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  for (let i = 0; i < text.length; i += maxLen) chunks.push(text.slice(i, i + maxLen));
  return chunks;
}

app.get("/debug-token", (req, res) => res.json({ hasToken: !!process.env.GOOGLE_TOKEN, tokenStart: process.env.GOOGLE_TOKEN?.slice(0,20) }));

app.get("/health", (req, res) => res.json({ ok: true }));

const server = http.createServer(app);
attachLaptopAgentServer(server);

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Orchestrator listening on port ${port}`);
  console.log(`Google auth: GET /google/auth`);
});
