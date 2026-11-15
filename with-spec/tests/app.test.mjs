import test from 'node:test';
import assert from 'node:assert/strict';
import { HISTORY_KEY } from '../storage.mjs';

// Минимальный адаптер DOM для проверки связей событий и состояния в Node.js.
// Он не проверяет разметку, CSS, реальный фокус и разрешения браузера.
class Element extends EventTarget {
  constructor(tag = 'div') {
    super();
    this.tagName = tag;
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.textContent = '';
    this.value = '';
    this.hidden = false;
    this.classList = { toggle: (name, enabled) => this.attributes.set(name, enabled) };
  }
  setAttribute(key, value) { this.attributes.set(key, value); }
  removeAttribute(key) { this.attributes.delete(key); }
  append(...children) {
    for (const child of children) { child.parent = this; this.children.push(child); }
  }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  querySelectorAll(tag) {
    return this.children.flatMap(child => [
      ...(child.tagName === tag ? [child] : []), ...child.querySelectorAll(tag),
    ]);
  }
  querySelector(tag) { return this.querySelectorAll(tag)[0] ?? null; }
  focus() { this.focused = true; }
  remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); }
  get nextElementSibling() { return this.parent.children[this.parent.children.indexOf(this) + 1]; }
  get previousElementSibling() { return this.parent.children[this.parent.children.indexOf(this) - 1]; }
}

let importNumber = 0;
async function launch(t, { data = new Map(), readError = false, writeError = false, fullscreen = 'success' } = {}) {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  const document = new Element();
  document.body = new Element('body');
  document.documentElement = new Element('html');
  document.getElementById = get;
  document.createElement = tag => new Element(tag);
  document.fullscreenEnabled = true;
  if (fullscreen !== 'missing') document.documentElement.requestFullscreen = async () => {
    if (fullscreen === 'reject') throw new Error('Отказ fullscreen');
    document.fullscreenElement = document.documentElement;
    document.dispatchEvent(new Event('fullscreenchange'));
  };
  document.exitFullscreen = async () => {
    document.fullscreenElement = null;
    document.dispatchEvent(new Event('fullscreenchange'));
  };
  for (const value of [3600000, 1800000, 300000]) {
    const input = new Element('input');
    input.value = String(value);
    get('modes').append(input);
  }
  const window = { localStorage: {
    getItem(key) { if (readError) throw new Error('Отказ чтения'); return data.get(key) ?? null; },
    setItem(key, value) { if (writeError) throw new Error('Отказ записи'); data.set(key, value); },
  } };
  for (const [key, value] of Object.entries({ document, window })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, key, previous);
      else delete globalThis[key];
    });
  }
  let now = new Date(2026, 10, 14, 12).getTime();
  let tick;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'setInterval', callback => { tick = callback; });
  await import(`../app.mjs?test=${++importNumber}`);
  const event = (id, type = 'click', target) => {
    const event = new Event(type, { cancelable: true });
    if (target) Object.defineProperty(event, 'target', { value: target });
    get(id).dispatchEvent(event);
  };
  return { get, event, document, data, tick: () => tick(),
    advance: ms => { now += ms; },
    add: title => { get('task-title').value = title; event('task-form', 'submit'); },
  };
}

