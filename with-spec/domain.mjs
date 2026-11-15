export const TARGETS = Object.freeze([60, 30, 5].map(minutes => minutes * 60_000));

export function createSession(targetMs = TARGETS[0]) {
  if (!TARGETS.includes(targetMs)) throw new RangeError('Неизвестная цель');
  return { status: 'idle', targetMs, accumulatedMs: 0, segmentStartedAt: null, startedAt: null, tasks: [], nextTaskId: 1 };
}

export function selectTarget(session, targetMs) {
  return session.status === 'idle' && TARGETS.includes(targetMs)
    ? { ...session, targetMs } : session;
}

export function start(session, nowMs) {
  return session.status === 'idle'
    ? { ...session, status: 'running', startedAt: nowMs, segmentStartedAt: nowMs } : session;
}

export function activeTime(session, nowMs) {
  return session.accumulatedMs + (session.status === 'running'
    ? Math.max(0, nowMs - session.segmentStartedAt) : 0);
}

export function pause(session, nowMs) {
  return session.status === 'running'
    ? { ...session, status: 'paused', accumulatedMs: activeTime(session, nowMs), segmentStartedAt: null } : session;
}

export function resume(session, nowMs) {
  return session.status === 'paused'
    ? { ...session, status: 'running', segmentStartedAt: nowMs } : session;
}

export function formatDuration(durationMs) {
  const seconds = Math.floor(Math.max(0, durationMs) / 1000);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(value => String(value).padStart(2, '0')).join(':');
}

export function progress(session, nowMs) {
  return Math.min(100, Math.max(0, activeTime(session, nowMs) / session.targetMs * 100));
}

export function finish(session, nowMs, id = `${session.startedAt}-${nowMs}`) {
  if (session.status === 'idle') return { session, result: null };
  const activeMs = activeTime(session, nowMs);
  const result = activeMs >= session.targetMs
    ? { id, date: localDate(nowMs), startedAt: session.startedAt, endedAt: nowMs, targetMs: session.targetMs, activeMs,
      tasks: session.tasks.map(task => ({ ...task })) } : null;
  return { session: createSession(session.targetMs), result };
}

export function addTask(session, title) {
  const trimmed = title.trim();
  if (!trimmed) return session;
  const task = { id: String(session.nextTaskId), title: trimmed, completed: false };
  return { ...session, nextTaskId: session.nextTaskId + 1, tasks: [...session.tasks, task] };
}

export function toggleTask(session, id) {
  return { ...session, tasks: session.tasks.map(task => task.id === id
    ? { ...task, completed: !task.completed } : task) };
}

export function removeTask(session, id) {
  return { ...session, tasks: session.tasks.filter(task => task.id !== id) };
}

export function localDate(nowMs) {
  const date = new Date(nowMs);
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((value, index) => String(value).padStart(index === 0 ? 4 : 2, '0')).join('-');
}

export function todayStatistics(history, nowMs) {
  const date = localDate(nowMs);
  const sessions = history.filter(session => session.date === date)
    .sort((a, b) => b.endedAt - a.endedAt);
  return { date, sessions, count: sessions.length,
    activeMs: sessions.reduce((total, session) => total + session.activeMs, 0) };
}
