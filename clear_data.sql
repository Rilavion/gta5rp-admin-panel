-- =====================================================================
-- LiveRP: Очистка данных (пользователи остаются)
-- Запустить в Supabase SQL Editor
-- =====================================================================

-- Порядок важен — сначала зависимые таблицы, потом основные

-- 1. Ответы на вопросы обзвонов
TRUNCATE public.call_answers CASCADE;

-- 2. Сессии обзвонов
TRUNCATE public.call_sessions CASCADE;

-- 3. Кандидаты
TRUNCATE public.candidates CASCADE;

-- 4. Вопросы
TRUNCATE public.questions CASCADE;

-- 5. Дисциплинарные наказания
TRUNCATE public.discipline_records CASCADE;

-- 6. Повышения (история)
TRUNCATE public.promotions CASCADE;

-- 7. Настройки повышения
TRUNCATE public.promotion_settings CASCADE;

-- 8. Выплаты
TRUNCATE public.payments CASCADE;

-- 9. Отделы
TRUNCATE public.admin_departments CASCADE;

-- 10. Состав администрации
TRUNCATE public.admins CASCADE;

-- 11. Аудит-логи
TRUNCATE public.audit_logs CASCADE;

-- Готово. Пользователи (user_profiles + auth.users) не тронуты.
-- После очистки можно снова запустить seed.sql для стартовых вопросов.
