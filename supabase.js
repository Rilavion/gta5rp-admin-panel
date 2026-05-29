/* =====================================================================
 * GTA5RP | Admin Recruit Panel — Supabase layer
 * =====================================================================
 * ВНИМАНИЕ: В этом файле допустимы только Project URL и ANON / publishable key.
 * НИКОГДА не вставляйте сюда service_role / secret key — он попадёт в репозиторий!
 * ===================================================================== */

// ---------------------------------------------------------------------
// 1. Конфигурация. Замените значения на свои из Supabase Dashboard:
//    Project Settings → API → Project URL + anon/public key
// ---------------------------------------------------------------------
window.SUPABASE_CONFIG = {
    url: 'https://efezrmthbssdkwbgypmv.supabase.co',
    anonKey: 'sb_publishable_535wL9XsOnsNrQrVMDUU4w_TqPmEhgA'
};

// ---------------------------------------------------------------------
// 2. Глобальный объект клиента и состояния
// ---------------------------------------------------------------------
window.SB = {
    client: null,
    user: null,
    profile: null
};

// ---------------------------------------------------------------------
// 3. Инициализация
// ---------------------------------------------------------------------
function initSupabase() {
    if (!window.supabase || !window.supabase.createClient) {
        console.error('[Supabase] supabase-js не загружен');
        return null;
    }
    if (!SUPABASE_CONFIG.url || SUPABASE_CONFIG.url.includes('YOUR-PROJECT-REF')) {
        console.warn('[Supabase] Не настроен URL/ключ в supabase.js. Откройте supabase.js и впишите реальные значения.');
    }
    window.SB.client = window.supabase.createClient(
        SUPABASE_CONFIG.url,
        SUPABASE_CONFIG.anonKey,
        {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true
            }
        }
    );
    return window.SB.client;
}

// ---------------------------------------------------------------------
// 4. Авторизация
// ---------------------------------------------------------------------
async function login(email, password) {
    const { data, error } = await SB.client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    SB.user = data.user;
    return data.user;
}

async function logout() {
    await SB.client.auth.signOut();
    SB.user = null;
    SB.profile = null;
}

async function getCurrentUser() {
    const { data } = await SB.client.auth.getUser();
    SB.user = data?.user || null;
    return SB.user;
}

async function getCurrentProfile() {
    if (!SB.user) await getCurrentUser();
    if (!SB.user) return null;
    try {
        // Таймаут 8 секунд — если RLS блокирует, не зависаем вечно
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const { data, error } = await SB.client
            .from('user_profiles')
            .select('*')
            .eq('id', SB.user.id)
            .maybeSingle()
            .abortSignal(controller.signal);
        clearTimeout(timeout);
        if (error) {
            console.error('[Supabase] getCurrentProfile error', error);
            return null;
        }
        SB.profile = data || null;
        return SB.profile;
    } catch (e) {
        console.error('[Supabase] getCurrentProfile timeout/error', e);
        return null;
    }
}

async function requireAuth() {
    const u = await getCurrentUser();
    if (!u) return null;
    const p = await getCurrentProfile();
    if (!p || !p.is_active) return null;
    return { user: u, profile: p };
}

function hasRole(...roles) {
    if (!SB.profile) return false;
    return roles.includes(SB.profile.access_role);
}

// ---------------------------------------------------------------------
// 5. Пользователи
// ---------------------------------------------------------------------
async function loadUsers() {
    const { data, error } = await SB.client
        .from('user_profiles')
        .select('*')
        .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
}

async function saveUserProfile(profile) {
    // upsert по id
    const { data, error } = await SB.client
        .from('user_profiles')
        .upsert(profile, { onConflict: 'id' })
        .select()
        .single();
    if (error) throw error;
    return data;
}

async function disableUser(userId, disabled = true) {
    const { data, error } = await SB.client
        .from('user_profiles')
        .update({ is_active: !disabled })
        .eq('id', userId)
        .select()
        .single();
    if (error) throw error;
    return data;
}


async function adminCreateUser({ email, password, display_name, access_role = 'viewer', admin_id = null, is_active = true }) {
    if (!hasRole('owner')) throw new Error('Только owner может создавать пользователей');
    const { data, error } = await SB.client.functions.invoke('manage-user', {
        body: { action: 'create', email, password, display_name, access_role, admin_id, is_active }
    });
    if (error) throw error;
    await writeAuditLog('create', 'user', data?.profile?.id || data?.id || null, { email, display_name, access_role, admin_id, is_active });
    return data?.profile || data;
}

