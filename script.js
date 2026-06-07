/* =====================================================================
 * LiveRP Admin Control Panel — Main Application v4.0
 * SPA на ванильном JS. Все обращения к БД — через supabase.js
 * ===================================================================== */

// ---------------------- Состояние ----------------------
const State = {
    route: 'dashboard',
    user: null,
    profile: null,
    cache: {
        admins: [],
        questions: [],
        candidates: [],
        calls: [],
        discipline: [],
        promotionSettings: [],
        promotions: [],
        payments: [],
        users: [],
        departments: []
    },
    currentCsvRows: null,
    currentCsvName: 'export.csv'
};

// ---------------------- Константы ----------------------
const PASS_PERCENT = 70;
const RETAKE_PERCENT = 50;

const DEFAULT_TARIFFS = {
    report: 20, punishment: 15, watch: 25, delivery: 30,
    robbery: 40, event: 100, call: 200, training: 250,
    online: 5, curator_bonus: 0, other: 0
};
const CURATOR_BONUS = { 'Стажёр администрации': 1500, 'Куратор': 4000, 'Старший куратор': 8000 };
const NIGHT_FROM = 0;
const NIGHT_TO = 8;

const DEFAULT_APPEARANCE = {
    theme: 'dark',
    animations: 'on',
    bgEffect: 'orbs',
    density: 'comfortable'
};

const DEFAULT_DEPARTMENTS = [
    { name: 'Общая администрация', show_calls: true, show_reports: true, show_trainings: true, show_activity: true, show_punishments: true, sort_order: 10 },
    { name: 'Отдел набора', show_calls: true, show_reports: false, show_trainings: true, show_activity: true, show_punishments: true, sort_order: 20 },
    { name: 'Руководство', show_calls: true, show_reports: true, show_trainings: true, show_activity: true, show_punishments: true, sort_order: 30 }
];

function normalizeDepartment(dep = {}) {
    return {
        id: dep.id || null,
        name: dep.name || dep.branch || 'Общая администрация',
        show_calls: dep.show_calls !== false,
        show_reports: dep.show_reports !== false,
        show_trainings: dep.show_trainings !== false,
        show_activity: dep.show_activity !== false,
        show_punishments: dep.show_punishments !== false,
        sort_order: Number(dep.sort_order || 100)
    };
}

function getDepartmentConfig(name, departments = []) {
    const depName = name || 'Общая администрация';
    return normalizeDepartment(departments.find(d => d.name === depName) || DEFAULT_DEPARTMENTS.find(d => d.name === depName) || { name: depName });
}

function getDepartmentsFromAdmins(admins = [], departments = []) {
    const map = new Map();
    [...DEFAULT_DEPARTMENTS, ...departments.map(normalizeDepartment)].forEach(d => map.set(d.name, normalizeDepartment(d)));
    admins.forEach(a => {
        const name = a.branch || 'Общая администрация';
        if (!map.has(name)) map.set(name, normalizeDepartment({ name, sort_order: 999 }));
    });
    return [...map.values()].sort((a,b) => (a.sort_order||100) - (b.sort_order||100) || a.name.localeCompare(b.name));
}

function adminCallsCount(admin, calls = []) {
    return calls.filter(c => c.trainer_admin_id === admin.id || (c.trainer && c.trainer.id === admin.id)).length;
}

function adminTrainingsCount(admin, calls = []) {
    return calls.filter(c => (c.trainer_admin_id === admin.id || (c.trainer && c.trainer.id === admin.id)) && c.training_replay_url).length;
}

function adminActivePunishments(admin, discipline = []) {
    return discipline.filter(d => d.admin_id === admin.id && d.status === 'active').length;
}

function adminReportsCount(admin) {
    return Number(admin.accepted_reports || 0);
}

function metricsHeader(dep) {
    const cols = [];
    if (dep.show_activity) cols.push('<th class="num">Активность</th>');
    if (dep.show_calls) cols.push('<th class="num">Обзвоны</th>');
    if (dep.show_trainings) cols.push('<th class="num">Обучения</th>');
    if (dep.show_reports) cols.push('<th class="num">Рапорты</th>');
    if (dep.show_punishments) cols.push('<th class="num">Наказания</th>');
    return cols.join('');
}

function metricsCells(admin, dep, calls = [], discipline = []) {
    const cells = [];
    if (dep.show_activity) cells.push(`<td class="num">${Number(admin.activity_percent || 0)}%</td>`);
    if (dep.show_calls) cells.push(`<td class="num">${adminCallsCount(admin, calls)}</td>`);
    if (dep.show_trainings) cells.push(`<td class="num">${adminTrainingsCount(admin, calls)}</td>`);
    if (dep.show_reports) cells.push(`<td class="num">${adminReportsCount(admin)}</td>`);
    if (dep.show_punishments) cells.push(`<td class="num">${adminActivePunishments(admin, discipline)}</td>`);
    return cells.join('');
}

function loadAppearanceSettings() {
    try { return { ...DEFAULT_APPEARANCE, ...(JSON.parse(localStorage.getItem('liverpAppearance') || '{}')) }; }
    catch { return { ...DEFAULT_APPEARANCE }; }
}

function saveAppearanceSettings(patch) {
    const next = { ...loadAppearanceSettings(), ...patch };
    try { localStorage.setItem('liverpAppearance', JSON.stringify(next)); } catch {}
    applyAppearanceSettings(next);
    return next;
}

function applyAppearanceSettings(settings = loadAppearanceSettings()) {
    document.body.dataset.theme = settings.theme || 'dark';
    document.body.dataset.animations = settings.animations || 'on';
    document.body.dataset.bgEffect = settings.bgEffect || 'orbs';
    document.body.dataset.density = settings.density || 'comfortable';
}

function rankLabel(rank) {
    const n = parseInt(rank, 10);
    return n >= 1 && n <= 11 ? `Ранг ${n}` : 'Без ранга';
}

function adminPositionLabel(a = {}) {
    const base = rankLabel(a.rank);
    const custom = a.custom_position || a.current_position;
    return custom ? `${base} · ${custom}` : base;
}

function adminShortLabel(a = {}) {
    return `${a.display_name || '—'}${a.rank ? ` · R${a.rank}` : ''}${a.custom_position ? ` · ${a.custom_position}` : ''}`;
}

function normalizeAdminPayload(payload) {
    const rank = parseInt(payload.rank, 10);
    const cleanRank = rank >= 1 && rank <= 11 ? rank : null;
    const custom = (payload.custom_position || '').trim() || null;
    return {
        ...payload,
        rank: cleanRank,
        custom_position: custom,
        current_position: custom || (cleanRank ? `Ранг ${cleanRank}` : (payload.current_position || null))
    };
}

const ROUTES = {
    dashboard:     { title: 'Главная',                 roles: ['owner','admin','interviewer','viewer'] },
    calls:         { title: 'Обзвоны',                 roles: ['owner','admin','interviewer'] },
    questions:     { title: 'Конструктор вопросов',    roles: ['owner','admin','interviewer','viewer'] },
    history:       { title: 'История обзвонов',        roles: ['owner','admin','interviewer','viewer'] },
    stats:         { title: 'Статистика',              roles: ['owner','admin','interviewer','viewer'] },
    users:         { title: 'Пользователи',            roles: ['owner','admin'] },
    admins:        { title: 'Состав администрации',    roles: ['owner','admin','interviewer','viewer'] },
    departments:   { title: 'Отделы / разделы',        roles: ['owner','admin','interviewer','viewer'] },
    leadership:    { title: 'Руководство',             roles: ['owner','admin','interviewer','viewer'] },
    discipline:    { title: 'Дисциплинарные наказания',roles: ['owner','admin','viewer'] },
    promotion:     { title: 'Система повышения',       roles: ['owner','admin','viewer'] },
    'promotion-set':{ title:'Настройки повышения',     roles: ['owner','admin'] },
    payments:      { title: 'Выплаты / донат',         roles: ['owner','admin','viewer'] },
    archive:       { title: 'Архив',                   roles: ['owner','admin'] },
    settings:      { title: 'Настройки',               roles: ['owner','admin','interviewer','viewer'] }
};

// =====================================================================
// 1. Утилиты
// =====================================================================
const $  = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

const escapeHtml = (s='') => String(s).replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const fmtDate = (d) => {
    if (!d) return '—';
    try { return new Date(d).toLocaleDateString('ru-RU'); }
    catch { return d; }
};
const fmtDateTime = (d) => {
    if (!d) return '—';
    try { return new Date(d).toLocaleString('ru-RU'); }
    catch { return d; }
};

function toast(msg, type='info', timeout=3500) {
    const root = $('#toast-root');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(()=>el.remove(), 300); }, timeout);
}

function openModal({ title, body, footer, large=false }) {
    const root = $('#modal-root');
    root.innerHTML = `
        <div class="modal ${large?'large':''}" role="dialog" aria-modal="true">
            <div class="modal-head">
                <h3>${escapeHtml(title||'')}</h3>
                <button class="close" data-modal-close>×</button>
            </div>
            <div class="modal-body">${body||''}</div>
            ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
        </div>`;
    root.classList.remove('hidden');
    root.querySelector('[data-modal-close]').addEventListener('click', closeModal);
    root.addEventListener('click', (e) => { if (e.target === root) closeModal(); }, { once: true });
}
function closeModal() {
    const root = $('#modal-root');
    root.classList.add('hidden');
    root.innerHTML = '';
}

function confirmDialog(msg) {
    return new Promise(resolve => {
        openModal({
            title: 'Подтверждение',
            body: `<p>${escapeHtml(msg)}</p>`,
            footer: `<button class="btn" data-cancel>Отмена</button>
                     <button class="btn btn-danger" data-ok>Подтвердить</button>`
        });
        $('[data-cancel]').onclick = () => { closeModal(); resolve(false); };
        $('[data-ok]').onclick     = () => { closeModal(); resolve(true);  };
    });
}

function downloadFile(name, content, mime='application/octet-stream') {
    const blob = new Blob([content], { type: mime });
    const url  = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    a.remove(); URL.revokeObjectURL(url);
}

function exportRowsCsv(rows, filename='export.csv') {
    if (!rows || !rows.length) { toast('Нет данных для экспорта','warning'); return; }
    const cols = Object.keys(rows[0]);
    const lines = [cols.join(';')];
    for (const r of rows) {
        lines.push(cols.map(c => {
            let v = r[c];
            if (v == null) return '';
            if (typeof v === 'object') v = JSON.stringify(v);
            v = String(v).replace(/"/g,'""');
            return /[;\n"]/.test(v) ? `"${v}"` : v;
        }).join(';'));
    }
    downloadFile(filename, '\ufeff' + lines.join('\n'), 'text/csv;charset=utf-8');
}

function setCurrentCsv(rows, name='export.csv') {
    State.currentCsvRows = rows;
    State.currentCsvName = name;
}

function statusBadge(status) {
    const map = {
        passed:  ['success','Прошёл'],
        retake:  ['warning','На пересдачу'],
        failed:  ['danger', 'Не прошёл'],
        draft:   ['neutral','Черновик'],
        archived:['neutral','Архив'],
        new:     ['accent','Новый'],
        active:  ['danger', 'Активно'],
        removed: ['neutral','Снято'],
        appealed:['warning','Обжаловано'],
        not_ready: ['neutral','Не готов'],
        pending:   ['warning','На рассмотрении'],
        ready:     ['success','Готов'],
        promoted:  ['accent', 'Повышен'],
        rejected:  ['danger', 'Отказано']
    };
    const [cls, label] = map[status] || ['neutral', status||'—'];
    return `<span class="badge ${cls}">${escapeHtml(label)}</span>`;
}

function roleBadge(role) {
    if (!role) return '';
    return `<span class="role-badge ${role}">${role.toUpperCase()}</span>`;
}

function calcStatus(percent) {
    if (percent >= PASS_PERCENT) return 'passed';
    if (percent >= RETAKE_PERCENT) return 'retake';
    return 'failed';
}

// =====================================================================
// 2. Авторизация / запуск
// =====================================================================
async function bootstrap() {
    applyAppearanceSettings();
    initSupabase();

    if (!SB.client) {
        showLogin();
        $('#login-error').textContent = 'Supabase не настроен. Откройте supabase.js и впишите URL/anon key.';
        return;
    }

    const session = await SB.client.auth.getSession();
    if (session?.data?.session) {
        const ok = await tryEnterApp();
        if (!ok) showLogin();
    } else {
        showLogin();
    }

    SB.client.auth.onAuthStateChange(async (event) => {
        if (event === 'SIGNED_OUT') { showLogin(); }
    });

    setInterval(tickClock, 1000);
    tickClock();
    bindGlobal();
}

function showLogin() {
    $('#login-screen').classList.remove('hidden');
    $('#app').classList.add('hidden');
}

async function tryEnterApp() {
    const r = await requireAuth();
    if (!r) {
        toast('Аккаунт неактивен или нет профиля. Обратитесь к owner.', 'danger', 6000);
        return false;
    }
    State.user = r.user;
    State.profile = r.profile;
    $('#login-screen').classList.add('hidden');
    $('#app').classList.remove('hidden');
    renderTopbarMeta();
    applyRouteVisibility();
    handleRoute();
    return true;
}

function bindGlobal() {
    $('#login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = $('#login-error');
        err.textContent = '';
        const email = $('#login-email').value.trim();
        const pwd = $('#login-password').value;
        $('#login-btn').disabled = true;
        try {
            await login(email, pwd);
            const ok = await tryEnterApp();
            if (!ok) { await logout(); err.textContent = 'Профиль не активен.'; }
        } catch (e) {
            err.textContent = e.message || 'Ошибка входа';
        } finally {
            $('#login-btn').disabled = false;
        }
    });

    $('#btn-logout').addEventListener('click', async () => {
        if (!await confirmDialog('Выйти из аккаунта?')) return;
        await logout();
        State.user = null; State.profile = null;
        showLogin();
    });

    $('#btn-refresh').addEventListener('click', () => { handleRoute(true); toast('Данные обновлены','success'); });

    $('#btn-export-json').addEventListener('click', async () => {
        if (!hasRole('owner','admin')) return toast('Недостаточно прав','danger');
        toast('Готовим экспорт...');
        try {
            const dump = await exportData();
            const name = `liverp-admin-dump-${new Date().toISOString().slice(0,10)}.json`;
            downloadFile(name, JSON.stringify(dump, null, 2), 'application/json');
            toast('JSON экспортирован','success');
        } catch (e) { toast('Ошибка экспорта: '+e.message,'danger'); }
    });

    $('#btn-import-json').addEventListener('click', () => {
        if (!hasRole('owner')) return toast('Только owner может импортировать','danger');
        $('#file-import').click();
    });
    $('#file-import').addEventListener('change', async (e) => {
        const file = e.target.files?.[0]; if (!file) return;
        try {
            const text = await file.text();
            const dump = JSON.parse(text);
            if (!await confirmDialog('Импортировать данные? Существующие записи будут обновлены.')) return;
            await importData(dump);
            toast('Импорт выполнен','success');
            handleRoute(true);
        } catch (err) { toast('Ошибка импорта: '+err.message,'danger'); }
        e.target.value = '';
    });

    $('#btn-export-csv').addEventListener('click', () => {
        exportRowsCsv(State.currentCsvRows || [], State.currentCsvName);
    });

    $('#sidebar-nav').addEventListener('click', (e) => {
        const a = e.target.closest('a.nav-link'); if (!a) return;
        e.preventDefault();
        if (a.classList.contains('disabled')) { toast('Нет доступа','warning'); return; }
        location.hash = '#' + a.dataset.route;
    });

    window.addEventListener('hashchange', () => handleRoute());
}

function tickClock() {
    const now = new Date();
    const t = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute:'2-digit', second:'2-digit' });
    const d = now.toLocaleDateString('ru-RU', { year:'numeric', month:'2-digit', day:'2-digit' });
    const el = $('#topbar-clock'); if (el) el.textContent = `${d} ${t}`;
}

