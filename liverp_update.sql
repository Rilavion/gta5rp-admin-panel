-- =====================================================================
-- LiveRP Admin Panel v2 migration
-- Запустить в Supabase SQL Editor, если база уже была создана раньше.
-- Добавляет ранги 1-11, кастомные должности, вкладку руководства и поддержку новых UI-полей.
-- =====================================================================

alter table public.admins
    add column if not exists rank int check (rank between 1 and 11),
    add column if not exists custom_position text,
    add column if not exists is_leadership boolean not null default false;

alter table public.admins
    alter column branch set default 'Общая администрация';

create index if not exists idx_admins_rank on public.admins(rank);
create index if not exists idx_admins_leadership on public.admins(is_leadership);

-- Если у старых записей была должность, переносим её как кастомную должность.
update public.admins
set custom_position = current_position
where custom_position is null
  and current_position is not null
  and current_position !~ '^Ранг [0-9]+$';

-- Базовая лестница рангов 1-11. Старые настройки не удаляются.
insert into public.promotion_settings (
    position_name,
    next_position_name,
    min_days,
    min_calls,
    min_trainings,
    max_active_punishments,
    required_activity_percent,
    additional_conditions
) values
('Ранг 1',  'Ранг 2',  7,  1, 0, 0, 40, 'Базовое освоение обязанностей администратора.'),
('Ранг 2',  'Ранг 3',  10, 2, 0, 0, 45, 'Стабильная активность и отсутствие активных наказаний.'),
('Ранг 3',  'Ранг 4',  14, 3, 1, 0, 50, 'Участие в работе состава и обработке обращений.'),
('Ранг 4',  'Ранг 5',  18, 4, 1, 0, 55, 'Уверенная работа с игроками и базовыми конфликтами.'),
('Ранг 5',  'Ранг 6',  21, 5, 2, 0, 60, 'Допускается участие в обучении/наборе при необходимости.'),
('Ранг 6',  'Ранг 7',  28, 6, 2, 0, 65, 'Стабильная активность, качественная работа по жалобам.'),
('Ранг 7',  'Ранг 8',  35, 8, 3, 0, 70, 'Старшая зона ответственности, помощь младшим рангам.'),
('Ранг 8',  'Ранг 9',  45, 10, 4, 0, 75, 'Подготовка к руководящим задачам.'),
('Ранг 9',  'Ранг 10', 60, 12, 5, 0, 80, 'Руководящий состав / кураторские задачи.'),
('Ранг 10', 'Ранг 11', 75, 15, 6, 0, 85, 'Высшее руководство, устойчивое качество и доверие.'),
('Ранг 11', null,      0,  0, 0, 0, 90, 'Максимальный ранг. Повышение вручную не требуется.')
on conflict (position_name) do update set
    next_position_name = excluded.next_position_name,
    min_days = excluded.min_days,
    min_calls = excluded.min_calls,
    min_trainings = excluded.min_trainings,
    max_active_punishments = excluded.max_active_punishments,
    required_activity_percent = excluded.required_activity_percent,
    additional_conditions = excluded.additional_conditions,
    updated_at = now();

-- Помечаем высокие ранги как руководство.
update public.admins
set is_leadership = true
where rank >= 9;

-- Проверка результата:
-- select rank, custom_position, is_leadership, display_name from public.admins order by rank desc nulls last, display_name;
-- select position_name, next_position_name from public.promotion_settings where position_name like 'Ранг %' order by position_name;
-- =====================================================================
-- LiveRP Admin Panel v3 update
-- Добавляет отделы/разделы и подсчёт принятых рапортов
-- Запустить в Supabase SQL Editor после v2/liverp_update.sql
-- =====================================================================

create extension if not exists "pgcrypto";

alter table public.admins
    add column if not exists accepted_reports int not null default 0;

create table if not exists public.admin_departments (
    id uuid primary key default gen_random_uuid(),
    name text not null unique,
    show_calls boolean not null default true,
    show_reports boolean not null default true,
    show_trainings boolean not null default true,
    show_activity boolean not null default true,
    show_punishments boolean not null default true,
    sort_order int not null default 100,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_admin_departments_sort on public.admin_departments(sort_order, name);

-- функция updated_at уже обычно есть из supabase.sql, но создаём на всякий случай
create or replace function public.update_updated_at_column()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

drop trigger if exists trg_admin_departments_updated_at on public.admin_departments;
create trigger trg_admin_departments_updated_at
before update on public.admin_departments
for each row execute function public.update_updated_at_column();

alter table public.admin_departments enable row level security;

drop policy if exists "admin_departments_select_any_authed" on public.admin_departments;
drop policy if exists "admin_departments_insert_owner_admin" on public.admin_departments;
drop policy if exists "admin_departments_update_owner_admin" on public.admin_departments;
drop policy if exists "admin_departments_delete_owner" on public.admin_departments;

create policy "admin_departments_select_any_authed" on public.admin_departments
    for select using (public.is_any_role());

create policy "admin_departments_insert_owner_admin" on public.admin_departments
    for insert with check (public.is_admin_or_owner());

create policy "admin_departments_update_owner_admin" on public.admin_departments
    for update using (public.is_admin_or_owner())
    with check (public.is_admin_or_owner());

create policy "admin_departments_delete_owner" on public.admin_departments
    for delete using (public.is_owner());

insert into public.admin_departments
    (name, show_calls, show_reports, show_trainings, show_activity, show_punishments, sort_order)
values
    ('Общая администрация', true, true, true, true, true, 10),
    ('Отдел набора', true, false, true, true, true, 20),
    ('Отдел репортов', false, true, false, true, true, 30),
    ('Руководство', true, true, true, true, true, 40)
on conflict (name) do nothing;
