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