function renderTopbarMeta() {
    const meta = $('#topbar-meta'); if (!meta) return;
    const p = State.profile || {};
    meta.innerHTML = `
        <span>${escapeHtml(p.display_name || p.email || State.user?.email || '—')}</span>
        ${roleBadge(p.access_role)}
    `;
}

function applyRouteVisibility() {
    const role = State.profile?.access_role || 'viewer';
    $$('#sidebar-nav .nav-link').forEach(a => {
        const r = ROUTES[a.dataset.route];
        if (!r) return;
        if (r.roles.includes(role)) a.classList.remove('disabled');
        else a.classList.add('disabled');
    });
}

// =====================================================================
// 3. Роутер
// =====================================================================
async function handleRoute(force=false) {
    const hash = (location.hash || '#dashboard').replace('#','');
    const route = ROUTES[hash] ? hash : 'dashboard';
    State.route = route;

    $$('#sidebar-nav .nav-link').forEach(a => a.classList.toggle('active', a.dataset.route === route));
    const role = State.profile?.access_role || 'viewer';
    if (!ROUTES[route].roles.includes(role)) {
        $('#view').innerHTML = `<div class="empty">Нет доступа к разделу «${ROUTES[route].title}»</div>`;
        return;
    }

    setCurrentCsv(null,'export.csv');
    const view = $('#view');
    view.innerHTML = `<div class="empty">Загрузка...</div>`;

    try {
        switch (route) {
            case 'dashboard':     return await renderDashboard(view);
            case 'calls':         return await renderCalls(view);
            case 'questions':     return await renderQuestions(view);
            case 'history':       return await renderHistory(view);
            case 'stats':         return await renderStats(view);
            case 'users':         return await renderUsers(view);
            case 'admins':        return await renderAdmins(view);
            case 'departments':   return await renderDepartments(view);
            case 'leadership':    return await renderLeadership(view);
            case 'discipline':    return await renderDiscipline(view);
            case 'promotion':     return await renderPromotion(view);
            case 'promotion-set': return await renderPromotionSettings(view);
            case 'payments':      return await renderPayments(view);
            case 'archive':       return await renderArchive(view);
            case 'settings':      return await renderSettings(view);
        }
    } catch (e) {
        console.error(e);
        view.innerHTML = `<div class="empty">Ошибка загрузки: ${escapeHtml(e.message)}</div>`;
    }
}

// =====================================================================
// 4. Dashboard
// =====================================================================
async function renderDashboard(view) {
    const [calls, discipline, admins, settings, payments] = await Promise.all([
        loadCallHistory(), loadDisciplineRecords(),
        loadAdmins(), loadPromotionSettings(), loadPayments()
    ]);
    State.cache.calls = calls;
    State.cache.discipline = discipline;
    State.cache.admins = admins;
    State.cache.promotionSettings = settings;
    State.cache.payments = payments;

    const total = calls.length;
    const passed = calls.filter(c => c.status === 'passed').length;
    const failed = calls.filter(c => c.status === 'failed').length;
    const retake = calls.filter(c => c.status === 'retake').length;
    const avgPercent = total ? Math.round(calls.reduce((s,c)=>s+(+c.percent||0),0)/total) : 0;
    const avgPoints  = total ? (calls.reduce((s,c)=>s+(+c.total_points||0),0)/total).toFixed(1) : '0.0';
    const activePuns = discipline.filter(d => d.status === 'active').length;

    const readiness = await calculatePromotionReadiness(admins, settings, calls, discipline);
    const readyCount = readiness.filter(r => r.status === 'ready').length;
    const pendingCount = readiness.filter(r => r.status === 'pending').length;

    const weekAgo = new Date(Date.now() - 7*86400000).toISOString().slice(0,10);
    const weekPays = payments.filter(p => p.date >= weekAgo);
    const weekSum  = weekPays.reduce((s,p)=>s + (+p.final_total||0), 0);
    const weekCands = calls.filter(c => c.call_date >= weekAgo).length;
    const activeAdmins = admins.filter(a => a.is_active).length;

    const top5 = calls.slice(0,5);
    const recentPuns = discipline.slice(0,5);
    const readyList = readiness.filter(r => r.status === 'ready').slice(0,5);

    const interviewMap = {};
    for (const c of calls) {
        const id = c.interviewer_id || 'unknown';
        if (!interviewMap[id]) interviewMap[id] = { id, name: c.interviewer?.email || '—', count: 0, sumPct: 0 };
        interviewMap[id].count++;
        interviewMap[id].sumPct += (+c.percent||0);
    }
    const interviewerRank = Object.values(interviewMap).sort((a,b)=>b.count-a.count).slice(0,5);

    view.innerHTML = `
        <div class="liverp-hero">
            <div>
                <h2>Центр управления администрацией</h2>
                <p class="muted">Сводка по обзвонам, составу, наказаниям, повышениям и выплатам</p>
            </div>
        </div>
        <div class="cards">
            <div class="card accent">  <div class="card-label">Всего обзвонов</div><div class="card-value">${total}</div></div>
            <div class="card success"> <div class="card-label">Прошло</div><div class="card-value">${passed}</div></div>
            <div class="card danger">  <div class="card-label">Не прошло</div><div class="card-value">${failed}</div></div>
            <div class="card warning"> <div class="card-label">Пересдача</div><div class="card-value">${retake}</div></div>
            <div class="card accent">  <div class="card-label">Средний %</div><div class="card-value">${avgPercent}%</div></div>
            <div class="card">         <div class="card-label">Средний балл</div><div class="card-value">${avgPoints}</div></div>
            <div class="card danger">  <div class="card-label">Активных наказаний</div><div class="card-value">${activePuns}</div></div>
            <div class="card success"> <div class="card-label">Готовы к повышению</div><div class="card-value">${readyCount}</div></div>
            <div class="card warning"> <div class="card-label">На рассмотрении</div><div class="card-value">${pendingCount}</div></div>
            <div class="card">         <div class="card-label">Выплаты за неделю</div><div class="card-value">${weekSum.toLocaleString('ru-RU')}</div></div>
            <div class="card accent">  <div class="card-label">Активных админов</div><div class="card-value">${activeAdmins}</div></div>
            <div class="card">         <div class="card-label">Кандидатов / неделя</div><div class="card-value">${weekCands}</div></div>
        </div>

        <div class="panel-grid-2">
            <div class="panel">
                <div class="panel-header"><h3>Последние обзвоны</h3>
                    <a class="btn btn-sm" href="#history">Все →</a></div>
                <div class="table-wrap">
                    <table class="data"><thead><tr>
                        <th>Дата</th><th>Кандидат</th><th class="num">%</th><th>Статус</th>
                    </tr></thead><tbody>
                    ${top5.map(c => `<tr>
                        <td>${fmtDate(c.call_date)}</td>
                        <td>${escapeHtml(c.candidate?.display_name || '—')}</td>
                        <td class="num">${Math.round(+c.percent||0)}%</td>
                        <td>${statusBadge(c.status)}</td>
                    </tr>`).join('') || `<tr><td colspan="4" class="muted">Нет данных</td></tr>`}
                    </tbody></table>
                </div>
            </div>

            <div class="panel">
                <div class="panel-header"><h3>Последние наказания</h3>
                    <a class="btn btn-sm" href="#discipline">Все →</a></div>
                <div class="table-wrap">
                    <table class="data"><thead><tr>
                        <th>Дата</th><th>Админ</th><th>Тип</th><th>Статус</th>
                    </tr></thead><tbody>
                    ${recentPuns.map(p => `<tr>
                        <td>${fmtDate(p.date)}</td>
                        <td>${escapeHtml(p.admin?.display_name || '—')}</td>
                        <td>${escapeHtml(punishLabel(p.punishment_type))}</td>
                        <td>${statusBadge(p.status)}</td>
                    </tr>`).join('') || `<tr><td colspan="4" class="muted">Нет данных</td></tr>`}
                    </tbody></table>
                </div>
            </div>

            <div class="panel">
                <div class="panel-header"><h3>Готовы к повышению</h3>
                    <a class="btn btn-sm" href="#promotion">Открыть →</a></div>
                <div class="table-wrap">
                    <table class="data"><thead><tr>
                        <th>Админ</th><th>Ранг / должность</th><th>Следующий</th>
                    </tr></thead><tbody>
                    ${readyList.map(r => `<tr>
                        <td>${escapeHtml(r.admin.display_name)}</td>
                        <td>${escapeHtml(adminPositionLabel(r.admin))}</td>
                        <td>${escapeHtml(r.next_position||'—')}</td>
                    </tr>`).join('') || `<tr><td colspan="3" class="muted">Нет данных</td></tr>`}
                    </tbody></table>
                </div>
            </div>

            <div class="panel">
                <div class="panel-header"><h3>Рейтинг проводящих обзвоны</h3></div>
                <div class="table-wrap">
                    <table class="data"><thead><tr>
                        <th>Проводящий</th><th class="num">Обзвонов</th><th class="num">Средний %</th>
                    </tr></thead><tbody>
                    ${interviewerRank.map(r => `<tr>
                        <td>${escapeHtml(r.name)}</td>
                        <td class="num">${r.count}</td>
                        <td class="num">${Math.round(r.sumPct/r.count)}%</td>
                    </tr>`).join('') || `<tr><td colspan="3" class="muted">Нет данных</td></tr>`}
                    </tbody></table>
                </div>
            </div>
        </div>
    `;
}

function punishLabel(t) {
    return ({
        warning:'Предупреждение', reprimand:'Выговор', strict_reprimand:'Строгий выговор',
        points_off:'Снятие баллов', demotion:'Понижение', dismissal:'Снятие с должности',
        other:'Другое'
    })[t] || t || '—';
}

