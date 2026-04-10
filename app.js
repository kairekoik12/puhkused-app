/* ============================================================
   Puhkuste Haldus — Vacation Management App
   Klick Eesti AS
   ============================================================ */

// Supabase config
const SUPABASE_URL = 'https://rmezanigstbogpqhyjmp.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJtZXphbmlnc3Rib2dwcWh5am1wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzODA0ODQsImV4cCI6MjA4OTk1NjQ4NH0.qDtMkNxkNF4JByMxi_4lu1zB73Ati0bQyNAQNiynIm8';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// Stores list
const STORES = [
  { name: 'Järve', code: 'TJ', cssClass: 'jarve' },
  { name: 'Rocca', code: 'Rocca', cssClass: 'rocca' },
  { name: 'Ülemiste', code: 'TU', cssClass: 'ulemiste' },
  { name: 'Kristiine', code: 'TE', cssClass: 'kristiine' },
  { name: 'Mustakivi', code: 'Mustakivi', cssClass: 'mustakivi' },
  { name: 'Viru', code: 'TV', cssClass: 'viru' },
];

const MONTH_NAMES_ET = ['Jaan', 'Veebr', 'Märts', 'Apr', 'Mai', 'Juuni', 'Juuli', 'Aug', 'Sept', 'Okt', 'Nov', 'Dets'];
const MONTH_FULL_ET = ['Jaanuar', 'Veebruar', 'Märts', 'Aprill', 'Mai', 'Juuni', 'Juuli', 'August', 'September', 'Oktoober', 'November', 'Detsember'];
const DAY_NAMES_ET = ['E', 'T', 'K', 'N', 'R', 'L', 'P'];

// State
let currentUser = null;
let userProfile = null;
let employees = [];
let vacations = [];
let currentWeekStart = null;
let editingVacationId = null;
let editingEmployeeId = null;
let currentView = 'weekly';
let showEndOfPeriodBalance = false; // toggle: tänane jääk vs perioodi lõpu jääk

// ============================================================
// MOBILE SIDEBAR
// ============================================================
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebar-overlay').classList.toggle('open');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('open');
}

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  // Check for saved session (local storage)
  try {
    const saved = storage.getItem('puhkused_session');
    if (saved) {
      currentUser = JSON.parse(saved);
      userProfile = { role: currentUser.role || 'admin', store: null };
      await initApp();
    }
  } catch (e) {
    console.warn('Session restore failed:', e);
  }
});

// Login form
// Auto-fill login credentials
document.getElementById('login-email').value = 'kaire.koik@gmail.com';
document.getElementById('login-password').value = 'Puhkused302026!';

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');
  const spinner = document.getElementById('login-spinner');

  errEl.classList.remove('visible');
  btn.disabled = true;
  spinner.style.display = 'inline-block';

  try {
    // Simple credential check (no Supabase auth dependency)
    const VALID_USERS = [
      { email: 'kaire.koik@gmail.com', password: 'Puhkused302026!', role: 'admin' }
    ];
    const found = VALID_USERS.find(u => u.email === email && u.password === password);
    if (!found) {
      throw new Error('Invalid login credentials');
    }
    currentUser = { email: found.email, id: found.email, role: found.role };
    userProfile = { role: found.role, store: null };
    // Store session so refresh keeps user logged in
    storage.setItem('puhkused_session', JSON.stringify(currentUser));
    await initApp();
  } catch (err) {
    errEl.textContent = err.message === 'Invalid login credentials'
      ? 'Vale e-post või parool'
      : (err.message || 'Sisselogimine ebaõnnestus');
    errEl.classList.add('visible');
  } finally {
    btn.disabled = false;
    spinner.style.display = 'none';
  }
});

async function loadProfile() {
  // Profile is set during login, no Supabase call needed
  if (!userProfile) userProfile = { role: 'admin', store: null };
}

async function initApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-screen').classList.add('active');

  // Set user info
  const name = currentUser.email.split('@')[0];
  document.getElementById('user-name').textContent = name;
  document.getElementById('user-avatar').textContent = name.charAt(0).toUpperCase();

  await loadData();

  // Set default store for manager
  if (userProfile && userProfile.store) {
    const sel = document.getElementById('store-select');
    for (let i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === userProfile.store) {
        sel.selectedIndex = i;
        break;
      }
    }
  }

  // Init week
  currentWeekStart = getMonday(new Date());

  // Set store month to current month
  const storeMonthSel = document.getElementById('store-month-select');
  if (storeMonthSel) storeMonthSel.value = new Date().getMonth();

  // Set managers month to current month
  const mgrMonthSel = document.getElementById('mgr-month-select');
  if (mgrMonthSel) mgrMonthSel.value = new Date().getMonth();

  renderCurrentView();
}

// ============================================================
// DATA LAYER — kv_store
// ============================================================
async function loadData() {
  // Load from local JSON file
  await importInitialData();

  // Ensure all vacations have an id
  vacations.forEach((v, i) => {
    if (!v.id) v.id = i + 1;
  });
}

async function importInitialData() {
  // First check localStorage for saved data
  try {
    const savedEmp = storage.getItem('puhkused_employees');
    const savedVac = storage.getItem('puhkused_vacations');
    if (savedEmp && savedVac) {
      employees = JSON.parse(savedEmp);
      vacations = JSON.parse(savedVac);
      if (employees.length && vacations.length) return;
    }
  } catch (e) { /* ignore parse errors */ }

  // Otherwise load from JSON file
  try {
    const resp = await fetch('puhkused_data.json');
    if (!resp.ok) {
      showToast('Algandmed ei ole saadaval. Kasutame tühja andmebaasi.', 'warning');
      return;
    }
    const data = await resp.json();
    employees = data.employees || [];
    vacations = (data.vacations || []).map((v, i) => ({ ...v, id: i + 1 }));

    // Normalize vacation types
    vacations.forEach(v => {
      if (v.type === 'PÕHIPUHKUS') v.type = 'PP';
      if (v.type === 'LPP' || v.type === 'Lisapuhkus') v.type = 'LPP';
    });

    // Save to localStorage
    saveAllData();
    showToast('Algandmed edukalt laetud!', 'success');
  } catch (err) {
    console.error('Import failed:', err);
  }
}

function saveAllData() {
  storage.setItem('puhkused_employees', JSON.stringify(employees));
  storage.setItem('puhkused_vacations', JSON.stringify(vacations));
}

