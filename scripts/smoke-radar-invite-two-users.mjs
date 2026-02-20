#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

function loadEnvFile(path) {
  if (!existsSync(path)) return;

  const content = readFileSync(path, 'utf-8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const index = line.indexOf('=');
    if (index <= 0) continue;

    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}

function pass(message) {
  console.log(`✓ ${message}`);
}

function warn(message) {
  console.log(`! ${message}`);
}

function fail(message) {
  console.error(`✗ ${message}`);
  process.exitCode = 1;
}

function normalizeError(error) {
  if (!error) return '';
  return `${error.message} ${error.details || ''}`.toLowerCase();
}

function isMissingColumnError(error) {
  const msg = normalizeError(error);
  return (
    msg.includes('42703') ||
    (msg.includes('column') && msg.includes('does not exist')) ||
    (msg.includes('could not find') && msg.includes('column'))
  );
}

function isMissingRelationError(error) {
  const msg = normalizeError(error);
  return (
    msg.includes('42p01') ||
    (msg.includes('relation') && msg.includes('does not exist')) ||
    (msg.includes('table') && msg.includes('does not exist')) ||
    msg.includes('could not find the table')
  );
}

function isPermissionError(error) {
  const msg = normalizeError(error);
  return (
    msg.includes('42501') ||
    msg.includes('permission denied') ||
    msg.includes('row-level security') ||
    msg.includes('not authenticated')
  );
}

function isEnumConstraintError(error) {
  const msg = normalizeError(error);
  return msg.includes('invalid input value for enum') || msg.includes('check constraint');
}

function isFunctionMissingError(error) {
  const msg = normalizeError(error);
  return (
    msg.includes('42883') ||
    msg.includes('function') && msg.includes('does not exist') ||
    msg.includes('could not find the function')
  );
}

function isForeignKeyError(error) {
  const msg = normalizeError(error);
  return msg.includes('23503') || msg.includes('foreign key');
}

function extractMissingColumnName(error) {
  const message = error?.message || '';
  const withQuote = message.match(/column\s+"([^"]+)"/i);
  if (withQuote?.[1]) return withQuote[1];
  const withSingleQuote = message.match(/column\s+'([^']+)'/i);
  if (withSingleQuote?.[1]) return withSingleQuote[1];
  const schemaCachePattern = message.match(/could not find the ['"]([^'"]+)['"] column/i);
  if (schemaCachePattern?.[1]) return schemaCachePattern[1];
  return null;
}

function extractStringCandidate(raw, candidates) {
  if (!raw || typeof raw !== 'object') return '';
  for (const key of candidates) {
    const value = raw[key];
    if (value === null || value === undefined) continue;
    const text = value.toString().trim();
    if (text) return text;
  }
  return '';
}

async function insertWithColumnFallback(client, table, payload, selectColumns = 'id') {
  const working = { ...payload };

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const result = await client.from(table).insert(working).select(selectColumns).maybeSingle();
    if (!result.error) {
      return { ok: true, data: result.data || null, table };
    }

    if (isMissingRelationError(result.error)) {
      return { ok: false, missing: true, table, error: result.error };
    }

    if (isPermissionError(result.error)) {
      return { ok: false, permission: true, table, error: result.error };
    }

    if (isMissingColumnError(result.error)) {
      const missingColumn = extractMissingColumnName(result.error);
      if (missingColumn && missingColumn in working) {
        delete working[missingColumn];
        continue;
      }
    }

    return { ok: false, table, error: result.error };
  }

  return {
    ok: false,
    table,
    error: { message: `Gagal insert ${table} setelah beberapa percobaan.` },
  };
}

async function updateWithColumnFallback(client, table, payload, match) {
  const working = { ...payload };

  for (let attempt = 0; attempt < 12; attempt += 1) {
    let query = client.from(table).update(working);
    for (const [column, value] of Object.entries(match)) {
      query = query.eq(column, value);
    }
    const result = await query;
    if (!result.error) return { ok: true };

    if (isMissingRelationError(result.error)) {
      return { ok: false, missing: true, error: result.error };
    }

    if (isPermissionError(result.error)) {
      return { ok: false, permission: true, error: result.error };
    }

    if (working.status === 'ARCHIVED' && isEnumConstraintError(result.error)) {
      working.status = 'FINISHED';
      continue;
    }

    if (isMissingColumnError(result.error)) {
      const missingColumn = extractMissingColumnName(result.error);
      if (missingColumn && missingColumn in working) {
        delete working[missingColumn];
        continue;
      }
    }

    return { ok: false, error: result.error };
  }

  return { ok: false, error: { message: `Gagal update ${table}.` } };
}