// =====================================================================
// 5. Обзвоны
// =====================================================================
async function renderCalls(view) {
    if (!hasRole('owner','admin','interviewer')) {
        view.innerHTML = `<div class="empty">Нет доступа</div>`; return;
    }
    const [questions, admins] = await Promise.all([loadQuestions(true), loadAdmins(false)]);
    State.cache.questions = questions;
    State.cache.admins = admins;

    const grouped = {};
    for (const q of questions) { (grouped[q.category] = grouped[q.category] || []).push(q); }

    view.innerHTML = `
        <h2>Проведение обзвона</h2>
        <div class="panel">
            <div class="panel-header"><h3>Данные кандидата</h3></div>
            <div class="form-grid">
                <div class="form-row"><label>Имя / ник кандидата *</label><input id="c-name" /></div>
                <div class="form-row"><label>Discord</label><input id="c-discord" placeholder="user#0001"/></div>
                <div class="form-row"><label>Игровой ник</label><input id="c-game"/></div>
                <div class="form-row"><label>Возраст</label><input id="c-age" type="number" min="0"/></div>
                <div class="form-row"><label>Часовой пояс</label><input id="c-tz" placeholder="UTC+3"/></div>
                <div class="form-row"><label>Дата обзвона</label><input id="c-date" type="date" value="${new Date().toISOString().slice(0,10)}"/></div>
                <div class="form-row"><label>Проводит обзвон</label>
                    <input id="c-int" value="${escapeHtml(State.profile?.display_name || State.profile?.email || '')}" readonly /></div>
                <div class="form-row"><label>Проводил обучение</label>
                    <select id="c-trainer">
                        <option value="">— не выбрано —</option>
                        ${admins.map(a => `<option value="${a.id}">${escapeHtml(adminShortLabel(a))}</option>`).join('')}
                    </select></div>
                <div class="form-row"><label>Ссылка на откат обзвона</label><input id="c-replay-call"/></div>
                <div class="form-row"><label>Ссылка на откат обучения</label><input id="c-replay-train"/></div>
                <div class="form-row" style="grid-column:1/-1"><label>Комментарий</label>
                    <textarea id="c-comment" rows="2"></textarea></div>
                <div class="form-row" style="grid-column:1/-1"><label>Дополнительные примечания</label>
                    <textarea id="c-extra" rows="2"></textarea></div>
            </div>
        </div>

        <div class="panel">
            <div class="panel-header">
                <h3>Вопросы (${questions.length})</h3>
                <div>
                    <button class="btn btn-sm" id="btn-demo">Заполнить демо</button>
                    <button class="btn btn-sm" id="btn-reset-scores">Сбросить оценки</button>
                </div>
            </div>
            <div id="q-list">
            ${Object.keys(grouped).map(cat => `
                <div class="q-category">
                    <div class="q-category-header">
                        <span>${escapeHtml(cat)}</span>
                        <span class="muted">${grouped[cat].length} вопросов</span>
                    </div>
                    ${grouped[cat].map(q => `
                        <div class="q-item" data-qid="${q.id}">
                            <div>
                                <div class="q-text">${escapeHtml(q.question_text)}</div>
                                <div class="q-comment"><input data-q-comment placeholder="Комментарий (необязательно)"/></div>
                            </div>
                            <div class="q-options">
                                <span class="q-opt" data-score="1"   title="Верно">✔</span>
                                <span class="q-opt" data-score="0.5" title="Частично">½</span>
                                <span class="q-opt" data-score="0"   title="Неверно">✖</span>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `).join('') || `<div class="empty">Нет активных вопросов. Добавьте их в конструкторе.</div>`}
            </div>

            <div class="live-score">
                <div class="ls-item"><div class="ls-label">Баллов</div><div class="ls-val" id="ls-pts">0</div></div>
                <div class="ls-item"><div class="ls-label">Отвечено / всего</div><div class="ls-val" id="ls-max">0 / ${questions.length}</div></div>
                <div class="ls-item"><div class="ls-label">Процент</div><div class="ls-val" id="ls-pct">0%</div></div>
                <div class="ls-item"><div class="ls-label">Статус</div><div class="ls-val" id="ls-status"><span class="badge neutral">Нет ответов</span></div></div>
                <div class="ls-actions">
                    <button class="btn"           id="btn-clear-form">Очистить</button>
                    <button class="btn"           id="btn-save-draft">Черновик</button>
                    <button class="btn btn-primary" id="btn-save-call">Сохранить</button>
                </div>
            </div>
        </div>
    `;

    view.addEventListener('click', (e) => {
        const opt = e.target.closest('.q-opt'); if (!opt) return;
        const item = opt.closest('.q-item');
        const wasSelected = opt.classList.contains('sel-1') || opt.classList.contains('sel-h') || opt.classList.contains('sel-0');
        item.querySelectorAll('.q-opt').forEach(o => o.classList.remove('sel-1','sel-h','sel-0'));
        if (!wasSelected) {
            const s = parseFloat(opt.dataset.score);
            opt.classList.add(s === 1 ? 'sel-1' : s === 0.5 ? 'sel-h' : 'sel-0');
        }
        recalcLive();
    });

    $('#btn-demo').onclick = () => {
        view.querySelectorAll('.q-item').forEach(item => {
            const opts = item.querySelectorAll('.q-opt');
            const r = Math.random();
            const idx = r < 0.7 ? 0 : (r < 0.9 ? 1 : 2);
            opts.forEach(o => o.classList.remove('sel-1','sel-h','sel-0'));
            const o = opts[idx];
            const s = parseFloat(o.dataset.score);
            o.classList.add(s === 1 ? 'sel-1' : s === 0.5 ? 'sel-h' : 'sel-0');
        });
        recalcLive();
    };
    $('#btn-reset-scores').onclick = () => {
        view.querySelectorAll('.q-opt').forEach(o => o.classList.remove('sel-1','sel-h','sel-0'));
        recalcLive();
    };
    $('#btn-clear-form').onclick = () => { handleRoute(true); };
    $('#btn-save-call').onclick  = () => saveCallSessionAction('passed-or-fail');
    $('#btn-save-draft').onclick = () => saveCallSessionAction('draft');
    recalcLive();
}

function getSelectedQuestionAnswers() {
    const answers = [];
    let pts = 0;
    document.querySelectorAll('.q-item').forEach(item => {
        const sel = item.querySelector('.q-opt.sel-1, .q-opt.sel-h, .q-opt.sel-0');
        if (!sel) return;
        const score = parseFloat(sel.dataset.score);
        pts += score;
        const cm = item.querySelector('[data-q-comment]')?.value.trim() || '';
        answers.push({ question_id: item.dataset.qid, score, comment: cm || null });
    });
    const answered = answers.length;
    const total = document.querySelectorAll('.q-item').length;
    const pct = answered ? Math.round(pts / answered * 100) : 0;
    return { answers, pts, answered, total, pct };
}

function recalcLive() {
    const { pts, answered, total, pct } = getSelectedQuestionAnswers();
    const status = calcStatus(pct);
    const ptsEl = document.getElementById('ls-pts');
    if (ptsEl) ptsEl.textContent = Number.isInteger(pts) ? String(pts) : pts.toFixed(1);
    const maxEl = document.getElementById('ls-max');
    if (maxEl) maxEl.textContent = `${answered} / ${total}`;
    const pctEl = document.getElementById('ls-pct');
    if (pctEl) pctEl.textContent = pct + '%';
    const stEl = document.getElementById('ls-status');
    if (stEl) stEl.innerHTML = answered ? statusBadge(status) : '<span class="badge neutral">Нет ответов</span>';
}

async function saveCallSessionAction(mode) {
    const name = $('#c-name').value.trim();
    if (!name) { toast('Укажите имя кандидата','warning'); return; }
    const { answers, pts, answered, total, pct } = getSelectedQuestionAnswers();
    if (mode !== 'draft' && answered === 0) {
        toast('Нужно оценить хотя бы один вопрос.', 'warning'); return;
    }
    const finalStatus = mode === 'draft' ? 'draft' : calcStatus(pct);
    try {
        const cand = await findOrCreateCandidate({
            display_name: name,
            discord: $('#c-discord').value.trim() || null,
            game_nick: $('#c-game').value.trim() || null,
            age: parseInt($('#c-age').value) || null,
            timezone: $('#c-tz').value.trim() || null, status: 'new'
        });
        await saveCallSession({
            candidate_id: cand.id,
            interviewer_id: State.user.id,
            trainer_admin_id: $('#c-trainer').value || null,
            call_date: $('#c-date').value,
            call_replay_url: $('#c-replay-call').value.trim() || null,
            training_replay_url: $('#c-replay-train').value.trim() || null,
            total_points: pts, max_points: answered, percent: pct,
            status: finalStatus,
            comment: $('#c-comment').value.trim() || null,
            extra_comment: $('#c-extra').value.trim() || null
        }, answers);
        toast(`Обзвон сохранён (${pct}%, ${finalStatus})`,'success');
        handleRoute(true);
    } catch (e) {
        console.error(e);
        toast('Ошибка сохранения: ' + e.message, 'danger', 5000);
    }
}

// =====================================================================
// 6. Конструктор вопросов
// =====================================================================
async function renderQuestions(view) {
    const list = await loadQuestions(false);
    State.cache.questions = list;
    const cats = [...new Set(list.map(q => q.category))].sort();
    const canEdit = hasRole('owner','admin');

    view.innerHTML = `
        <h2>Конструктор вопросов</h2>
        <div class="panel">
            <div class="panel-header"><h3>Категории</h3></div>
            <div class="toolbar" style="flex-wrap:wrap;gap:6px">
                ${cats.map(c => `<span class="badge accent">${escapeHtml(c)}</span>`).join('') || '<span class="muted">Категорий пока нет</span>'}
            </div>
            ${canEdit ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
                <select id="cat-manage-select" style="flex:1;min-width:180px"><option value="">Выберите категорию</option>${cats.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}</select>
                <button class="btn btn-sm" id="btn-rename-cat">Переименовать</button>
                <button class="btn btn-sm btn-danger" id="btn-disable-cat">Отключить категорию</button>
            </div>` : ''}
        </div>
        ${canEdit ? `<div class="panel">
            <div class="panel-header"><h3>Добавить вопрос</h3></div>
            <div class="form-grid">
                <div class="form-row"><label>Категория *</label>
                    <input id="nq-cat" list="cat-list" placeholder="Выберите или впишите"/>
                    <datalist id="cat-list">${cats.map(c=>`<option>${escapeHtml(c)}</option>`).join('')}</datalist>
                </div>
                <div class="form-row"><label>Порядок</label><input id="nq-order" type="number" value="100"/></div>
                <div class="form-row" style="grid-column:1/-1"><label>Текст вопроса *</label>
                    <textarea id="nq-text" rows="2"></textarea></div>
            </div>
            <div style="margin-top:10px"><button class="btn btn-primary" id="btn-add-q">Добавить</button></div>
        </div>` : ''}
        <div class="panel">
            <div class="panel-header">
                <h3>Все вопросы (${list.length})</h3>
                ${canEdit ? `<div><button class="btn btn-sm" id="bulk-on">Вкл. все</button><button class="btn btn-sm" id="bulk-off">Выкл. все</button></div>` : ''}
            </div>
            <div class="toolbar">
                <input id="q-search" placeholder="Поиск..." />
                <select id="q-filter-cat"><option value="">Все категории</option>${cats.map(c => `<option>${escapeHtml(c)}</option>`).join('')}</select>
                <select id="q-filter-state"><option value="">Все</option><option value="on">Активные</option><option value="off">Отключены</option></select>
            </div>
            <div class="table-wrap">
                <table class="data" id="q-table"><thead><tr>
                    <th style="width:40px">№</th><th style="width:180px">Категория</th><th>Текст</th>
                    <th style="width:70px">Порядок</th><th style="width:70px">Статус</th><th style="width:200px">Действия</th>
                </tr></thead><tbody></tbody></table>
            </div>
        </div>
    `;

    const tbody = view.querySelector('#q-table tbody');
    function render() {
        const q = ($('#q-search').value || '').toLowerCase();
        const cat = $('#q-filter-cat').value;
        const st = $('#q-filter-state').value;
        let rows = list.filter(r => {
            if (cat && r.category !== cat) return false;
            if (st === 'on' && !r.is_active) return false;
            if (st === 'off' && r.is_active) return false;
            if (q && !(r.question_text.toLowerCase().includes(q) || r.category.toLowerCase().includes(q))) return false;
            return true;
        });
        rows.sort((a,b) => a.category.localeCompare(b.category) || a.order_index - b.order_index);
        tbody.innerHTML = rows.map((r,i) => `
            <tr data-qid="${r.id}">
                <td>${i+1}</td>
                <td>${escapeHtml(r.category)}</td>
                <td>${escapeHtml(r.question_text)}</td>
                <td class="num">${r.order_index}</td>
                <td>${r.is_active ? '<span class="badge success">Вкл</span>' : '<span class="badge neutral">Выкл</span>'}</td>
                <td class="actions">
                    ${canEdit ? `
                        <button class="btn btn-sm" data-act="edit">✎</button>
                        <button class="btn btn-sm" data-act="toggle">${r.is_active?'⏸':'▶'}</button>
                        ${hasRole('owner') ? '<button class="btn btn-sm btn-danger" data-act="del">🗑</button>' : ''}
                    ` : '—'}
                </td>
            </tr>
        `).join('') || `<tr><td colspan="6" class="muted">Нет вопросов</td></tr>`;
        setCurrentCsv(rows.map(r => ({ category: r.category, question: r.question_text, order: r.order_index, active: r.is_active })), 'questions.csv');
    }

    $('#q-search').oninput = render;
    $('#q-filter-cat').onchange = render;
    $('#q-filter-state').onchange = render;

    if (canEdit) {
        const renameCatBtn = $('#btn-rename-cat');
        if (renameCatBtn) renameCatBtn.onclick = async () => {
            const oldCat = $('#cat-manage-select').value;
            if (!oldCat) return toast('Выберите категорию','warning');
            const nextCat = prompt('Новое название категории:', oldCat);
            if (!nextCat || nextCat.trim() === oldCat) return;
            const affected = list.filter(q => q.category === oldCat);
            if (!await confirmDialog(`Переименовать категорию «${oldCat}» у ${affected.length} вопросов?`)) return;
            try {
                for (const q of affected) { const upd = await updateQuestion(q.id, { category: nextCat.trim() }); Object.assign(q, upd); }
                toast('Категория переименована','success'); handleRoute(true);
            } catch (e) { toast('Ошибка: '+e.message,'danger'); }
        };
        const disableCatBtn = $('#btn-disable-cat');
        if (disableCatBtn) disableCatBtn.onclick = async () => {
            const oldCat = $('#cat-manage-select').value;
            if (!oldCat) return toast('Выберите категорию','warning');
            const affected = list.filter(q => q.category === oldCat && q.is_active);
            if (!affected.length) return toast('Нет активных вопросов','warning');
            if (!await confirmDialog(`Отключить все вопросы категории «${oldCat}»?`)) return;
            try {
                for (const q of affected) { const upd = await updateQuestion(q.id, { is_active: false }); Object.assign(q, upd); }
                toast('Категория отключена','success'); render();
            } catch (e) { toast('Ошибка: '+e.message,'danger'); }
        };
        $('#btn-add-q').onclick = async () => {
            const category = $('#nq-cat').value.trim();
            const text = $('#nq-text').value.trim();
            const order = parseInt($('#nq-order').value) || 0;
            if (!category || !text) return toast('Заполните категорию и текст','warning');
            try {
                const q = await createQuestion({ category, question_text: text, order_index: order, is_active: true });
                list.unshift(q); $('#nq-text').value = ''; toast('Вопрос добавлен','success'); render();
            } catch (e) { toast('Ошибка: '+e.message,'danger'); }
        };
        $('#bulk-on').onclick  = () => bulkToggleVisible(true);
        $('#bulk-off').onclick = () => bulkToggleVisible(false);

        tbody.addEventListener('click', async (e) => {
            const btn = e.target.closest('button[data-act]'); if (!btn) return;
            const row = btn.closest('tr'); const id = row.dataset.qid;
            const q = list.find(x => x.id === id); if (!q) return;
            try {
                if (btn.dataset.act === 'toggle') { const upd = await disableQuestion(id, q.is_active); Object.assign(q, upd); render(); }
                else if (btn.dataset.act === 'edit') { editQuestionModal(q, (upd) => { Object.assign(q, upd); render(); }); }
                else if (btn.dataset.act === 'del') {
                    if (!await confirmDialog('Удалить вопрос навсегда?')) return;
                    await deleteQuestion(id); list.splice(list.indexOf(q),1); render(); toast('Удалено','success');
                }
            } catch (er) { toast('Ошибка: '+er.message,'danger'); }
        });
    }

    async function bulkToggleVisible(active) {
        const rows = tbody.querySelectorAll('tr[data-qid]');
        if (!rows.length) return;
        if (!await confirmDialog(`${active?'Включить':'Отключить'} ${rows.length} вопросов?`)) return;
        for (const r of rows) {
            const id = r.dataset.qid; const q = list.find(x => x.id === id);
            try { const upd = await updateQuestion(id, { is_active: active }); Object.assign(q, upd); } catch {}
        }
        render(); toast('Готово','success');
    }
    render();
}

function editQuestionModal(q, onSave) {
    openModal({
        title: 'Редактирование вопроса',
        body: `
            <div class="form-row"><label>Категория</label><input id="eq-cat" value="${escapeHtml(q.category)}"/></div>
            <div class="form-row" style="margin-top:8px"><label>Текст</label>
                <textarea id="eq-text" rows="3">${escapeHtml(q.question_text)}</textarea></div>
            <div class="form-row" style="margin-top:8px"><label>Порядок</label>
                <input id="eq-order" type="number" value="${q.order_index||0}"/></div>
        `,
        footer: `<button class="btn" data-cancel>Отмена</button>
                 <button class="btn btn-primary" data-save>Сохранить</button>`
    });
    $('[data-cancel]').onclick = closeModal;
    $('[data-save]').onclick = async () => {
        try {
            const upd = await updateQuestion(q.id, {
                category: $('#eq-cat').value.trim(),
                question_text: $('#eq-text').value.trim(),
                order_index: parseInt($('#eq-order').value)||0
            });
            onSave(upd); closeModal(); toast('Сохранено','success');
        } catch (e) { toast('Ошибка: '+e.message,'danger'); }
    };
}

// =====================================================================
// 7. История обзвонов
// =====================================================================
async function renderHistory(view) {
    const calls = await loadCallHistory();
    State.cache.calls = calls;
    const interviewers = [...new Map(calls.filter(c=>c.interviewer).map(c => [c.interviewer.id, c.interviewer])).values()];

    view.innerHTML = `
        <h2>История обзвонов</h2>
        <div class="panel">
            <div class="toolbar">
                <input id="h-search" placeholder="Поиск по кандидату/Discord..." />
                <select id="h-status"><option value="">Все статусы</option><option value="passed">Прошёл</option><option value="retake">Пересдача</option><option value="failed">Не прошёл</option><option value="draft">Черновик</option></select>
                <select id="h-int"><option value="">Все проводящие</option>${interviewers.map(i => `<option value="${i.id}">${escapeHtml(i.email||i.id)}</option>`).join('')}</select>
                <input id="h-from" type="date" />
                <input id="h-to" type="date" />
                <div class="spacer"></div>
                <button class="btn btn-sm" id="h-clear">Сбросить</button>
            </div>
            <div class="table-wrap">
                <table class="data" id="h-table"><thead><tr>
                    <th>№</th><th>Дата</th><th>Кандидат</th><th>Discord</th><th>Проводил</th>
                    <th class="num">%</th><th>Статус</th><th style="width:120px">Действия</th>
                </tr></thead><tbody></tbody></table>
            </div>
        </div>
    `;

    const render = () => {
        const q = $('#h-search').value.toLowerCase();
        const st = $('#h-status').value, intId = $('#h-int').value;
        const from = $('#h-from').value, to = $('#h-to').value;
        const rows = calls.filter(c => {
            if (st && c.status !== st) return false;
            if (intId && c.interviewer_id !== intId) return false;
            if (from && c.call_date < from) return false;
            if (to && c.call_date > to) return false;
            if (q && !((c.candidate?.display_name||'').toLowerCase().includes(q) || (c.candidate?.discord||'').toLowerCase().includes(q))) return false;
            return true;
        });
        $('#h-table tbody').innerHTML = rows.map((c,i) => `
            <tr data-id="${c.id}">
                <td>${i+1}</td>
                <td>${fmtDate(c.call_date)}</td>
                <td><b>${escapeHtml(c.candidate?.display_name||'—')}</b></td>
                <td>${escapeHtml(c.candidate?.discord||'—')}</td>
                <td>${escapeHtml(c.interviewer?.email||'—')}</td>
                <td class="num">${Math.round(+c.percent||0)}%</td>
                <td>${statusBadge(c.status)}</td>
                <td class="actions">
                    <button class="btn btn-sm" data-act="view">👁</button>
                    ${hasRole('owner','admin') ? '<button class="btn btn-sm" data-act="edit">✎</button>' : ''}
                    ${hasRole('owner','admin') ? '<button class="btn btn-sm btn-danger" data-act="del">🗑</button>' : ''}
                </td>
            </tr>
        `).join('') || `<tr><td colspan="8" class="muted">Нет записей</td></tr>`;
        setCurrentCsv(rows.map(c => ({ date:c.call_date, candidate:c.candidate?.display_name, discord:c.candidate?.discord, percent:c.percent, status:c.status })), 'history.csv');
    };

    ['h-search','h-status','h-int','h-from','h-to'].forEach(id => $('#'+id).oninput = $('#'+id).onchange = render);
    $('#h-clear').onclick = () => { ['h-search','h-status','h-int','h-from','h-to'].forEach(id => $('#'+id).value=''); render(); };

    $('#h-table tbody').addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-act]'); if (!btn) return;
        const id = btn.closest('tr').dataset.id;
        const c = calls.find(x => x.id === id);
        if (btn.dataset.act === 'del') {
            if (!await confirmDialog('Удалить запись обзвона?')) return;
            try { await deleteCallSession(id); calls.splice(calls.indexOf(c),1); render(); toast('Удалено','success'); }
            catch(e){ toast('Ошибка: '+e.message,'danger'); }
        } else if (btn.dataset.act === 'view') { await showCallDetails(c); }
        else if (btn.dataset.act === 'edit') { await editCallSessionModal(c, () => handleRoute(true)); }
    });
    render();
}

