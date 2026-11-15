import {
  createSession, selectTarget, start, pause, resume, finish,
  activeTime, formatDuration, progress, addTask, toggleTask, removeTask,
  localDate, todayStatistics,
} from './domain.mjs';
import { readHistory, writeHistory } from './storage.mjs';

const byId = id => document.getElementById(id);
const elements = Object.fromEntries([
  'modes', 'timer', 'target-label', 'progress', 'progress-label', 'session-status',
  'primary-action', 'finish', 'task-form', 'task-title', 'task-error', 'task-list',
  'tasks-empty', 'task-count', 'today-date', 'session-count', 'total-time',
  'history-list', 'history-empty', 'storage-message',
].map(id => [id, byId(id)]));

let session = createSession();
// Получение самого window.localStorage тоже может выбросить SecurityError.
const storage = {
  getItem: key => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
};
const restored = readHistory(storage);
let history = restored.sessions;
let renderedDate = null;

function message(element, text = '') {
  element.textContent = text;
  element.hidden = !text;
}

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function renderTimer(nowMs) {
  const percentage = progress(session, nowMs);
  elements.timer.textContent = formatDuration(activeTime(session, nowMs));
  elements['target-label'].textContent = formatDuration(session.targetMs);
  elements.progress.value = percentage;
  elements['progress-label'].textContent = `${Math.floor(percentage)}%`;
  elements.modes.disabled = session.status !== 'idle';
  for (const input of elements.modes.querySelectorAll('input')) {
    input.checked = Number(input.value) === session.targetMs;
  }
  elements['primary-action'].textContent = {
    idle: 'Старт', running: 'Пауза', paused: 'Продолжить',
  }[session.status];
  elements.finish.disabled = session.status === 'idle';
  elements['session-status'].textContent = {
    idle: 'Время сосредоточиться',
    running: percentage >= 100 ? 'Цель достигнута — завершите, когда будете готовы' : 'Время для важного',
    paused: 'Пауза — продолжите, когда будете готовы',
  }[session.status];
}

function renderTaskCount() {
  elements['task-count'].textContent = `${session.tasks.filter(task => task.completed).length} / ${session.tasks.length}`;
  elements['tasks-empty'].hidden = session.tasks.length > 0;
}

