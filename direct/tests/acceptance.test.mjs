import test from 'node:test';
import assert from 'node:assert/strict';
import '../domain.mjs';

const D = globalThis.FocusTimerDomain;
const minute = 60_000;
const wall = new Date(2026, 10, 13, 10, 0).getTime();

test('T1. Цели 60/30/5 минут, по умолчанию 60; блокировка режима при работе и паузе', () => {
  const initial = D.createSession();
  assert.deepEqual(D.MODES, [3600, 1800, 300]);
  assert.equal(initial.target, 3600);
  for (const target of D.MODES) {
    const selected = D.selectMode(initial, target);
    assert.equal(selected.target, target);
    const running = D.start(selected, 0, wall);
    const other = target === 300 ? 1800 : 300;
    assert.equal(D.selectMode(running, other).target, target);
    const paused = D.pause(running, 1000);
    assert.equal(D.selectMode(paused, other).target, target);
    const finished = D.finish(paused, 2000, wall + 2000).session;
    assert.equal(D.selectMode(finished, other).target, other);
  }
  assert.equal(initial.target, 3600, 'выбор режима не изменяет исходное состояние');
});

test('T2. Реальное время, паузы и продолжение; формат ЧЧ:ММ:СС', () => {
  let session = D.start(D.createSession(), 500, wall);
  assert.equal(D.elapsedMilliseconds(session, 500), 0);
  assert.equal(D.elapsedMilliseconds(session, 1734), 1234);
  // No update calls are needed between timestamps.
  assert.equal(D.elapsedMilliseconds(session, 60_500), minute);
  session = D.pause(session, 60_500);
  assert.equal(D.elapsedMilliseconds(session, 180_500), minute);
  session = D.resume(session, 180_500);
  assert.equal(D.elapsedMilliseconds(session, 180_500), minute);
  assert.equal(D.elapsedMilliseconds(session, 240_500), 2 * minute);
  session = D.pause(session, 240_500);
  session = D.resume(session, 300_500);
  assert.equal(D.elapsedMilliseconds(session, 301_500), 121_000);
  assert.equal(D.formatTime(59_999), '00:00:59');
  assert.equal(D.formatTime(minute), '00:01:00');
  assert.equal(D.formatTime(3_599_999), '00:59:59');
  assert.equal(D.formatTime(60 * minute), '01:00:00');
});

test('T3. Цель 30 минут: 15 минут = 50%, 35 минут = 100%, отсчёт продолжается', () => {
  const session = D.start(D.selectMode(D.createSession(), 1800), 0, wall);
  assert.equal(D.progress(D.elapsedMilliseconds(session, 15 * minute), session.target), 50);
  assert.equal(D.progress(D.elapsedMilliseconds(session, 35 * minute), session.target), 100);
  assert.equal(session.status, 'running');
  assert.equal(D.elapsedMilliseconds(session, 36 * minute), 36 * minute);
});

test('T4. Сохранение только после цели и ручного завершения; фактическое время и сброс', () => {
  const session = D.start(D.selectMode(D.createSession(), 1800), 0, wall);
  assert.equal(D.isSuccessful(30 * minute - 1, 1800), false);
  assert.equal(D.isSuccessful(30 * minute, 1800), true);
  for (const duration of [30 * minute - 1, 30 * minute, 35 * minute]) {
    const result = D.finish(session, duration, wall + duration);
    if (duration < 30 * minute) assert.equal(result.record, null);
    else {
      assert.equal(result.record.durationMs, duration);
      assert.equal(result.record.startedAt, wall);
      assert.equal(result.record.endedAt, wall + duration);
    }
    assert.equal(result.session.status, 'idle');
    assert.equal(D.elapsedMilliseconds(result.session, duration + minute), 0);
    assert.equal(D.formatTime(result.session.elapsedMs), '00:00:00');
    assert.equal(result.session.startedAt, null);
  }
  const paused = D.pause(session, 35 * minute);
  const result = D.finish(paused, 50 * minute, wall + 50 * minute);
  assert.equal(result.record.durationMs, 35 * minute, 'пауза не входит в длительность');
  assert.equal(result.record.endedAt, wall + 50 * minute);
  assert.equal(D.finish(result.session, 51 * minute, wall + 51 * minute).record, null);
});

test('T5. Задачи, очистка и история успешных сессий за дату завершения', () => {
  let session = D.selectMode(D.createSession(), 300);
  session = D.addTask(session, '', 0);
  session = D.addTask(session, '   ', 1);
  assert.deepEqual(session.tasks, []);
  session = D.addTask(session, '  Прочитать главу  ', 2);
  session = D.addTask(session, 'Решить упражнения', 3);
  session = D.addTask(session, 'Лишняя задача', 4);
  session = D.deleteTask(session, 4);
  session = D.start(session, 0, wall);
  session = D.pause(session, minute);
  session = D.toggleTask(session, 2);
  session = D.addTask(session, 'Проверить ответы', 5);
  session = D.deleteTask(session, 5);
  assert.deepEqual(session.tasks, [
    { id: 2, title: 'Прочитать главу', completed: true },
    { id: 3, title: 'Решить упражнения', completed: false },
  ]);
  const early = D.finish(session, 2 * minute, wall + 2 * minute);
  assert.equal(early.record, null);
  assert.deepEqual(early.session.tasks, []);
  session = D.resume(session, 2 * minute);
  const result = D.finish(session, 7 * minute, wall + 7 * minute);
  assert.deepEqual(result.session.tasks, []);
  assert.equal(result.record.startedAt, wall);
  assert.equal(result.record.endedAt, wall + 7 * minute);
  assert.equal(result.record.durationMs, 6 * minute);
  assert.deepEqual(result.record.tasks, session.tasks);
  assert.notEqual(result.record.tasks[0], session.tasks[0], 'история содержит независимый снимок задач');
  // JSON roundtrip matches the localStorage representation.
  const saved = JSON.parse(JSON.stringify([result.record]));
  const yesterday = new Date(2026, 10, 12, 23, 58).getTime();
  const crossMidnight = { startedAt: yesterday, endedAt: new Date(2026, 10, 13, 0, 5).getTime(), durationMs: 7 * minute, tasks: [] };
  const old = { ...crossMidnight, endedAt: yesterday };
  const today = D.todayRecords([...saved, crossMidnight, old], wall);
  assert.equal(today.length, 2);
  assert.equal(D.totalDuration(today), 13 * minute);
  assert.deepEqual(today[0].tasks, session.tasks);
});