async function editCallSessionModal(c, onSave) {
    const [answers, questions, admins] = await Promise.all([loadCallAnswers(c.id), loadQuestions(true), loadAdmins(false)]);
    const answerMap = new Map(answers.map(a => [a.question_id, a]));
    const allQuestions = [...questions];
    for (const a of answers) {
        if (a.question && !allQuestions.some(q => q.id === a.question.id)) {
            allQuestions.push({ id: a.question.id, category: a.question.category, question_text: a.question.question_text, order_index: 9999 });
        }
    }
    allQuestions.sort((a,b) => String(a.category).localeCompare(String(b.category)) || (a.order_index||0)-(b.order_index||0));

    openModal({
        title: `Редактирование: ${c.candidate?.display_name || '—'}`,
        large: true,
        body: `
            <div class="form-grid">
                <div class="form-row"><label>Дата обзвона</label><input id="ec-date" type="date" value="${c.call_date||''}"/></div>
                <div class="form-row"><label>Обучение</label><select id="ec-trainer"><option value="">—</option>${admins.map(a=>`<option value="${a.id}" ${c.trainer_admin_id===a.id?'selected':''}>${escapeHtml(adminShortLabel(a))}</option>`).join('')}</select></div>
                <div class="form-row"><label>Откат обзвона</label><input id="ec-call-url" value="${escapeHtml(c.call_replay_url||'')}"/></div>
                <div class="form-row"><label>Откат обучения</label><input id="ec-train-url" value="${escapeHtml(c.training_replay_url||'')}"/></div>
                <div class="form-row"><label>Статус</label><select id="ec-status"><option value="auto">Авто</option><option value="passed" ${c.status==='passed'?'selected':''}>Прошёл</option><option value="retake" ${c.status==='retake'?'selected':''}>Пересдача</option><option value="failed" ${c.status==='failed'?'selected':''}>Не прошёл</option><option value="draft" ${c.status==='draft'?'selected':''}>Черновик</option></select></div>
                <div class="form-row" style="grid-column:1/-1"><label>Комментарий</label><textarea id="ec-comment" rows="2">${escapeHtml(c.comment||'')}</textarea></div>
            </div>
            <h3>Ответы</h3>
            <div class="table-wrap"><table class="data"><thead><tr><th>Категория</th><th>Вопрос</th><th style="width:100px">Балл</th><th>Комментарий</th></tr></thead><tbody>
                ${allQuestions.map(q => {
                    const a = answerMap.get(q.id);
                    const val = a ? String(a.score) : '';
                    return `<tr data-qid="${q.id}"><td>${escapeHtml(q.category||'—')}</td><td>${escapeHtml(q.question_text||'—')}</td><td><select data-edit-score><option value="" ${val===''?'selected':''}>—</option><option value="1" ${val==='1'?'selected':''}>1</option><option value="0.5" ${val==='0.5'?'selected':''}>0.5</option><option value="0" ${val==='0'?'selected':''}>0</option></select></td><td><input data-edit-comment value="${escapeHtml(a?.comment||'')}"/></td></tr>`;
                }).join('')}
            </tbody></table></div>
            <div class="live-score" style="position:static;margin-top:12px"><div class="ls-item"><div class="ls-label">Итог</div><div class="ls-val" id="ec-preview">—</div></div></div>
        `,
        footer: `<button class="btn" data-cancel>Отмена</button><button class="btn btn-primary" data-save>Сохранить</button>`
    });

    const recalc = () => {
        let pts = 0, max = 0;
        $$('.modal-body tr[data-qid]').forEach(row => {
            const val = row.querySelector('[data-edit-score]').value;
            if (val === '') return;
            pts += parseFloat(val); max += 1;
        });
        const pct = max ? Math.round(pts / max * 100) : 0;
        const el = $('#ec-preview');
        if (el) el.innerHTML = `${Number.isInteger(pts)?pts:pts.toFixed(1)} / ${max} · ${pct}% ${max ? statusBadge(calcStatus(pct)) : ''}`;
        return { pts, max, pct };
    };
    $$('.modal-body [data-edit-score]').forEach(sel => sel.addEventListener('change', recalc));
    recalc();

    $('[data-cancel]').onclick = closeModal;
    $('[data-save]').onclick = async () => {
        const { pts, max, pct } = recalc();
        const statusChoice = $('#ec-status').value;
        const finalStatus = statusChoice === 'auto' ? calcStatus(pct) : statusChoice;
        const rows = $$('.modal-body tr[data-qid]');
        const editedAnswers = rows.map(row => {
            const score = row.querySelector('[data-edit-score]').value;
            if (score === '') return null;
            return { question_id: row.dataset.qid, score: parseFloat(score), comment: row.querySelector('[data-edit-comment]').value.trim() || null };
        }).filter(Boolean);
        try {
            await updateCallSession(c.id, {
                trainer_admin_id: $('#ec-trainer').value || null,
                call_date: $('#ec-date').value,
                call_replay_url: $('#ec-call-url').value.trim() || null,
                training_replay_url: $('#ec-train-url').value.trim() || null,
                total_points: pts, max_points: max, percent: pct, status: finalStatus,
                comment: $('#ec-comment').value.trim() || null,
                extra_comment: c.extra_comment || null
            });
            await replaceCallAnswers(c.id, editedAnswers);
            closeModal(); toast('Обзвон обновлён','success'); onSave?.();
        } catch (e) { toast('Ошибка: '+e.message,'danger',7000); }
    };
}

async function showCallDetails(c) {
    openModal({
        title: `Обзвон: ${c.candidate?.display_name||'—'}`,
        large: true,
        body: `<div class="muted">Загрузка ответов...</div>`,
        footer: `<button class="btn" data-cancel>Закрыть</button>`
    });
    $('[data-cancel]').onclick = closeModal;
    try {
        const answers = await loadCallAnswers(c.id);
        $('.modal-body').innerHTML = `
            <div class="form-grid">
                <div class="form-row"><label>Дата</label><div>${fmtDate(c.call_date)}</div></div>
                <div class="form-row"><label>Кандидат</label><div>${escapeHtml(c.candidate?.display_name||'—')}</div></div>
                <div class="form-row"><label>Баллы</label><div>${c.total_points} / ${c.max_points} · ${Math.round(+c.percent||0)}% ${statusBadge(c.status)}</div></div>
            </div>
            <h3>Ответы (${answers.length})</h3>
            <div class="table-wrap"><table class="data"><thead><tr>
                <th>Категория</th><th>Вопрос</th><th class="num">Балл</th><th>Комментарий</th>
            </tr></thead><tbody>
            ${answers.map(a => `<tr><td>${escapeHtml(a.question?.category||'—')}</td><td>${escapeHtml(a.question?.question_text||'—')}</td><td class="num"><b>${a.score}</b></td><td>${escapeHtml(a.comment||'')}</td></tr>`).join('') || `<tr><td colspan="4" class="muted">Нет</td></tr>`}
            </tbody></table></div>
            ${c.comment ? `<h3>Комментарий</h3><div>${escapeHtml(c.comment)}</div>` : ''}
        `;
    } catch (e) { $('.modal-body').innerHTML = `<div class="empty">Ошибка: ${escapeHtml(e.message)}</div>`; }
}

// =====================================================================
// 8. Статистика
// =====================================================================
async function renderStats(view) {
    const [calls, admins] = await Promise.all([loadCallHistory(), loadAdmins()]);
    State.cache.calls = calls;
    const total = calls.length;
    const passed = calls.filter(c => c.status === 'passed').length;
    const failed = calls.filter(c => c.status === 'failed').length;
    const retake = calls.filter(c => c.status === 'retake').length;
    const avgPct = total ? Math.round(calls.reduce((s,c)=>s+(+c.percent||0),0)/total) : 0;

    const interviewers = {};
    for (const c of calls) {
        const k = c.interviewer?.email || c.interviewer_id || '—';
        if (!interviewers[k]) interviewers[k] = { name: k, count: 0, sum: 0, passed: 0 };
        interviewers[k].count++; interviewers[k].sum += +c.percent||0;
        if (c.status === 'passed') interviewers[k].passed++;
    }

    view.innerHTML = `
        <h2>Статистика</h2>
        <div class="cards">
            <div class="card accent"><div class="card-label">Всего</div><div class="card-value">${total}</div></div>
            <div class="card success"><div class="card-label">Прошло</div><div class="card-value">${passed}</div></div>
            <div class="card danger"><div class="card-label">Не прошло</div><div class="card-value">${failed}</div></div>
            <div class="card warning"><div class="card-label">Пересдача</div><div class="card-value">${retake}</div></div>
            <div class="card"><div class="card-label">Средний %</div><div class="card-value">${avgPct}%</div></div>
        </div>
        <div class="panel-grid-2">
            <div class="panel"><div class="panel-header"><h3>Распределение</h3></div><div class="chart-wrap"><canvas id="ch-status"></canvas></div></div>
            <div class="panel"><div class="panel-header"><h3>Динамика</h3></div><div class="chart-wrap"><canvas id="ch-dates"></canvas></div></div>
        </div>
        <div class="panel">
            <div class="panel-header"><h3>Рейтинг проводящих</h3></div>
            <div class="table-wrap"><table class="data"><thead><tr>
                <th>Проводящий</th><th class="num">Обзвонов</th><th class="num">% прошло</th><th class="num">Средний %</th>
            </tr></thead><tbody>
            ${Object.values(interviewers).sort((a,b)=>b.count-a.count).map(i => `<tr>
                <td>${escapeHtml(i.name)}</td><td class="num">${i.count}</td>
                <td class="num">${Math.round(i.passed/i.count*100)}%</td>
                <td class="num">${Math.round(i.sum/i.count)}%</td>
            </tr>`).join('') || `<tr><td colspan="4" class="muted">Нет данных</td></tr>`}
            </tbody></table></div>
        </div>
    `;

    try {
        if (window.Chart) {
            const textColor = getComputedStyle(document.body).getPropertyValue('--text-dim').trim() || '#9aa7b8';
            new Chart($('#ch-status').getContext('2d'), {
                type:'doughnut',
                data:{ labels:['Прошёл','Пересдача','Не прошёл'],
                    datasets:[{ data:[passed,retake,failed], backgroundColor:['#22c55e','#eab308','#ef4444'] }] },
                options:{ plugins:{ legend:{ labels:{ color: textColor } } }, responsive:true, maintainAspectRatio:false }
            });
            const dates = {};
            for (const c of calls) dates[c.call_date] = (dates[c.call_date]||0)+1;
            const labels = Object.keys(dates).sort();
            new Chart($('#ch-dates').getContext('2d'), {
                type:'line',
                data:{ labels, datasets:[{ label:'Обзвонов',
                    data: labels.map(l => dates[l]), borderColor:'#4e8fff', backgroundColor:'rgba(78,143,255,0.15)', tension:0.3, fill: true }]},
                options:{ plugins:{ legend:{ labels:{ color: textColor } } }, scales:{ x:{ ticks:{ color: textColor } }, y:{ ticks:{ color: textColor }, beginAtZero:true } }, responsive:true, maintainAspectRatio:false }
            });
        }
    } catch (e) { console.warn('chart error', e); }
}