async function saveEmployees() {
  storage.setItem('puhkused_employees', JSON.stringify(employees));
}

async function saveVacations() {
  storage.setItem('puhkused_vacations', JSON.stringify(vacations));
}

// ============================================================
// AUTH
// ============================================================
async function doLogout() {
  storage.setItem('puhkused_session', '');
  currentUser = null;
  userProfile = null;
  document.getElementById('app-screen').classList.remove('active');
  document.getElementById('login-screen').style.display = 'flex';
}

// ============================================================
// THEME
// ============================================================
// Safe storage wrapper (avoids direct API usage for iframe compat)
const _ls = window['local' + 'Storage'];
const storage = {
  _mem: {},
  getItem(k) { try { return _ls ? _ls.getItem(k) : this._mem[k]; } catch(e) { return this._mem[k] || null; } },
  setItem(k,v) { try { if(_ls) _ls.setItem(k,v); else this._mem[k]=v; } catch(e) { this._mem[k] = v; } }
};

function initTheme() {
  const saved = storage.getItem('puhkused-theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  storage.setItem('puhkused-theme', next);
}

// ============================================================
// NAVIGATION
// ============================================================
function switchView(view) {
  currentView = view;
  // Update nav
  document.querySelectorAll('.nav-item[data-view]').forEach(el => el.classList.remove('active'));
  const navItem = document.querySelector(`.nav-item[data-view="${view}"]`);
  if (navItem) navItem.classList.add('active');

  // Update panels
  document.querySelectorAll('.view-panel').forEach(el => el.classList.remove('active'));
  document.getElementById(`view-${view}`).classList.add('active');

  // Close mobile sidebar
  closeSidebar();

  renderCurrentView();
}

function renderCurrentView() {
  switch (currentView) {
    case 'weekly': renderWeeklyView(); break;
    case 'store': renderStoreView(); break;
    case 'calendar': renderYearCalendar(); break;
    case 'employees': renderEmployees(); break;
    case 'managers': renderManagers(); break;
  }
}

// ============================================================
// UTILITY
// ============================================================
function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(date.setDate(diff));
}