async function adminUpdateUser({ id, email, password, display_name, access_role, admin_id = null, is_active = true }) {
    if (!hasRole('owner')) throw new Error('Только owner может редактировать пользователей');
    const { data, error } = await SB.client.functions.invoke('manage-user', {
        body: { action: 'update', id, email, password: password || undefined, display_name, access_role, admin_id, is_active }
    });
    if (error) throw error;
    await writeAuditLog('update', 'user', id, { email, display_name, access_role, admin_id, is_active, password_changed: Boolean(password) });
    return data?.profile || data;
}

// ---------------------------------------------------------------------
// 5.5 Отделы / разделы
// ---------------------------------------------------------------------
async function loadDepartments() {
    const { data, error } = await SB.client
        .from('admin_departments')
        .select('*')
        .order('sort_order')
        .order('name');
    if (error) throw error;
    return data || [];
}

async function saveDepartment(dep) {
    const payload = { ...dep };
    if (!payload.id) delete payload.id;
    const { data, error } = await SB.client
        .from('admin_departments')
        .upsert(payload, { onConflict: 'id' })
        .select()
        .single();
    if (error) throw error;
    await writeAuditLog('upsert','department', data.id, payload);
    return data;
}

async function deleteDepartment(id) {
    const { error } = await SB.client.from('admin_departments').delete().eq('id', id);
    if (error) throw error;
    await writeAuditLog('delete','department', id, {});
}

// ---------------------------------------------------------------------
// 6. Администраторы (состав)
// ---------------------------------------------------------------------
async function loadAdmins(includeInactive = true) {
    let q = SB.client.from('admins').select('*').order('display_name');
    if (!includeInactive) q = q.eq('is_active', true);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
}

async function createAdmin(admin) {
    const { data, error } = await SB.client
        .from('admins')
        .insert(admin)
        .select()
        .single();
    if (error) throw error;
    await writeAuditLog('create', 'admin', data.id, admin);
    return data;
}

async function updateAdmin(id, patch) {
    const { data, error } = await SB.client
        .from('admins')
        .update(patch)
        .eq('id', id)
        .select()
        .single();
    if (error) throw error;
    await writeAuditLog('update', 'admin', id, patch);
    return data;
}

async function archiveAdmin(id) {
    return updateAdmin(id, { is_active: false });
}

// ---------------------------------------------------------------------
// 7. Вопросы
// ---------------------------------------------------------------------
async function loadQuestions(onlyActive = false) {
    let q = SB.client.from('questions').select('*').order('category').order('order_index');
    if (onlyActive) q = q.eq('is_active', true);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
}

async function createQuestion(question) {
    const payload = { ...question, created_by: SB.user?.id || null };
    const { data, error } = await SB.client
        .from('questions')
        .insert(payload)
        .select()
        .single();
    if (error) throw error;
    await writeAuditLog('create', 'question', data.id, payload);
    return data;
}

async function updateQuestion(id, patch) {
    const { data, error } = await SB.client
        .from('questions')
        .update(patch)
        .eq('id', id)
        .select()
        .single();
    if (error) throw error;
    await writeAuditLog('update', 'question', id, patch);
    return data;
}

async function disableQuestion(id, disabled = true) {
    return updateQuestion(id, { is_active: !disabled });
}

async function deleteQuestion(id) {
    const { error } = await SB.client.from('questions').delete().eq('id', id);
    if (error) throw error;
    await writeAuditLog('delete', 'question', id, {});
}

// ---------------------------------------------------------------------
// 8. Кандидаты
// ---------------------------------------------------------------------
async function loadCandidates() {
    const { data, error } = await SB.client
        .from('candidates')
        .select('*')
        .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
}

async function createCandidate(cand) {
    const payload = { ...cand, created_by: SB.user?.id || null };
    const { data, error } = await SB.client
        .from('candidates')
        .insert(payload)
        .select()
        .single();
    if (error) throw error;
    await writeAuditLog('create', 'candidate', data.id, payload);
    return data;
}


async function updateCandidate(id, patch) {
    const { data, error } = await SB.client
        .from('candidates')
        .update(patch)
        .eq('id', id)
        .select()
        .single();
    if (error) throw error;
    await writeAuditLog('update', 'candidate', id, patch);
    return data;
}