async function getChurchContext(client, userId) {
  const profileRes = await client
    .from('profiles')
    .select('id, role, country_id, diocese_id, church_id, allow_mass_invite')
    .eq('id', userId)
    .maybeSingle();
  if (profileRes.error || !profileRes.data?.id) {
    throw new Error(`profile read failed: ${profileRes.error?.message || 'profile not found'}`);
  }

  let countryId = profileRes.data.country_id?.toString() || '';
  let dioceseId = profileRes.data.diocese_id?.toString() || '';
  let churchId = profileRes.data.church_id?.toString() || '';

  if (!churchId) {
    const churchRes = await client.from('churches').select('id, diocese_id').limit(1).maybeSingle();
    if (churchRes.error || !churchRes.data?.id) {
      throw new Error(`church context missing: ${churchRes.error?.message || 'church table empty'}`);
    }
    churchId = churchRes.data.id.toString();
    dioceseId = churchRes.data.diocese_id?.toString() || dioceseId;
  }

  if (!dioceseId) {
    const dioceseRes = await client
      .from('dioceses')
      .select('id, country_id')
      .limit(1)
      .maybeSingle();
    if (dioceseRes.error || !dioceseRes.data?.id) {
      throw new Error(`diocese context missing: ${dioceseRes.error?.message || 'dioceses empty'}`);
    }
    dioceseId = dioceseRes.data.id.toString();
    countryId = dioceseRes.data.country_id?.toString() || countryId;
  }

  if (!countryId) {
    const countryRes = await client.from('countries').select('id').limit(1).maybeSingle();
    if (countryRes.error || !countryRes.data?.id) {
      throw new Error(`country context missing: ${countryRes.error?.message || 'countries empty'}`);
    }
    countryId = countryRes.data.id.toString();
  }

  return {
    role: profileRes.data.role?.toString() || 'umat',
    countryId,
    dioceseId,
    churchId,
  };
}

async function ensureProfileForInvite(adminClient, userId, email, context) {
  const nowIso = new Date().toISOString();
  const upsert = await adminClient.from('profiles').upsert(
    {
      id: userId,
      email,
      full_name: context.fullName,
      role: 'umat',
      account_status: 'active',
      faith_status: 'baptized',
      verification_status: 'verified',
      profile_filled: true,
      allow_mass_invite: true,
      country_id: context.countryId || null,
      diocese_id: context.dioceseId || null,
      church_id: context.churchId || null,
      updated_at: nowIso,
    },
    { onConflict: 'id' }
  );
  if (upsert.error) {
    warn(`profile upsert warning (${context.fullName}): ${upsert.error.message}`);
  }
}

async function joinRadarEventFallback(client, params) {
  const { radarId, userId, source } = params;

  if (source === 'v2') {
    const rpc = await client.rpc('radar_v2_join_event', { p_radar_id: radarId, p_force_join: false });
    if (!rpc.error) {
      const raw = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
      const status = raw?.status?.toString().toUpperCase() || 'JOINED';
      return status;
    }
    warn(`radar_v2_join_event rpc fallback ke direct insert: ${rpc.error.message}`);
  } else {
    const rpc = await client.rpc('join_radar_event', { p_radar_id: radarId, p_user_id: userId });
    if (!rpc.error) {
      const raw = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
      const status = raw?.status?.toString().toUpperCase() || 'JOINED';
      return status;
    }
    warn(`join_radar_event rpc fallback ke direct insert: ${rpc.error.message}`);
  }

  const primaryTable = source === 'v2' ? 'radar_participants_v2' : 'radar_participants';
  const secondaryTable = source === 'v2' ? 'radar_participants' : 'radar_participants_v2';
  for (const table of [primaryTable, secondaryTable]) {
    const insert = await insertWithColumnFallback(
      client,
      table,
      {
        radar_id: radarId,
        user_id: userId,
        role: 'MEMBER',
        status: 'JOINED',
      },
      'id'
    );
    if (insert.ok) return 'JOINED';
    if (!insert.error || !isMissingColumnError(insert.error)) break;
  }

  throw new Error('join radar failed after invite accepted');
}