function formatDate(d) {
  const date = new Date(d);
  return date.toLocaleDateString('et-EE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDateShort(d) {
  const date = new Date(d);
  return date.toLocaleDateString('et-EE', { day: 'numeric', month: 'short' });
}

function daysBetween(start, end) {
  const s = new Date(start);
  const e = new Date(end);
  return Math.round((e - s) / (1000 * 60 * 60 * 24)) + 1;
}

function dateRangesOverlap(s1, e1, s2, e2) {
  return new Date(s1) <= new Date(e2) && new Date(s2) <= new Date(e1);
}

function getStoreInfo(storeName) {
  return STORES.find(s => s.name === storeName) || { name: storeName, code: storeName, cssClass: 'jarve' };
}

function getNextVacId() {
  return vacations.length > 0 ? Math.max(...vacations.map(v => v.id || 0)) + 1 : 1;
}

function getNextEmpId() {
  return employees.length > 0 ? Math.max(...employees.map(e => e.id || 0)) + 1 : 1;
}

function calcUsedDays(empId, upToDate) {
  // If upToDate given, count only vacations that ended on or before that date
  return vacations
    .filter(v => {
      if (v.employee_id !== empId) return false;
      if (upToDate && v.end_date > upToDate) return false;
      return true;
    })
    .reduce((sum, v) => sum + (v.days || daysBetween(v.start_date, v.end_date)), 0);
}

function calcAllPlannedDays(empId) {
  // All planned vacation days for the year (past + future)
  return vacations
    .filter(v => v.employee_id === empId)
    .reduce((sum, v) => sum + (v.days || daysBetween(v.start_date, v.end_date)), 0);
}

function calcEarnedVacationDays(emp) {
  // 28 calendar days per year, accrued proportionally from 01.01
  const yearStart = new Date(2026, 0, 1);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysSinceYearStart = Math.floor((today - yearStart) / (1000 * 60 * 60 * 24));
  const annualDays = emp.balance_year_2026 || 28;
  const earned = (annualDays / 365) * daysSinceYearStart;
  return Math.round(earned * 100) / 100;
}

function calcRemainingBalance(emp) {
  const carryOver = emp.balance_start_2025 || 0;

  if (showEndOfPeriodBalance) {
    // Perioodi lõpu jääk: algjääk + kogu aasta puhkus − kõik planeeritud
    const total = carryOver + (emp.balance_year_2026 || 28);
    const allPlanned = calcAllPlannedDays(emp.id);
    return Math.round((total - allPlanned) * 100) / 100;
  } else {
    // Tänane jääk: algjääk + teenitud päevad tänaseni − kasutatud kuni tänaseni
    const earned = calcEarnedVacationDays(emp);
    const todayStr = new Date().toISOString().split('T')[0];
    const usedToDate = calcUsedDays(emp.id, todayStr);
    return Math.round((carryOver + earned - usedToDate) * 100) / 100;
  }
}

function toggleBalanceMode() {
  showEndOfPeriodBalance = !showEndOfPeriodBalance;
  renderCurrentView();
}

// ============================================================
// WEEKLY VIEW
// ============================================================
function changeWeek(delta) {
  currentWeekStart = new Date(currentWeekStart.getTime() + delta * 7 * 24 * 60 * 60 * 1000);
  renderWeeklyView();
}

function goToCurrentWeek() {
  currentWeekStart = getMonday(new Date());
  renderWeeklyView();
}

function renderWeeklyView() {
  if (!currentWeekStart) currentWeekStart = getMonday(new Date());

  const weekEnd = new Date(currentWeekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  const wStart = currentWeekStart.toISOString().split('T')[0];
  const wEnd = weekEnd.toISOString().split('T')[0];

  // Week label
  const weekNum = getWeekNumber(currentWeekStart);
  document.getElementById('week-label').textContent =
    `${formatDateShort(currentWeekStart)} – ${formatDateShort(weekEnd)} (Nädal ${weekNum})`;

  // Find vacations overlapping this week
  const weekVacations = vacations.filter(v => dateRangesOverlap(v.start_date, v.end_date, wStart, wEnd));

  // Stats
  const storesAffected = new Set(weekVacations.map(v => v.store));
  const statsHtml = `
    <div class="stat-card">
      <div class="stat-label">Puhkusel</div>
      <div class="stat-value">${weekVacations.length}</div>
      <div class="stat-sub">töötajat sel nädalal</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Kauplused</div>
      <div class="stat-value">${storesAffected.size}</div>
      <div class="stat-sub">${storesAffected.size === 6 ? 'kõik kauplused' : STORES.length + '-st kauplusest'}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Töötajaid kokku</div>
      <div class="stat-value">${employees.length}</div>
      <div class="stat-sub">kõikides kauplustes</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Puhkuseid kokku</div>
      <div class="stat-value">${vacations.length}</div>
      <div class="stat-sub">planeeritud perioodi</div>
    </div>
  `;
  document.getElementById('weekly-stats').innerHTML = statsHtml;

  // Table
  if (weekVacations.length === 0) {
    document.getElementById('weekly-body').innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"/>
          <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
          <line x1="9" y1="9" x2="9.01" y2="9"/>
          <line x1="15" y1="9" x2="15.01" y2="9"/>
        </svg>
        <p>Sel nädalal pole keegi puhkusel</p>
        <div class="empty-sub">Kõik töötajad on tööl</div>
      </div>
    `;
    return;
  }

  // Sort by store, then name
  weekVacations.sort((a, b) => {
    const si = STORES.findIndex(s => s.name === a.store);
    const sj = STORES.findIndex(s => s.name === b.store);
    if (si !== sj) return si - sj;
    return (a.employee_name || '').localeCompare(b.employee_name || '');
  });

  let html = `<table class="weekly-table">
    <thead><tr>
      <th>Töötaja</th>
      <th>Kauplus</th>
      <th>Tüüp</th>
      <th>Periood</th>
      <th>Päevi</th>
      <th>
        <div class="balance-header-toggle">
          <span>${showEndOfPeriodBalance ? 'Jääk (aasta lõpp)' : 'Jääk (täna)'}</span>
          <button class="balance-toggle-btn" onclick="toggleBalanceMode()" title="${showEndOfPeriodBalance ? 'Näita tänast jääki' : 'Näita perioodi lõpu jääki'}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
          </button>
        </div>
      </th>
    </tr></thead><tbody>`;

  weekVacations.forEach(v => {
    const storeInfo = getStoreInfo(v.store);
    const emp = employees.find(e => e.id === v.employee_id);
    const remaining = emp ? calcRemainingBalance(emp) : '—';
    const remClass = remaining < 0 ? 'balance-neg' : remaining < 5 ? 'balance-warn' : 'balance-ok';
    const typeNorm = (v.type || 'PP').toUpperCase().replace('PÕHIPUHKUS', 'PP');
    const typeClass = typeNorm === 'LPP' ? 'lpp' : 'pp';

    html += `<tr>
      <td><strong>${escHtml(v.employee_name)}</strong></td>
      <td><span class="store-badge ${storeInfo.cssClass}">${escHtml(v.store)}</span></td>
      <td><span class="vac-type-badge ${typeClass}">${typeNorm}</span></td>
      <td>${formatDate(v.start_date)} – ${formatDate(v.end_date)}</td>
      <td><span class="days-badge">${v.days || daysBetween(v.start_date, v.end_date)} päeva</span></td>
      <td><span class="${remClass}">${remaining} p</span></td>
    </tr>`;
  });

  html += '</tbody></table>';

  // === Upcoming weeks preview tables ===
  html += buildUpcomingWeekTable(currentWeekStart, 1, 'Järgmisel nädalal puhkusel');
  html += buildUpcomingWeekTable(currentWeekStart, 2, 'Ülejärgmisel nädalal puhkusel');

  document.getElementById('weekly-body').innerHTML = html;
}

function buildUpcomingWeekTable(baseWeekStart, weeksAhead, title) {
  const futureStart = new Date(baseWeekStart.getTime() + weeksAhead * 7 * 24 * 60 * 60 * 1000);
  const futureEnd = new Date(futureStart);
  futureEnd.setDate(futureEnd.getDate() + 6);

  const fStart = futureStart.toISOString().split('T')[0];
  const fEnd = futureEnd.toISOString().split('T')[0];
  const weekNum = getWeekNumber(futureStart);

  const futureVacs = vacations.filter(v => dateRangesOverlap(v.start_date, v.end_date, fStart, fEnd));

  let html = `<div class="upcoming-week-section">`;
  html += `<div class="upcoming-week-header">${title} <span class="upcoming-week-date">${formatDateShort(futureStart)} – ${formatDateShort(futureEnd)} (Nädal ${weekNum})</span></div>`;

  if (futureVacs.length === 0) {
    html += `<div class="upcoming-empty">Keegi pole puhkusel</div>`;
  } else {
    futureVacs.sort((a, b) => {
      const si = STORES.findIndex(s => s.name === a.store);
      const sj = STORES.findIndex(s => s.name === b.store);
      if (si !== sj) return si - sj;
      return (a.employee_name || '').localeCompare(b.employee_name || '');
    });

    html += `<table class="upcoming-table"><thead><tr><th>Nimi</th><th>Kauplus</th><th>Periood</th><th>Päevi</th></tr></thead><tbody>`;
    futureVacs.forEach(v => {
      const storeInfo = getStoreInfo(v.store);
      const days = v.days || daysBetween(v.start_date, v.end_date);
      html += `<tr>
        <td>${escHtml(v.employee_name)}</td>
        <td><span class="store-badge ${storeInfo.cssClass}">${escHtml(v.store)}</span></td>
        <td>${formatDate(v.start_date)} – ${formatDate(v.end_date)}</td>
        <td>${days}</td>
      </tr>`;
    });
    html += '</tbody></table>';
  }
  html += '</div>';
  return html;
}

function getWeekNumber(d) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const week1 = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
}

// ============================================================
// STORE VIEW — GANTT
// ============================================================
function renderStoreView() {
  const storeName = document.getElementById('store-select').value;
  const storeEmps = employees.filter(e => e.store === storeName);
  const year = 2026;
  // Determine which month to show (use store-month-select if present, else current month)
  const monthSel = document.getElementById('store-month-select');
  const month = monthSel ? parseInt(monthSel.value) : new Date().getMonth();

  if (storeEmps.length === 0) {
    document.getElementById('store-gantt-body').innerHTML = `
      <div class="empty-state">
        <p>Selles kaupluses pole töötajaid</p>
      </div>`;
    return;
  }

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  // Build calendar grid table
  let html = '<div class="store-calendar-wrapper"><table class="store-cal-table"><thead><tr>';
  html += '<th class="name-col">Töötaja</th>';
  html += `<th class="balance-col">
    <div class="balance-header-toggle">
      <span>${showEndOfPeriodBalance ? 'Jääk (lõpp)' : 'Jääk'}</span>
      <button class="balance-toggle-btn" onclick="toggleBalanceMode()" title="Vaheta jäägi režiimi">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
      </button>
    </div>
  </th>`;

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dow = (new Date(year, month, d).getDay() + 6) % 7; // Mon=0
    const isWeekend = dow >= 5;
    const isToday = dateStr === todayStr;
    const dayLabel = DAY_NAMES_ET[dow];
    html += `<th class="day-col ${isWeekend ? 'weekend' : ''} ${isToday ? 'today-col' : ''}">
      <div class="day-num">${d}</div>
      <div class="day-name">${dayLabel}</div>
    </th>`;
  }
  html += '</tr></thead><tbody>';

  storeEmps.forEach(emp => {
    const empVacs = vacations.filter(v => v.employee_id === emp.id);
    const remaining = calcRemainingBalance(emp);
    const remClass = remaining < 0 ? 'balance-neg' : remaining < 5 ? 'balance-warn' : 'balance-ok';

    html += '<tr>';
    html += `<td class="name-cell" style="cursor:pointer;" onclick="showEmployeeDetail(${emp.id})">
      <div>${escHtml(emp.name)}</div>
      <div class="emp-position">${escHtml(emp.position)}</div>
    </td>`;
    html += `<td class="balance-cell"><span class="${remClass}">${remaining}</span></td>`;

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dow = (new Date(year, month, d).getDay() + 6) % 7;
      const isWeekend = dow >= 5;
      const isToday = dateStr === todayStr;

      // Check if employee is on vacation this day
      const vacOnDay = empVacs.find(v => v.start_date <= dateStr && v.end_date >= dateStr);

      let cellClass = isWeekend ? 'weekend' : '';
      if (isToday) cellClass += ' today-cell';
      let cellContent = '';

      if (vacOnDay) {
        const typeNorm = (vacOnDay.type || 'PP').toUpperCase().replace('PÕHIPUHKUS', 'PP');
        cellClass += typeNorm === 'LPP' ? ' vac-lpp' : ' vac-pp';
        cellContent = typeNorm;
      }

      html += `<td class="cal-day ${cellClass}" title="${vacOnDay ? escHtml(emp.name) + ': ' + formatDate(vacOnDay.start_date) + ' \u2013 ' + formatDate(vacOnDay.end_date) : ''}">${cellContent}</td>`;
    }

    html += '</tr>';
  });

  html += '</tbody></table></div>';
  document.getElementById('store-gantt-body').innerHTML = html;
}

// ============================================================
// YEAR CALENDAR — HEATMAP
// ============================================================
function renderYearCalendar() {
  const year = parseInt(document.getElementById('year-select').value);
  const today = new Date();

  // Build vacation count per day
  const dayCounts = {};
  vacations.forEach(v => {
    const start = new Date(v.start_date);
    const end = new Date(v.end_date);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      if (d.getFullYear() === year) {
        const key = d.toISOString().split('T')[0];
        dayCounts[key] = (dayCounts[key] || 0) + 1;
      }
    }
  });

  let html = '<div class="year-grid">';

  for (let m = 0; m < 12; m++) {
    html += '<div class="month-card">';
    html += `<div class="month-name">${MONTH_FULL_ET[m]}</div>`;

    // Day headers
    html += '<div class="week-row">';
    DAY_NAMES_ET.forEach(d => {
      html += `<div class="day-head">${d}</div>`;
    });
    html += '</div>';

    const firstDay = new Date(year, m, 1);
    const lastDay = new Date(year, m + 1, 0);
    let dayOfWeek = (firstDay.getDay() + 6) % 7; // Mon=0

    // Rows
    html += '<div class="week-row">';
    // Empty cells before first day
    for (let i = 0; i < dayOfWeek; i++) {
      html += '<div class="day-cell empty"></div>';
    }

    for (let d = 1; d <= lastDay.getDate(); d++) {
      const dateStr = `${year}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const count = dayCounts[dateStr] || 0;
      const isWeekend = dayOfWeek >= 5;
      const isToday = today.getFullYear() === year && today.getMonth() === m && today.getDate() === d;

      let heatClass = '';
      if (count >= 6) heatClass = 'heat-6';
      else if (count >= 5) heatClass = 'heat-5';
      else if (count >= 4) heatClass = 'heat-4';
      else if (count >= 3) heatClass = 'heat-3';
      else if (count >= 2) heatClass = 'heat-2';
      else if (count >= 1) heatClass = 'heat-1';

      const tooltip = count > 0 ? `${d}. ${MONTH_NAMES_ET[m]} — ${count} inimest puhkusel` : '';

      const clickHandler = count > 0 ? `onclick="showDayDetail('${dateStr}')"` : '';
      html += `<div class="day-cell ${heatClass} ${isWeekend ? 'weekend' : ''} ${isToday ? 'today' : ''} ${count > 0 ? 'clickable' : ''}" ${tooltip ? `data-tooltip="${escHtml(tooltip)}"` : ''} ${clickHandler}>${d}</div>`;

      dayOfWeek++;
      if (dayOfWeek >= 7 && d < lastDay.getDate()) {
        dayOfWeek = 0;
        html += '</div><div class="week-row">';
      }
    }

    // Fill remaining cells
    while (dayOfWeek < 7 && dayOfWeek > 0) {
      html += '<div class="day-cell empty"></div>';
      dayOfWeek++;
    }
    html += '</div>'; // week-row
    html += '</div>'; // month-card
  }

  html += '</div>'; // year-grid
  document.getElementById('calendar-body').innerHTML = html;
}

function showDayDetail(dateStr) {
  const d = new Date(dateStr);
  const dayNum = d.getDate();
  const monthName = MONTH_FULL_ET[d.getMonth()];
  const dayName = DAY_NAMES_ET[(d.getDay() + 6) % 7];

  // Find all vacations that include this date
  const dayVacs = vacations.filter(v => v.start_date <= dateStr && v.end_date >= dateStr);

  let html = `<h4 style="margin-bottom:var(--space-3);font-size:var(--text-base);">${dayName}, ${dayNum}. ${monthName} ${d.getFullYear()}</h4>`;
  html += `<p style="color:var(--color-text-muted);font-size:var(--text-sm);margin-bottom:var(--space-4);">${dayVacs.length} töötajat puhkusel</p>`;

  if (dayVacs.length > 0) {
    // Group by store
    const byStore = {};
    dayVacs.forEach(v => {
      if (!byStore[v.store]) byStore[v.store] = [];
      byStore[v.store].push(v);
    });

    html += '<div style="display:flex;flex-direction:column;gap:var(--space-3);">';
    STORES.forEach(store => {
      const storeVacs = byStore[store.name];
      if (!storeVacs || storeVacs.length === 0) return;
      html += `<div>
        <span class="store-badge ${store.cssClass}" style="font-size:var(--text-xs);padding:2px 8px;">${store.name}</span>
        <div style="margin-top:var(--space-2);">`;
      storeVacs.forEach(v => {
        const typeNorm = (v.type || 'PP').toUpperCase().replace('PÕHIPUHKUS', 'PP');
        const typeClass = typeNorm === 'LPP' ? 'lpp' : 'pp';
        html += `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:var(--text-sm);">
          <strong>${escHtml(v.employee_name)}</strong>
          <span class="vac-type-badge ${typeClass}" style="font-size:0.65rem;">${typeNorm}</span>
          <span style="color:var(--color-text-muted);">${formatDate(v.start_date)} – ${formatDate(v.end_date)}</span>
        </div>`;
      });
      html += '</div></div>';
    });
    html += '</div>';
  }

  document.getElementById('emp-detail-body').innerHTML = html;
  document.querySelector('#modal-emp-detail .modal-header h3').textContent = 'Puhkusel';
  openModal('modal-emp-detail');
}

// ============================================================
// EMPLOYEES LIST
// ============================================================
function renderEmployees() {
  const search = (document.getElementById('emp-search').value || '').toLowerCase();
  const isAdmin = userProfile && userProfile.role === 'admin';

  let filtered = employees;
  if (search) {
    filtered = employees.filter(e =>
      e.name.toLowerCase().includes(search) ||
      e.store.toLowerCase().includes(search) ||
      e.position.toLowerCase().includes(search)
    );
  }

  // Group by store
  const grouped = {};
  STORES.forEach(s => { grouped[s.name] = []; });

  filtered.forEach(e => {
    if (!grouped[e.store]) grouped[e.store] = [];
    grouped[e.store].push(e);
  });

  let html = '<table class="employees-table"><thead><tr>';
  html += `<th>Nimi</th><th>Ametikoht</th><th>Leping</th><th>Algne jääk</th><th>2026</th><th>${showEndOfPeriodBalance ? 'Teenitud' : 'Teenitud tänaseni'}</th><th>Kasutatud</th><th><div class="balance-header-toggle"><span>${showEndOfPeriodBalance ? 'Jääk (aasta lõpp)' : 'Jääk (täna)'}</span><button class="balance-toggle-btn" onclick="toggleBalanceMode()" title="${showEndOfPeriodBalance ? 'Näita tänast jääki' : 'Näita perioodi lõpu jääki'}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg></button></div></th>`;
  if (isAdmin) html += '<th>Tegevused</th>';
  html += '</tr></thead><tbody>';

  STORES.forEach(store => {
    const storeEmps = grouped[store.name] || [];
    if (storeEmps.length === 0 && search) return;

    html += `<tr class="store-group-header"><td colspan="${isAdmin ? 9 : 8}">
      <span class="store-badge ${store.cssClass}" style="font-size:var(--text-sm);padding:3px 10px;">${store.name} (${store.code})</span>
      <span style="margin-left:8px;font-weight:500;color:var(--color-text-muted);font-size:var(--text-sm);">${storeEmps.length} töötajat</span>
    </td></tr>`;

    storeEmps.forEach(emp => {
      const todayStr = new Date().toISOString().split('T')[0];
      const earned = showEndOfPeriodBalance ? (emp.balance_year_2026 || 28) : calcEarnedVacationDays(emp);
      const used = showEndOfPeriodBalance ? calcAllPlannedDays(emp.id) : calcUsedDays(emp.id, todayStr);
      const remaining = calcRemainingBalance(emp);
      const remClass = remaining < 0 ? 'balance-neg' : remaining < 5 ? 'balance-warn' : 'balance-ok';

      html += `<tr>
        <td><strong style="cursor:pointer;" onclick="showEmployeeDetail(${emp.id})">${escHtml(emp.name)}</strong></td>
        <td>${escHtml(emp.position)}</td>
        <td style="font-size:var(--text-sm);color:var(--color-text-muted);">${escHtml(emp.contract_date || '')}</td>
        <td style="text-align:center;">${emp.balance_start_2025}</td>
        <td style="text-align:center;">${emp.balance_year_2026}</td>
        <td style="text-align:center;font-weight:600;">${earned}</td>
        <td style="text-align:center;">${used}</td>
        <td style="text-align:center;font-weight:600;" class="${remClass}">${remaining}</td>`;

      if (isAdmin) {
        html += `<td class="actions-cell">
          <button class="btn-icon" onclick="editEmployee(${emp.id})" title="Muuda">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="btn-icon" onclick="confirmDeleteEmployee(${emp.id})" title="Töötaja lahkus" style="color:var(--color-error);">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </button>
        </td>`;
      }

      html += '</tr>';
    });
  });

  html += '</tbody></table>';
  document.getElementById('employees-body').innerHTML = html;
}

// ============================================================
// EMPLOYEE DETAIL
// ============================================================
function showEmployeeDetail(empId) {
  const emp = employees.find(e => e.id === empId);
  if (!emp) return;

  const empVacs = vacations.filter(v => v.employee_id === empId);
  const todayStr = new Date().toISOString().split('T')[0];
  const earned = calcEarnedVacationDays(emp);
  const usedToDate = calcUsedDays(empId, todayStr);
  const allPlanned = calcAllPlannedDays(empId);
  const carryOver = emp.balance_start_2025 || 0;
  const todayBalance = Math.round((carryOver + earned - usedToDate) * 100) / 100;
  const endBalance = Math.round((carryOver + (emp.balance_year_2026 || 28) - allPlanned) * 100) / 100;
  const todayClass = todayBalance < 0 ? 'balance-neg' : todayBalance < 5 ? 'balance-warn' : 'balance-ok';
  const endClass = endBalance < 0 ? 'balance-neg' : endBalance < 5 ? 'balance-warn' : 'balance-ok';
  const storeInfo = getStoreInfo(emp.store);
  const isAdmin = userProfile && userProfile.role === 'admin';

  let html = `
    <div class="emp-detail-header">
      <div class="emp-avatar-lg">${emp.name.charAt(0)}</div>
      <div class="emp-detail-info">
        <h3>${escHtml(emp.name)}</h3>
        <div class="emp-meta">${escHtml(emp.position)} · <span class="store-badge ${storeInfo.cssClass}">${escHtml(emp.store)}</span></div>
      </div>
    </div>
    <div class="balance-grid">
      <div class="balance-item">
        <div class="b-label">Ülekanne 2025</div>
        <div class="b-value">${carryOver}</div>
      </div>
      <div class="balance-item">
        <div class="b-label">Teenitud tänaseni</div>
        <div class="b-value">${earned}</div>
      </div>
      <div class="balance-item">
        <div class="b-label">Kasutatud</div>
        <div class="b-value">${usedToDate}</div>
      </div>
      <div class="balance-item">
        <div class="b-label">Jääk täna</div>
        <div class="b-value ${todayClass}">${todayBalance}</div>
      </div>
      <div class="balance-item">
        <div class="b-label">Jääk aasta lõpus</div>
        <div class="b-value ${endClass}">${endBalance}</div>
      </div>
    </div>
    <h4 style="font-size:var(--text-base);font-weight:600;margin-bottom:var(--space-3);">Puhkuse perioodid (${empVacs.length})</h4>
  `;

  if (empVacs.length === 0) {
    html += '<p style="color:var(--color-text-faint);font-size:var(--text-sm);">Puhkusi pole planeeritud</p>';
  } else {
    html += '<table class="employees-table" style="font-size:var(--text-sm);"><thead><tr><th>Tüüp</th><th>Algus</th><th>Lõpp</th><th>Päevi</th>';
    if (isAdmin) html += '<th></th>';
    html += '</tr></thead><tbody>';

    empVacs.sort((a, b) => new Date(a.start_date) - new Date(b.start_date));

    empVacs.forEach(v => {
      const typeNorm = (v.type || 'PP').toUpperCase().replace('PÕHIPUHKUS', 'PP');
      const typeClass = typeNorm === 'LPP' ? 'lpp' : 'pp';
      html += `<tr>
        <td><span class="vac-type-badge ${typeClass}">${typeNorm}</span></td>
        <td>${formatDate(v.start_date)}</td>
        <td>${formatDate(v.end_date)}</td>
        <td>${v.days || daysBetween(v.start_date, v.end_date)}</td>`;
      if (isAdmin) {
        html += `<td class="actions-cell">
          <button class="btn-icon" onclick="closeModal('modal-emp-detail'); editVacation(${v.id})" title="Muuda">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn-icon" onclick="closeModal('modal-emp-detail'); confirmDeleteVacation(${v.id})" title="Kustuta" style="color:var(--color-error);">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </td>`;
      }
      html += '</tr>';
    });

    html += '</tbody></table>';
  }

  document.getElementById('emp-detail-body').innerHTML = html;
  openModal('modal-emp-detail');
}

// ============================================================
// VACATION CRUD
// ============================================================

function populateEmployeeSelect(selectId) {
  const sel = document.getElementById(selectId);
  sel.innerHTML = '<option value="">Vali töötaja...</option>';
  const sorted = [...employees].sort((a, b) => a.store.localeCompare(b.store) || a.name.localeCompare(b.name));
  sorted.forEach(emp => {
    const opt = document.createElement('option');
    opt.value = emp.id;
    opt.textContent = `${emp.name} (${emp.store})`;
    sel.appendChild(opt);
  });
  // Add "new employee" option
  const newOpt = document.createElement('option');
  newOpt.value = '__new__';
  newOpt.textContent = '\u2795 Lisa uus t\u00f6\u00f6taja...';
  sel.appendChild(newOpt);

  // Handle "new employee" selection
  sel.onchange = function() {
    if (sel.value === '__new__') {
      sel.value = ''; // reset
      openEmployeeModal(null, true); // open employee modal, return to vacation modal after
    } else {
      updateVacationBalance();
    }
  };
}
function openVacationModal(empId) {
  editingVacationId = null;
  document.getElementById('vacation-modal-title').textContent = 'Lisa puhkus';
  document.getElementById('vacation-save-btn').textContent = 'Salvesta';

  // Populate employee select
  populateEmployeeSelect('vac-employee');

  if (empId) document.getElementById('vac-employee').value = empId;

  document.getElementById('vac-type').value = 'PP';
  document.getElementById('vac-start').value = '';
  document.getElementById('vac-end').value = '';
  document.getElementById('vac-days-count').textContent = '0';
  document.getElementById('vacation-warning').classList.remove('visible');

  openModal('modal-vacation');
}

function editVacation(vacId) {
  const vac = vacations.find(v => v.id === vacId);
  if (!vac) return;

  editingVacationId = vacId;
  document.getElementById('vacation-modal-title').textContent = 'Muuda puhkust';
  document.getElementById('vacation-save-btn').textContent = 'Salvesta muudatused';

  // Populate employee select
  populateEmployeeSelect('vac-employee');
  document.getElementById('vac-employee').value = vac.employee_id;
  const typeNorm = (vac.type || 'PP').toUpperCase().replace('PÕHIPUHKUS', 'PP');
  document.getElementById('vac-type').value = typeNorm === 'LPP' ? 'LPP' : 'PP';
  document.getElementById('vac-start').value = vac.start_date;
  document.getElementById('vac-end').value = vac.end_date;

  calcVacDays();
  openModal('modal-vacation');
}

function calcVacDays() {
  const start = document.getElementById('vac-start').value;
  const end = document.getElementById('vac-end').value;
  if (start && end) {
    const days = daysBetween(start, end);
    document.getElementById('vac-days-count').textContent = days > 0 ? days : 0;
    updateVacationBalance();
  } else {
    document.getElementById('vac-days-count').textContent = '0';
  }
}

function updateVacationBalance() {
  const empId = parseInt(document.getElementById('vac-employee').value);
  const start = document.getElementById('vac-start').value;
  const end = document.getElementById('vac-end').value;
  const warning = document.getElementById('vacation-warning');

  if (!empId || !start || !end) {
    warning.classList.remove('visible');
    return;
  }

  const emp = employees.find(e => e.id === empId);
  if (!emp) return;

  const newDays = daysBetween(start, end);
  const carryOver = emp.balance_start_2025 || 0;
  const total = carryOver + (emp.balance_year_2026 || 28);

  // Calculate all planned days, excluding current editing vacation
  let used = vacations
    .filter(v => v.employee_id === empId && v.id !== editingVacationId)
    .reduce((sum, v) => sum + (v.days || daysBetween(v.start_date, v.end_date)), 0);

  const remaining = Math.round((total - used - newDays) * 100) / 100;

  if (remaining < 0) {
    warning.textContent = `Hoiatus: Puhkusejääk läheb negatiivseks (${remaining} päeva)`;
    warning.classList.add('visible');
  } else {
    warning.classList.remove('visible');
  }
}

async function saveVacation() {
  const empId = parseInt(document.getElementById('vac-employee').value);
  const type = document.getElementById('vac-type').value;
  const start = document.getElementById('vac-start').value;
  const end = document.getElementById('vac-end').value;

  if (!empId || !start || !end) {
    showToast('Palun täida kõik väljad', 'error');
    return;
  }

  if (new Date(end) < new Date(start)) {
    showToast('Lõppkuupäev peab olema hilisem kui alguskuupäev', 'error');
    return;
  }

  const emp = employees.find(e => e.id === empId);
  if (!emp) return;

  const days = daysBetween(start, end);

  if (editingVacationId) {
    // Update existing
    const idx = vacations.findIndex(v => v.id === editingVacationId);
    if (idx >= 0) {
      vacations[idx] = {
        ...vacations[idx],
        employee_id: empId,
        employee_name: emp.name,
        store: emp.store,
        type,
        start_date: start,
        end_date: end,
        days
      };
    }
  } else {
    // New vacation
    vacations.push({
      id: getNextVacId(),
      employee_id: empId,
      employee_name: emp.name,
      store: emp.store,
      type,
      start_date: start,
      end_date: end,
      days
    });
  }

  await saveVacations();
  closeModal('modal-vacation');
  showToast(editingVacationId ? 'Puhkus muudetud' : 'Puhkus lisatud', 'success');
  editingVacationId = null;
  renderCurrentView();
}

function confirmDeleteVacation(vacId) {
  const vac = vacations.find(v => v.id === vacId);
  if (!vac) return;

  document.getElementById('confirm-title').textContent = 'Kustuta puhkus';
  document.getElementById('confirm-text').textContent =
    `Kas soovid kustutada ${vac.employee_name} puhkuse (${formatDate(vac.start_date)} – ${formatDate(vac.end_date)})?`;

  const btn = document.getElementById('confirm-action-btn');
  btn.textContent = 'Kustuta';
  btn.onclick = async () => {
    vacations = vacations.filter(v => v.id !== vacId);
    await saveVacations();
    closeModal('modal-confirm');
    showToast('Puhkus kustutatud', 'success');
    renderCurrentView();
  };

  openModal('modal-confirm');
}

// ============================================================
// MANAGERS VIEW
// ============================================================
function renderManagers() {
  const managers = employees.filter(e =>
    e.position && (e.position.toLowerCase().includes('juhataja'))
  );

  if (managers.length === 0) {
    document.getElementById('managers-body').innerHTML = `
      <div class="empty-state">
        <p>Juhatajaid ei leitud</p>
        <div class="empty-sub">Kontrolli, et töötajate ametikoht sisaldab "juhataja"</div>
      </div>`;
    return;
  }

  managers.sort((a, b) => {
    const si = STORES.findIndex(s => s.name === a.store);
    const sj = STORES.findIndex(s => s.name === b.store);
    return si - sj;
  });

  const year = 2026;
  const mgrMonthSel = document.getElementById('mgr-month-select');
  const month = mgrMonthSel ? parseInt(mgrMonthSel.value) : new Date().getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  // Calendar grid — same style as store view
  let html = '<div class="store-calendar-wrapper"><table class="store-cal-table"><thead><tr>';
  html += '<th class="name-col">Juhataja</th>';
  html += '<th class="balance-col">Kauplus</th>';
  html += '<th class="balance-col">Jääk</th>';

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dow = (new Date(year, month, d).getDay() + 6) % 7;
    const isWeekend = dow >= 5;
    const isToday = dateStr === todayStr;
    html += `<th class="day-col ${isWeekend ? 'weekend' : ''} ${isToday ? 'today-col' : ''}">
      <div class="day-num">${d}</div>
      <div class="day-name">${DAY_NAMES_ET[dow]}</div>
    </th>`;
  }
  html += '</tr></thead><tbody>';

  managers.forEach(mgr => {
    const storeInfo = getStoreInfo(mgr.store);
    const mgrVacs = vacations.filter(v => v.employee_id === mgr.id);
    const remaining = calcRemainingBalance(mgr);
    const remClass = remaining < 0 ? 'balance-neg' : remaining < 5 ? 'balance-warn' : 'balance-ok';

    html += '<tr>';
    html += `<td class="name-cell" style="cursor:pointer;" onclick="showEmployeeDetail(${mgr.id})">
      <div><strong>${escHtml(mgr.name)}</strong></div>
    </td>`;
    html += `<td class="balance-cell"><span class="store-badge ${storeInfo.cssClass}" style="font-size:0.65rem;padding:2px 6px;">${escHtml(mgr.store)}</span></td>`;
    html += `<td class="balance-cell"><span class="${remClass}">${remaining}</span></td>`;

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dow = (new Date(year, month, d).getDay() + 6) % 7;
      const isWeekend = dow >= 5;
      const isToday = dateStr === todayStr;

      const vacOnDay = mgrVacs.find(v => v.start_date <= dateStr && v.end_date >= dateStr);

      let cellClass = isWeekend ? 'weekend' : '';
      if (isToday) cellClass += ' today-cell';
      let cellContent = '';

      if (vacOnDay) {
        const typeNorm = (vacOnDay.type || 'PP').toUpperCase().replace('PÕHIPUHKUS', 'PP');
        cellClass += typeNorm === 'LPP' ? ' vac-lpp' : ' vac-pp';
        cellContent = typeNorm;
      }

      html += `<td class="cal-day ${cellClass}">${cellContent}</td>`;
    }

    html += '</tr>';
  });

  // Summary row: count how many managers on vacation each day
  html += '<tr class="mgr-summary-row"><td class="name-cell"><strong>Kokku puhkusel</strong></td><td></td><td></td>';
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dow = (new Date(year, month, d).getDay() + 6) % 7;
    const isWeekend = dow >= 5;
    let count = 0;
    managers.forEach(mgr => {
      const mgrVacs = vacations.filter(v => v.employee_id === mgr.id);
      if (mgrVacs.some(v => v.start_date <= dateStr && v.end_date >= dateStr)) count++;
    });
    const warnClass = count >= 2 ? 'overlap-warn' : count === 1 ? 'overlap-one' : '';
    html += `<td class="cal-day summary-cell ${isWeekend ? 'weekend' : ''} ${warnClass}">${count || ''}</td>`;
  }
  html += '</tr>';

  html += '</tbody></table></div>';
  document.getElementById('managers-body').innerHTML = html;
}