test('UI-адаптер T1–T5: события, пауза, превышение, снимок и восстановление', async t => {
  const app = await launch(t);
  const { get, event, advance, tick, add, data } = app;
  assert.equal(get('target-label').textContent, '01:00:00');
  event('modes', 'change', { value: '1800000' });
  add('   ');
  assert.equal(get('task-list').children.length, 0);
  assert.equal(get('task-error').hidden, false);
  add('<img src=x onerror=alert(1)>');
  add('Вторая');
  const first = get('task-list').children[0];
  assert.equal(first.querySelector('span').textContent, '<img src=x onerror=alert(1)>');
  first.querySelector('input').dispatchEvent(new Event('change'));
  event('primary-action');
  assert.equal(get('modes').disabled, true);
  advance(15 * 60000);
  tick();
  assert.equal(get('progress-label').textContent, '50%');
  assert.equal(get('task-list').children[0], first);
  event('primary-action');
  advance(3 * 60000);
  tick();
  assert.equal(get('timer').textContent, '00:15:00');
  event('modes', 'change', { value: '300000' });
  assert.equal(get('target-label').textContent, '00:30:00');
  add('На паузе');
  get('task-list').children[2].querySelector('button').dispatchEvent(new Event('click'));
  assert.equal(get('task-list').children.length, 2);
  event('primary-action');
  advance(20 * 60000);
  app.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(get('timer').textContent, '00:35:00');
  assert.equal(get('progress-label').textContent, '100%');
  assert.equal(data.has(HISTORY_KEY), false);
  event('finish');
  assert.equal(get('timer').textContent, '00:00:00');
  assert.equal(get('target-label').textContent, '00:30:00');
  assert.equal(get('modes').disabled, false);
  assert.equal(get('task-list').children.length, 0);
  assert.equal(get('total-time').textContent, '00:35:00');
  const saved = data.get(HISTORY_KEY);
  const record = JSON.parse(saved).sessions[0];
  assert.equal(record.activeMs, 35 * 60000);
  assert.equal(record.endedAt - record.startedAt, 38 * 60000);
  assert.deepEqual(record.tasks.map(task => task.completed), [true, false]);
  event('finish');
  add('Следующая сессия');
  event('primary-action');
  advance(1000);
  event('finish');
  assert.equal(data.get(HISTORY_KEY), saved);
  assert.equal(get('task-list').children.length, 0);
  // Новая загрузка получает новый DOM без прежних обработчиков, но то же хранилище.
  await t.test('Восстановление в новом DOM и смена дня', async reloadTest => {
    const reopened = await launch(reloadTest, { data });
    assert.equal(reopened.get('session-count').textContent, '1');
    assert.equal(reopened.get('total-time').textContent, '00:35:00');
    assert.equal(reopened.get('target-label').textContent, '01:00:00');
    assert.equal(reopened.get('task-list').children.length, 0);
    reopened.advance(24 * 60 * 60000);
    reopened.document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(reopened.get('session-count').textContent, '0');
  });
});

test('UI-адаптер: ошибки чтения и записи не нарушают завершение', async t => {
  const { get, event, advance, add } = await launch(t, { readError: true, writeError: true });
  assert.equal(get('storage-message').hidden, false);
  event('modes', 'change', { value: '300000' });
  add('Задача');
  event('primary-action');
  advance(300000);
  event('finish');
  assert.equal(get('session-count').textContent, '1');
  assert.equal(get('timer').textContent, '00:00:00');
  assert.equal(get('task-list').children.length, 0);
  assert.match(get('storage-message').textContent, /Не удалось сохранить/);
  event('finish');
  assert.equal(get('session-count').textContent, '1');
});

for (const fullscreen of ['success', 'reject', 'missing']) {
  test(`UI-адаптер: концентрация и fullscreen (${fullscreen})`, async t => {
    const { get, event, document, add, advance, tick } = await launch(t, { fullscreen });
    add('Сохранить задачу');
    for (const state of ['idle', 'running', 'paused']) {
      if (state !== 'idle') event('primary-action');
      advance(1000);
      tick();
      const time = get('timer').textContent;
      const primary = get('primary-action').textContent;
      event('focus-toggle');
      assert.equal(document.body.attributes.get('focus-mode'), true);
      event('fullscreen');
      await new Promise(resolve => setImmediate(resolve));
      if (fullscreen === 'success') {
        assert.ok(document.fullscreenElement);
        await document.exitFullscreen(); // Событие выхода, аналогичное Escape.
        assert.equal(document.body.attributes.get('focus-mode'), true);
        event('fullscreen');
        await new Promise(resolve => setImmediate(resolve));
      } else {
        assert.equal(get('fullscreen-message').hidden, false);
      }
      event('focus-toggle');
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(Boolean(document.fullscreenElement), false);
      assert.equal(document.body.attributes.get('focus-mode'), false);
      assert.equal(get('timer').textContent, time);
      assert.equal(get('primary-action').textContent, primary);
      assert.equal(get('task-list').children.length, 1);
    }
    event('focus-toggle');
    event('dismiss-fullscreen');
    assert.equal(get('fullscreen-offer').hidden, true);
    assert.equal(document.body.attributes.get('focus-mode'), true);
  });
}
