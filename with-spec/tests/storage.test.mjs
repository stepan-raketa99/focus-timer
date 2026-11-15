import test from 'node:test';
import assert from 'node:assert/strict';
import { HISTORY_KEY, readHistory, writeHistory } from '../storage.mjs';

function memoryStorage() {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}

function record() {
  return { id: 'сессия-1', startedAt: 1000, endedAt: 301000, date: '2026-11-14',
    targetMs: 300000, activeMs: 300000, tasks: [{ id: '1', title: 'Глава', completed: true }] };
}

test('Хранилище: пустая история, запись и независимое повторное чтение', () => {
  const storage = memoryStorage();
  assert.deepEqual(readHistory(storage), { sessions: [], error: null });
  const sessions = [record()];
  assert.equal(writeHistory(storage, sessions).error, null);
  assert.equal(JSON.parse(storage.getItem(HISTORY_KEY)).version, 1);
  assert.deepEqual(readHistory(storage).sessions, sessions);
  const loaded = readHistory(storage);
  loaded.sessions[0].tasks[0].title = 'Изменено';
  assert.deepEqual(readHistory(storage).sessions, sessions);
});

test('Хранилище: повреждённый JSON, версия и структура', () => {
  const storage = memoryStorage();
  for (const raw of ['{', '', 'null', '[]', '{}', '{"version":2,"sessions":[]}',
    '{"version":1,"sessions":{}}', '{"version":1,"sessions":[null]}']) {
    storage.setItem(HISTORY_KEY, raw);
    const loaded = readHistory(storage);
    assert.deepEqual(loaded.sessions, []);
    assert.ok(loaded.error);
  }
});

test('Хранилище: проверка значений и дубликатов', () => {
  const storage = memoryStorage();
  const invalid = [
    { id: '' }, { startedAt: '1000' }, { endedAt: null }, { date: '2026-02-30' },
    { date: '2026-1-1' }, { targetMs: 1 }, { activeMs: 299999 }, { activeMs: Infinity },
    { tasks: [{}] }, { tasks: [{ id: '1', title: ' ', completed: true }] },
    { tasks: [{ id: '1', title: 'Глава', completed: 'да' }] },
    { tasks: [record().tasks[0], record().tasks[0]] },
  ];
  for (const patch of invalid) {
    const sessions = [{ ...record(), ...patch }];
    assert.ok(writeHistory(storage, sessions).error);
    storage.setItem(HISTORY_KEY, JSON.stringify({ version: 1, sessions }));
    assert.ok(readHistory(storage).error);
  }
  assert.ok(writeHistory(storage, [record(), record()]).error);
});

test('Хранилище: исключения чтения и записи не выходят из адаптера', () => {
  const failure = new Error('Хранилище недоступно');
  const storage = { getItem() { throw failure; }, setItem() { throw failure; } };
  assert.deepEqual(readHistory(storage), { sessions: [], error: failure });
  const sessions = [record()];
  const snapshot = structuredClone(sessions);
  assert.equal(writeHistory(storage, sessions).error, failure);
  assert.deepEqual(sessions, snapshot);
  assert.ok(readHistory(undefined).error);
  assert.ok(writeHistory(undefined, sessions).error);
});
