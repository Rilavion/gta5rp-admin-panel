# GTA5RP | Admin Recruit Panel

Полноценная веб-панель набора и учёта администрации GTA5RP-сервера.
Полностью заменяет Google Таблицу и объединяет в одном месте: обзвоны кандидатов,
конструктор вопросов, историю, статистику, состав администрации, дисциплинарные
наказания, систему повышения и выплаты.

Технологии:

- **Frontend:** чистый HTML + CSS + JavaScript (без React/Vue/Angular/Node).
- **Backend:** Supabase (Postgres + Auth + RLS + опционально Edge Functions).
- **Хостинг:** GitHub Pages (только статика).

> ⚠ Сайт полностью клиентский. Вся защита данных строится на **Row Level Security**
> Supabase. Поэтому критически важно правильно выполнить `supabase.sql` —
> там настроены роли, политики и проверки прав.

---

## Содержание

1. [Структура проекта](#структура-проекта)
2. [Настройка Supabase шаг за шагом](#настройка-supabase-шаг-за-шагом)
3. [Где взять ключи и куда их вставлять](#где-взять-ключи-и-куда-их-вставлять)
4. [Почему нельзя использовать service_role во frontend](#почему-нельзя-использовать-service_role-во-frontend)
5. [Настройка Auth](#настройка-auth)
6. [Создание первого owner-а](#создание-первого-owner-а)
7. [Добавление новых пользователей](#добавление-новых-пользователей)
   - [Базовый вариант — вручную через Dashboard](#вариант-1--базовый-вручную)
   - [Продвинутый вариант — Edge Function](#вариант-2--продвинутый-edge-function-create-user)
8. [Деплой на GitHub Pages](#деплой-на-github-pages)
9. [Как пользоваться системой](#как-пользоваться-системой)
10. [Резервные копии и восстановление](#резервные-копии-и-восстановление)
11. [Обновление вопросов](#обновление-вопросов)
12. [Управление ролями и правами](#управление-ролями-и-правами)
13. [FAQ / траблшутинг](#faq--траблшутинг)

---

## Структура проекта

```
gta5rp-admin-panel/
├── index.html        # Разметка приложения и экран входа
├── style.css         # Тёмная тема + все стили
├── script.js         # Логика SPA, роутинг, рендер всех разделов
├── supabase.js       # Тонкий слой над supabase-js (CRUD + Auth)
├── supabase.sql      # Полная схема БД + RLS + функции + триггеры
├── seed.sql          # Стартовые вопросы, настройки повышения и пр.
└── README.md         # Этот файл
```

---

## Настройка Supabase шаг за шагом

### 1. Создайте проект Supabase

1. Зайдите на [https://supabase.com](https://supabase.com) и создайте бесплатный аккаунт.
2. Нажмите **New project**.
3. Укажите имя проекта (например `gta5rp-admin`), пароль для БД и регион
   (Frankfurt или Stockholm — оптимально по пингу).
4. Подождите 1–2 минуты, пока проект развернётся.

### 2. Откройте SQL Editor и выполните `supabase.sql`

1. В боковом меню Supabase выберите **SQL Editor**.
2. Нажмите **New query**.
3. Откройте файл [`supabase.sql`](./supabase.sql), скопируйте всё содержимое
   и вставьте в редактор Supabase.
4. Нажмите **Run** (Cmd/Ctrl + Enter).
5. Должно появиться `Success. No rows returned.`

`supabase.sql` создаёт:

- 11 таблиц (user_profiles, admins, candidates, questions, call_sessions,
  call_answers, discipline_records, promotion_settings, promotions,
  payments, audit_logs);
- check-ограничения для ролей и статусов;
- индексы для быстрых выборок;
- функцию обновления `updated_at` и триггеры;
- функции проверки роли `get_my_role`, `is_owner`, `is_admin_or_owner`,
  `is_interviewer_plus`, `is_any_role`;
- включает **Row Level Security** для всех таблиц;
- создаёт политики доступа для каждой роли.

> Файл идемпотентен — его можно запускать повторно при необходимости.

### 3. Выполните `seed.sql`

1. В SQL Editor создайте ещё один **New query**.
2. Скопируйте содержимое [`seed.sql`](./seed.sql) и нажмите **Run**.

`seed.sql` добавит:

- около 40 стартовых вопросов по 9 категориям;
- 6 уровней повышения (Стажёр → Руководящая администрация);
- комментарии по тарифам (сами тарифы зашиты в `script.js`).

---

## Где взять ключи и куда их вставлять

Откройте в Supabase **Project Settings → API**. Вам нужны два значения:

| Что | Где взять | Куда вставить |
|---|---|---|
| **Project URL** | `Project URL` | в `supabase.js` → `SUPABASE_CONFIG.url` |
| **anon / publishable key** | блок `Project API Keys → anon` `public` | в `supabase.js` → `SUPABASE_CONFIG.anonKey` |

Откройте `supabase.js` и замените:

```js
window.SUPABASE_CONFIG = {
    url: 'https://YOUR-PROJECT-REF.supabase.co',
    anonKey: 'YOUR-ANON-PUBLIC-KEY'
};
```

на свои реальные значения.

---

## Почему нельзя использовать service_role во frontend

В Supabase есть **второй ключ** — `service_role`. Он даёт **полный доступ ко всей БД,
минуя любые RLS-политики**. Если вставить его в `supabase.js` и опубликовать на GitHub Pages,
любой человек, открывший сайт, сможет прочитать ключ из исходников страницы и
удалить/изменить любые данные.

**Правило:**

- `anon` / `publishable` key — **МОЖНО** класть во frontend. Без RLS он бесполезен,
  а RLS у нас уже настроен.
- `service_role` / `secret` key — **НИКОГДА** не кладите во frontend и не коммитьте
  в публичный репозиторий. Он используется **только** на сервере (Edge Function,
  ваш сервер, ваши скрипты).

---

## Настройка Auth

1. В Supabase откройте **Authentication → Providers** и убедитесь, что включён
   провайдер **Email**.
2. Откройте **Authentication → Sign In / Up** (или старую вкладку Settings) и:
   - При желании выключите **Confirm email** — иначе пользователю нужно подтверждать
     почту по ссылке. Для внутренней админки это часто избыточно.
   - Установите **Site URL** = URL вашего GitHub Pages
     (например `https://your-name.github.io/gta5rp-admin-panel/`).
   - В **Redirect URLs** также добавьте этот же URL.

---

## Создание первого owner-а

В новой БД ещё нет ни одного пользователя. Чтобы войти в панель, выполните:

### Шаг 1. Создайте Auth-пользователя

1. В Supabase откройте **Authentication → Users**.
2. Нажмите **Add user → Create new user**.
3. Введите email и пароль (пароль ≥ 6 символов).
4. **Скопируйте `UID`** (это длинная uuid-строка вида
   `f1d2e7a8-9c4b-4a3a-9c1e-...`).

### Шаг 2. Создайте профиль owner в SQL Editor

В Supabase **SQL Editor** выполните:

```sql
insert into public.user_profiles (id, email, display_name, access_role, is_active)
values
    ('PASTE-UUID-HERE', 'your@email.com', 'Глава', 'owner', true)
on conflict (id) do update
set access_role = 'owner', is_active = true;
```

> Замените `PASTE-UUID-HERE` на скопированный UID из шага 1.

### Шаг 3. Войдите в панель

1. Откройте сайт.
2. На экране входа введите email и пароль того же пользователя.
3. После входа в верхней панели появится бейдж `OWNER` — значит, всё работает.

---

## Добавление новых пользователей

### Вариант 1 — базовый (вручную)

Подходит для маленькой команды (до ~20 человек).

1. **Создайте Auth-пользователя** в Supabase Dashboard
   (`Authentication → Users → Add user`).
2. Скопируйте его UUID.
3. В панели сайта зайдите в раздел **Пользователи** → **+ Создать профиль**
   (доступно только owner).
4. Вставьте UUID, укажите email, имя, выберите роль (`owner / admin / interviewer / viewer`),
   при желании свяжите с записью из «Состава администрации».
5. Сохраните. Новый пользователь сможет войти со своим паролем.

### Вариант 2 — продвинутый (Edge Function `create-user`)

Подходит, если хотите создавать пользователей **прямо из панели**, без перехода
в Supabase Dashboard.

Поскольку фронтенд не может создавать пользователей через `anon`-ключ (это запрещено
Supabase), используется Supabase **Edge Function**, которая на сервере вызывает
`auth.admin.createUser` с `service_role`-ключом.

#### Установка

1. Установите Supabase CLI: <https://supabase.com/docs/guides/cli>.
2. Залогиньтесь:
   ```bash
   supabase login
   supabase link --project-ref YOUR-PROJECT-REF
   ```
3. Создайте функцию:
   ```bash
   supabase functions new create-user
   ```
4. Замените содержимое `supabase/functions/create-user/index.ts` на:

```ts
// Supabase Edge Function: create-user
// Создаёт нового пользователя в Auth. Требует, чтобы вызывающий был owner.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const authHeader = req.headers.get('Authorization') || '';
        const jwt = authHeader.replace('Bearer ', '');
        if (!jwt) return new Response('Unauthorized', { status: 401, headers: corsHeaders });

        // 1. Проверяем кто вызвал
        const userClient = createClient(SUPABASE_URL, ANON_KEY, {
            global: { headers: { Authorization: `Bearer ${jwt}` } }
        });
        const { data: me, error: meErr } = await userClient.auth.getUser();
        if (meErr || !me?.user) return new Response('Unauthorized', { status: 401, headers: corsHeaders });

        const { data: profile } = await userClient
            .from('user_profiles').select('access_role,is_active').eq('id', me.user.id).maybeSingle();
        if (!profile || !profile.is_active || profile.access_role !== 'owner') {
            return new Response('Forbidden: only owner can create users', { status: 403, headers: corsHeaders });
        }

        // 2. Создаём пользователя через service_role
        const body = await req.json();
        const { email, password, display_name, access_role = 'viewer', admin_id = null } = body;
        if (!email || !password) return new Response('email and password required', { status: 400, headers: corsHeaders });

        const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);
        const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
            email, password, email_confirm: true
        });
        if (createErr) return new Response(createErr.message, { status: 400, headers: corsHeaders });

        // 3. Создаём профиль
        await adminClient.from('user_profiles').upsert({
            id: created.user.id, email, display_name, access_role, admin_id, is_active: true
        });

        return new Response(JSON.stringify({ id: created.user.id }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    } catch (e) {
        return new Response('Error: ' + (e as Error).message, { status: 500, headers: corsHeaders });
    }
});
```

5. Задеплойте:
   ```bash
   supabase functions deploy create-user --no-verify-jwt
   ```
   > Флаг `--no-verify-jwt` нужен, потому что JWT мы проверяем самостоятельно внутри функции.

6. Из фронта функцию можно вызывать так (добавьте в `supabase.js` свою обвязку):
   ```js
   const { data, error } = await SB.client.functions.invoke('create-user', {
       body: { email, password, display_name, access_role: 'admin' }
   });
   ```

> ⚠ `service_role` хранится только в переменных окружения Edge Function —
> в репозиторий он не попадает.

---

## Деплой на GitHub Pages

1. Создайте репозиторий на GitHub, например `gta5rp-admin-panel`.
2. Загрузите все файлы проекта в корень репозитория:
   ```bash
   git init
   git add .
   git commit -m "init"
   git branch -M main
   git remote add origin https://github.com/YOUR-NAME/gta5rp-admin-panel.git
   git push -u origin main
   ```
3. В репозитории → **Settings → Pages**:
   - **Source** = `Deploy from a branch`
   - **Branch** = `main`, `/ (root)`
   - Сохраните.
4. Через 1–2 минуты сайт будет доступен по адресу
   `https://YOUR-NAME.github.io/gta5rp-admin-panel/`.

5. **Обязательно** добавьте этот URL в Supabase → **Authentication → URL Configuration**
   (Site URL + Redirect URLs).

> 💡 Если вы храните `supabase.js` с реальным `anon`-ключом в **публичном** репозитории
> — это нормально. `anon`-ключ безопасен при правильной настройке RLS (которая уже сделана
> в `supabase.sql`).
>
> Если хотите дополнительно скрыть его — сделайте репозиторий приватным и пользуйтесь
> GitHub Pages Pro, либо разверните на любом другом статическом хостинге
> (Netlify, Cloudflare Pages — там тоже бесплатно).

---

## Как пользоваться системой

После входа доступные разделы зависят от роли:

| Раздел | owner | admin | interviewer | viewer |
|---|:-:|:-:|:-:|:-:|
| Главная | ✔ | ✔ | ✔ | ✔ |
| Обзвоны | ✔ | ✔ | ✔ | — |
| Конструктор вопросов | ✔ | ✔ | 👁 | 👁 |
| История обзвонов | ✔ | ✔ | ✔ | ✔ |
| Статистика | ✔ | ✔ | ✔ | ✔ |
| Пользователи | ✔ | 👁 | — | — |
| Состав администрации | ✔ | ✔ | 👁 | 👁 |
| Наказания | ✔ | ✔ | — | 👁 |
| Система повышения | ✔ | ✔ | — | 👁 |
| Настройки повышения | ✔ | ✔ | — | — |
| Выплаты | ✔ | ✔ | — | 👁 |
| Архив | ✔ | ✔ | — | — |
| Настройки | ✔ | ✔ | ✔ | ✔ |

«👁» — просмотр без редактирования.

### Типовой сценарий

1. **owner** добавляет всех людей из состава в раздел «Состав администрации».
2. **owner** создаёт Auth-пользователей и в разделе «Пользователи» назначает им роли.
3. **interviewer / admin** заходит в раздел «Обзвоны», заполняет форму, проставляет
   оценки и нажимает «Сохранить результат».
4. Запись автоматически попадает в «Историю обзвонов» и в «Статистику».
5. **admin** периодически открывает «Систему повышения», смотрит список готовых
   к повышению и нажимает «Повысить».
6. **admin** ведёт «Наказания» и «Выплаты» в течение недели.
7. Раз в неделю «Главная» показывает сводку: сумма к выплате, кандидаты, наказания.

---

## Резервные копии и восстановление

### Сделать резервную копию

- В верхней панели нажмите **⤓ JSON**. Скачается файл вида
  `gta5rp-admin-dump-2025-12-31.json` со всеми данными по всем таблицам
  (кроме `auth.users` — это управляется самим Supabase).
- Рекомендуется делать дамп раз в неделю и хранить копии (например в Google Drive).

> На уровне Supabase: **Project Settings → Database → Backups** — там доступны
> ежедневные резервные копии всей БД (на Pro-плане автоматически, на free
> — point-in-time нет, но дамп через JSON работает в любом тарифе).

### Восстановить

- Нажмите **⤒ JSON** (только owner), выберите сохранённый файл.
- Записи будут **upsert-нуты** в соответствующие таблицы (по `id`).

---

## Обновление вопросов

- Заходите в раздел **Конструктор вопросов**.
- Добавляйте новые, редактируйте текст, меняйте порядок (стрелки ↑ ↓).
- Если вопрос уже использовался в обзвонах — **отключайте** его (`is_active = false`),
  а не удаляйте. Тогда историю не разрушит.
- Только owner имеет право физически удалить вопрос.

---

## Управление ролями и правами

### Как изменить роль пользователя

1. Зайдите в раздел **Пользователи**.
2. Нажмите ✎ возле нужного пользователя.
3. Выберите новую роль и сохраните.

### Как заблокировать пользователя

- В разделе **Пользователи** нажмите ⏸ — `is_active` станет `false`,
  и человек перестанет проходить `requireAuth()`.

### Описание ролей

- **owner** — полный доступ ко всему: пользователи, удаление, импорт, настройки.
- **admin** — старший администратор / HR. Управляет вопросами, составом,
  наказаниями, повышениями, выплатами. Не может создавать owner-ов и удалять
  критические системные данные.
- **interviewer** — проводит обзвоны, создаёт кандидатов, видит свои записи.
- **viewer** — только просмотр.

---

## FAQ / траблшутинг

**Не могу войти. Пишет «Account is not active».**
Профиль не создан или `is_active = false`. Зайдите в SQL Editor и выполните:
```sql
select * from public.user_profiles where email = 'your@email.com';
```
Если строки нет — создайте через `insert`. Если `is_active = false` —
обновите: `update public.user_profiles set is_active = true where id = '...';`.

**Запросы возвращают пустоту, хотя я owner.**
Проверьте, что `supabase.sql` был выполнен **целиком** и все политики созданы:
```sql
select tablename, policyname from pg_policies where schemaname = 'public';
```
Должно быть ~30+ строк.

**`Failed to fetch` при логине.**
Скорее всего, неверный URL/ключ в `supabase.js`, либо в Supabase не добавлен
ваш Site URL.

**Хочу сменить цветовую тему.**
Все цвета — это CSS-переменные в `:root` файла `style.css`. Меняйте `--accent`,
`--success` и т.п.

**Можно ли подключить Discord-логин?**
Да. В Supabase → Authentication → Providers включите Discord, добавьте Client ID/Secret.
Дополнительно в `supabase.js` используйте `signInWithOAuth({ provider: 'discord' })`.

---

## Лицензия

Используйте свободно для своего GTA5RP-сервера. Удачи и хороших обзвонов! 🎮

---

## LiveRP v2 update

Подробная инструкция по обновлению находится в [`README_V2_UPDATE.md`](./README_V2_UPDATE.md).
Перед использованием новых рангов 1–11 и вкладки «Руководство» выполните `liverp_update.sql` в Supabase SQL Editor.
