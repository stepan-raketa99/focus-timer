// A shared namespace allows direct file:// use without a server or module fetching.
(() => {
  'use strict';
  const MODES = Object.freeze([3600, 1800, 300]);
  const createSession = () => ({
    target: MODES[0], status: 'idle', elapsedMs: 0,
    runningSince: null, startedAt: null, tasks: [],
  });
  const elapsedMilliseconds = (session, now) => session.elapsedMs +
    (session.status === 'running' ? Math.max(0, now - session.runningSince) : 0);
  const progress = (elapsedMs, targetSeconds) =>
    Math.min(100, Math.max(0, elapsedMs / (targetSeconds * 1000) * 100));
  const isSuccessful = (elapsedMs, targetSeconds) => elapsedMs >= targetSeconds * 1000;
  function formatTime(milliseconds) {
    const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
    return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
      .map(value => String(value).padStart(2, '0')).join(':');
  }
  function selectMode(session, target) {
    return session.status === 'idle' && MODES.includes(target) ? { ...session, target } : session;
  }
  function start(session, now, wallTime) {
    return session.status === 'idle' ? {
      ...session, status: 'running', runningSince: now, startedAt: wallTime,
    } : session;
  }
  function pause(session, now) {
    return session.status === 'running' ? {
      ...session, elapsedMs: elapsedMilliseconds(session, now), status: 'paused', runningSince: null,
    } : session;
  }
  function resume(session, now) {
    return session.status === 'paused' ? { ...session, status: 'running', runningSince: now } : session;
  }
  function addTask(session, title, id) {
    const name = title.trim();
    return name && !session.tasks.some(task => task.id === id)
      ? { ...session, tasks: [...session.tasks, { id, title: name, completed: false }] } : session;
  }
  const toggleTask = (session, id) => ({ ...session,
    tasks: session.tasks.map(task => task.id === id ? { ...task, completed: !task.completed } : task),
  });
  const deleteTask = (session, id) => ({ ...session, tasks: session.tasks.filter(task => task.id !== id) });
  function finish(session, now, wallTime) {
    const durationMs = elapsedMilliseconds(session, now);
    const record = session.status !== 'idle' && isSuccessful(durationMs, session.target) ? {
      startedAt: session.startedAt, endedAt: wallTime, durationMs,
      tasks: session.tasks.map(task => ({ ...task })),
    } : null;
    return { session: { ...createSession(), target: session.target }, record };
  }
  function dateKey(timestamp) {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  }
  const todayRecords = (records, today) => records.filter(record => dateKey(record.endedAt) === dateKey(today));
  const totalDuration = records => records.reduce((sum, record) => sum + record.durationMs, 0);
  globalThis.FocusTimerDomain = Object.freeze({ MODES, createSession, elapsedMilliseconds,
    progress, isSuccessful, formatTime, selectMode, start, pause, resume,
    addTask, toggleTask, deleteTask, finish, todayRecords, totalDuration });
})();