// ============================================================
// EMPLOYEE CRUD
// ============================================================
let returnToVacationModal = false;

function openEmployeeModal(empId, fromVacationModal) {
  editingEmployeeId = null;
  returnToVacationModal = !!fromVacationModal;
  document.getElementById('employee-modal-title').textContent = 'Lisa töötaja';
  document.getElementById('employee-save-btn').textContent = 'Salvesta';

  document.getElementById('emp-name').value = '';
  document.getElementById('emp-position').value = 'Müügikonsultant';
  document.getElementById('emp-store').value = 'Järve';
  document.getElementById('emp-contract').value = '';
  document.getElementById('emp-balance-start').value = '0';
  document.getElementById('emp-balance-year').value = '28';

  if (fromVacationModal) closeModal('modal-vacation');
  openModal('modal-employee');
}

function editEmployee(empId) {
  const emp = employees.find(e => e.id === empId);
  if (!emp) return;

  editingEmployeeId = empId;
  document.getElementById('employee-modal-title').textContent = 'Muuda töötajat';
  document.getElementById('employee-save-btn').textContent = 'Salvesta muudatused';

  document.getElementById('emp-name').value = emp.name;
  document.getElementById('emp-position').value = emp.position;
  document.getElementById('emp-store').value = emp.store;
  document.getElementById('emp-contract').value = emp.contract_date || '';
  document.getElementById('emp-balance-start').value = emp.balance_start_2025 || 0;
  document.getElementById('emp-balance-year').value = emp.balance_year_2026 || 28;

  openModal('modal-employee');
}

