(() => {
  'use strict';

  const DB_NAME = 'kanbanboard';
  const DB_VERSION = 1;
  const STORE = 'cards';
  const columnOrder = ['todo', 'today', 'inprogress', 'waiting', 'done'];
  const columnNames = { todo: '할일', today: '오늘 할일', inprogress: '진행중', waiting: '대기중', done: '완료' };
  const colors = ['#ffd9dc', '#ffe2c2', '#fff1ad', '#d8efcf', '#cfe8ff', '#d8dcf8', '#ead7f7'];
  const state = { cards: [], selectedColor: colors[2], deleteArmed: false, deleteTimer: null };
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
    if (Number.isNaN(date.getTime())) return '';
    return `${date.getMonth() + 1}월 ${date.getDate()}일 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  };

  function parseNaturalDate(value, now = new Date()) {
    const text = value.trim().replace(/\s+/g, ' ');
    if (!text) return null;
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let year;
    let month;
    let day;
    let dateRecognized = false;
    let yearWasOmitted = false;

    const relativeDays = { '오늘': 0, '내일': 1, '모레': 2, '글피': 3, '어제': -1 };
    const relative = Object.keys(relativeDays).find(word => text.includes(word));
    if (relative) {
      base.setDate(base.getDate() + relativeDays[relative]);
      year = base.getFullYear(); month = base.getMonth() + 1; day = base.getDate();
      dateRecognized = true;
    } else {
      const weekMatch = text.match(/(이번|다음)주\s*([일월화수목금토])(?:요일)?/);
      if (weekMatch) {
        const weekday = '일월화수목금토'.indexOf(weekMatch[2]);
        base.setDate(base.getDate() - base.getDay() + (weekMatch[1] === '다음' ? 7 : 0) + weekday);
        year = base.getFullYear(); month = base.getMonth() + 1; day = base.getDate();
        dateRecognized = true;
      } else {
        const koreanMatch = text.match(/(?:(\d{4})년\s*)?(\d{1,2})월\s*(\d{1,2})일/);
        const numericMatch = text.match(/(?:(\d{4})\s*[-\/.]\s*)?(\d{1,2})\s*[-\/.]\s*(\d{1,2})(?!\s*\d)/);
        const match = koreanMatch || numericMatch;
        if (match) {
          yearWasOmitted = !match[1];
          year = match[1] ? Number(match[1]) : now.getFullYear();
          month = Number(match[2]); day = Number(match[3]);
          dateRecognized = true;
        }
      }
    }

    let hour = 0;
    let minute = 0;
    let timeRecognized = false;
    const koreanTime = text.match(/(?:(오전|오후)\s*)?(\d{1,2})시(?:\s*(?:(\d{1,2})분|(반)))?/);
    const colonTime = text.match(/(?:\b(오전|오후)\s*)?(\d{1,2}):(\d{2})(?:\s*(am|pm))?\b/i);
    if (koreanTime) {
      hour = Number(koreanTime[2]);
      minute = koreanTime[4] ? 30 : Number(koreanTime[3] || 0);
      if (koreanTime[1] === '오후' && hour < 12) hour += 12;
      if (koreanTime[1] === '오전' && hour === 12) hour = 0;
      timeRecognized = true;
    } else if (colonTime) {
      hour = Number(colonTime[2]); minute = Number(colonTime[3]);
      const period = (colonTime[4] || colonTime[1] || '').toLowerCase();
      if ((period === 'pm' || period === '오후') && hour < 12) hour += 12;
      if ((period === 'am' || period === '오전') && hour === 12) hour = 0;
      timeRecognized = true;
    }

    if (!dateRecognized && !timeRecognized) return null;
    if (!dateRecognized) {
      year = now.getFullYear(); month = now.getMonth() + 1; day = now.getDate();
    }
    if (month < 1 || month > 12 || day < 1 || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    let parsed = new Date(year, month - 1, day, hour, minute, 0, 0);
    if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return null;
    if (yearWasOmitted) {
      const pastLimit = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 62);
      if (parsed < pastLimit) parsed = new Date(year + 1, month - 1, day, hour, minute, 0, 0);
    }
    return parsed;
  }

  const fromInputDate = value => {
    const parsed = parseNaturalDate(value);
    return parsed ? parsed.toISOString() : '';
  };

  function previewDate(date) {
    return `→ ${new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(date)}`;
  }

  function updateDatePreview(input) {
    const preview = el(`${input.id}Preview`);
    const value = input.value.trim();
    const parsed = parseNaturalDate(value);
    preview.classList.toggle('unrecognized', Boolean(value && !parsed));
    preview.textContent = !value ? '' : (parsed ? previewDate(parsed) : '인식하지 못했어요');
  }

  function refreshDatePreviews() {
    ['startAt', 'dueAt', 'completedAt'].forEach(id => updateDatePreview(el(id)));
  }

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
    board.innerHTML = '';
    ['todo', 'inprogress', 'done'].forEach(column => board.appendChild(renderColumn(column)));
  }

  function renderColumn(column) {
    const cards = state.cards.filter(card => card.column === column).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const section = document.createElement('section');
    section.className = 'column';
    section.setAttribute('aria-label', columnNames[column]);
    const header = document.createElement('div');
    header.className = 'column-header';
    header.innerHTML = `<h2>${columnNames[column]}</h2><span class="count">${cards.length}</span>`;
    const list = document.createElement('div');
    list.className = 'card-list';
    if (!cards.length) list.innerHTML = '<div class="empty">카드가<br>없어요</div>';
    cards.forEach(card => list.appendChild(renderCard(card)));
    section.append(header, list);
    return section;
  }

  function renderSideLists() {
    const container = el('sideListSections');
    container.innerHTML = '';
    ['today', 'waiting'].forEach(column => {
      const cards = state.cards.filter(card => card.column === column).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      const section = document.createElement('section');
      section.className = 'side-list-section';
      section.innerHTML = `<div class="side-list-heading"><h3>${columnNames[column]}</h3><span class="count">${cards.length}</span></div>`;
      const list = document.createElement('div');
      list.className = 'side-card-list';
      if (!cards.length) list.innerHTML = '<div class="empty">카드가 없어요</div>';
      cards.forEach(card => list.appendChild(renderCard(card)));
      section.appendChild(list);
      container.appendChild(section);
    });
  }

  function openSideList() {
    renderSideLists();
    el('sideListLayer').hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeSideList() {
    el('sideListLayer').hidden = true;
    document.body.style.overflow = '';
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
    updateDatePreview(el('completedAt'));
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
    refreshDatePreviews();
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
    if (!el('sideListLayer').hidden) renderSideLists();
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

  async function handleCardClick(event) {
    const cardElement = event.target.closest('.task-card');
    if (!cardElement) return;
    const card = state.cards.find(item => item.id === cardElement.dataset.id);
    const move = event.target.closest('[data-move]');
    if (move) { await moveCard(card, Number(move.dataset.move)); return; }
    if (!el('sideListLayer').hidden) closeSideList();
    openSheet(card);
  }

  board.addEventListener('click', handleCardClick);
  el('sideListSections').addEventListener('click', handleCardClick);

  el('addButton').addEventListener('click', () => openSheet());
  el('sideListButton').addEventListener('click', openSideList);
  el('sideListCloseButton').addEventListener('click', closeSideList);
  el('sideListBackdrop').addEventListener('click', closeSideList);
  el('closeButton').addEventListener('click', closeSheet);
  el('sheetBackdrop').addEventListener('click', closeSheet);
  el('cardColumn').addEventListener('change', updateCompletedVisibility);
  ['startAt', 'dueAt', 'completedAt'].forEach(id => {
    const input = el(id);
    let timer;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => updateDatePreview(input), 200);
    });
  });
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
      completedAt: column === 'done' ? (el('completedAt').value.trim() ? fromInputDate(el('completedAt').value) : now) : (existing?.completedAt || ''),
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
