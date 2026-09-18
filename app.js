(() => {
  'use strict';

  const DB_NAME = 'kanbanboard';
  const DB_VERSION = 1;
  const STORE = 'cards';
  const columnOrder = ['todo', 'today', 'inprogress', 'waiting', 'done'];
  const columnNames = { todo: '할일', today: '오늘 할일', inprogress: '진행중', waiting: '대기중', done: '완료' };
  const colors = ['#ffd9dc', '#ffe2c2', '#fff1ad', '#d8efcf', '#cfe8ff', '#d8dcf8', '#ead7f7'];
  const state = { cards: [], openColumns: new Set(), selectedColor: colors[2], deleteArmed: false, deleteTimer: null };
  let db;

  const el = id => document.getElementById(id);
  const board = el('board');
  const sheetLayer = el('sheetLayer');
  const form = el('cardForm');

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const database = req.result;
        if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function storeRequest(mode, operation) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = operation(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  const getAllCards = () => storeRequest('readonly', store => store.getAll());
  const putCard = card => storeRequest('readwrite', store => store.put(card));
  const removeCard = id => storeRequest('readwrite', store => store.delete(id));
  const uuid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const toInputDate = value => {
    if (!value) return '';
    const date = new Date(value);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };
  const fromInputDate = value => value ? new Date(value).toISOString() : '';

  function formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    return new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  }

  function safeText(value) {
    const span = document.createElement('span');
    span.textContent = value;
    return span.innerHTML;
  }

  function render() {
    board.className = 'board';
    if (state.openColumns.has('today')) board.classList.add('today-open');
    if (state.openColumns.has('waiting')) board.classList.add('waiting-open');
    board.innerHTML = '';
    columnOrder.forEach(column => board.appendChild(renderColumn(column)));
  }

  function renderColumn(column) {
    const cards = state.cards.filter(card => card.column === column).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const collapsible = column === 'today' || column === 'waiting';
    const isOpen = !collapsible || state.openColumns.has(column);
    const section = document.createElement('section');
    section.className = `column${collapsible ? ' collapsible' : ''}${isOpen ? '' : ' collapsed-column'}`;
    section.setAttribute('aria-label', columnNames[column]);
    if (!isOpen) {
      section.innerHTML = `<button class="collapsed-tab" type="button" data-toggle="${column}"><span class="count">${cards.length}</span><span>${columnNames[column]}</span></button>`;
      return section;
    }
    const header = document.createElement(collapsible ? 'button' : 'div');
    header.className = 'column-header';
    if (collapsible) { header.type = 'button'; header.dataset.toggle = column; }
    header.innerHTML = `<h2>${columnNames[column]}</h2><span class="count">${cards.length}</span>${collapsible ? '<span class="collapse-mark">접기</span>' : ''}`;
    const list = document.createElement('div');
    list.className = 'card-list';
    if (!cards.length) list.innerHTML = '<div class="empty">카드가<br>없어요</div>';
    cards.forEach(card => list.appendChild(renderCard(card)));
    section.append(header, list);
    return section;
  }

  function renderCard(card) {
    const article = document.createElement('article');
    article.className = 'task-card';
    article.dataset.id = card.id;
    article.style.background = card.color;
    const start = card.startAt ? `<div class="task-date">시작 ${formatDate(card.startAt)}</div>` : '';
    const due = card.dueAt ? `<div class="task-date">마감 ${formatDate(card.dueAt)}</div>` : '';
    const done = card.column === 'done' && card.completedAt ? `<div class="task-date">종료 ${formatDate(card.completedAt)}</div>` : '';
    const index = columnOrder.indexOf(card.column);
    article.innerHTML = `<p class="task-text">${safeText(card.text)}</p>${start}${due}${done}<div class="move-row"><button class="move-button" type="button" data-move="-1" ${index === 0 ? 'disabled' : ''}>← 이전</button><button class="move-button" type="button" data-move="1" ${index === columnOrder.length - 1 ? 'disabled' : ''}>다음 →</button></div>`;
    return article;
  }

  function renderSwatches() {
    el('swatches').innerHTML = '';
    colors.forEach((color, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `swatch${state.selectedColor === color ? ' selected' : ''}`;
      button.style.background = color;
      button.dataset.color = color;
      button.setAttribute('aria-label', `${index + 1}번 색상`);
      button.setAttribute('aria-pressed', state.selectedColor === color ? 'true' : 'false');
      el('swatches').appendChild(button);
    });
  }

  function updateCompletedVisibility() {
    const isDone = el('cardColumn').value === 'done';
    el('completedField').classList.toggle('is-hidden', !isDone);
    if (isDone && !el('completedAt').value) el('completedAt').value = toInputDate(new Date().toISOString());
  }

  function openSheet(card = null) {
    state.deleteArmed = false;
    clearTimeout(state.deleteTimer);
    form.reset();
    el('sheetTitle').textContent = card ? '카드 자세히' : '새 카드';
    el('cardId').value = card?.id || '';
    el('taskText').value = card?.text || '';
    el('cardColumn').value = card?.column || 'todo';
    el('startAt').value = toInputDate(card?.startAt);
    el('dueAt').value = toInputDate(card?.dueAt);
    el('completedAt').value = toInputDate(card?.completedAt);
    state.selectedColor = card?.color || colors[2];
    const deleteButton = el('deleteButton');
    deleteButton.hidden = !card;
    deleteButton.textContent = '삭제';
    deleteButton.classList.remove('armed');
    renderSwatches();
    updateCompletedVisibility();
    sheetLayer.hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(() => el('taskText').focus(), 80);
  }

  function closeSheet() {
    sheetLayer.hidden = true;
    document.body.style.overflow = '';
    clearTimeout(state.deleteTimer);
  }

  async function refresh() {
    state.cards = await getAllCards();
    render();
  }

  async function moveCard(card, direction) {
    const nextIndex = columnOrder.indexOf(card.column) + direction;
    if (nextIndex < 0 || nextIndex >= columnOrder.length) return;
    const nextColumn = columnOrder[nextIndex];
    const updated = { ...card, column: nextColumn, updatedAt: new Date().toISOString() };
    if (nextColumn === 'done' && !updated.completedAt) updated.completedAt = new Date().toISOString();
    await putCard(updated);
    await refresh();
    showToast(`${columnNames[nextColumn]}으로 옮겼어요`);
  }

  function showToast(message) {
    const toast = el('toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 1800);
  }

  board.addEventListener('click', async event => {
    const toggle = event.target.closest('[data-toggle]');
    if (toggle) {
      const column = toggle.dataset.toggle;
      state.openColumns.has(column) ? state.openColumns.delete(column) : state.openColumns.add(column);
      render();
      return;
    }
    const cardElement = event.target.closest('.task-card');
    if (!cardElement) return;
    const card = state.cards.find(item => item.id === cardElement.dataset.id);
    const move = event.target.closest('[data-move]');
    if (move) { await moveCard(card, Number(move.dataset.move)); return; }
    openSheet(card);
  });

  el('addButton').addEventListener('click', () => openSheet());
  el('closeButton').addEventListener('click', closeSheet);
  el('sheetBackdrop').addEventListener('click', closeSheet);
  el('cardColumn').addEventListener('change', updateCompletedVisibility);
  el('swatches').addEventListener('click', event => {
    const swatch = event.target.closest('[data-color]');
    if (!swatch) return;
    state.selectedColor = swatch.dataset.color;
    renderSwatches();
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const text = el('taskText').value.trim();
    if (!text) { el('taskText').focus(); return; }
    const id = el('cardId').value;
    const existing = state.cards.find(card => card.id === id);
    const now = new Date().toISOString();
    const column = el('cardColumn').value;
    const card = {
      id: id || uuid(), text, color: state.selectedColor, column,
      startAt: fromInputDate(el('startAt').value), dueAt: fromInputDate(el('dueAt').value),
      completedAt: column === 'done' ? (fromInputDate(el('completedAt').value) || now) : (existing?.completedAt || ''),
      createdAt: existing?.createdAt || now, updatedAt: now
    };
    await putCard(card);
    closeSheet();
    await refresh();
    showToast(id ? '카드를 저장했어요' : '할일에 카드를 추가했어요');
  });

  el('deleteButton').addEventListener('click', async () => {
    const button = el('deleteButton');
    if (!state.deleteArmed) {
      state.deleteArmed = true;
      button.textContent = '한 번 더 눌러 삭제';
      button.classList.add('armed');
      state.deleteTimer = setTimeout(() => {
        state.deleteArmed = false; button.textContent = '삭제'; button.classList.remove('armed');
      }, 3000);
      return;
    }
    await removeCard(el('cardId').value);
    closeSheet();
    await refresh();
    showToast('카드를 삭제했어요');
  });

  async function dailyBackup() {
    const localNow = new Date();
    const today = `${localNow.getFullYear()}-${String(localNow.getMonth() + 1).padStart(2, '0')}-${String(localNow.getDate()).padStart(2, '0')}`;
    if (localStorage.getItem('kanbanboard-backup-date') === today) return;
    try {
      const cards = await getAllCards();
      const exportedData = { app: 'kanbanboard', exportedAt: new Date().toISOString(), cards };
      const res = await fetch('https://appointee-unnoticed-donated.ngrok-free.dev/api/app-backup/kanbanboard', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(exportedData)
      });
      if (res.ok) localStorage.setItem('kanbanboard-backup-date', today);
    } catch (_) {}
  }

  async function init() {
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
    db = await openDB();
    await refresh();
    setTimeout(dailyBackup, 4000);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(reg => reg.update()).catch(() => {});
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloading) return; reloading = true; location.reload(); });
    }
  }

  init().catch(() => showToast('저장소를 열지 못했어요'));
})();
