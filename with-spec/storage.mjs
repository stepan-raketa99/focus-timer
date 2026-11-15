import { TARGETS } from './domain.mjs';

export const HISTORY_KEY = 'focus-timer.history.v1';
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isId = value => typeof value === 'string' && value.trim().length > 0;
const isTimestamp = value => Number.isFinite(value) && !Number.isNaN(new Date(value).getTime());

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validRecord(record) {
  return isObject(record) && isId(record.id)
    && isTimestamp(record.startedAt) && isTimestamp(record.endedAt)
    && validDate(record.date) && TARGETS.includes(record.targetMs)
    && Number.isFinite(record.activeMs) && record.activeMs >= record.targetMs
    && Array.isArray(record.tasks) && record.tasks.every(task => isObject(task)
      && isId(task.id) && typeof task.title === 'string' && task.title.trim().length > 0
      && task.title === task.title.trim() && typeof task.completed === 'boolean')
    && new Set(record.tasks.map(task => task.id)).size === record.tasks.length;
}

function validHistory(sessions) {
  return Array.isArray(sessions) && sessions.every(validRecord)
    && new Set(sessions.map(session => session.id)).size === sessions.length;
}

// Передача адаптера позволяет проверять ошибки без браузера.
export function readHistory(storage) {
  try {
    const raw = storage.getItem(HISTORY_KEY);
    if (raw === null) return { sessions: [], error: null };
    const data = JSON.parse(raw);
    if (!isObject(data) || data.version !== 1 || !validHistory(data.sessions)) {
      throw new Error('Недопустимый формат истории');
    }
    return { sessions: data.sessions, error: null };
  } catch (error) {
    return { sessions: [], error };
  }
}

export function writeHistory(storage, sessions) {
  try {
    if (!validHistory(sessions)) throw new Error('Недопустимый формат истории');
    storage.setItem(HISTORY_KEY, JSON.stringify({ version: 1, sessions }));
    return { error: null };
  } catch (error) {
    return { error };
  }
}