function renderTasks() {
  const rows = session.tasks.map(task => {
    const row = node('li', undefined, 'task-item');
    const label = node('label');
    const checkbox = node('input');
    checkbox.type = 'checkbox';
    checkbox.checked = task.completed;
    checkbox.addEventListener('change', () => {
      session = toggleTask(session, task.id);
      // Существующий checkbox остаётся в DOM вместе с клавиатурным фокусом.
      renderTaskCount();
    });
    label.append(checkbox, node('span', task.title));
    const remove = node('button', 'Удалить');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Удалить задачу: ${task.title}`);
    remove.addEventListener('click', () => {
      const next = row.nextElementSibling ?? row.previousElementSibling;
      session = removeTask(session, task.id);
      row.remove();
      renderTaskCount();
      (next?.querySelector('button') ?? elements['task-title']).focus();
    });
    row.append(label, remove);
    return row;
  });
  elements['task-list'].replaceChildren(...rows);
  renderTaskCount();
}

const clockTime = timestamp => new Date(timestamp).toLocaleTimeString('ru-RU', {
  hour: '2-digit', minute: '2-digit', hour12: false,
});

function renderHistory(nowMs) {
  const stats = todayStatistics(history, nowMs);
  renderedDate = stats.date;
  elements['today-date'].textContent = new Date(nowMs).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  elements['session-count'].textContent = String(stats.count);
  elements['total-time'].textContent = formatDuration(stats.activeMs);
  elements['history-empty'].hidden = stats.count > 0;
  const rows = stats.sessions.map(record => {
    const row = node('li', undefined, 'history-item');
    const heading = node('div', undefined, 'history-heading');
    heading.append(node('span', `${clockTime(record.startedAt)}–${clockTime(record.endedAt)}`),
      node('strong', formatDuration(record.activeMs)));
    const tasks = node('ul');
    for (const task of record.tasks) {
      tasks.append(node('li', `${task.completed ? '✓ Выполнена' : '○ Не выполнена'} — ${task.title}`, 'history-task'));
    }
    row.append(heading, tasks);
    return row;
  });
  elements['history-list'].replaceChildren(...rows);
}

function refresh() {
  const nowMs = Date.now();
  renderTimer(nowMs);
  if (renderedDate !== localDate(nowMs)) renderHistory(nowMs);
}

elements.modes.addEventListener('change', event => {
  session = selectTarget(session, Number(event.target.value));
  refresh();
});

elements['primary-action'].addEventListener('click', () => {
  const nowMs = Date.now();
  session = { idle: start, running: pause, paused: resume }[session.status](session, nowMs);
  refresh();
});

elements.finish.addEventListener('click', () => {
  if (session.status === 'idle') return;
  const nowMs = Date.now();
  const outcome = finish(session, nowMs, crypto.randomUUID());
  session = outcome.session;
  if (outcome.result) {
    history = [outcome.result, ...history];
    const saved = writeHistory(storage, history);
    message(elements['storage-message'], saved.error
      ? 'Не удалось сохранить историю. Результат виден в этой вкладке, но может потеряться после перезагрузки.' : '');
  }
  renderTasks();
  renderHistory(nowMs);
  refresh();
  elements['primary-action'].focus();
});

elements['task-form'].addEventListener('submit', event => {
  event.preventDefault();
  const next = addTask(session, elements['task-title'].value);
  if (next === session) {
    message(elements['task-error'], 'Введите название задачи, а не только пробелы.');
    elements['task-title'].setAttribute('aria-invalid', 'true');
  } else {
    session = next;
    elements['task-title'].value = '';
    elements['task-title'].removeAttribute('aria-invalid');
    message(elements['task-error']);
    renderTasks();
  }
  elements['task-title'].focus();
});
elements['task-title'].addEventListener('input', () => {
  message(elements['task-error']);
  elements['task-title'].removeAttribute('aria-invalid');
});

let focusMode = false;
let fullscreenDismissed = false;
let fullscreenPending = false;
const focusToggle = byId('focus-toggle');
const fullscreenButton = byId('fullscreen');
const fullscreenOffer = byId('fullscreen-offer');
const fullscreenMessage = byId('fullscreen-message');

function renderFocus() {
  document.body.classList.toggle('focus-mode', focusMode);
  focusToggle.setAttribute('aria-pressed', String(focusMode));
  focusToggle.textContent = focusMode ? 'Выйти из концентрации' : 'Концентрация';
  fullscreenOffer.hidden = !focusMode || fullscreenDismissed || Boolean(document.fullscreenElement);
  fullscreenButton.disabled = fullscreenPending;
}

async function exitFullscreen() {
  if (!document.fullscreenElement) return;
  try {
    if (typeof document.exitFullscreen !== 'function') throw new Error('API недоступен');
    await document.exitFullscreen();
  } catch {
    message(fullscreenMessage, 'Не удалось выйти из полного экрана. Используйте Escape или меню браузера.');
  }
}

focusToggle.addEventListener('click', async () => {
  focusMode = !focusMode;
  fullscreenDismissed = false;
  message(fullscreenMessage);
  renderFocus();
  if (!focusMode) await exitFullscreen();
});

byId('dismiss-fullscreen').addEventListener('click', () => {
  fullscreenDismissed = true;
  renderFocus();
  focusToggle.focus();
});

fullscreenButton.addEventListener('click', async () => {
  if (!focusMode || fullscreenPending || document.fullscreenElement) return;
  message(fullscreenMessage);
  if (typeof document.documentElement.requestFullscreen !== 'function' || document.fullscreenEnabled === false) {
    message(fullscreenMessage, 'Полный экран недоступен. Концентрация работает в обычном окне.');
    return;
  }
  fullscreenPending = true;
  renderFocus();
  try {
    await document.documentElement.requestFullscreen();
    // Пользователь мог выйти из концентрации, пока браузер обрабатывал запрос.
    if (!focusMode) await exitFullscreen();
  } catch {
    if (focusMode) message(fullscreenMessage, 'Браузер отклонил полный экран. Концентрация работает в обычном окне.');
  } finally {
    fullscreenPending = false;
    renderFocus();
    if (focusMode && document.fullscreenElement) focusToggle.focus();
  }
});

document.addEventListener('fullscreenchange', () => {
  // Escape меняет только полноэкранное отображение, не сессию и не концентрацию.
  renderFocus();
  if (focusMode) focusToggle.focus();
});
renderFocus();

if (restored.error) {
  message(elements['storage-message'], 'Не удалось восстановить историю. Показана пустая история; таймер и задачи доступны.');
}
renderTasks();
refresh();
document.addEventListener('visibilitychange', () => {
  refresh();
  renderHistory(Date.now());
});
setInterval(refresh, 250);
document.documentElement.dataset.appReady = 'true';
