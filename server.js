import "dotenv/config";
import express from "express";
import http from "http";
import twilio from "twilio";
import { attachLaptopAgentServer, getQueuedJobs, resolveJob, isLaptopAgentOnline } from "./laptopAgentBridge.js";
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

  console.log(`[webhook] received from ${from}: ${body}`);

  if (allowedNumbers.length > 0 && !allowedNumbers.includes(from)) {
    console.log(`[webhook] rejected unauthorized number: ${from}`);
    res.status(200).send("");
    return;
  }

  res.status(200).send("");

  try {
    console.log(`[webhook] calling handleIncomingMessage`);
    const reply = await handleIncomingMessage(from, body);
    console.log(`[webhook] got reply: ${reply?.slice(0, 100)}`);
    await sendWhatsAppMessage(from, reply);
  } catch (err) {
    console.error(`[webhook] ERROR:`, err.message);
    console.error(err.stack);
    await sendWhatsAppMessage(from, "Something went wrong — try again.").catch((e) => {
      console.error(`[webhook] also failed to send error message:`, e.message);
    });
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

app.get("/debug-env", (req, res) => {
  res.json({
    hasGoogleToken: !!process.env.GOOGLE_TOKEN,
    tokenLength: process.env.GOOGLE_TOKEN?.length,
    tokenFirst10: process.env.GOOGLE_TOKEN?.slice(0, 10),
    redirectBase: process.env.GOOGLE_REDIRECT_BASE,
    redirectUri: process.env.GOOGLE_REDIRECT_URI,
  });
});

app.get("/show-token-raw", (req, res) => {
  res.send(`<pre>${process.env.GOOGLE_TOKEN}</pre>`);
});

app.get("/health", (req, res) => res.json({ ok: true }));

app.get("/agent/status", (req, res) => {
  res.json({ 
    online: isLaptopAgentOnline("default-laptop"),
    time: Date.now()
  });
});

// Laptop agent polls this every 3 seconds to get jobs
app.get("/agent/poll", (req, res) => {
  const secret = req.headers["x-agent-secret"];
  const agentId = req.headers["x-agent-id"] || "default-laptop";
  console.log(`[poll] agentId=${agentId} secretMatch=${secret === process.env.AGENT_SHARED_SECRET} secretLength=${secret?.length}`);
  if (secret !== process.env.AGENT_SHARED_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const jobs = getQueuedJobs(agentId);
  res.json({ jobs });
});

// Laptop agent posts results here
app.post("/agent/result", express.json(), (req, res) => {
  const secret = req.headers["x-agent-secret"];
  if (secret !== process.env.AGENT_SHARED_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const { jobId, ok, output, error } = req.body;
  resolveJob(jobId, { ok, output, error });
  res.json({ received: true });
});

const server = http.createServer(app);
attachLaptopAgentServer(server);

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Orchestrator listening on port ${port}`);
  console.log(`Google auth: GET /google/auth`);
});
