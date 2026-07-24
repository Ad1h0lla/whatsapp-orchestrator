import { askClaude, classifyIntent } from "../agents/claude.js";
import { askChatGPT } from "../agents/openai.js";
import { sendJobToLaptop, isLaptopAgentOnline } from "../laptopAgentBridge.js";
import { runGoogleAction } from "../google/dispatcher.js";
import sessionStore from "../sessionStore.js";

const LOCAL_ACTION_SYSTEM_PROMPT = `You are a personal assistant that can trigger actions on the
user's laptop through a small set of whitelisted tools. When the user's message needs a laptop
action, respond with ONLY a JSON object (no prose):
{ "action": "<one of: list_files, read_file, run_script, open_app, npm_run>", "args": { ... } }

Tool argument shapes:
- list_files: { "path": "<folder path>" }
- read_file: { "path": "<file path>" }
- run_script: { "path": "<script path>", "args": ["optional","args"] }
- open_app: { "name": "<application name>" }
- npm_run: { "dir": "<project directory>", "script": "<npm script name, default: dev>" }

If you cannot map the request to one of these, respond with:
{ "action": null, "args": {}, "clarify": "<question to ask the user>" }`;

/**
 * Handle a single incoming WhatsApp message end-to-end and return the reply text.
 */
export async function handleIncomingMessage(fromNumber, messageBody) {
  const session = sessionStore.getSession(fromNumber);

  // 1. Handle a pending confirmation ("yes"/"no") for a previously proposed action
  if (session.pendingConfirmation) {
    const confirmed = /^(y|yes|go|confirm|do it)$/i.test(messageBody.trim());
    const cancelled = /^(n|no|cancel|stop)$/i.test(messageBody.trim());

    if (confirmed) {
      console.log(`[Router] User confirmed pending action: ${session.pendingConfirmation.actionName}`);
      const { actionName, args } = session.pendingConfirmation;
      session.pendingConfirmation = null;
      return runLaptopAction(fromNumber, actionName, args);
    }
    if (cancelled) {
      console.log(`[Router] User cancelled pending action`);
      session.pendingConfirmation = null;
      return "Cancelled. Nothing was run.";
    }
    return `You have a pending action waiting for confirmation:\n"${session.pendingConfirmation.action}"\nReply "yes" to run it or "no" to cancel.`;
  }

  sessionStore.pushHistory(fromNumber, "user", messageBody);

  // 2. Classify the intent
  const intent = await classifyIntent(messageBody);
  console.log(`[Router] Intent classified as ${intent.type} for message: "${messageBody}"`);

  let reply;
  
  const msg = messageBody.toLowerCase();
  let actionOverride = null;
  let argsOverride = null;

  // npm dev server
  if (/(start|run|launch).*(dev|server|frontend|vite)/.test(msg) ||
      /npm run/.test(msg)) {
    const dirMatch = messageBody.match(/in\s+(E:\\[^\s]+|[A-Z]:\\[^\s]+)/i);
    actionOverride = "npm_run";
    argsOverride = { 
      dir: dirMatch?.[1] || "E:\\executa-engine",
      script: "dev"
    };
  }
  // Git status
  else if (/(git status|whats changed|what changed|status of|check status)/.test(msg)) {
    const dirMatch = messageBody.match(/(?:of|in)\s+(E:\\[^\s]+|[A-Z]:\\[^\s]+)/i) ||
                     messageBody.match(/(E:\\[^\s]+|[A-Z]:\\[^\s]+)/i);
    actionOverride = "git_status";
    argsOverride = { dir: dirMatch?.[1] || "E:\\executa-engine" };
  }
  // Git push
  else if (/(push|commit and push|deploy|ship).*(code|changes|update)/.test(msg) ||
           /git push/.test(msg)) {
    const dirMatch = messageBody.match(/(E:\\[^\s]+|[A-Z]:\\[^\s]+)/i);
    const msgMatch = messageBody.match(/(?:message|msg|saying|with)\s+"?([^"]+)"?/i);
    actionOverride = "git_push";
    argsOverride = { 
      dir: dirMatch?.[1] || "E:\\executa-engine",
      message: msgMatch?.[1] || "update from WhatsApp"
    };
  }
  // Build project
  else if (/(build|compile|bundle).*(project|app|executa|axl|tetris)/.test(msg) ||
           /npm (run )?build/.test(msg)) {
    const dirMatch = messageBody.match(/(E:\\[^\s]+|[A-Z]:\\[^\s]+)/i);
    actionOverride = "npm_build";
    argsOverride = { dir: dirMatch?.[1] || "E:\\executa-engine" };
  }
  // Kill port / stop server
  else if (/(stop|kill|close).*(server|dev|port|vite)/.test(msg)) {
    const portMatch = msg.match(/port\s*(\d+)/);
    actionOverride = "kill_port";
    argsOverride = { port: portMatch?.[1] || 5173 };
  }
  // List projects
  else if (/(list|show|what).*(projects?|apps?|folders?)/.test(msg) ||
           /what('?s| is) on my (e )?drive/.test(msg)) {
    actionOverride = "list_projects";
    argsOverride = {};
  }
  // Screenshot
  else if (/(screenshot|screen shot|show screen|what's on screen|whats on screen|show me the (ui|frontend|app|screen))/.test(msg)) {
    actionOverride = "take_screenshot";
    argsOverride = {};
  }
  // Code runner — triggers Claude Code / Antigravity on laptop
  else if (/(build|write|create|code|make|generate).*(script|code|function|app|tool|file|component)/.test(msg) ||
      /^(build|code|make|write|create)\s+me\s+/.test(msg)) {
    actionOverride = "run_claude_code";
    argsOverride = { 
      task: messageBody,  // pass the full original message as the task
      workingDir: "."     // runs in AGENT_SANDBOX_ROOT by default
    };
  }

  const CONFIRM_ACTIONS = new Set(["run_claude_code", "git_push", "npm_build"]);
  if (CONFIRM_ACTIONS.has(actionOverride)) {
    console.log(`[Router] Branch: local_action (regex override requiring confirmation)`);
    const session = sessionStore.getSession(fromNumber);
    session.pendingConfirmation = {
      action: `${actionOverride}(${JSON.stringify(argsOverride)})`,
      args: argsOverride,
      actionName: actionOverride
    };
    reply = `About to run: ${actionOverride} with ${JSON.stringify(argsOverride)}\nReply "yes" to confirm or "no" to cancel.`;
  } else if (actionOverride) {
    console.log(`[Router] Branch: local_action (direct override ${actionOverride})`);
    reply = await runLaptopAction(fromNumber, actionOverride, argsOverride);
  } else if (intent.type === "local_action") {
    console.log(`[Router] Branch: local_action`);
    reply = await planAndRunLocalAction(fromNumber, messageBody);
  } else if (intent.type === "google_action") {
    console.log(`[Router] Branch: google_action`);
    reply = await planAndRunGoogleAction(fromNumber, messageBody);
  } else if (intent.type === "multi_model") {
    console.log(`[Router] Branch: multi_model`);
    reply = await consultMultipleModels(fromNumber, messageBody);
  } else {
    console.log(`[Router] Branch: chat`);
    reply = await askClaude({ message: messageBody, history: session.history });
  }

  sessionStore.pushHistory(fromNumber, "assistant", reply);
  return reply;
}

async function planAndRunLocalAction(fromNumber, messageBody) {
  // Online check removed — job timeout handles offline case

  const raw = await askClaude({ message: messageBody, system: LOCAL_ACTION_SYSTEM_PROMPT });
  console.log(`[planAndRunLocalAction] Raw Claude output:`, raw);
  let plan;
  try {
    const cleanRaw = raw.replace(/^```(json)?/im, "").replace(/```$/im, "").trim();
    plan = JSON.parse(cleanRaw);
    console.log(`[planAndRunLocalAction] Parsed plan:`, plan);
  } catch (err) {
    console.warn(`[planAndRunLocalAction] Failed to parse plan. Error: ${err.message}`);
    return "I couldn't figure out exactly what to run on your laptop — can you rephrase that?";
  }

  if (!plan.action) {
    return plan.clarify || "Can you be more specific about what you want done on your laptop?";
  }

  const NEEDS_CONFIRMATION = new Set(["run_script", "git_push", "npm_build"]); // grow this list as you add riskier actions
  if (NEEDS_CONFIRMATION.has(plan.action)) {
    const session = sessionStore.getSession(fromNumber);
    session.pendingConfirmation = {
      action: `${plan.action}(${JSON.stringify(plan.args)})`,
      args: plan.args,
    };
    // stash the raw action name too
    session.pendingConfirmation.actionName = plan.action;
    return `About to run: ${plan.action} with ${JSON.stringify(plan.args)}\nReply "yes" to confirm or "no" to cancel.`;
  }

  return runLaptopAction(fromNumber, plan.action, plan.args);
}

const todayString = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });



