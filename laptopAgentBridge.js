import { WebSocketServer } from "ws";
import { nanoid } from "nanoid";

// Tracks connected laptop agents: agentId -> ws connection
const connectedAgents = new Map();
// Tracks in-flight job requests: jobId -> { resolve, reject, timeout }
const pendingJobs = new Map();

export function attachLaptopAgentServer(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: "/agent-socket" });

  wss.on("connection", (ws, req) => {
    let agentId = null;

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.type === "auth") {
        if (msg.secret !== process.env.AGENT_SHARED_SECRET) {
          ws.close(4001, "bad secret");
          return;
        }
        agentId = msg.agentId || "default-laptop";
        connectedAgents.set(agentId, ws);
        ws.send(JSON.stringify({ type: "auth_ok" }));
        console.log(`[agent-socket] laptop agent connected: ${agentId}`);
        return;
      }

      if (msg.type === "job_result") {
        const pending = pendingJobs.get(msg.jobId);
        if (pending) {
          clearTimeout(pending.timeout);
          pending.resolve(msg);
          pendingJobs.delete(msg.jobId);
        }
        return;
      }
    });

    ws.on("close", () => {
      if (agentId) {
        connectedAgents.delete(agentId);
        console.log(`[agent-socket] laptop agent disconnected: ${agentId}`);
      }
    });
  });

  return wss;
}

export function isLaptopAgentOnline(agentId = "default-laptop") {
  return connectedAgents.has(agentId);
}

/**
 * Send a job to the laptop agent and wait for its result.
 * action: string identifying which whitelisted action to run
 * args: object of arguments for that action
 */
export function sendJobToLaptop({ action, args = {}, agentId = "default-laptop", timeoutMs = 20000 }) {
  const ws = connectedAgents.get(agentId);
  if (!ws) {
    console.error(`[agent-socket] Failed to send job, laptop agent '${agentId}' is not connected.`);
    return Promise.reject(new Error("Laptop agent is not connected right now."));
  }

  const jobId = nanoid();
  const payload = JSON.stringify({ type: "job", jobId, action, args });
  console.log(`[agent-socket] Sending job ${jobId} to laptop agent '${agentId}':`, { action, args });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingJobs.delete(jobId);
      reject(new Error("Laptop agent did not respond in time."));
    }, timeoutMs);

    pendingJobs.set(jobId, { resolve, reject, timeout });
    ws.send(payload);
  });
}