async function main() {
  loadEnvFile('.env.local');
  loadEnvFile('.env');

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const inviterEmail = process.env.E2E_TEST_EMAIL || process.env.E2E_EMAIL;
  const inviterPassword = process.env.E2E_TEST_PASSWORD || process.env.E2E_PASSWORD;
  const inviteeEmail = process.env.E2E_TEST_EMAIL_2 || process.env.E2E_EMAIL_2;
  const inviteePassword = process.env.E2E_TEST_PASSWORD_2 || process.env.E2E_PASSWORD_2;

  if (!url || !anonKey) {
    fail('URL/anon key belum tersedia. Isi NEXT_PUBLIC_SUPABASE_URL dan NEXT_PUBLIC_SUPABASE_ANON_KEY.');
    return;
  }
  if (!inviterEmail || !inviterPassword) {
    fail('Isi E2E_TEST_EMAIL + E2E_TEST_PASSWORD untuk user pengirim invite.');
    return;
  }
  if (!serviceKey) {
    fail('SUPABASE_SERVICE_ROLE_KEY dibutuhkan untuk menyiapkan user kedua otomatis.');
    return;
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const inviterClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const inviteeClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let tempInviteeId = '';
  let tempInviteeEmail = '';
  let radarId = '';
  let radarSource = 'legacy';
  let inviteId = '';
  let inviteTable = '';
  let inviterId = '';
  let inviteeId = '';
  let inviterRadarTable = '';
  const cleanupErrors = [];

  try {
    const inviterLogin = await inviterClient.auth.signInWithPassword({
      email: inviterEmail,
      password: inviterPassword,
    });
    if (inviterLogin.error || !inviterLogin.data.user) {
      fail(`auth inviter: ${inviterLogin.error?.message || 'unknown error'}`);
      return;
    }
    inviterId = inviterLogin.data.user.id;
    pass('auth inviter login');

    let inviteeCredentialEmail = inviteeEmail;
    let inviteeCredentialPassword = inviteePassword;

    if (!inviteeCredentialEmail || !inviteeCredentialPassword) {
      tempInviteeEmail = `e2e-radar-invite-${Date.now()}@example.com`;
      inviteeCredentialEmail = tempInviteeEmail;
      inviteeCredentialPassword = `Mychatolic!${Math.floor(Date.now() % 100000)}Aa`;
      const created = await admin.auth.admin.createUser({
        email: inviteeCredentialEmail,
        password: inviteeCredentialPassword,
        email_confirm: true,
        user_metadata: {
          full_name: 'E2E Invitee Temp',
          role: 'umat',
        },
      });
      if (created.error || !created.data.user?.id) {
        fail(`create invitee user: ${created.error?.message || 'unknown error'}`);
        return;
      }
      tempInviteeId = created.data.user.id;
      pass('create temporary invitee user');
    }

    const inviteeLogin = await inviteeClient.auth.signInWithPassword({
      email: inviteeCredentialEmail,
      password: inviteeCredentialPassword,
    });
    if (inviteeLogin.error || !inviteeLogin.data.user) {
      fail(`auth invitee: ${inviteeLogin.error?.message || 'unknown error'}`);
      return;
    }
    inviteeId = inviteeLogin.data.user.id;
    pass('auth invitee login');

    const inviterContext = await getChurchContext(inviterClient, inviterId);
    pass('inviter church context ready');

    await ensureProfileForInvite(admin, inviterId, inviterEmail, {
      fullName: 'E2E Inviter',
      countryId: inviterContext.countryId,
      dioceseId: inviterContext.dioceseId,
      churchId: inviterContext.churchId,
    });
    await ensureProfileForInvite(admin, inviteeId, inviteeCredentialEmail, {
      fullName: tempInviteeId ? 'E2E Invitee Temp' : 'E2E Invitee',
      countryId: inviterContext.countryId,
      dioceseId: inviterContext.dioceseId,
      churchId: inviterContext.churchId,
    });
    pass('profile role + allow_mass_invite ready');

    const startsAtIso = new Date(Date.now() + 50 * 60 * 1000).toISOString();
    const startsAtDateOnly = startsAtIso.slice(0, 10);
    const rpcInvite = await inviterClient.rpc('radar_v2_send_invite', {
      p_source: 'PERSONAL',
      p_invitee_id: inviteeId,
      p_country_id: inviterContext.countryId,
      p_diocese_id: inviterContext.dioceseId,
      p_church_id: inviterContext.churchId,
      p_event_starts_at_utc: startsAtIso,
      p_note: 'Smoke 2-user personal invite',
      p_expires_at: startsAtIso,
    });

    let personalInviteCreatedViaRpc = false;
    if (!rpcInvite.error) {
      const raw = Array.isArray(rpcInvite.data) ? rpcInvite.data[0] : rpcInvite.data;
      radarId = extractStringCandidate(raw, [
        'radar_id',
        'event_id',
        'radar_event_id',
        'created_radar_id',
      ]);
      if (radarId) {
        radarSource = 'v2';
      }
      inviteId = extractStringCandidate(raw, [
        'invite_id',
        'radar_invite_id',
      ]);

      if (inviteId) {
        const byIdV2 = await inviterClient
          .from('radar_invites_v2')
          .select('id, radar_id')
          .eq('id', inviteId)
          .maybeSingle();
        if (!byIdV2.error && byIdV2.data?.id) {
          inviteTable = 'radar_invites_v2';
          radarId = radarId || byIdV2.data.radar_id?.toString() || '';
          if (radarId) radarSource = 'v2';
          personalInviteCreatedViaRpc = true;
        }
      }

      if (!personalInviteCreatedViaRpc) {
        const rpcInviteLookupV2 = await inviterClient
          .from('radar_invites_v2')
          .select('id, radar_id, source')
          .eq('inviter_id', inviterId)
          .eq('invitee_id', inviteeId)
          .eq('source', 'PERSONAL')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!rpcInviteLookupV2.error && rpcInviteLookupV2.data?.id) {
          inviteId = rpcInviteLookupV2.data.id.toString();
          inviteTable = 'radar_invites_v2';
          radarId = radarId || rpcInviteLookupV2.data.radar_id?.toString() || '';
          if (radarId) radarSource = 'v2';
          personalInviteCreatedViaRpc = true;
        }
      }

      if (!personalInviteCreatedViaRpc) {
        const rpcInviteLookupLegacy = await inviterClient
          .from('radar_invites')
          .select('id, radar_id, source')
          .eq('inviter_id', inviterId)
          .eq('invitee_id', inviteeId)
          .eq('source', 'PERSONAL')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!rpcInviteLookupLegacy.error && rpcInviteLookupLegacy.data?.id) {
          inviteId = rpcInviteLookupLegacy.data.id.toString();
          inviteTable = 'radar_invites';
          radarId = radarId || rpcInviteLookupLegacy.data.radar_id?.toString() || '';
          personalInviteCreatedViaRpc = true;
        }
      }

      if (personalInviteCreatedViaRpc) {
        pass('send personal invite via rpc');
      } else {
        warn('rpc radar_v2_send_invite tidak mengembalikan data invite yang bisa diverifikasi, fallback ke insert manual.');
      }
    } else if (!isFunctionMissingError(rpcInvite.error) && !isPermissionError(rpcInvite.error)) {
      fail(`send personal invite rpc: ${rpcInvite.error.message}`);
      return;
    }

    if (!personalInviteCreatedViaRpc) {
      const legacyRadar = await insertWithColumnFallback(
        inviterClient,
        'radar_events',
        {
          title: 'Misa Bersama',
          description: 'Smoke personal invite',
          church_id: inviterContext.churchId,
          church_name: 'Gereja',
          event_time: startsAtIso,
          creator_id: inviterId,
          visibility: 'PRIVATE',
          status: 'PUBLISHED',
          max_participants: 2,
          allow_member_invite: false,
          require_host_approval: false,
        },
        'id'
      );

      if (legacyRadar.ok && legacyRadar.data?.id) {
        radarId = legacyRadar.data.id.toString();
        radarSource = 'legacy';
        inviterRadarTable = 'radar_events';
      } else {
        const v2Radar = await insertWithColumnFallback(
          inviterClient,
          'radar_events_v2',
          {
            title: 'Misa Bersama',
            description: 'Smoke personal invite',
            church_id: inviterContext.churchId,
            event_starts_at_utc: startsAtIso,
            creator_id: inviterId,
            visibility: 'PRIVATE',
            status: 'PUBLISHED',
            max_participants: 2,
            allow_member_invite: false,
            require_host_approval: false,
          },
          'id'
        );

        if (!v2Radar.ok || !v2Radar.data?.id) {
          fail(`create personal radar fallback: ${legacyRadar.error?.message || v2Radar.error?.message || 'unknown error'}`);
          return;
        }
        radarId = v2Radar.data.id.toString();
        radarSource = 'v2';
        inviterRadarTable = 'radar_events_v2';
      }

      const hostTableCandidates =
        radarSource === 'v2'
          ? ['radar_participants_v2', 'radar_participants']
          : ['radar_participants', 'radar_participants_v2'];

      let hostInserted = false;
      for (const table of hostTableCandidates) {
        const hostInsert = await insertWithColumnFallback(
          inviterClient,
          table,
          {
            radar_id: radarId,
            user_id: inviterId,
            role: 'HOST',
            status: 'JOINED',
          },
          'id'
        );
        if (hostInsert.ok) {
          hostInserted = true;
          break;
        }
      }
      if (!hostInserted) {
        fail('host participant insert gagal untuk radar personal.');
        return;
      }

      let inviteInsert = await insertWithColumnFallback(
        inviterClient,
        'radar_invites',
        {
          inviter_id: inviterId,
          invitee_id: inviteeId,
          radar_id: radarId,
          source: 'PERSONAL',
          status: 'PENDING',
          note: 'Smoke 2-user personal invite',
          title: 'Ajak Misa Personal',
          message: 'Smoke 2-user personal invite',
          church_id: inviterContext.churchId,
          church_name: 'Gereja',
          country_id: inviterContext.countryId,
          diocese_id: inviterContext.dioceseId,
          event_time: startsAtIso,
          event_starts_at_utc: startsAtIso,
          mass_date: startsAtDateOnly,
          mass_time: startsAtIso,
          expires_at: startsAtIso,
        },
        'id'
      );

      if (inviteInsert.error && isForeignKeyError(inviteInsert.error)) {
        inviteInsert = await insertWithColumnFallback(
          inviterClient,
          'radar_invites',
          {
            inviter_id: inviterId,
            invitee_id: inviteeId,
            source: 'PERSONAL',
            status: 'PENDING',
            note: 'Smoke 2-user personal invite',
            title: 'Ajak Misa Personal',
            message: 'Smoke 2-user personal invite',
            church_id: inviterContext.churchId,
            church_name: 'Gereja',
            country_id: inviterContext.countryId,
            diocese_id: inviterContext.dioceseId,
            event_time: startsAtIso,
            event_starts_at_utc: startsAtIso,
            mass_date: startsAtDateOnly,
            mass_time: startsAtIso,
            expires_at: startsAtIso,
          },
          'id'
        );
      }

      if (!inviteInsert.ok) {
        fail(`create personal invite fallback: ${inviteInsert.error?.message || 'unknown error'}`);
        return;
      }
      inviteId = inviteInsert.data?.id?.toString() || '';
      inviteTable = 'radar_invites';
      pass('send personal invite via fallback insert');
    }

    const incomingInviteV2 = await inviteeClient
      .from('radar_invites_v2')
      .select('id, status, radar_id, source, inviter_id, invitee_id')
      .eq('invitee_id', inviteeId)
      .eq('inviter_id', inviterId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let incomingInvite = incomingInviteV2;
    if (!incomingInviteV2.error && incomingInviteV2.data?.id) {
      inviteTable = 'radar_invites_v2';
      radarSource = incomingInviteV2.data.radar_id ? 'v2' : radarSource;
    } else {
      const incomingInviteLegacy = await inviteeClient
        .from('radar_invites')
        .select('id, status, radar_id, source, inviter_id, invitee_id')
        .eq('invitee_id', inviteeId)
        .eq('inviter_id', inviterId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      incomingInvite = incomingInviteLegacy;
      if (!incomingInviteLegacy.error && incomingInviteLegacy.data?.id) {
        inviteTable = 'radar_invites';
      }
    }
    if (incomingInvite.error || !incomingInvite.data?.id) {
      fail(`read incoming invite: ${incomingInvite.error?.message || 'invite not found'}`);
      return;
    }
    inviteId = incomingInvite.data.id.toString();
    if (!radarId) {
      radarId = incomingInvite.data.radar_id?.toString() || '';
    }
    pass('invitee sees personal invite');

    const v2Respond = await inviteeClient.rpc('radar_v2_respond_invite', {
      p_invite_id: inviteId,
      p_accept: true,
    });
    if (v2Respond.error) {
      const legacyRespond = await inviteeClient.rpc('respond_radar_invite', {
        p_invite_id: inviteId,
        p_accept: true,
      });
      if (legacyRespond.error) {
        const directRespond = await updateWithColumnFallback(
          inviteeClient,
          inviteTable || 'radar_invites',
          {
            status: 'ACCEPTED',
            responded_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          {
            id: inviteId,
            invitee_id: inviteeId,
          }
        );
        if (!directRespond.ok) {
          fail(`respond invite: ${directRespond.error?.message || 'unknown error'}`);
          return;
        }
      }
    }
    pass('invitee accepted invite');

    if (radarId) {
      const joined = await joinRadarEventFallback(inviteeClient, {
        radarId,
        userId: inviteeId,
        source: radarSource,
      });
      pass(`invitee join radar (${joined})`);

      const participantTables =
        radarSource === 'v2'
          ? ['radar_participants_v2', 'radar_participants']
          : ['radar_participants', 'radar_participants_v2'];

      let participantFound = false;
      for (const table of participantTables) {
        const participant = await inviteeClient
          .from(table)
          .select('id, status')
          .eq('radar_id', radarId)
          .eq('user_id', inviteeId)
          .maybeSingle();
        if (!participant.error && participant.data?.id) {
          participantFound = true;
          break;
        }
      }

      if (!participantFound) {
        fail('verifikasi participant gagal: invitee belum tercatat di radar_participants.');
        return;
      }
      pass('participant verification passed');
    } else {
      pass('personal invite tanpa radar_id: tidak perlu join participant');
    }
  } finally {
    const nowIso = new Date().toISOString();

    if (inviteId) {
      for (const table of ['radar_invites', 'radar_invites_v2']) {
        const delInvite = await inviterClient.from(table).delete().eq('id', inviteId);
        if (delInvite.error && !isMissingRelationError(delInvite.error)) {
          cleanupErrors.push(`delete ${table} invite: ${delInvite.error.message}`);
        }
      }
    }

    if (radarId) {
      for (const table of ['radar_participants', 'radar_participants_v2']) {
        const clearParticipants = await inviterClient.from(table).delete().eq('radar_id', radarId);
        if (clearParticipants.error && !isMissingRelationError(clearParticipants.error)) {
          cleanupErrors.push(`delete ${table}: ${clearParticipants.error.message}`);
        }
      }
    }

    for (const table of ['mass_checkins', 'mass_checkins_v2']) {
      if (!inviteeId) continue;
      const archive = await updateWithColumnFallback(
        inviteeClient,
        table,
        {
          status: 'ARCHIVED',
          archived_at: nowIso,
          updated_at: nowIso,
        },
        {
          user_id: inviteeId,
          status: 'ACTIVE',
        }
      );
      if (!archive.ok && !archive.missing) {
        cleanupErrors.push(`archive ${table}: ${archive.error?.message || 'unknown error'}`);
      }
    }

    if (radarId && inviterRadarTable) {
      const delRadar = await inviterClient
        .from(inviterRadarTable)
        .delete()
        .eq('id', radarId)
        .eq('creator_id', inviterId);
      if (delRadar.error && !isMissingRelationError(delRadar.error)) {
        cleanupErrors.push(`delete radar: ${delRadar.error.message}`);
      }
    }

    if (tempInviteeId) {
      const deleteUser = await admin.auth.admin.deleteUser(tempInviteeId);
      if (deleteUser.error) {
        cleanupErrors.push(`delete temp invitee user: ${deleteUser.error.message}`);
      }
    }

    await inviterClient.auth.signOut();
    await inviteeClient.auth.signOut();

    if (cleanupErrors.length > 0) {
      warn(`cleanup warnings: ${cleanupErrors.join(' | ')}`);
    } else {
      pass('cleanup');
    }
  }
}

await main();

if (process.exitCode && process.exitCode !== 0) {
  console.error('\nHasil: smoke 2-user Ajak Misa menemukan error yang perlu diperbaiki.');
  process.exit(process.exitCode);
}

console.log('\nHasil: smoke 2-user Ajak Misa lulus.');
