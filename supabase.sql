-- =====================================================================
-- GTA5RP | Admin Recruit Panel — Supabase schema
-- Запустите этот файл в Supabase SQL Editor ОДИН РАЗ при первой настройке.
-- =====================================================================

-- Расширения
create extension if not exists "pgcrypto";

-- =====================================================================
-- ENUM-подобные ограничения сделаны через check, чтобы было легче менять
-- список значений без миграций enum-типов.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. user_profiles
-- ---------------------------------------------------------------------
create table if not exists public.user_profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    email text,
    display_name text,
    access_role text not null default 'viewer'
        check (access_role in ('owner','admin','interviewer','viewer')),
    admin_id uuid,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_user_profiles_role on public.user_profiles(access_role);
create index if not exists idx_user_profiles_active on public.user_profiles(is_active);

-- ---------------------------------------------------------------------
-- 2. admins (состав администрации)
-- ---------------------------------------------------------------------
create table if not exists public.admins (
    id uuid primary key default gen_random_uuid(),
    display_name text not null,
    discord text,
    game_nick text,
    current_position text,
    branch text,
    joined_at date,
    last_promotion_at date,
    activity_percent numeric default 0,
    is_active boolean not null default true,
    comment text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_admins_active on public.admins(is_active);
create index if not exists idx_admins_position on public.admins(current_position);

-- Связь user_profiles -> admins (после создания таблицы admins)
do $$
begin
    if not exists (
        select 1 from information_schema.table_constraints
        where constraint_name = 'fk_user_profiles_admin_id'
    ) then
        alter table public.user_profiles
            add constraint fk_user_profiles_admin_id
            foreign key (admin_id) references public.admins(id) on delete set null;
    end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. candidates
-- ---------------------------------------------------------------------
create table if not exists public.candidates (
    id uuid primary key default gen_random_uuid(),
    display_name text not null,
    discord text,
    game_nick text,
    age int,
    timezone text,
    status text default 'new'
        check (status in ('new','passed','failed','retake','archived')),
    comment text,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_candidates_status on public.candidates(status);
create index if not exists idx_candidates_discord on public.candidates(discord);

-- ---------------------------------------------------------------------
-- 4. questions
-- ---------------------------------------------------------------------
create table if not exists public.questions (
    id uuid primary key default gen_random_uuid(),
    category text not null,
    question_text text not null,
    order_index int not null default 0,
    is_active boolean not null default true,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_questions_category on public.questions(category);
create index if not exists idx_questions_active on public.questions(is_active);
create index if not exists idx_questions_order on public.questions(order_index);

-- ---------------------------------------------------------------------
-- 5. call_sessions
-- ---------------------------------------------------------------------
create table if not exists public.call_sessions (
    id uuid primary key default gen_random_uuid(),
    candidate_id uuid references public.candidates(id) on delete cascade,
    interviewer_id uuid references auth.users(id) on delete set null,
    trainer_admin_id uuid references public.admins(id) on delete set null,
    call_date date not null default current_date,
    call_replay_url text,
    training_replay_url text,
    total_points numeric default 0,
    max_points numeric default 0,
    percent numeric default 0,
    status text default 'failed'
        check (status in ('passed','retake','failed','draft','archived')),
    comment text,
    extra_comment text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_call_sessions_date on public.call_sessions(call_date desc);
create index if not exists idx_call_sessions_status on public.call_sessions(status);
create index if not exists idx_call_sessions_interviewer on public.call_sessions(interviewer_id);
create index if not exists idx_call_sessions_trainer on public.call_sessions(trainer_admin_id);
create index if not exists idx_call_sessions_candidate on public.call_sessions(candidate_id);

-- ---------------------------------------------------------------------
-- 6. call_answers
-- ---------------------------------------------------------------------
create table if not exists public.call_answers (
    id uuid primary key default gen_random_uuid(),
    call_session_id uuid not null references public.call_sessions(id) on delete cascade,
    question_id uuid references public.questions(id) on delete set null,
    score numeric not null default 0 check (score in (0,0.5,1)),
    comment text,
    created_at timestamptz not null default now()
);

create index if not exists idx_call_answers_session on public.call_answers(call_session_id);
create index if not exists idx_call_answers_question on public.call_answers(question_id);

-- ---------------------------------------------------------------------
-- 7. discipline_records
-- ---------------------------------------------------------------------
create table if not exists public.discipline_records (
    id uuid primary key default gen_random_uuid(),
    admin_id uuid references public.admins(id) on delete cascade,
    date date not null default current_date,
    position text,
    punishment_type text
        check (punishment_type in ('warning','reprimand','strict_reprimand','points_off','demotion','dismissal','other')),
    reason text,
    issued_by uuid references auth.users(id) on delete set null,
    expires_at date,
    status text default 'active'
        check (status in ('active','removed','appealed','archived')),
    comment text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_discipline_admin on public.discipline_records(admin_id);
create index if not exists idx_discipline_status on public.discipline_records(status);
create index if not exists idx_discipline_date on public.discipline_records(date desc);

-- ---------------------------------------------------------------------
-- 8. promotion_settings
-- ---------------------------------------------------------------------
create table if not exists public.promotion_settings (
    id uuid primary key default gen_random_uuid(),
    position_name text not null unique,
    next_position_name text,
    min_days int default 0,
    min_calls int default 0,
    min_trainings int default 0,
    max_active_punishments int default 0,
    required_activity_percent numeric default 0,
    additional_conditions text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_promotion_settings_position on public.promotion_settings(position_name);

-- ---------------------------------------------------------------------
-- 9. promotions
-- ---------------------------------------------------------------------
create table if not exists public.promotions (
    id uuid primary key default gen_random_uuid(),
    admin_id uuid references public.admins(id) on delete cascade,
    old_position text,
    new_position text,
    approved_by uuid references auth.users(id) on delete set null,
    promoted_at date,
    status text default 'pending'
        check (status in ('not_ready','pending','ready','promoted','rejected')),
    comment text,
    created_at timestamptz not null default now()
);

create index if not exists idx_promotions_admin on public.promotions(admin_id);
create index if not exists idx_promotions_status on public.promotions(status);

-- ---------------------------------------------------------------------
-- 10. payments
-- ---------------------------------------------------------------------
create table if not exists public.payments (
    id uuid primary key default gen_random_uuid(),
    admin_id uuid references public.admins(id) on delete cascade,
    date date not null default current_date,
    activity_type text
        check (activity_type in ('report','punishment','watch','delivery','robbery','event','call','training','online','curator_bonus','other')),
    amount numeric default 0,
    tariff numeric default 0,
    multiplier numeric default 1,
    total numeric default 0,
    deduction_percent numeric default 0,
    final_total numeric default 0,
    comment text,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now()
);

create index if not exists idx_payments_admin on public.payments(admin_id);
create index if not exists idx_payments_date on public.payments(date desc);
create index if not exists idx_payments_type on public.payments(activity_type);

-- ---------------------------------------------------------------------
-- 11. audit_logs
-- ---------------------------------------------------------------------
create table if not exists public.audit_logs (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references auth.users(id) on delete set null,
    action text,
    entity_type text,
    entity_id uuid,
    details jsonb,
    created_at timestamptz not null default now()
);

create index if not exists idx_audit_user on public.audit_logs(user_id);
create index if not exists idx_audit_entity on public.audit_logs(entity_type, entity_id);
create index if not exists idx_audit_created on public.audit_logs(created_at desc);

-- =====================================================================
-- Триггер updated_at
-- =====================================================================
create or replace function public.update_updated_at_column()
returns trigger as $$
begin
    new.updated_at := now();
    return new;
end;
$$ language plpgsql;

do $$
declare
    t text;
begin
    for t in select unnest(array[
        'user_profiles','admins','candidates','questions',
        'call_sessions','discipline_records','promotion_settings'
    ])
    loop
        execute format('drop trigger if exists trg_%s_updated_at on public.%s;', t, t);
        execute format(
            'create trigger trg_%s_updated_at before update on public.%s ' ||
            'for each row execute function public.update_updated_at_column();', t, t);
    end loop;
end $$;

-- =====================================================================
-- Функции проверки роли пользователя
-- =====================================================================
create or replace function public.get_my_role()
returns text
language sql
security definer
set search_path = public
as $$
    select coalesce(
        (select access_role from public.user_profiles
            where id = auth.uid() and is_active = true),
        'viewer'
    );
$$;

create or replace function public.is_owner()
returns boolean
language sql
security definer
set search_path = public
as $$
    select public.get_my_role() = 'owner';
$$;

create or replace function public.is_admin_or_owner()
returns boolean
language sql
security definer
set search_path = public
as $$
    select public.get_my_role() in ('owner','admin');
$$;

create or replace function public.is_interviewer_plus()
returns boolean
language sql
security definer
set search_path = public
as $$
    select public.get_my_role() in ('owner','admin','interviewer');
$$;

create or replace function public.is_any_role()
returns boolean
language sql
security definer
set search_path = public
as $$
    select public.get_my_role() in ('owner','admin','interviewer','viewer');
$$;

grant execute on function public.get_my_role() to anon, authenticated;
grant execute on function public.is_owner() to anon, authenticated;
grant execute on function public.is_admin_or_owner() to anon, authenticated;
grant execute on function public.is_interviewer_plus() to anon, authenticated;
grant execute on function public.is_any_role() to anon, authenticated;

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.user_profiles enable row level security;
alter table public.admins enable row level security;
alter table public.candidates enable row level security;
alter table public.questions enable row level security;
alter table public.call_sessions enable row level security;
alter table public.call_answers enable row level security;
alter table public.discipline_records enable row level security;
alter table public.promotion_settings enable row level security;
alter table public.promotions enable row level security;
alter table public.payments enable row level security;
alter table public.audit_logs enable row level security;

-- Удаляем старые политики если есть (для повторного запуска файла)
do $$
declare
    pol record;
begin
    for pol in
        select schemaname, tablename, policyname
        from pg_policies
        where schemaname = 'public'
          and tablename in (
            'user_profiles','admins','candidates','questions',
            'call_sessions','call_answers','discipline_records',
            'promotion_settings','promotions','payments','audit_logs'
          )
    loop
        execute format('drop policy if exists %I on %I.%I;',
            pol.policyname, pol.schemaname, pol.tablename);
    end loop;
end $$;

-- ----- user_profiles -----
create policy "up_select_self_or_admin" on public.user_profiles
    for select using (id = auth.uid() or public.is_admin_or_owner());

create policy "up_update_self_limited" on public.user_profiles
    for update using (id = auth.uid())
    with check (id = auth.uid());

create policy "up_owner_all" on public.user_profiles
    for all using (public.is_owner())
    with check (public.is_owner());

-- ----- admins -----
create policy "admins_select_any_authed" on public.admins
    for select using (public.is_any_role());

create policy "admins_modify_admin_or_owner" on public.admins
    for insert with check (public.is_admin_or_owner());

create policy "admins_update_admin_or_owner" on public.admins
    for update using (public.is_admin_or_owner())
    with check (public.is_admin_or_owner());

create policy "admins_delete_owner" on public.admins
    for delete using (public.is_owner());

-- ----- candidates -----
create policy "candidates_select_any_authed" on public.candidates
    for select using (public.is_any_role());

create policy "candidates_insert_interviewer_plus" on public.candidates
    for insert with check (public.is_interviewer_plus());

create policy "candidates_update_admin_or_owner" on public.candidates
    for update using (public.is_admin_or_owner())
    with check (public.is_admin_or_owner());

create policy "candidates_delete_owner" on public.candidates
    for delete using (public.is_owner());

-- ----- questions -----
create policy "questions_select_any_authed" on public.questions
    for select using (public.is_any_role());

create policy "questions_insert_admin" on public.questions
    for insert with check (public.is_admin_or_owner());

create policy "questions_update_admin" on public.questions
    for update using (public.is_admin_or_owner())
    with check (public.is_admin_or_owner());

create policy "questions_delete_owner" on public.questions
    for delete using (public.is_owner());

-- ----- call_sessions -----
create policy "cs_select_any_authed" on public.call_sessions
    for select using (public.is_any_role());

create policy "cs_insert_interviewer_plus" on public.call_sessions
    for insert with check (
        public.is_interviewer_plus()
        and (interviewer_id = auth.uid() or public.is_admin_or_owner())
    );

create policy "cs_update_self_or_admin" on public.call_sessions
    for update using (
        interviewer_id = auth.uid() or public.is_admin_or_owner()
    ) with check (
        interviewer_id = auth.uid() or public.is_admin_or_owner()
    );

create policy "cs_delete_admin_or_owner" on public.call_sessions
    for delete using (public.is_admin_or_owner());

-- ----- call_answers -----
create policy "ca_select_any_authed" on public.call_answers
    for select using (public.is_any_role());

create policy "ca_insert_interviewer_plus" on public.call_answers
    for insert with check (public.is_interviewer_plus());

create policy "ca_update_admin_or_owner" on public.call_answers
    for update using (public.is_admin_or_owner())
    with check (public.is_admin_or_owner());

create policy "ca_delete_admin_or_owner" on public.call_answers
    for delete using (public.is_admin_or_owner());

-- ----- discipline_records -----
create policy "dr_select_any_authed" on public.discipline_records
    for select using (public.is_any_role());

create policy "dr_insert_admin" on public.discipline_records
    for insert with check (public.is_admin_or_owner());

create policy "dr_update_admin" on public.discipline_records
    for update using (public.is_admin_or_owner())
    with check (public.is_admin_or_owner());

create policy "dr_delete_owner" on public.discipline_records
    for delete using (public.is_owner());

-- ----- promotion_settings -----
create policy "ps_select_any_authed" on public.promotion_settings
    for select using (public.is_any_role());

create policy "ps_insert_owner" on public.promotion_settings
    for insert with check (public.is_owner());

create policy "ps_update_admin" on public.promotion_settings
    for update using (public.is_admin_or_owner())
    with check (public.is_admin_or_owner());

create policy "ps_delete_owner" on public.promotion_settings
    for delete using (public.is_owner());

-- ----- promotions -----
create policy "prom_select_any_authed" on public.promotions
    for select using (public.is_any_role());

create policy "prom_insert_admin" on public.promotions
    for insert with check (public.is_admin_or_owner());

create policy "prom_update_admin" on public.promotions
    for update using (public.is_admin_or_owner())
    with check (public.is_admin_or_owner());

create policy "prom_delete_owner" on public.promotions
    for delete using (public.is_owner());

-- ----- payments -----
create policy "pay_select_any_authed" on public.payments
    for select using (public.is_any_role());

create policy "pay_insert_admin" on public.payments
    for insert with check (public.is_admin_or_owner());

create policy "pay_update_admin" on public.payments
    for update using (public.is_admin_or_owner())
    with check (public.is_admin_or_owner());

create policy "pay_delete_owner" on public.payments
    for delete using (public.is_owner());

-- ----- audit_logs -----
create policy "audit_select_admin" on public.audit_logs
    for select using (public.is_admin_or_owner());

create policy "audit_insert_any_authed" on public.audit_logs
    for insert with check (auth.uid() is not null);

create policy "audit_delete_owner" on public.audit_logs
    for delete using (public.is_owner());

-- =====================================================================
-- Готово.  Перейдите к seed.sql для стартовых данных.
-- =====================================================================