async function findOrCreateCandidate(cand) {
    // ищем по Discord или нику
    if (cand.discord) {
        const { data } = await SB.client
            .from('candidates')
            .select('*')
            .eq('discord', cand.discord)
            .limit(1);
        if (data && data.length) return data[0];
    }
    return await createCandidate(cand);
}

// ---------------------------------------------------------------------
// 9. Обзвоны
// ---------------------------------------------------------------------
async function saveCallSession(session, answers) {
    const sessPayload = {
        candidate_id: session.candidate_id,
        interviewer_id: session.interviewer_id || SB.user?.id || null,
        trainer_admin_id: session.trainer_admin_id || null,
        call_date: session.call_date,
        call_replay_url: session.call_replay_url || null,
        training_replay_url: session.training_replay_url || null,
        total_points: session.total_points,
        max_points: session.max_points,
        percent: session.percent,
        status: session.status,
        comment: session.comment || null,
        extra_comment: session.extra_comment || null
    };
    const { data: sessData, error: sessErr } = await SB.client
        .from('call_sessions')
        .insert(sessPayload)
        .select()
        .single();
    if (sessErr) throw sessErr;

    if (Array.isArray(answers) && answers.length) {
        const rows = answers.map(a => ({
            call_session_id: sessData.id,
            question_id: a.question_id,
            score: a.score,
            comment: a.comment || null
        }));
        const { error: ansErr } = await SB.client.from('call_answers').insert(rows);
        if (ansErr) throw ansErr;
    }

    // Обновляем статус кандидата
    if (session.candidate_id) {
        const candStatus = session.status === 'passed' ? 'passed'
                         : session.status === 'retake' ? 'retake'
                         : session.status === 'failed' ? 'failed' : 'new';
        await SB.client.from('candidates').update({ status: candStatus }).eq('id', session.candidate_id);
    }

    await writeAuditLog('create', 'call_session', sessData.id, sessPayload);
    return sessData;
}


async function updateCallSession(id, patch) {
    const { data, error } = await SB.client
        .from('call_sessions')
        .update(patch)
        .eq('id', id)
        .select()
        .single();
    if (error) throw error;
    await writeAuditLog('update', 'call_session', id, patch);
    return data;
}

async function replaceCallAnswers(callSessionId, answers = []) {
    const { error: delErr } = await SB.client
        .from('call_answers')
        .delete()
        .eq('call_session_id', callSessionId);
    if (delErr) throw delErr;

    if (Array.isArray(answers) && answers.length) {
        const rows = answers.map(a => ({
            call_session_id: callSessionId,
            question_id: a.question_id,
            score: a.score,
            comment: a.comment || null
        }));
        const { error: insErr } = await SB.client.from('call_answers').insert(rows);
        if (insErr) throw insErr;
    }
    await writeAuditLog('replace', 'call_answers', callSessionId, { count: answers.length });
    return true;
}

async function loadCallHistory(filters = {}) {
    let q = SB.client.from('call_sessions').select(`
        *,
        candidate:candidate_id (id, display_name, discord, game_nick),
        trainer:trainer_admin_id (id, display_name, rank, custom_position, current_position)
    `).order('call_date', { ascending: false });

    if (filters.status) q = q.eq('status', filters.status);
    if (filters.interviewer_id) q = q.eq('interviewer_id', filters.interviewer_id);
    if (filters.from) q = q.gte('call_date', filters.from);
    if (filters.to) q = q.lte('call_date', filters.to);

    const { data, error } = await q;
    if (error) throw error;
    const rows = data || [];

    // Подмешиваем профили проводящих обзвон (ручной join, т.к. FK на auth.users)
    const ids = [...new Set(rows.map(r => r.interviewer_id).filter(Boolean))];
    if (ids.length) {
        const { data: profs } = await SB.client
            .from('user_profiles').select('id,email,display_name').in('id', ids);
        const map = {};
        (profs||[]).forEach(p => map[p.id] = p);
        rows.forEach(r => {
            const p = map[r.interviewer_id];
            r.interviewer = p ? { id: p.id, email: p.email || p.display_name } : null;
        });
    }
    return rows;
}

async function loadCallAnswers(callSessionId) {
    const { data, error } = await SB.client
        .from('call_answers')
        .select(`*, question:question_id (id, category, question_text)`)
        .eq('call_session_id', callSessionId);
    if (error) throw error;
    return data || [];
}

async function deleteCallSession(id) {
    const { error } = await SB.client.from('call_sessions').delete().eq('id', id);
    if (error) throw error;
    await writeAuditLog('delete', 'call_session', id, {});
}

