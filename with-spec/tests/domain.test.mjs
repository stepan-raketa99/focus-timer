import test from 'node:test';
import assert from 'node:assert/strict';
import { TARGETS, createSession, selectTarget, start, pause, resume, activeTime, formatDuration, progress, finish } from '../domain.mjs';
import { addTask, toggleTask, removeTask } from '../domain.mjs';
import { localDate, todayStatistics } from '../domain.mjs';

const minute = 60_000;

test('T5: сегодняшние 35+60 минут, вчерашняя запись и порядок истории', () => {
  const now = new Date(2026, 10, 14, 18).getTime();
  const result = (at, target, duration, id) => finish(start(createSession(target * minute), at), at + duration * minute, id).result;
  const yesterday = result(new Date(2026, 10, 13, 10).getTime(), 30, 30, 'вчера');
  const first = result(new Date(2026, 10, 14, 10).getTime(), 30, 35, 'первая');
  const second = result(new Date(2026, 10, 14, 12).getTime(), 60, 60, 'вторая');
  const history = [first, yesterday, second];
  const stats = todayStatistics(history, now);
  assert.equal(stats.date, '2026-11-14');
  assert.equal(stats.count, 2);
  assert.equal(formatDuration(stats.activeMs), '01:35:00');
  assert.deepEqual(stats.sessions, [second, first]);
  assert.deepEqual(history, [first, yesterday, second]);
  assert.deepEqual(todayStatistics([], now), { date: '2026-11-14', sessions: [], count: 0, activeMs: 0 });
  assert.equal(todayStatistics(history, new Date(2026, 10, 15).getTime()).count, 0);
});

test('T5: переход через местную полночь и сумма до округления', () => {
  const at = new Date(2026, 10, 13, 23, 58).getTime();
  const endedAt = at + 5 * minute;
  const result = finish(start(createSession(5 * minute), at), endedAt, 'полночь').result;
  assert.equal(localDate(at), '2026-11-13');
  assert.equal(result.date, '2026-11-14');
  assert.equal(todayStatistics([result], at).count, 0);
  assert.equal(todayStatistics([result], endedAt).activeMs, 5 * minute);
  const other = { ...result, id: 'другая', activeMs: 300600 };
  assert.equal(formatDuration(todayStatistics([{ ...result, activeMs: 300600 }, other], endedAt).activeMs), '00:10:01');
});

test('T4/T5: очистка задач и независимый снимок успешной сессии', () => {
  let session = addTask(addTask(createSession(5 * minute), 'Первая'), 'Вторая');
  session = toggleTask(session, session.tasks[0].id);
  session = start(session, 0);
  assert.deepEqual(finish(session, 5 * minute - 1).session.tasks, []);
  assert.equal(finish(session, 5 * minute - 1).result, null);
  const outcome = finish(session, 5 * minute);
  assert.deepEqual(outcome.session.tasks, []);
  assert.deepEqual(outcome.result.tasks.map(({ title, completed }) => ({ title, completed })), [
    { title: 'Первая', completed: true }, { title: 'Вторая', completed: false },
  ]);
  const snapshot = structuredClone(outcome.result);
  let next = addTask(outcome.session, 'Новая');
  next = toggleTask(next, next.tasks[0].id);
  next = removeTask(next, next.tasks[0].id);
  session.tasks[0].title = 'Изменён исходный объект';
  session.tasks[1].completed = true;
  assert.deepEqual(outcome.result, snapshot);
});

test('T5: задачи в idle/running/paused, пустые и одинаковые названия', () => {
  const idle = createSession();
  for (let session of [idle, start(idle, 0), pause(start(idle, 0), 100)]) {
    const status = session.status;
    assert.equal(addTask(session, ''), session);
    assert.equal(addTask(session, ' \t\n '), session);
    session = addTask(addTask(session, ' Глава '), 'Глава');
    const [first, second] = session.tasks;
    assert.equal(first.title, 'Глава');
    assert.equal(first.completed, false);
    assert.notEqual(first.id, second.id);
    session = toggleTask(session, first.id);
    assert.equal(session.tasks[0].completed, true);
    assert.equal(session.tasks[1].completed, false);
    session = toggleTask(session, first.id);
    assert.equal(session.tasks[0].completed, false);
    session = removeTask(session, first.id);
    assert.deepEqual(session.tasks, [second]);
    session = addTask(session, 'Следующая');
    assert.notEqual(session.tasks[1].id, first.id);
    assert.notEqual(session.tasks[1].id, second.id);
    assert.equal(session.status, status);
    assert.deepEqual(removeTask(session, 'нет').tasks, session.tasks);
    assert.deepEqual(toggleTask(session, 'нет').tasks, session.tasks);
  }
});

