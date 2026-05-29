// Supabase Edge Function: manage-user
// Создание и редактирование Auth-пользователей прямо из панели.
// Доступ: только owner. Service role key хранится только на стороне Supabase Function.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
      return json({ error: 'Function env is not configured' }, 500);
    }

    const authHeader = req.headers.get('Authorization') || '';
    const jwt = authHeader.replace('Bearer ', '').trim();

    if (!jwt) {
      return json({ error: 'Unauthorized' }, 401);
    }

    // Проверяем вызывающего пользователя обычным anon-клиентом + его JWT.
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false },
    });

    const { data: meData, error: meError } = await userClient.auth.getUser();
    if (meError || !meData?.user) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const { data: meProfile, error: profileError } = await userClient
      .from('user_profiles')
      .select('id, access_role, is_active')
      .eq('id', meData.user.id)
      .maybeSingle();

    if (profileError) {
      return json({ error: profileError.message }, 400);
    }

    if (!meProfile || !meProfile.is_active || meProfile.access_role !== 'owner') {
      return json({ error: 'Forbidden: only owner can manage users' }, 403);
    }

    const body = await req.json();
    const action = body.action;

    const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });

    if (action === 'create') {
      const {
        email,
        password,
        display_name = null,
        access_role = 'viewer',
        admin_id = null,
        is_active = true,
      } = body;

      if (!email || !password) {
        return json({ error: 'email and password are required' }, 400);
      }

      if (String(password).length < 6) {
        return json({ error: 'password must be at least 6 characters' }, 400);
      }

      const { data: created, error: createError } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

      if (createError || !created?.user) {
        return json({ error: createError?.message || 'Failed to create user' }, 400);
      }

      const profilePayload = {
        id: created.user.id,
        email,
        display_name,
        access_role,
        admin_id,
        is_active,
        updated_at: new Date().toISOString(),
      };

      const { data: profile, error: upsertError } = await adminClient
        .from('user_profiles')
        .upsert(profilePayload, { onConflict: 'id' })
        .select()
        .single();

      if (upsertError) {
        return json({ error: upsertError.message }, 400);
      }

      return json({ user: created.user, profile });
    }

    if (action === 'update') {
      const {
        id,
        email,
        password,
        display_name = null,
        access_role = 'viewer',
        admin_id = null,
        is_active = true,
      } = body;

      if (!id) {
        return json({ error: 'id is required' }, 400);
      }

      // Не даём owner случайно отрезать самого себя от системы.
      if (id === meData.user.id && (is_active === false || access_role !== 'owner')) {
        return json({ error: 'Owner cannot deactivate or demote himself' }, 400);
      }

      const authPatch: Record<string, unknown> = {};
      if (email) authPatch.email = email;
      if (password) {
        if (String(password).length < 6) {
          return json({ error: 'password must be at least 6 characters' }, 400);
        }
        authPatch.password = password;
      }

      if (Object.keys(authPatch).length > 0) {
        const { error: updateAuthError } = await adminClient.auth.admin.updateUserById(id, authPatch);
        if (updateAuthError) {
          return json({ error: updateAuthError.message }, 400);
        }
      }

      const profilePayload = {
        id,
        email,
        display_name,
        access_role,
        admin_id,
        is_active,
        updated_at: new Date().toISOString(),
      };

      const { data: profile, error: upsertError } = await adminClient
        .from('user_profiles')
        .upsert(profilePayload, { onConflict: 'id' })
        .select()
        .single();

      if (upsertError) {
        return json({ error: upsertError.message }, 400);
      }

      return json({ profile });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
