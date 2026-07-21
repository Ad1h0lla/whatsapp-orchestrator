import { nanoid } from "nanoid";

const jobQueue = new Map();
const resultQueue = new Map();
const agentLastSeen = {};  // plain object instead of Map

export function isLaptopAgentOnline(agentId = "default-laptop") {
  const last = agentLastSeen[agentId];
  if (!last) return false;
  const diff = Date.now() - last;
  console.log(`[online-check] agentId=${agentId} last=${last} diff=${diff}ms online=${diff < 15000}`);
  return diff < 15000;
}

export function attachLaptopAgentServer(httpServer) {
  // no-op — polling routes in server.js
}

export function sendJobToLaptop({ action, args = {}, agentId = "default-laptop", timeoutMs = 30000 }) {
  return new Promise((resolve, reject) => {
    const jobId = nanoid();
    const timeout = setTimeout(() => {
      jobQueue.delete(jobId);
      reject(new Error("Laptop agent did not respond in time."));
    }, timeoutMs);

    jobQueue.set(jobId, { resolve, reject, timeout });

    if (!resultQueue[agentId]) resultQueue[agentId] = [];
    resultQueue[agentId].push({ jobId, action, args });

    console.log(`[laptop] queued job ${jobId} action=${action}`);
  });
}

export function getQueuedJobs(agentId) {
  agentLastSeen[agentId] = Date.now();
  console.log(`[laptop] agentLastSeen[${agentId}] = ${agentLastSeen[agentId]}`);
  const jobs = resultQueue[agentId] || [];
  resultQueue[agentId] = [];
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
