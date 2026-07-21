import { nanoid } from "nanoid";

// Single source of truth — plain global object
global.__agentState = global.__agentState || {
  lastSeen: {},
  jobQueue: new Map(),
  resultQueue: {},
};

const state = global.__agentState;

export function isLaptopAgentOnline(agentId = "default-laptop") {
  const last = state.lastSeen[agentId];
  if (!last) return false;
  return Date.now() - last < 15000;
}

export function attachLaptopAgentServer() {}

export function sendJobToLaptop({ action, args = {}, agentId = "default-laptop", timeoutMs = 30000 }) {
  return new Promise((resolve, reject) => {
    const jobId = nanoid();
    const timeout = setTimeout(() => {
      state.jobQueue.delete(jobId);
      reject(new Error("Laptop agent did not respond in time."));
    }, timeoutMs);
    state.jobQueue.set(jobId, { resolve, reject, timeout });
    if (!state.resultQueue[agentId]) state.resultQueue[agentId] = [];
    state.resultQueue[agentId].push({ jobId, action, args });
    console.log(`[laptop] queued job ${jobId} action=${action}`);
  });
}

export function getQueuedJobs(agentId) {
  state.lastSeen[agentId] = Date.now();
  const jobs = state.resultQueue[agentId] || [];
  state.resultQueue[agentId] = [];
  return jobs;
}

export function resolveJob(jobId, result) {
  const pending = state.jobQueue.get(jobId);
  if (!pending) return;
  clearTimeout(pending.timeout);
  if (result.ok) pending.resolve(result);
  else pending.reject(new Error(result.error));
  state.jobQueue.delete(jobId);
}
