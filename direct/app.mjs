(() => {
  'use strict';
  const D = globalThis.FocusTimerDomain;
  const $ = id => document.getElementById(id);
  const storageKey = 'focus-timer.sessions.v1';
  let session = D.createSession();
  let records = [];
  let nextTaskId = 0;
  let displayedDate = '';
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (!Array.isArray(saved)) throw new Error('Invalid history');
    records = saved.filter(record => record && Number.isFinite(record.startedAt) &&
      Number.isFinite(record.endedAt) && Number.isFinite(record.durationMs) && record.durationMs >= 0 &&
      Array.isArray(record.tasks) && record.tasks.every(task => task && typeof task.title === 'string' && typeof task.completed === 'boolean'));
  } catch {
    $('storage-message').textContent = 'Не удалось прочитать историю. Статистика доступна в текущем окне.';
  }
  function renderTimer() {
    const elapsed = D.elapsedMilliseconds(session, performance.now());
    const percent = D.progress(elapsed, session.target);
    $('timer').textContent = D.formatTime(elapsed);
    $('progress').value = percent;
    $('percentage').textContent = `${Math.floor(percent)}%`;
    $('goal').textContent = `Цель · ${D.formatTime(session.target * 1000)}`;
    $('status').textContent = session.status === 'idle' ? 'Готовы начать?' :
      session.status === 'paused' ? 'Пауза — время не учитывается' :
      percent === 100 ? 'Цель достигнута. Можно продолжать!' : 'Время сосредоточиться';
    $('primary').textContent = { idle: 'Старт', running: 'Пауза', paused: 'Продолжить' }[session.status];
    $('finish').disabled = session.status === 'idle';
    $('modes').disabled = session.status !== 'idle';
    if (displayedDate !== new Date().toDateString()) renderHistory();
  }
  function renderTasks() {
    $('tasks').replaceChildren();
    $('tasks-empty').hidden = session.tasks.length > 0;
    for (const task of session.tasks) {
      const li = document.createElement('li');
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = task.completed;
      checkbox.addEventListener('change', () => { session = D.toggleTask(session, task.id); });
      const name = document.createElement('span');
      name.className = 'task-name';
      name.textContent = task.title;
      label.append(checkbox, name);
      const remove = document.createElement('button');
      remove.className = 'delete';
      remove.textContent = 'Удалить';
      remove.setAttribute('aria-label', `Удалить задачу: ${task.title}`);
      remove.addEventListener('click', () => {
        session = D.deleteTask(session, task.id);
        renderTasks();
        $('task-title').focus();
      });
      li.append(label, remove);
      $('tasks').append(li);
    }
  }
  function renderHistory() {
    displayedDate = new Date().toDateString();
    const today = D.todayRecords(records, Date.now());
    $('count').textContent = today.length;
    $('total').textContent = D.formatTime(D.totalDuration(today));
    $('history-empty').hidden = today.length > 0;
    $('history').replaceChildren();
    const clock = timestamp => new Date(timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', hour12: false });
    for (const record of [...today].reverse()) {
      const li = document.createElement('li');
      const heading = document.createElement('strong');
      heading.textContent = `${clock(record.startedAt)}–${clock(record.endedAt)}`;
      const duration = document.createElement('p');
      duration.textContent = `Концентрация · ${D.formatTime(record.durationMs)}`;
      const tasks = document.createElement('ul');
      for (const task of record.tasks) {
        const item = document.createElement('li');
        item.textContent = `${task.completed ? '✓ Выполнено' : '○ Не выполнено'} — ${task.title}`;
        tasks.append(item);
      }
      li.append(heading, duration, tasks);
      $('history').append(li);
    }
  }
  $('modes').addEventListener('change', event => {
    session = D.selectMode(session, Number(event.target.value));
    renderTimer();
  });
  $('primary').addEventListener('click', () => {
    const now = performance.now();
    session = session.status === 'idle' ? D.start(session, now, Date.now()) :
      session.status === 'running' ? D.pause(session, now) : D.resume(session, now);
    $('message').textContent = 'В статистику попадёт сессия, достигшая цели.';
    renderTimer();
  });
  $('finish').addEventListener('click', () => {
    const result = D.finish(session, performance.now(), Date.now());
    session = result.session;
    if (result.record) {
      records = [...records, result.record];
      try {
        localStorage.setItem(storageKey, JSON.stringify(records));
        $('storage-message').textContent = '';
      } catch {
        $('storage-message').textContent = 'История не сохранена в браузере. Она доступна только до закрытия или обновления страницы.';
      }
    }
    $('message').textContent = result.record ? 'Сессия завершена и добавлена в статистику.' : 'Сессия завершена раньше цели и не засчитана.';
    renderTimer();
    renderTasks();
    renderHistory();
  });
  $('task-form').addEventListener('submit', event => {
    event.preventDefault();
    const input = $('task-title');
    if (!input.value.trim()) {
      input.setCustomValidity('Введите название задачи, а не только пробелы.');
      input.reportValidity();
      return;
    }
    session = D.addTask(session, input.value, ++nextTaskId);
    input.value = '';
    renderTasks();
    input.focus();
  });
  $('task-title').addEventListener('input', () => $('task-title').setCustomValidity(''));
  $('focus').addEventListener('click', async () => {
    const enabled = document.body.classList.toggle('deep-focus');
    $('focus').setAttribute('aria-pressed', String(enabled));
    $('focus').textContent = enabled ? 'Выйти из фокуса' : 'Глубокий фокус';
    if (enabled && document.documentElement.requestFullscreen && window.confirm('Перейти в полноэкранный режим для глубокой концентрации?')) {
      try { await document.documentElement.requestFullscreen(); } catch { /* Focus mode works without fullscreen. */ }
    } else if (!enabled && document.fullscreenElement) {
      try { await document.exitFullscreen(); } catch { /* Browser may already have exited. */ }
    }
  });
  renderTasks();
  renderTimer();
  setInterval(renderTimer, 200);
  document.addEventListener('visibilitychange', renderTimer);
})();