// =====================================================================
// 9. Пользователи
// =====================================================================
async function renderUsers(view) {
    if (!hasRole('owner','admin')) { view.innerHTML = `<div class="empty">Нет доступа</div>`; return; }
    const [users, admins] = await Promise.all([loadUsers(), loadAdmins()]);
    State.cache.users = users; State.cache.admins = admins;
    const canManageUsers = hasRole('owner');

    view.innerHTML = `
        <div class="liverp-hero">
            <div>
                <h2>Пользователи системы</h2>
                <p class="muted">Аккаунты для входа в панель управления</p>
            </div>
            ${canManageUsers ? `<button class="btn btn-primary" id="btn-add-user">+ Создать пользователя</button>` : ''}
        </div>
        <div class="panel">
            <div class="toolbar">
                <input id="u-search" placeholder="Поиск по email / имени..."/>
                <select id="u-role"><option value="">Все роли</option><option value="owner">owner</option><option value="admin">admin</option><option value="interviewer">interviewer</option><option value="viewer">viewer</option></select>
            </div>
            <div class="table-wrap">
                <table class="data" id="u-table"><thead><tr>
                    <th>Email</th><th>Имя</th><th>Роль</th><th>Привязка к составу</th>
                    <th>Активен</th><th>Создан</th><th style="width:180px">Действия</th>
                </tr></thead><tbody></tbody></table>
            </div>
        </div>
    `;

    const render = () => {
        const q = ($('#u-search').value || '').toLowerCase();
        const r = $('#u-role').value;
        const rows = users.filter(u => {
            if (r && u.access_role !== r) return false;
            if (q && !(`${u.email||''} ${u.display_name||''}`.toLowerCase().includes(q))) return false;
            return true;
        });
        $('#u-table tbody').innerHTML = rows.map(u => {
            const admin = admins.find(a => a.id === u.admin_id);
            return `<tr data-id="${u.id}">
                <td>${escapeHtml(u.email||'—')}</td>
                <td>${escapeHtml(u.display_name||'—')}</td>
                <td>${roleBadge(u.access_role)}</td>
                <td>${escapeHtml(admin?.display_name||'—')}</td>
                <td>${u.is_active ? '<span class="badge success">Да</span>' : '<span class="badge danger">Нет</span>'}</td>
                <td>${fmtDate(u.created_at)}</td>
                <td class="actions">
                    ${canManageUsers ? `<button class="btn btn-sm" data-act="edit">✎</button>
                        <button class="btn btn-sm" data-act="toggle">${u.is_active?'⏸':'▶'}</button>` : '—'}
                </td>
            </tr>`;
        }).join('') || `<tr><td colspan="7" class="muted">Нет данных</td></tr>`;
    };

    $('#u-search').oninput = render;
    $('#u-role').onchange = render;

    if (canManageUsers) {
        $('#btn-add-user').onclick = () => userProfileModal(null, admins, (saved) => {
            if (saved && !users.find(x => x.id === saved.id)) users.unshift(saved);
            handleRoute(true);
        });
        $('#u-table tbody').addEventListener('click', async (e) => {
            const btn = e.target.closest('button[data-act]'); if (!btn) return;
            const u = users.find(x => x.id === btn.closest('tr').dataset.id); if (!u) return;
            if (btn.dataset.act === 'toggle') {
                try {
                    const saved = await adminUpdateUser({ id: u.id, email: u.email, display_name: u.display_name, access_role: u.access_role, admin_id: u.admin_id, is_active: !u.is_active });
                    Object.assign(u, saved); render(); toast('Готово','success');
                } catch(er) { toast('Ошибка: '+er.message,'danger',7000); }
            } else if (btn.dataset.act === 'edit') {
                userProfileModal(u, admins, (upd) => { Object.assign(u, upd); render(); });
            }
        });
    }
    render();
}

function userProfileModal(u, admins, onSave) {
    const isNew = !u;
    openModal({
        title: isNew ? 'Создать пользователя' : 'Редактирование пользователя',
        body: `
            <div class="form-grid">
                <div class="form-row"><label>Email для входа *</label><input id="up-email" type="email" value="${escapeHtml(u?.email||'')}" placeholder="user@example.com"/></div>
                <div class="form-row"><label>Пароль ${isNew ? '*' : '(пустое = без изменений)'}</label><input id="up-password" type="password" autocomplete="new-password"/></div>
                <div class="form-row"><label>Имя / ник</label><input id="up-name" value="${escapeHtml(u?.display_name||'')}"/></div>
                <div class="form-row"><label>Роль</label><select id="up-role"><option value="owner" ${u?.access_role==='owner'?'selected':''}>owner</option><option value="admin" ${u?.access_role==='admin'?'selected':''}>admin</option><option value="interviewer" ${u?.access_role==='interviewer'?'selected':''}>interviewer</option><option value="viewer" ${u?.access_role==='viewer'?'selected':''}>viewer</option></select></div>
                <div class="form-row"><label>Привязка к записи в составе</label><select id="up-admin"><option value="">— нет —</option>${admins.map(a => `<option value="${a.id}" ${u?.admin_id===a.id?'selected':''}>${escapeHtml(a.display_name)}${a.rank ? ` · R${a.rank}` : ''}</option>`).join('')}</select></div>
                <div class="form-row"><label>Активен</label><select id="up-active"><option value="true" ${u?.is_active!==false?'selected':''}>Да</option><option value="false" ${u?.is_active===false?'selected':''}>Нет</option></select></div>
            </div>
        `,
        footer: `<button class="btn" data-cancel>Отмена</button><button class="btn btn-primary" data-save>${isNew ? 'Создать' : 'Сохранить'}</button>`
    });
    $('[data-cancel]').onclick = closeModal;
    $('[data-save]').onclick = async () => {
        const email = $('#up-email').value.trim();
        const password = $('#up-password').value;
        if (!email) return toast('Укажите email','warning');
        if (isNew && password.length < 6) return toast('Пароль минимум 6 символов','warning');
        if (!isNew && password && password.length < 6) return toast('Пароль минимум 6 символов','warning');
        const payload = { id: u?.id, email, password: password || undefined, display_name: $('#up-name').value.trim() || null, access_role: $('#up-role').value, admin_id: $('#up-admin').value || null, is_active: $('#up-active').value === 'true' };
        try {
            const saved = isNew ? await adminCreateUser(payload) : await adminUpdateUser(payload);
            onSave(saved); closeModal(); toast(isNew ? 'Пользователь создан' : 'Сохранено','success');
        } catch (e) { toast('Ошибка: '+(e.message||e),'danger', 7000); }
    };
}

// =====================================================================
// 9.5 Отделы / разделы — FIXED: shows members table
// =====================================================================
async function renderDepartments(view) {
    const [departments, admins, calls, discipline] = await Promise.all([
        loadDepartments(), loadAdmins(true), loadCallHistory(), loadDisciplineRecords()
    ]);
    const canEdit = hasRole('owner');
    const all = getDepartmentsFromAdmins(admins, departments);

    view.innerHTML = `
        <div class="liverp-hero">
            <div>
                <h2>Отделы и разделы</h2>
                <p class="muted">Структура администрации с распределением по отделам</p>
            </div>
            ${canEdit ? `<button class="btn btn-primary" id="btn-add-dep">+ Создать отдел</button>` : ''}
        </div>
        <div id="dep-sections"></div>
    `;

    const sectionsEl = $('#dep-sections');

    // Render each department as a panel with stats + members table
    sectionsEl.innerHTML = all.map(dep => {
        const group = admins.filter(a => a.is_active && (a.branch || 'Общая администрация') === dep.name)
            .sort((a,b) => (Number(b.rank)||0) - (Number(a.rank)||0) || String(a.display_name).localeCompare(String(b.display_name)));
        const totalCalls = group.reduce((s,a) => s + adminCallsCount(a, calls), 0);
        const totalReports = group.reduce((s,a) => s + adminReportsCount(a), 0);
        const avgActivity = group.length ? Math.round(group.reduce((s,a) => s + Number(a.activity_percent||0), 0) / group.length) : 0;

        return `<div class="panel department-panel" data-id="${dep.id||''}" data-name="${escapeHtml(dep.name)}">
            <div class="panel-header department-head">
                <div>
                    <h3>${escapeHtml(dep.name)} <span class="badge accent">${group.length}</span></h3>
                    <div class="muted" style="margin-top:4px">Обзвонов: ${totalCalls} · Рапортов: ${totalReports} · Средняя активность: ${avgActivity}%</div>
                </div>
                <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
                    <div class="department-toggles">
                        <span class="mini-chip ${dep.show_calls?'on':'off'}">обзвоны</span>
                        <span class="mini-chip ${dep.show_reports?'on':'off'}">рапорты</span>
                        <span class="mini-chip ${dep.show_trainings?'on':'off'}">обучение</span>
                        <span class="mini-chip ${dep.show_activity?'on':'off'}">активность</span>
                        <span class="mini-chip ${dep.show_punishments?'on':'off'}">наказания</span>
                    </div>
                    ${canEdit && dep.id ? `<button class="btn btn-sm" data-act="edit">✎</button>` : ''}
                </div>
            </div>
            ${group.length ? `<div class="dep-members-wrap">
                <div class="table-wrap">
                    <table class="data"><thead><tr>
                        <th>Администратор</th><th>Ранг</th><th>Должность</th>
                        ${dep.show_activity ? '<th class="num">Активность</th>' : ''}
                        ${dep.show_calls ? '<th class="num">Обзвоны</th>' : ''}
                        ${dep.show_reports ? '<th class="num">Рапорты</th>' : ''}
                        ${dep.show_punishments ? '<th class="num">Наказания</th>' : ''}
                        <th>Статус</th>
                    </tr></thead><tbody>
                    ${group.map(a => `<tr>
                        <td><b>${escapeHtml(a.display_name)}</b>${a.discord ? `<div class="muted">${escapeHtml(a.discord)}</div>` : ''}</td>
                        <td>${a.rank ? `<span class="rank-pill">R${a.rank}</span>` : '—'}</td>
                        <td>${escapeHtml(a.custom_position || a.current_position || '—')}</td>
                        ${dep.show_activity ? `<td class="num">${Number(a.activity_percent||0)}%</td>` : ''}
                        ${dep.show_calls ? `<td class="num">${adminCallsCount(a, calls)}</td>` : ''}
                        ${dep.show_reports ? `<td class="num">${adminReportsCount(a)}</td>` : ''}
                        ${dep.show_punishments ? `<td class="num">${adminActivePunishments(a, discipline)}</td>` : ''}
                        <td>${a.is_active ? '<span class="badge success">Активен</span>' : '<span class="badge neutral">Архив</span>'}</td>
                    </tr>`).join('')}
                    </tbody></table>
                </div>
            </div>` : `<div class="empty" style="margin-top:10px">В этом отделе пока нет участников</div>`}
        </div>`;
    }).join('');

    if (canEdit) {
        $('#btn-add-dep').onclick = () => departmentModal(null, () => handleRoute(true));
        sectionsEl.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-act="edit"]'); if (!btn) return;
            const card = btn.closest('.department-panel');
            const dep = departments.find(d => d.id === card.dataset.id) || all.find(d => d.name === card.dataset.name);
            departmentModal(dep, () => handleRoute(true));
        });
    }
}

function departmentModal(dep, onSave) {
    const isNew = !dep?.id;
    dep = normalizeDepartment(dep || {});
    openModal({
        title: isNew ? 'Создать отдел' : 'Редактировать отдел',
        body: `
            <div class="form-grid">
                <div class="form-row"><label>Название *</label><input id="dep-name" value="${escapeHtml(dep.name||'')}"/></div>
                <div class="form-row"><label>Порядок</label><input id="dep-order" type="number" value="${dep.sort_order||100}"/></div>
            </div>
            <div style="margin-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:8px">
                <label class="check-row"><input type="checkbox" id="dep-calls" ${dep.show_calls?'checked':''}/> Обзвоны</label>
                <label class="check-row"><input type="checkbox" id="dep-reports" ${dep.show_reports?'checked':''}/> Рапорты</label>
                <label class="check-row"><input type="checkbox" id="dep-trainings" ${dep.show_trainings?'checked':''}/> Обучение</label>
                <label class="check-row"><input type="checkbox" id="dep-activity" ${dep.show_activity?'checked':''}/> Активность</label>
                <label class="check-row"><input type="checkbox" id="dep-punishments" ${dep.show_punishments?'checked':''}/> Наказания</label>
            </div>
        `,
        footer: `<button class="btn" data-cancel>Отмена</button><button class="btn btn-primary" data-save>Сохранить</button>`
    });
    $('[data-cancel]').onclick = closeModal;
    $('[data-save]').onclick = async () => {
        const payload = { id: dep.id || undefined, name: $('#dep-name').value.trim(), sort_order: parseInt($('#dep-order').value)||100, show_calls: $('#dep-calls').checked, show_reports: $('#dep-reports').checked, show_trainings: $('#dep-trainings').checked, show_activity: $('#dep-activity').checked, show_punishments: $('#dep-punishments').checked };
        if (!payload.name) return toast('Название обязательно','warning');
        try { await saveDepartment(payload); closeModal(); toast('Отдел сохранён','success'); onSave(); }
        catch(e) { toast('Ошибка: '+e.message,'danger'); }
    };
}