// ---------------------------------------------------------------------
// 10. Дисциплинарные наказания
// ---------------------------------------------------------------------
async function loadDisciplineRecords() {
    const { data, error } = await SB.client
        .from('discipline_records')
        .select(`*, admin:admin_id (id, display_name, discord, rank, custom_position, current_position)`)
        .order('date', { ascending: false });
    if (error) throw error;
    return data || [];
}

async function createDisciplineRecord(record) {
    const payload = { ...record, issued_by: record.issued_by || SB.user?.id || null };
    const { data, error } = await SB.client
        .from('discipline_records')
        .insert(payload)
        .select()
        .single();
    if (error) throw error;
    await writeAuditLog('create', 'discipline', data.id, payload);
    return data;
}

async function updateDisciplineRecord(id, patch) {
    const { data, error } = await SB.client
        .from('discipline_records')
        .update(patch)
        .eq('id', id)
        .select()
        .single();
    if (error) throw error;
    await writeAuditLog('update', 'discipline', id, patch);
    return data;
}

async function deleteDisciplineRecord(id) {
    const { error } = await SB.client.from('discipline_records').delete().eq('id', id);
    if (error) throw error;
    await writeAuditLog('delete', 'discipline', id, {});
}

// ---------------------------------------------------------------------
// 11. Настройки повышения и повышения
// ---------------------------------------------------------------------
async function loadPromotionSettings() {
    const { data, error } = await SB.client
        .from('promotion_settings')
        .select('*')
        .order('min_days');
    if (error) throw error;
    return data || [];
}

async function savePromotionSettings(setting) {
    const { data, error } = await SB.client
        .from('promotion_settings')
        .upsert(setting, { onConflict: 'position_name' })
        .select()
        .single();
    if (error) throw error;
    await writeAuditLog('upsert', 'promotion_settings', data.id, setting);
    return data;
}

async function loadPromotions() {
    const { data, error } = await SB.client
        .from('promotions')
        .select(`*, admin:admin_id (id, display_name)`)
        .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
}

async function approvePromotion(adminId, newPosition, comment) {
    // 1. создаём запись о повышении
    const { data: admin } = await SB.client.from('admins').select('*').eq('id', adminId).single();
    const promo = {
        admin_id: adminId,
        old_position: admin?.current_position || null,
        new_position: newPosition,
        approved_by: SB.user?.id || null,
        promoted_at: new Date().toISOString().slice(0,10),
        status: 'promoted',
        comment: comment || null
    };
    const { data, error } = await SB.client.from('promotions').insert(promo).select().single();
    if (error) throw error;
    // 2. обновляем должность у админа
    await SB.client.from('admins').update({
        current_position: newPosition,
        last_promotion_at: promo.promoted_at
    }).eq('id', adminId);
    await writeAuditLog('approve_promotion','promotion', data.id, promo);
    return data;
}

async function rejectPromotion(adminId, comment) {
    const promo = {
        admin_id: adminId,
        approved_by: SB.user?.id || null,
        status: 'rejected',
        comment: comment || null
    };
    const { data, error } = await SB.client.from('promotions').insert(promo).select().single();
    if (error) throw error;
    await writeAuditLog('reject_promotion','promotion', data.id, promo);
    return data;
}

// Чисто клиентский расчёт готовности к повышению
async function calculatePromotionReadiness(admins, settings, calls, discipline) {
    const today = new Date();
    return admins.filter(a => a.is_active).map(a => {
        const setting = settings.find(s => s.position_name === a.current_position);
        if (!setting) {
            return { admin: a, ready: false, status: 'not_ready', reason: 'Нет настроек для должности', percent: 0 };
        }
        const joined = a.last_promotion_at || a.joined_at;
        const days = joined ? Math.floor((today - new Date(joined)) / 86400000) : 0;
        const myCalls = calls.filter(c => c.trainer_admin_id === a.id || (c.trainer && c.trainer.id === a.id));
        const callsCount = myCalls.length;
        const trainingsCount = myCalls.filter(c => c.training_replay_url).length;
        const activePuns = discipline.filter(d => d.admin_id === a.id && d.status === 'active').length;
        const activityOk = (a.activity_percent || 0) >= setting.required_activity_percent;

        const reportsCount = Number(a.accepted_reports || 0);
        const minReports = Number(setting.min_reports || 0);
        const reportsOk = reportsCount >= minReports;

        const checks = {
            days: days >= setting.min_days,
            calls: callsCount >= setting.min_calls,
            trainings: trainingsCount >= setting.min_trainings,
            reports: reportsOk,
            punishments: activePuns <= setting.max_active_punishments,
            activity: activityOk
        };
        const totalChecks = Object.keys(checks).length;
        const okCount = Object.values(checks).filter(Boolean).length;
        const percent = Math.round(okCount * 100 / totalChecks);

        let status = 'not_ready';
        if (activePuns > setting.max_active_punishments) status = 'not_ready';
        else if (percent === 100) status = 'ready';
        else if (percent >= 60) status = 'pending';

        return {
            admin: a, setting, days, callsCount, trainingsCount,
            reportsCount, activePuns, checks, percent, status,
            next_position: setting.next_position_name
        };
    });
}