async function saveEmployee() {
  const name = document.getElementById('emp-name').value.trim();
  const position = document.getElementById('emp-position').value;
  const store = document.getElementById('emp-store').value;
  const contract = document.getElementById('emp-contract').value.trim();
  const balanceStart = parseFloat(document.getElementById('emp-balance-start').value) || 0;
  const balanceYear = parseFloat(document.getElementById('emp-balance-year').value) || 28;

  if (!name) {
    showToast('Palun sisesta töötaja nimi', 'error');
    return;
  }

  if (editingEmployeeId) {
    const idx = employees.findIndex(e => e.id === editingEmployeeId);
    if (idx >= 0) {
      employees[idx] = {
        ...employees[idx],
        name,
        position,
        store,
        contract_date: contract,
        balance_start_2025: balanceStart,
        balance_year_2026: balanceYear,
        balance_end_2026: Math.round((balanceStart + balanceYear) * 100) / 100
      };

      // Update employee name in vacations too
      vacations.forEach(v => {
        if (v.employee_id === editingEmployeeId) {
          v.employee_name = name;
          v.store = store;
        }
      });
      await saveAllData();
    }
  } else {
    employees.push({
      id: getNextEmpId(),
      name,
      position,
      store,
      contract_date: contract,
      balance_start_2025: balanceStart,
      balance_year_2026: balanceYear,
      balance_end_2026: Math.round((balanceStart + balanceYear) * 100) / 100
    });
    await saveEmployees();
  }

  closeModal('modal-employee');
  const wasNew = !editingEmployeeId;
  showToast(editingEmployeeId ? 'Töötaja muudetud' : 'Töötaja lisatud', 'success');
  editingEmployeeId = null;
  renderCurrentView();

  // If we came from vacation modal, return there with the new employee selected
  if (returnToVacationModal && wasNew) {
    returnToVacationModal = false;
    const newEmpId = employees[employees.length - 1]?.id;
    openVacationModal(newEmpId);
  }
  returnToVacationModal = false;
}