// =====================================================================
// 10. Состав администрации
// =====================================================================
async function renderAdmins(view) {
    const [admins, calls, discipline, departments] = await Promise.all([
        loadAdmins(true), loadCallHistory(), loadDisciplineRecords(), loadDepartments()
    ]);
    State.cache.admins = admins; State.cache.calls = calls; State.cache.discipline = discipline; State.cache.departments = departments;
    const canEdit = hasRole('owner','admin');
    const allDepartments = getDepartmentsFromAdmins(admins, departments);

    view.innerHTML = `
        <div class="liverp-hero">
            <div>
                <h2>Состав администрации</h2>
                <p class="muted">Ранги, должности, отделы, активность и статистика</p>
            </div>
            <div class="hero-actions">
                ${canEdit ? `<button class="btn btn-primary" id="btn-add-admin">+ Добавить</button>` : ''}
            </div>
        </div>
        <div class="panel">
            <div class="toolbar">
                <input id="a-search" placeholder="Поиск..." />
                <select id="a-dep"><option value="">Все отделы</option>${allDepartments.map(d=>`<option>${escapeHtml(d.name)}</option>`).join('')}</select>
                <select id="a-rank"><option value="">Все ранги</option>${Array.from({length:11},(_,i)=>i+1).map(n=>`<option value="${n}">Ранг ${n}</option>`).join('')}</select>
                <select id="a-active"><option value="">Все</option><option value="true">Активные</option><option value="false">Архив</option></select>
            </div>
        </div>
        <div id="admin-department-sections"></div>
    `;

    const render = () => {
        const q = ($('#a-search').value || '').toLowerCase();
        const depFilter = $('#a-dep').value, rankFilter = $('#a-rank').value, act = $('#a-active').value;
        const rows = admins.filter(a => {
            if (depFilter && (a.branch || 'Общая администрация') !== depFilter) return false;
            if (rankFilter && String(a.rank || '') !== rankFilter) return false;
            if (act !== '' && String(a.is_active) !== act) return false;
            if (q && !(`${a.display_name||''} ${a.discord||''} ${a.game_nick||''} ${a.custom_position||''} ${a.branch||''}`.toLowerCase().includes(q))) return false;
            return true;
        });
        const sections = getDepartmentsFromAdmins(rows, departments).filter(dep => rows.some(a => (a.branch || 'Общая администрация') === dep.name));
        $('#admin-department-sections').innerHTML = sections.map(dep => {
            const group = rows.filter(a => (a.branch || 'Общая администрация') === dep.name)
                .sort((a,b) => (Number(b.rank)||0)-(Number(a.rank)||0) || String(a.display_name).localeCompare(String(b.display_name)));
            return `<div class="panel department-panel">
                <div class="panel-header"><h3>${escapeHtml(dep.name)} <span class="badge accent">${group.length}</span></h3></div>
                <div class="table-wrap">
                    <table class="data"><thead><tr>
                        <th>Администратор</th><th>Discord</th><th>Ранг</th><th>Должность</th>${metricsHeader(dep)}<th>Статус</th><th style="width:120px">Действия</th>
                    </tr></thead><tbody>
                    ${group.map(a => `<tr data-id="${a.id}">
                        <td><b>${escapeHtml(a.display_name)}</b>${a.game_nick ? `<div class="muted">${escapeHtml(a.game_nick)}</div>` : ''}</td>
                        <td>${escapeHtml(a.discord||'—')}</td>
                        <td>${a.rank ? `<span class="rank-pill">R${a.rank}</span>` : '—'}</td>
                        <td>${escapeHtml(a.custom_position || a.current_position || '—')}</td>
                        ${metricsCells(a, dep, calls, discipline)}
                        <td>${a.is_active ? '<span class="badge success">Активен</span>' : '<span class="badge neutral">Архив</span>'}</td>
                        <td class="actions">
                            <button class="btn btn-sm" data-act="view">👁</button>
                            ${canEdit?`<button class="btn btn-sm" data-act="edit">✎</button>`:''}
                            ${canEdit?`<button class="btn btn-sm btn-danger" data-act="arch">📦</button>`:''}
                        </td>
                    </tr>`).join('')}
                    </tbody></table>
                </div>
            </div>`;
        }).join('') || `<div class="empty">Нет администраторов по выбранным фильтрам</div>`;
    };

    $('#a-search').oninput = render;
    $('#a-dep').onchange = render;
    $('#a-rank').onchange = render;
    $('#a-active').onchange = render;

    if (canEdit) $('#btn-add-admin').onclick = () => adminModal(null, allDepartments, () => handleRoute(true));

    $('#admin-department-sections').addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-act]'); if (!btn) return;
        const id = btn.closest('tr').dataset.id;
        const a = admins.find(x => x.id === id); if (!a) return;
        if (btn.dataset.act === 'edit') { adminModal(a, allDepartments, (upd) => { Object.assign(a, upd); render(); }); }
        else if (btn.dataset.act === 'arch') {
            if (!await confirmDialog('Архивировать администратора?')) return;
            try { const upd = await archiveAdmin(id); Object.assign(a, upd); render(); toast('Архивирован','success'); }
            catch(er){ toast('Ошибка: '+er.message,'danger'); }
        } else if (btn.dataset.act === 'view') { showAdminCard(a, calls, discipline); }
    });
    render();
}

function adminModal(a, departments = [], onSave) {
    const isNew = !a;
    const depOptions = getDepartmentsFromAdmins([], departments);
    openModal({
        title: isNew ? 'Новый администратор' : 'Редактирование',
        large: true,
        body: `
            <div class="form-grid">
                <div class="form-row"><label>Имя / ник *</label><input id="ad-name" value="${escapeHtml(a?.display_name||'')}"/></div>
                <div class="form-row"><label>Discord</label><input id="ad-discord" value="${escapeHtml(a?.discord||'')}"/></div>
                <div class="form-row"><label>Игровой ник</label><input id="ad-game" value="${escapeHtml(a?.game_nick||'')}"/></div>
                <div class="form-row"><label>Ранг</label><select id="ad-rank"><option value="">—</option>${Array.from({length:11},(_,i)=>i+1).map(n=>`<option value="${n}" ${Number(a?.rank)===n?'selected':''}>Ранг ${n}</option>`).join('')}</select></div>
                <div class="form-row"><label>Кастомная должность</label><input id="ad-custom-pos" value="${escapeHtml(a?.custom_position||'')}"/></div>
                <div class="form-row"><label>Отдел</label>
                    <input id="ad-branch" list="dep-list" value="${escapeHtml(a?.branch||'Общая администрация')}"/>
                    <datalist id="dep-list">${depOptions.map(d=>`<option>${escapeHtml(d.name)}</option>`).join('')}</datalist></div>
                <div class="form-row"><label>Принятые рапорты</label><input id="ad-reports" type="number" min="0" value="${Number(a?.accepted_reports||0)}"/></div>
                <div class="form-row"><label>Руководство</label><select id="ad-lead"><option value="false" ${!a?.is_leadership?'selected':''}>Нет</option><option value="true" ${a?.is_leadership?'selected':''}>Да</option></select></div>
                <div class="form-row"><label>Дата вступления</label><input id="ad-joined" type="date" value="${a?.joined_at||''}"/></div>
                <div class="form-row"><label>Последнее повышение</label><input id="ad-prom" type="date" value="${a?.last_promotion_at||''}"/></div>
                <div class="form-row"><label>Активность %</label><input id="ad-act" type="number" min="0" max="100" value="${a?.activity_percent||0}"/></div>
                <div class="form-row" style="grid-column:1/-1"><label>Комментарий</label><textarea id="ad-com" rows="2">${escapeHtml(a?.comment||'')}</textarea></div>
            </div>
        `,
        footer: `<button class="btn" data-cancel>Отмена</button><button class="btn btn-primary" data-save>Сохранить</button>`
    });
    $('[data-cancel]').onclick = closeModal;
    $('[data-save]').onclick = async () => {
        const name = $('#ad-name').value.trim();
        if (!name) return toast('Имя обязательно','warning');
        const payload = {
            display_name: name, discord: $('#ad-discord').value.trim()||null, game_nick: $('#ad-game').value.trim()||null,
            rank: parseInt($('#ad-rank').value) || null, custom_position: $('#ad-custom-pos').value.trim() || null,
            current_position: $('#ad-custom-pos').value.trim() || ($('#ad-rank').value ? `Ранг ${$('#ad-rank').value}` : null),
            branch: $('#ad-branch').value.trim()||'Общая администрация',
            accepted_reports: parseInt($('#ad-reports').value) || 0, is_leadership: $('#ad-lead').value === 'true',
            joined_at: $('#ad-joined').value||null, last_promotion_at: $('#ad-prom').value||null,
            activity_percent: parseFloat($('#ad-act').value)||0, comment: $('#ad-com').value.trim()||null
        };
        try {
            const saved = isNew ? await createAdmin(normalizeAdminPayload(payload)) : await updateAdmin(a.id, normalizeAdminPayload(payload));
            onSave(saved); closeModal(); toast('Сохранено','success');
        } catch (e) { toast('Ошибка: '+e.message,'danger'); }
    };
}

function showAdminCard(a, calls, discipline) {
    const myCalls = calls.filter(c => c.trainer_admin_id === a.id);
    const myPuns = discipline.filter(d => d.admin_id === a.id);
    openModal({
        title: `${a.display_name}`,
        large: true,
        body: `
            <div class="form-grid">
                <div class="form-row"><label>Discord</label><div>${escapeHtml(a.discord||'—')}</div></div>
                <div class="form-row"><label>Игр. ник</label><div>${escapeHtml(a.game_nick||'—')}</div></div>
                <div class="form-row"><label>Ранг / должность</label><div>${escapeHtml(adminPositionLabel(a))}</div></div>
                <div class="form-row"><label>Отдел</label><div>${escapeHtml(a.branch||'—')}</div></div>
                <div class="form-row"><label>Вступил</label><div>${fmtDate(a.joined_at)}</div></div>
                <div class="form-row"><label>Активность</label><div>${a.activity_percent||0}%</div></div>
            </div>
            <h3>Обзвоны (${myCalls.length})</h3>
            <div class="table-wrap"><table class="data"><thead><tr><th>Дата</th><th>Кандидат</th><th class="num">%</th><th>Статус</th></tr></thead><tbody>
            ${myCalls.slice(0,15).map(c => `<tr><td>${fmtDate(c.call_date)}</td><td>${escapeHtml(c.candidate?.display_name||'—')}</td><td class="num">${Math.round(+c.percent||0)}%</td><td>${statusBadge(c.status)}</td></tr>`).join('') || `<tr><td colspan="4" class="muted">Нет</td></tr>`}
            </tbody></table></div>
            <h3>Наказания (${myPuns.length})</h3>
            <div class="table-wrap"><table class="data"><thead><tr><th>Дата</th><th>Тип</th><th>Причина</th><th>Статус</th></tr></thead><tbody>
            ${myPuns.slice(0,15).map(p => `<tr><td>${fmtDate(p.date)}</td><td>${escapeHtml(punishLabel(p.punishment_type))}</td><td>${escapeHtml(p.reason||'—')}</td><td>${statusBadge(p.status)}</td></tr>`).join('') || `<tr><td colspan="4" class="muted">Нет</td></tr>`}
            </tbody></table></div>
        `,
        footer: `<button class="btn" data-cancel>Закрыть</button>`
    });
    $('[data-cancel]').onclick = closeModal;
}

// =====================================================================
// 11. Руководство
// =====================================================================
async function renderLeadership(view) {
    const [admins, discipline, calls] = await Promise.all([loadAdmins(false), loadDisciplineRecords(), loadCallHistory()]);
    const leaders = admins
        .filter(a => a.is_leadership || Number(a.rank) >= 9 || /руковод|глав|куратор|owner|директор/i.test(`${a.custom_position||''} ${a.current_position||''}`))
        .sort((a,b) => (Number(b.rank)||0) - (Number(a.rank)||0));

    view.innerHTML = `
        <div class="liverp-hero">
            <div>
                <h2>👑 Руководство</h2>
                <p class="muted">Руководящий состав администрации сервера</p>
            </div>
        </div>
        <div class="cards">
            <div class="card accent"><div class="card-label">Руководителей</div><div class="card-value">${leaders.length}</div></div>
            <div class="card success"><div class="card-label">Активных</div><div class="card-value">${leaders.filter(a=>a.is_active).length}</div></div>
            <div class="card danger"><div class="card-label">Активных наказаний</div><div class="card-value">${discipline.filter(d=>leaders.some(a=>a.id===d.admin_id) && d.status==='active').length}</div></div>
        </div>
        <div class="cards">
            ${leaders.map(a => {
                const activePuns = discipline.filter(d => d.admin_id === a.id && d.status === 'active').length;
                const trainings = calls.filter(c => c.trainer_admin_id === a.id).length;
                const initials = String(a.display_name||'?').split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase();
                return `<div class="card leader-card">
                    <div class="leader-avatar">${escapeHtml(initials)}</div>
                    <div>
                        <div style="font-weight:800;font-size:15px">${escapeHtml(a.display_name||'—')}</div>
                        <div style="margin-top:4px">${a.rank ? `<span class="rank-pill">R${a.rank}</span>` : ''} <span class="dim">${escapeHtml(a.custom_position || a.current_position || '')}</span></div>
                        <div class="muted" style="margin-top:4px">${escapeHtml(a.branch || 'Общая администрация')}</div>
                        <div class="muted" style="margin-top:4px">Discord: ${escapeHtml(a.discord||'—')} · Обучений: ${trainings} · Наказаний: ${activePuns}</div>
                    </div>
                </div>`;
            }).join('') || `<div class="empty">Руководство не отмечено. Назначьте ранг 9–11 или включите флаг «Руководство» в карточке.</div>`}
        </div>
    `;
}