test('T4: завершение до, на и после цели из running и paused', () => {
  for (const targetMs of TARGETS) {
    for (const duration of [targetMs - 1, targetMs, targetMs + 5 * minute]) {
      for (const paused of [false, true]) {
        let session = start(createSession(targetMs), 1000);
        if (paused) session = pause(session, 1000 + duration);
        const endedAt = 1000 + duration + (paused ? 10 * minute : 0);
        const outcome = finish(session, endedAt);
        assert.equal(Boolean(outcome.result), duration >= targetMs);
        if (outcome.result) {
          assert.equal(outcome.result.activeMs, duration);
          assert.equal(outcome.result.startedAt, 1000);
          assert.equal(outcome.result.endedAt, endedAt);
        }
        assert.equal(outcome.session.status, 'idle');
        assert.equal(outcome.session.targetMs, targetMs);
        assert.equal(activeTime(outcome.session, endedAt), 0);
        assert.equal(progress(outcome.session, endedAt), 0);
        assert.equal(finish(outcome.session, endedAt).result, null);
        assert.equal(selectTarget(outcome.session, 30 * minute).targetMs, 30 * minute);
      }
    }
  }
});

test('T2: форматирование границ, округление вниз и часы после суток', () => {
  for (const [ms, expected] of [[0, '00:00:00'], [59_999, '00:00:59'],
    [60_000, '00:01:00'], [3_599_999, '00:59:59'], [3_600_000, '01:00:00'],
    [90_000_000, '25:00:00'], [-1, '00:00:00']]) {
    assert.equal(formatDuration(ms), expected);
  }
});

test('T2/T3: задержанные обновления, отрицательная разница и превышение цели', () => {
  const session = start(createSession(30 * minute), 1000);
  assert.equal(activeTime(session, 0), 0);
  assert.equal(progress(session, 0), 0);
  assert.equal(progress(session, 1000 + 15 * minute), 50);
  assert.equal(progress(session, 1000 + 35 * minute), 100);
  assert.equal(formatDuration(activeTime(session, 1000 + 35 * minute)), '00:35:00');
  assert.equal(session.status, 'running');
  assert.equal(activeTime(session, 1000 + 36 * minute), 36 * minute);
});

test('T1: цели, исходное состояние и запрет смены цели после старта', () => {
  assert.deepEqual(TARGETS, [60 * minute, 30 * minute, 5 * minute]);
  const initial = createSession();
  assert.equal(initial.status, 'idle');
  assert.equal(initial.targetMs, 60 * minute);
  for (const target of TARGETS) assert.equal(selectTarget(initial, target).targetMs, target);
  assert.equal(selectTarget(initial, 1), initial);
  assert.throws(() => createSession(1), RangeError);
  const running = start(selectTarget(initial, 5 * minute), 100);
  assert.equal(selectTarget(running, 30 * minute), running);
  const paused = pause(running, 200);
  assert.equal(selectTarget(paused, 60 * minute), paused);
});

test('T2: старт, несколько пауз, продолжение и повторные действия', () => {
  const idle = createSession();
  assert.equal(pause(idle, 0), idle);
  assert.equal(resume(idle, 0), idle);
  let session = start(idle, 0);
  assert.equal(start(session, 100), session);
  assert.equal(resume(session, 100), session);
  assert.equal(activeTime(session, 10 * minute), 10 * minute);
  session = pause(session, 10 * minute);
  assert.equal(pause(session, 11 * minute), session);
  assert.equal(start(session, 11 * minute), session);
  assert.equal(activeTime(session, 13 * minute), 10 * minute);
  session = resume(session, 13 * minute);
  assert.equal(activeTime(session, 15 * minute), 12 * minute);
  session = pause(session, 15 * minute);
  session = resume(session, 20 * minute);
  assert.equal(activeTime(session, 21 * minute), 13 * minute);
  assert.equal(session.startedAt, 0);
  assert.equal(idle.status, 'idle');
});