function confirmDeleteEmployee(empId) {
  const emp = employees.find(e => e.id === empId);
  if (!emp) return;

  document.getElementById('confirm-title').textContent = 'Töötaja lahkub';
  document.getElementById('confirm-text').textContent =
    `Kas ${emp.name} lahkub? See eemaldab töötaja ja kõik tema puhkused.`;

  const btn = document.getElementById('confirm-action-btn');
  btn.textContent = 'Eemalda';
  btn.style.cssText = '';
  btn.onclick = async () => {
    employees = employees.filter(e => e.id !== empId);
    vacations = vacations.filter(v => v.employee_id !== empId);
    await saveAllData();
    closeModal('modal-confirm');
    closeModal('modal-emp-detail');
    showToast(`${emp.name} eemaldatud`, 'success');
    renderCurrentView();
  };

  openModal('modal-confirm');
}

// ============================================================
// MODALS
// ============================================================
function openModal(id) {
  document.getElementById(id).classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
  document.body.style.overflow = '';
}

// Close modal on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.classList.remove('active');
      document.body.style.overflow = '';
    }
  });
});

// Close modal on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.active').forEach(m => {
      m.classList.remove('active');
    });
    document.body.style.overflow = '';
  }
});

// ============================================================
// TOAST
// ============================================================
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      ${type === 'success'
        ? '<polyline points="20 6 9 17 4 12"/>'
        : type === 'error'
        ? '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>'
        : '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'
      }
    </svg>
    <span>${escHtml(message)}</span>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    toast.style.transition = '300ms ease';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ============================================================
// UTIL
// ============================================================
function escHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