async function planAndRunGoogleAction(fromNumber, messageBody) {
  const today = todayString();
  const msg = messageBody.toLowerCase();

  // Tomorrow's date
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toLocaleDateString("en-CA");

  // Figure out the target date from the message
  const targetDate = msg.includes("tomorrow") ? tomorrowStr : today;

  let action, args;

  // Calendar — list
  if (/(what'?s on|show|list|check|view|see).*(calendar|schedule|events|agenda)/.test(msg) ||
      /calendar.*(today|tomorrow|this week)/.test(msg) ||
      /what.*(today|tomorrow|schedule)/.test(msg)) {
    action = "calendar_list";
    args = { date: targetDate };
  }

  // Calendar — add/schedule
  else if (/(add|schedule|create|set up|book).*(meeting|event|call|standup|appointment|reminder)/.test(msg) ||
           /(meeting|event|call|appointment).*(at|on|tomorrow|today)/.test(msg)) {
    // Extract time like "3pm", "10:30", "3:00pm"
    const timeMatch = msg.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
    let time = "09:00";
    if (timeMatch) {
      let hour = parseInt(timeMatch[1]);
      const mins = timeMatch[2] || "00";
      const period = timeMatch[3]?.toLowerCase();
      if (period === "pm" && hour !== 12) hour += 12;
      if (period === "am" && hour === 12) hour = 0;
      time = `${String(hour).padStart(2, "0")}:${mins}`;
    }
    // Extract title — everything before "at" or "tomorrow" or "today"
    const titleMatch = messageBody.match(/(?:add|schedule|create|set up|book)\s+(?:a\s+)?(.+?)(?:\s+(?:at|on|tomorrow|today)|\s+\d)/i);
    const title = titleMatch?.[1]?.trim() || "New Event";
    action = "calendar_add";
    args = { title, date: targetDate, time, durationMinutes: 60 };
  }

  // Calendar — clear
  else if (/(clear|delete all|remove all).*(calendar|events|schedule)/.test(msg) ||
           /cancel.*(everything|all).*(today|tomorrow)/.test(msg)) {
    action = "calendar_clear";
    args = { date: targetDate };
  }

  // Drive — recent files
  else if (/(recent|latest|today'?s?|modified).*(files?|docs?|documents?)/.test(msg) ||
           /(files?|docs?).*(today|recently|latest)/.test(msg)) {
    action = "drive_recent";
    args = { days: msg.includes("week") ? 7 : 1 };
  }

  // Drive — search
  else if (/(find|search|look for|where is).*(file|doc|document|folder|sheet|slide)/.test(msg)) {
    const queryMatch = msg.match(/(?:find|search for|look for|where is)\s+(.+?)(?:\s+(?:file|doc|document|folder))?$/i);
    action = "drive_search";
    args = { query: queryMatch?.[1]?.trim() || messageBody, maxResults: 8 };
  }

  // Contacts — search
  else if (/(find|get|what'?s|give me).*(number|contact|email|phone).*(of|for)?/.test(msg) ||
           /(number|contact|email|phone).*(of|for)/.test(msg) ||
           /contact.*(named?|called?)/.test(msg)) {
    // Extract name — last word(s) after "of/for" or before "number/contact"
    const nameMatch = msg.match(/(?:of|for)\s+([a-z\s]+?)(?:\s*$|\s*\?)/i) ||
                      msg.match(/find\s+([a-z]+(?:\s+[a-z]+)?)'?s?\s+(?:number|contact|email)/i);
    action = "contacts_search";
    args = { name: nameMatch?.[1]?.trim() || messageBody };
  }

  // Contacts — list all
  else if (/(list|show|all).*(contacts?)/.test(msg)) {
    action = "contacts_list";
    args = { maxResults: 20 };
  }

  // Couldn't match — ask the user
  else {
    return "I understood you want to do something with Google but couldn't figure out exactly what. Try being more specific, like:\n• \"what's on my calendar today\"\n• \"add a meeting at 3pm tomorrow\"\n• \"find Rohan's number\"\n• \"show recent files\"";
  }

  console.log(`[google] action=${action} args=${JSON.stringify(args)}`);

  try {
    return await runGoogleAction(action, args);
  } catch (err) {
    if (err.message.includes("not connected")) {
      return "Google isn't connected yet. Open this in your browser:\nhttp://localhost:3000/google/auth";
    }
    return `Google action failed: ${err.message}`;
  }
}

async function runLaptopAction(fromNumber, actionName, args) {
  console.log(`[Router] Running laptop action: ${actionName}`, args);
  try {
    const result = await sendJobToLaptop({ action: actionName, args });
    if (result.ok) {
      console.log(`[Router] Laptop action succeeded: ${result.output}`);
      return `Done.\n\n${result.output}`;
    }
    console.warn(`[Router] Laptop action failed: ${result.error}`);
    return `That failed: ${result.error}`;
  } catch (err) {
    return `Couldn't reach your laptop agent: ${err.message}`;
  }
}

async function consultMultipleModels(fromNumber, messageBody) {
  const session = sessionStore.getSession(fromNumber);
  const [claudeAnswer, gptAnswer] = await Promise.all([
    askClaude({ message: messageBody, history: session.history }),
    askChatGPT({ message: messageBody, history: session.history }).catch(
      (e) => `(ChatGPT unavailable: ${e.message})`
    ),
  ]);

  return `*Claude says:*\n${claudeAnswer}\n\n*ChatGPT says:*\n${gptAnswer}`;
}