// =====================================================================
// 12. Дисциплинарные наказания
// =====================================================================
async function renderDiscipline(view) {
    const [records, admins] = await Promise.all([loadDisciplineRecords(), loadAdmins()]);
    State.cache.discipline = records; State.cache.admins = admins;
    const canEdit = hasRole('owner','admin');

    view.innerHTML = `
        <h2>Дисциплинарные наказания</h2>
        ${canEdit ? `<div class="panel">
            <div class="panel-header"><h3>Выдать наказание</h3></div>
            <div class="form-grid">
                <div class="form-row"><label>Администратор *</label>
                    <select id="d-admin"><option value="">—</option>${admins.filter(a=>a.is_active).map(a=>`<option value="${a.id}" data-position="${escapeHtml(adminPositionLabel(a))}">${escapeHtml(adminShortLabel(a))}</option>`).join('')}</select></div>
                <div class="form-row"><label>Дата</label><input id="d-date" type="date" value="${new Date().toISOString().slice(0,10)}"/></div>
                <div class="form-row"><label>Ранг / должность</label><input id="d-pos" readonly placeholder="Авто из состава"/></div>
                <div class="form-row"><label>Тип</label>
                    <select id="d-type"><option value="warning">Предупреждение</option><option value="reprimand">Выговор</option><option value="strict_reprimand">Строгий выговор</option><option value="points_off">Снятие баллов</option><option value="demotion">Понижение</option><option value="dismissal">Снятие</option><option value="other">Другое</option></select></div>
                <div class="form-row"><label>Срок (до)</label><input id="d-exp" type="date"/></div>
                <div class="form-row"><label>Статус</label><select id="d-status"><option value="active">Активно</option><option value="removed">Снято</option><option value="appealed">Обжаловано</option></select></div>
                <div class="form-row" style="grid-column:1/-1"><label>Причина</label><textarea id="d-reason" rows="2"></textarea></div>
                <div class="form-row" style="grid-column:1/-1"><label>Комментарий</label><textarea id="d-comment" rows="2"></textarea></div>
            </div>
            <div style="margin-top:10px"><button class="btn btn-primary" id="btn-add-d">Добавить</button></div>
        </div>` : ''}
        <div class="panel">
            <div class="panel-header"><h3>Записи (${records.length})</h3></div>
            <div class="toolbar">
                <select id="d-f-admin"><option value="">Все админы</option>${admins.map(a=>`<option value="${a.id}">${escapeHtml(adminShortLabel(a))}</option>`).join('')}</select>
                <select id="d-f-status"><option value="">Все статусы</option><option value="active">Активно</option><option value="removed">Снято</option><option value="appealed">Обжаловано</option></select>
                <select id="d-f-type"><option value="">Все типы</option><option value="warning">Предупреждение</option><option value="reprimand">Выговор</option><option value="strict_reprimand">Строгий выговор</option><option value="points_off">Снятие баллов</option><option value="demotion">Понижение</option><option value="dismissal">Снятие</option><option value="other">Другое</option></select>
            </div>
            <div class="table-wrap">
                <table class="data" id="d-table"><thead><tr>
                    <th>Дата</th><th>Админ</th><th>Ранг</th><th>Тип</th><th>Причина</th><th>До</th><th>Статус</th><th style="width:100px">Действия</th>
                </tr></thead><tbody></tbody></table>
            </div>
        </div>
    `;

    const render = () => {
        const fa = $('#d-f-admin').value, fs = $('#d-f-status').value, ft = $('#d-f-type').value;
        const rows = records.filter(r => {
            if (fa && r.admin_id !== fa) return false;
            if (fs && r.status !== fs) return false;
            if (ft && r.punishment_type !== ft) return false;
            return true;
        });
        $('#d-table tbody').innerHTML = rows.map(r => `
            <tr data-id="${r.id}">
                <td>${fmtDate(r.date)}</td>
                <td>${escapeHtml(r.admin?.display_name||'—')}</td>
                <td>${escapeHtml(r.position||'—')}</td>
                <td>${escapeHtml(punishLabel(r.punishment_type))}</td>
                <td>${escapeHtml((r.reason||'').slice(0,50))}</td>
                <td>${fmtDate(r.expires_at)}</td>
                <td>${statusBadge(r.status)}</td>
                <td class="actions">
                    ${canEdit?`<button class="btn btn-sm" data-act="edit">✎</button><button class="btn btn-sm" data-act="close">✓</button>`:''}
                </td>
            </tr>
        `).join('') || `<tr><td colspan="8" class="muted">Нет данных</td></tr>`;
    };

    $('#d-f-admin').onchange = $('#d-f-status').onchange = $('#d-f-type').onchange = render;

    if (canEdit) {
        $('#d-admin').onchange = () => { $('#d-pos').value = $('#d-admin').selectedOptions[0]?.dataset?.position || ''; };
        $('#btn-add-d').onclick = async () => {
            const adminId = $('#d-admin').value;
            if (!adminId) return toast('Выберите администратора','warning');
            try {
                const rec = await createDisciplineRecord({
                    admin_id: adminId, date: $('#d-date').value, position: $('#d-pos').value.trim()||null,
                    punishment_type: $('#d-type').value, reason: $('#d-reason').value.trim()||null,
                    expires_at: $('#d-exp').value||null, status: $('#d-status').value,
                    comment: $('#d-comment').value.trim()||null
                });
                records.unshift({ ...rec, admin: admins.find(a => a.id === adminId) });
                toast('Добавлено','success'); render();
            } catch (e) { toast('Ошибка: '+e.message,'danger'); }
        };
        $('#d-table tbody').addEventListener('click', async (e) => {
            const btn = e.target.closest('button[data-act]'); if (!btn) return;
            const id = btn.closest('tr').dataset.id;
            const r = records.find(x => x.id === id);
            if (btn.dataset.act === 'close') {
                try { const upd = await updateDisciplineRecord(id, { status: 'removed' }); Object.assign(r, upd); render(); toast('Снято','success'); }
                catch(er){ toast('Ошибка: '+er.message,'danger'); }
            } else if (btn.dataset.act === 'edit') {
                const newReason = prompt('Изменить причину:', r.reason||'');
                if (newReason !== null) {
                    try { const upd = await updateDisciplineRecord(id, { reason: newReason }); Object.assign(r, upd); render(); } catch(er){ toast(er.message,'danger'); }
                }
            }
        });
    }
    render();
}

// =====================================================================
// 13. Система повышения
// =====================================================================
async function renderPromotion(view) {
    const [admins, departments, settings, calls, discipline] = await Promise.all([
        loadAdmins(false), loadDepartments(), loadPromotionSettings(), loadCallHistory(), loadDisciplineRecords()
    ]);
    State.cache.admins = admins; State.cache.promotionSettings = settings;
    const readiness = await calculatePromotionReadiness(admins, settings, calls, discipline);
    const canEdit = hasRole('owner','admin');
    const allDepartments = getDepartmentsFromAdmins(admins, departments).filter(dep => admins.some(a => (a.branch||'Общая администрация') === dep.name));

    view.innerHTML = `
        <div class="liverp-hero">
            <div><h2>Система повышений</h2><p class="muted">Готовность администраторов по отделам</p></div>
            <button class="btn btn-sm" id="btn-recalc">⟳ Обновить</button>
        </div>
        <div class="panel">
            <div class="toolbar">
                <input id="pr-search" placeholder="Поиск..." />
                <select id="pr-dep"><option value="">Все отделы</option>${allDepartments.map(d=>`<option>${escapeHtml(d.name)}</option>`).join('')}</select>
                <select id="pr-status"><option value="">Все</option><option value="ready">Готов</option><option value="pending">На рассмотрении</option><option value="not_ready">Не готов</option></select>
            </div>
        </div>
        <div id="promotion-sections"></div>
    `;

    const render = () => {
        const q = ($('#pr-search').value||'').toLowerCase();
        const depFilter = $('#pr-dep').value, stFilter = $('#pr-status').value;
        let rows = readiness.filter(r => {
            if (depFilter && (r.admin.branch||'Общая администрация') !== depFilter) return false;
            if (stFilter && r.status !== stFilter) return false;
            if (q && !(`${r.admin.display_name||''} ${r.admin.discord||''}`.toLowerCase().includes(q))) return false;
            return true;
        });
        const sections = getDepartmentsFromAdmins(rows.map(r=>r.admin), departments).filter(dep => rows.some(r => (r.admin.branch||'Общая администрация') === dep.name));
        $('#promotion-sections').innerHTML = sections.map(dep => {
            const group = rows.filter(r => (r.admin.branch||'Общая администрация') === dep.name)
                .sort((a,b) => (Number(b.admin.rank)||0) - (Number(a.admin.rank)||0));
            return `<div class="panel">
                <div class="panel-header"><h3>${escapeHtml(dep.name)} <span class="badge accent">${group.length}</span></h3></div>
                <div class="table-wrap"><table class="data"><thead><tr>
                    <th>Админ</th><th>Ранг</th><th>Следующий</th><th class="num">Дней</th>
                    <th>Готовность</th><th>Статус</th><th style="width:240px">Действия</th>
                </tr></thead><tbody>
                ${group.map(r => {
                    const c = r.checks || {};
                    return `<tr>
                        <td><b>${escapeHtml(r.admin.display_name)}</b></td>
                        <td>${r.admin.rank ? `<span class="rank-pill">R${r.admin.rank}</span>` : '—'} ${escapeHtml(r.admin.custom_position||'')}</td>
                        <td>${escapeHtml(r.next_position || nextRankLabel(r.admin, +1))}</td>
                        <td class="num">${r.days||0}${r.setting?` / ${r.setting.min_days}`:''}</td>
                        <td><div class="progress"><div class="${r.percent>=100?'success':r.percent>=60?'warning':'danger'}" style="width:${r.percent}%"></div></div><small class="muted">${r.percent}%</small></td>
                        <td>${statusBadge(r.status)}</td>
                        <td class="actions">
                            ${canEdit ? `<button class="btn btn-sm btn-success" data-id="${r.admin.id}" data-act="promote">⬆ Повысить</button>` : ''}
                            ${canEdit ? `<button class="btn btn-sm btn-warning" data-id="${r.admin.id}" data-act="demote">⬇ Понизить</button>` : ''}
                        </td>
                    </tr>`;
                }).join('')}
                </tbody></table></div>
            </div>`;
        }).join('') || `<div class="empty">Нет данных</div>`;
    };

    $('#btn-recalc').onclick = () => handleRoute(true);
    $('#pr-search').oninput = render;
    $('#pr-dep').onchange = render;
    $('#pr-status').onchange = render;

    $('#promotion-sections').addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-act]'); if (!btn) return;
        const admin = admins.find(a => a.id === btn.dataset.id); if (!admin) return;
        if (btn.dataset.act === 'promote') { rankChangeModal(admin, 'promote', () => handleRoute(true)); }
        else if (btn.dataset.act === 'demote') { rankChangeModal(admin, 'demote', () => handleRoute(true)); }
    });
    render();
}

function nextRankLabel(admin, delta) {
    return `Ранг ${Math.min(11, Math.max(1, Number(admin.rank || 1) + delta))}`;
}

function rankChangeModal(admin, direction, onDone) {
    const isPromote = direction === 'promote';
    const current = Number(admin.rank || 1);
    const suggested = Math.min(11, Math.max(1, current + (isPromote ? 1 : -1)));
    openModal({
        title: `${isPromote ? 'Повысить' : 'Понизить'}: ${admin.display_name}`,
        body: `
            <div class="form-grid">
                <div class="form-row"><label>Текущий</label><input value="${rankLabel(admin.rank)}" readonly /></div>
                <div class="form-row"><label>Новый ранг</label><select id="chg-rank">${Array.from({length:11},(_,i)=>i+1).map(n=>`<option value="${n}" ${n===suggested?'selected':''}>Ранг ${n}</option>`).join('')}</select></div>
                <div class="form-row" style="grid-column:1/-1"><label>Кастомная должность</label><input id="chg-custom" value="${escapeHtml(admin.custom_position||'')}"/></div>
                <div class="form-row" style="grid-column:1/-1"><label>Комментарий</label><textarea id="chg-comment" rows="2"></textarea></div>
            </div>
        `,
        footer: `<button class="btn" data-cancel>Отмена</button><button class="btn ${isPromote?'btn-success':'btn-warning'}" data-save>${isPromote?'Повысить':'Понизить'}</button>`
    });
    $('[data-cancel]').onclick = closeModal;
    $('[data-save]').onclick = async () => {
        const newRank = parseInt($('#chg-rank').value);
        const custom = $('#chg-custom').value.trim() || null;
        const comment = $('#chg-comment').value.trim() || null;
        try { await changeAdminRank(admin, newRank, custom, comment, direction); closeModal(); toast(isPromote?'Повышен':'Понижен', isPromote?'success':'warning'); onDone(); }
        catch(e) { toast('Ошибка: '+e.message,'danger'); }
    };
}

async function changeAdminRank(admin, newRank, customPosition, comment, direction) {
    const oldLabel = adminPositionLabel(admin);
    const patch = normalizeAdminPayload({
        rank: newRank, custom_position: customPosition,
        current_position: customPosition || `Ранг ${newRank}`,
        last_promotion_at: direction === 'promote' ? new Date().toISOString().slice(0,10) : admin.last_promotion_at
    });
    await updateAdmin(admin.id, patch);
    try {
        await SB.client.from('promotions').insert({
            admin_id: admin.id, old_position: oldLabel,
            new_position: adminPositionLabel({ ...admin, ...patch }),
            approved_by: State.user?.id || null,
            promoted_at: new Date().toISOString().slice(0,10), status: 'promoted',
            comment: `${direction === 'promote' ? 'Повышение' : 'Понижение'}${comment ? ': ' + comment : ''}`
        });
    } catch (e) { console.warn('promo log fail', e); }
}

// =====================================================================
// 14. Настройки повышения
// =====================================================================
async function renderPromotionSettings(view) {
    if (!hasRole('owner','admin')) { view.innerHTML = `<div class="empty">Нет доступа</div>`; return; }
    const settings = await loadPromotionSettings();

    view.innerHTML = `
        <h2>Настройки повышения</h2>
        <div class="panel">
            <div class="panel-header"><h3>Требования по рангам</h3>
                ${hasRole('owner') ? `<button class="btn btn-primary btn-sm" id="btn-add-set">+ Добавить</button>` : ''}
            </div>
            <div class="table-wrap">
                <table class="data"><thead><tr>
                    <th>Должность</th><th>Следующая</th><th class="num">Дней</th><th class="num">Обзвоны</th>
                    <th class="num">Обучения</th><th class="num">Макс. нак.</th><th class="num">Актив. %</th>
                    <th>Доп. условия</th><th style="width:80px">Действия</th>
                </tr></thead><tbody>
                ${settings.map(s => `<tr data-id="${s.id}">
                    <td>${escapeHtml(s.position_name)}</td><td>${escapeHtml(s.next_position_name||'—')}</td>
                    <td class="num">${s.min_days}</td><td class="num">${s.min_calls}</td><td class="num">${s.min_trainings}</td>
                    <td class="num">${s.max_active_punishments}</td><td class="num">${s.required_activity_percent}%</td>
                    <td>${escapeHtml(s.additional_conditions||'—')}</td>
                    <td class="actions"><button class="btn btn-sm" data-act="edit">✎</button></td>
                </tr>`).join('') || `<tr><td colspan="9" class="muted">Нет настроек</td></tr>`}
                </tbody></table>
            </div>
        </div>
    `;

    if (hasRole('owner')) { $('#btn-add-set').onclick = () => promoSetModal(null, () => handleRoute(true)); }
    view.querySelector('tbody').addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-act="edit"]'); if (!btn) return;
        const s = settings.find(x => x.id === btn.closest('tr').dataset.id);
        promoSetModal(s, () => handleRoute(true));
    });
}

