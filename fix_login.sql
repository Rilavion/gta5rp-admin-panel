-- =====================================================================
-- Починка входа: проверка и восстановление профиля
-- Запускать по шагам в Supabase SQL Editor
-- =====================================================================

-- ШАГ 1: Проверяем что есть в auth.users
SELECT id, email, created_at FROM auth.users ORDER BY created_at;

-- ШАГ 2: Проверяем что есть в user_profiles
SELECT * FROM public.user_profiles ORDER BY created_at;

-- ШАГ 3: Если профиля нет — вставляем.
-- ⚠️ ЗАМЕНИТЕ значения на свои из шага 1!

-- INSERT INTO public.user_profiles (id, email, display_name, access_role, is_active)
-- VALUES ('ваш-uuid', 'ваш@email', 'Owner', 'owner', true)
-- ON CONFLICT (id) DO UPDATE SET access_role = 'owner', is_active = true;

-- ШАГ 4: Если логин всё ещё зависает — проблема в RLS.
-- Временно отключаем RLS на user_profiles чтобы войти:
-- ALTER TABLE public.user_profiles DISABLE ROW LEVEL SECURITY;

-- ШАГ 5: После успешного входа — включить RLS обратно:
-- ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