// ---------------------------------------------------------------------
// 12. Выплаты
// ---------------------------------------------------------------------
async function loadPayments(filters = {}) {
    let q = SB.client.from('payments')
        .select(`*, admin:admin_id (id, display_name, rank, custom_position, current_position)`)
        .order('date', { ascending: false });
    if (filters.from) q = q.gte('date', filters.from);
    if (filters.to) q = q.lte('date', filters.to);
    if (filters.admin_id) q = q.eq('admin_id', filters.admin_id);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
}

async function createPayment(p) {
    const payload = { ...p, created_by: SB.user?.id || null };
    const { data, error } = await SB.client.from('payments').insert(payload).select().single();
    if (error) throw error;
    await writeAuditLog('create','payment', data.id, payload);
    return data;
}

async function deletePayment(id) {
    const { error } = await SB.client.from('payments').delete().eq('id', id);
    if (error) throw error;
    await writeAuditLog('delete','payment', id, {});
}

// ---------------------------------------------------------------------
// 13. Экспорт / импорт
// ---------------------------------------------------------------------
async function exportData() {
    const tables = ['user_profiles','admins','candidates','questions',
        'call_sessions','call_answers','discipline_records',
        'promotion_settings','promotions','payments','admin_departments'];
    const dump = { exportedAt: new Date().toISOString(), tables: {} };
    for (const t of tables) {
        try {
            const { data, error } = await SB.client.from(t).select('*');
            if (error) throw error;
            dump.tables[t] = data || [];
        } catch (e) {
            console.warn('export skip', t, e.message);
            dump.tables[t] = [];
        }
    }
    return dump;
}

async function importData(dump) {
    // Импорт идёт по таблицам в правильном порядке.
    const order = ['admin_departments','admins','candidates','questions','promotion_settings',
        'call_sessions','call_answers','discipline_records','promotions','payments'];
    for (const t of order) {
        const rows = dump?.tables?.[t];
        if (!rows || !rows.length) continue;
        const { error } = await SB.client.from(t).upsert(rows);
        if (error) console.warn('import error', t, error.message);
    }
    await writeAuditLog('import','system',null,{ tables: order });
}

// ---------------------------------------------------------------------
// 14. Аудит
// ---------------------------------------------------------------------
async function writeAuditLog(action, entityType, entityId, details) {
    try {
        if (!SB.user) return;
        await SB.client.from('audit_logs').insert({
            user_id: SB.user.id,
            action,
            entity_type: entityType,
            entity_id: entityId,
            details
        });
    } catch (e) {
        console.warn('[audit] failed', e.message);
    }
}

// Экспортируем в window для удобства
Object.assign(window, {
    initSupabase, login, logout, getCurrentUser, getCurrentProfile, requireAuth, hasRole,
    loadUsers, saveUserProfile, disableUser, adminCreateUser, adminUpdateUser,
    loadDepartments, saveDepartment, deleteDepartment,
    loadAdmins, createAdmin, updateAdmin, archiveAdmin,
    loadQuestions, createQuestion, updateQuestion, disableQuestion, deleteQuestion,
    loadCandidates, createCandidate, updateCandidate, findOrCreateCandidate,
    saveCallSession, updateCallSession, replaceCallAnswers, loadCallHistory, loadCallAnswers, deleteCallSession,
    loadDisciplineRecords, createDisciplineRecord, updateDisciplineRecord, deleteDisciplineRecord,
    loadPromotionSettings, savePromotionSettings, loadPromotions,
    calculatePromotionReadiness, approvePromotion, rejectPromotion,
    loadPayments, createPayment, deletePayment,
    exportData, importData, writeAuditLog
});