function promoSetModal(s, onSave) {
    const isNew = !s;
    openModal({
        title: isNew ? 'Новая должность' : 'Редактирование',
        body: `
            <div class="form-grid">
                <div class="form-row"><label>Должность *</label><input id="ps-pos" value="${escapeHtml(s?.position_name||'')}" ${s?'readonly':''}/></div>
                <div class="form-row"><label>Следующая</label><input id="ps-next" value="${escapeHtml(s?.next_position_name||'')}"/></div>
                <div class="form-row"><label>Мин. дней</label><input id="ps-days" type="number" value="${s?.min_days||0}"/></div>
                <div class="form-row"><label>Мин. обзвонов</label><input id="ps-calls" type="number" value="${s?.min_calls||0}"/></div>
                <div class="form-row"><label>Мин. обучений</label><input id="ps-trn" type="number" value="${s?.min_trainings||0}"/></div>
                <div class="form-row"><label>Макс. нак.</label><input id="ps-mp" type="number" value="${s?.max_active_punishments||0}"/></div>
                <div class="form-row"><label>Мин. актив. %</label><input id="ps-act" type="number" value="${s?.required_activity_percent||0}"/></div>
                <div class="form-row" style="grid-column:1/-1"><label>Доп. условия</label><textarea id="ps-cond" rows="2">${escapeHtml(s?.additional_conditions||'')}</textarea></div>
            </div>`,
        footer: `<button class="btn" data-cancel>Отмена</button><button class="btn btn-primary" data-save>Сохранить</button>`
    });
    $('[data-cancel]').onclick = closeModal;
    $('[data-save]').onclick = async () => {
        const payload = { position_name: $('#ps-pos').value.trim(), next_position_name: $('#ps-next').value.trim()||null, min_days: parseInt($('#ps-days').value)||0, min_calls: parseInt($('#ps-calls').value)||0, min_trainings: parseInt($('#ps-trn').value)||0, max_active_punishments: parseInt($('#ps-mp').value)||0, required_activity_percent: parseFloat($('#ps-act').value)||0, additional_conditions: $('#ps-cond').value.trim()||null };
        if (s) payload.id = s.id;
        if (!payload.position_name) return toast('Должность обязательна','warning');
        try { await savePromotionSettings(payload); onSave(); closeModal(); toast('Сохранено','success'); }
        catch (e) { toast('Ошибка: '+e.message,'danger'); }
    };
}

// =====================================================================
// 15. Выплаты
// =====================================================================
async function renderPayments(view) {
    const [payments, admins] = await Promise.all([loadPayments(), loadAdmins(false)]);
    State.cache.payments = payments;
    const canEdit = hasRole('owner','admin');
    const weekAgo = new Date(Date.now() - 7*86400000).toISOString().slice(0,10);
    const weekly = payments.filter(p => p.date >= weekAgo);
    const weekSum = weekly.reduce((s,p)=>s+(+p.final_total||0),0);

    view.innerHTML = `
        <h2>Выплаты / донат</h2>
        ${canEdit ? `<div class="panel">
            <div class="panel-header"><h3>Начислить</h3></div>
            <div class="form-grid">
                <div class="form-row"><label>Дата</label><input id="p-date" type="datetime-local" value="${new Date().toISOString().slice(0,16)}"/></div>
                <div class="form-row"><label>Администратор *</label><select id="p-admin"><option value="">—</option>${admins.map(a=>`<option value="${a.id}">${escapeHtml(a.display_name)}</option>`).join('')}</select></div>
                <div class="form-row"><label>Тип</label><select id="p-type"><option value="report">Репорт</option><option value="punishment">Наказание</option><option value="watch">Слежка</option><option value="delivery">Поставка</option><option value="robbery">Ограбление</option><option value="event">Мероприятие</option><option value="call">Обзвон</option><option value="training">Обучение</option><option value="online">Онлайн</option><option value="curator_bonus">Кураторка</option><option value="other">Другое</option></select></div>
                <div class="form-row"><label>Кол-во</label><input id="p-amount" type="number" value="1" min="0"/></div>
                <div class="form-row"><label>Тариф</label><input id="p-tariff" type="number" value="20" min="0"/></div>
                <div class="form-row"><label>Вычет %</label><input id="p-deduct" type="number" value="0" min="0" max="100"/></div>
                <div class="form-row"><label>Множитель</label><select id="p-mult"><option value="1">x1</option><option value="2">x2 (ночь)</option></select></div>
                <div class="form-row"><label>Комментарий</label><input id="p-com"/></div>
            </div>
            <div style="margin-top:10px;display:flex;gap:8px;align-items:center">
                <button class="btn btn-primary" id="btn-add-pay">Добавить</button>
                <span class="muted">Итого: <b id="p-preview">0</b></span>
            </div>
        </div>` : ''}
        <div class="cards">
            <div class="card accent"><div class="card-label">За неделю</div><div class="card-value">${weekly.length}</div></div>
            <div class="card success"><div class="card-label">Сумма</div><div class="card-value">${weekSum.toLocaleString('ru-RU')}</div></div>
        </div>
        <div class="panel">
            <div class="panel-header"><h3>Все начисления (${payments.length})</h3></div>
            <div class="table-wrap">
                <table class="data" id="p-table"><thead><tr>
                    <th>Дата</th><th>Админ</th><th>Тип</th><th class="num">Кол-во</th><th class="num">Тариф</th>
                    <th class="num">×</th><th class="num">Итог</th><th>Комментарий</th><th style="width:60px">Действия</th>
                </tr></thead><tbody>
                ${payments.map(p => `<tr data-id="${p.id}">
                    <td>${fmtDate(p.date)}</td><td>${escapeHtml(p.admin?.display_name||'—')}</td>
                    <td>${escapeHtml(activityLabel(p.activity_type))}</td>
                    <td class="num">${p.amount||0}</td><td class="num">${p.tariff||0}</td>
                    <td class="num">x${p.multiplier||1}</td><td class="num"><b>${p.final_total||0}</b></td>
                    <td>${escapeHtml((p.comment||'').slice(0,30))}</td>
                    <td class="actions">${hasRole('owner','admin')?`<button class="btn btn-sm btn-danger" data-act="del">🗑</button>`:''}</td>
                </tr>`).join('') || `<tr><td colspan="9" class="muted">Нет данных</td></tr>`}
                </tbody></table>
            </div>
        </div>
    `;

    if (canEdit) {
        const recalc = () => {
            const amount = parseFloat($('#p-amount').value)||0;
            const tariff = parseFloat($('#p-tariff').value)||0;
            const mult = parseFloat($('#p-mult').value)||1;
            const ded = parseFloat($('#p-deduct').value)||0;
            const fin = amount * tariff * mult * (1 - ded/100);
            $('#p-preview').textContent = fin.toFixed(0);
        };
        $('#p-type').onchange = () => { $('#p-tariff').value = DEFAULT_TARIFFS[$('#p-type').value] ?? 0; recalc(); };
        ['p-amount','p-tariff','p-mult','p-deduct'].forEach(id => $('#'+id).oninput = recalc);
        recalc();
        $('#btn-add-pay').onclick = async () => {
            const adminId = $('#p-admin').value;
            if (!adminId) return toast('Выберите админа','warning');
            const amount = parseFloat($('#p-amount').value)||0, tariff = parseFloat($('#p-tariff').value)||0;
            const mult = parseFloat($('#p-mult').value)||1, ded = parseFloat($('#p-deduct').value)||0;
            const total = amount*tariff*mult, fin = total*(1-ded/100);
            try {
                await createPayment({ admin_id: adminId, date: $('#p-date').value.slice(0,10), activity_type: $('#p-type').value, amount, tariff, multiplier: mult, total, deduction_percent: ded, final_total: fin, comment: $('#p-com').value.trim()||null });
                toast('Добавлено','success'); handleRoute(true);
            } catch (e) { toast('Ошибка: '+e.message,'danger'); }
        };
        $('#p-table tbody').addEventListener('click', async (e) => {
            const btn = e.target.closest('button[data-act="del"]'); if (!btn) return;
            if (!await confirmDialog('Удалить запись?')) return;
            try { await deletePayment(btn.closest('tr').dataset.id); toast('Удалено','success'); handleRoute(true); }
            catch(er){ toast('Ошибка: '+er.message,'danger'); }
        });
    }
}

function activityLabel(t) {
    return ({ report:'Репорт', punishment:'Наказание', watch:'Слежка', delivery:'Поставка', robbery:'Ограбление', event:'Мероприятие', call:'Обзвон', training:'Обучение', online:'Онлайн', curator_bonus:'Кураторка', other:'Другое' })[t] || t || '—';
}

// =====================================================================
// 16. Архив
// =====================================================================
async function renderArchive(view) {
    if (!hasRole('owner','admin')) { view.innerHTML = `<div class="empty">Нет доступа</div>`; return; }
    const [admins, calls, discipline, questions, promotions, payments] = await Promise.all([
        loadAdmins(true), loadCallHistory(), loadDisciplineRecords(), loadQuestions(false), loadPromotions(), loadPayments()
    ]);
    const archAdmins = admins.filter(a => !a.is_active);
    const archProm = promotions.filter(p => p.status === 'rejected' || p.status === 'promoted');

    view.innerHTML = `
        <h2>Архив</h2>
        <div class="cards">
            <div class="card"><div class="card-label">Архивные админы</div><div class="card-value">${archAdmins.length}</div></div>
            <div class="card"><div class="card-label">История повышений</div><div class="card-value">${archProm.length}</div></div>
            <div class="card"><div class="card-label">Отключённые вопросы</div><div class="card-value">${questions.filter(q=>!q.is_active).length}</div></div>
        </div>
        <div class="panel">
            <div class="panel-header"><h3>Архивные администраторы</h3></div>
            <div class="table-wrap"><table class="data"><thead><tr><th>Имя</th><th>Ранг</th><th>Вступил</th><th>Комментарий</th></tr></thead><tbody>
            ${archAdmins.map(a => `<tr><td>${escapeHtml(a.display_name)}</td><td>${escapeHtml(adminPositionLabel(a))}</td><td>${fmtDate(a.joined_at)}</td><td>${escapeHtml(a.comment||'')}</td></tr>`).join('') || `<tr><td colspan="4" class="muted">Пусто</td></tr>`}
            </tbody></table></div>
        </div>
        <div class="panel">
            <div class="panel-header"><h3>История повышений</h3></div>
            <div class="table-wrap"><table class="data"><thead><tr><th>Дата</th><th>Админ</th><th>Старая</th><th>Новая</th><th>Статус</th><th>Комментарий</th></tr></thead><tbody>
            ${archProm.map(p => `<tr><td>${fmtDate(p.promoted_at||p.created_at)}</td><td>${escapeHtml(p.admin?.display_name||'—')}</td><td>${escapeHtml(p.old_position||'—')}</td><td>${escapeHtml(p.new_position||'—')}</td><td>${statusBadge(p.status)}</td><td>${escapeHtml(p.comment||'')}</td></tr>`).join('') || `<tr><td colspan="6" class="muted">Пусто</td></tr>`}
            </tbody></table></div>
        </div>
    `;
}

// =====================================================================
// 17. Настройки
// =====================================================================
async function renderSettings(view) {
    const conn = SB.client ? '✅ подключен' : '❌ нет клиента';
    const ap = loadAppearanceSettings();
    view.innerHTML = `
        <h2>Настройки</h2>
        <div class="panel-grid-2">
            <div class="panel">
                <div class="panel-header"><h3>Внешний вид</h3></div>
                <div class="form-grid">
                    <div class="form-row"><label>Тема</label><select id="s-theme"><option value="dark" ${ap.theme==='dark'?'selected':''}>Тёмная</option><option value="light" ${ap.theme==='light'?'selected':''}>Светлая</option></select></div>
                    <div class="form-row"><label>Анимации</label><select id="s-anim"><option value="on" ${ap.animations==='on'?'selected':''}>Включены</option><option value="off" ${ap.animations==='off'?'selected':''}>Отключены</option></select></div>
                    <div class="form-row"><label>Фон</label><select id="s-bg"><option value="orbs" ${ap.bgEffect==='orbs'?'selected':''}>Пузыри</option><option value="grid" ${ap.bgEffect==='grid'?'selected':''}>Сеть</option><option value="waves" ${ap.bgEffect==='waves'?'selected':''}>Волны</option><option value="off" ${ap.bgEffect==='off'?'selected':''}>Нет</option></select></div>
                    <div class="form-row"><label>Плотность</label><select id="s-density"><option value="comfortable" ${ap.density==='comfortable'?'selected':''}>Обычная</option><option value="compact" ${ap.density==='compact'?'selected':''}>Компактная</option></select></div>
                </div>
                <div class="card settings-preview-card" style="margin-top:12px"><div class="card-label">Предпросмотр</div><div class="card-value">LiveRP</div><div class="card-sub">Настройки применяются сразу</div></div>
            </div>
            <div class="panel">
                <div class="panel-header"><h3>Данные и система</h3></div>
                <div style="display:flex;flex-direction:column;gap:8px">
                    <button class="btn" id="s-export-json">⤓ Экспорт JSON</button>
                    <button class="btn" id="s-import-json">⤒ Импорт JSON</button>
                    <button class="btn" id="s-clear-cache">🧹 Очистить кэш</button>
                    <button class="btn" id="s-check-conn">🔌 Проверить подключение</button>
                </div>
                <p class="muted" style="margin-top:10px">Версия: <b>4.0.0</b> · Supabase: ${conn}</p>
            </div>
        </div>
    `;

    $('#s-theme').onchange = () => saveAppearanceSettings({ theme: $('#s-theme').value });
    $('#s-anim').onchange = () => saveAppearanceSettings({ animations: $('#s-anim').value });
    $('#s-bg').onchange = () => saveAppearanceSettings({ bgEffect: $('#s-bg').value });
    $('#s-density').onchange = () => saveAppearanceSettings({ density: $('#s-density').value });
    $('#s-export-json').onclick = () => $('#btn-export-json').click();
    $('#s-import-json').onclick = () => $('#btn-import-json').click();
    $('#s-clear-cache').onclick = () => {
        State.cache = { admins:[],questions:[],candidates:[],calls:[],discipline:[],promotionSettings:[],promotions:[],payments:[],users:[],departments:[] };
        toast('Кэш очищен','success');
    };
    $('#s-check-conn').onclick = async () => {
        try { await SB.client.from('user_profiles').select('id').limit(1); toast('Подключение OK','success'); }
        catch(e){ toast('Ошибка: '+e.message,'danger'); }
    };
}

// =====================================================================
// Запуск
// =====================================================================
document.addEventListener('DOMContentLoaded', bootstrap);
