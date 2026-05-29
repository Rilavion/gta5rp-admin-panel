-- =====================================================================
-- Восстановление owner-профиля
-- Запустить в Supabase SQL Editor
-- =====================================================================

-- Шаг 1: Посмотреть, какие пользователи есть в auth.users
SELECT id, email, created_at 
FROM auth.users 
ORDER BY created_at;

-- Шаг 2: После того как увидите свой id и email — 
-- вставьте свои данные в команду ниже.
-- Замените YOUR_USER_ID на ваш id из результата выше,
-- и YOUR_EMAIL на ваш email.

-- РАСКОММЕНТИРУЙТЕ и отредактируйте:

-- INSERT INTO public.user_profiles (id, email, display_name, access_role, is_active)
-- VALUES (
--     'YOUR_USER_ID',
--     'YOUR_EMAIL',
--     'Owner',
--     'owner',
--     true
-- )
-- ON CONFLICT (id) DO UPDATE SET
--     access_role = 'owner',
--     is_active = true;
