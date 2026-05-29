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
