// Simple in-memory session store, keyed by WhatsApp number.
// Swap this for SQLite/Postgres/Redis once you need it to survive restarts
// or scale beyond a single process.

const sessions = new Map();

function getSession(number) {
  if (!sessions.has(number)) {
    sessions.set(number, {
      history: [], // [{role, content}]
      pendingConfirmation: null, // { action, args, laptopAgentId } awaiting "yes"/"no"
    });
  }
  return sessions.get(number);
}

function pushHistory(number, role, content) {
  const session = getSession(number);
  session.history.push({ role, content });
  // Keep the last ~20 turns so the context doesn't grow unbounded
  if (session.history.length > 20) {
    session.history = session.history.slice(-20);
  }
}

export default { getSession, pushHistory };
