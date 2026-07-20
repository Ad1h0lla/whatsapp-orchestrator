// Job queue — in memory on the Render server
const jobQueue = new Map();     // jobId -> { action, args, resolve, reject, timeout }
const resultQueue = new Map();  // agentId -> [{ jobId, action, args }]
let agentLastSeen = new Map();  // agentId -> timestamp

export function isLaptopAgentOnline(agentId = "default-laptop") {
  const last = agentLastSeen.get(agentId);
  if (!last) return false;
  return Date.now() - last < 15000; // online if polled within last 15 seconds
}

export function attachLaptopAgentServer(httpServer) {
  // No-op — polling routes are added directly in server.js
}

export function sendJobToLaptop({ action, args = {}, agentId = "default-laptop", timeoutMs = 30000 }) {
  return new Promise((resolve, reject) => {
    const jobId = Math.random().toString(36).slice(2);
    const timeout = setTimeout(() => {
      jobQueue.delete(jobId);
      reject(new Error("Laptop agent did not respond in time."));
    }, timeoutMs);

    jobQueue.set(jobId, { resolve, reject, timeout });

    if (!resultQueue.has(agentId)) resultQueue.set(agentId, []);
    resultQueue.get(agentId).push({ jobId, action, args });

    console.log(`[laptop] queued job ${jobId} action=${action}`);
  });
}

export function getQueuedJobs(agentId) {
  agentLastSeen.set(agentId, Date.now());
  const jobs = resultQueue.get(agentId) || [];
  resultQueue.set(agentId, []);
  return jobs;
}

export function resolveJob(jobId, result) {
  const pending = jobQueue.get(jobId);
  if (!pending) return;
  clearTimeout(pending.timeout);
  if (result.ok) pending.resolve(result);
  else pending.reject(new Error(result.error));
  jobQueue.delete(jobId);
}
