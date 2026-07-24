import Cerebras from "@cerebras/cerebras_cloud_sdk";


export async function askClaude({ message, history = [], system }) {
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push(...history, { role: "user", content: message });

  const client = new Cerebras({ apiKey: process.env.CEREBRAS_API_KEY });

  const response = await client.chat.completions.create({
    model: "gemma-4-31b",
    messages,
    max_tokens: 1024,
  });

  return response.choices[0]?.message?.content ?? "";
}

export async function classifyIntent(message) {
  const system = `You are a routing classifier for a personal AI assistant.
Given a user's WhatsApp message, respond with ONLY a JSON object, no prose, no markdown fences:
{
  "type": "chat" | "local_action" | "google_action" | "multi_model",
  "action": "short description if type is local_action or google_action, else null",
  "reason": "one short sentence"
}

PRIORITY ORDER — check these in order:
1. "google_action" = ANYTHING about calendar (today, tomorrow, schedule, add event, clear day, what's on my calendar), Drive (find files, recent docs), or Contacts (find someone's number/email). This takes priority over everything else.
2. "local_action" = user wants something done on their laptop FILES or APPS (open an app, run a script, list local folder contents, take a screenshot, start a dev server, check git status, push code). NOT calendar or Google stuff.
3. "multi_model" = user explicitly wants multiple AI models compared.
4. "chat" = everything else.

Examples:
- "what's on my calendar today" -> google_action
- "add a meeting at 3pm" -> google_action
- "find Rohan's number" -> google_action
- "list files in Downloads" -> local_action
- "open VS Code" -> local_action
- "what is React" -> chat`;

  const raw = await askClaude({ message, system });
  try {
    return JSON.parse(raw);
  } catch {
    return { type: "chat", action: null, reason: "fallback" };
  }
}
