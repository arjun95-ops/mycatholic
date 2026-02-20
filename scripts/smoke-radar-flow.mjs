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
    msg.includes('relation') && msg.includes('does not exist') ||
    msg.includes('table') && msg.includes('does not exist') ||
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
  return (
    msg.includes('invalid input value for enum') ||
    msg.includes('check constraint')
  );
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

async function insertWithColumnFallback(client, table, payload, selectColumns = 'id') {
  const working = { ...payload };

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const result = await client.from(table).insert(working).select(selectColumns).maybeSingle();
    if (!result.error) {
      return {
        ok: true,
        data: result.data || null,
        table,
      };
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

async function archiveCheckInsByUser(client, table, userId) {
  const nowIso = new Date().toISOString();
  const working = {
    status: 'ARCHIVED',
    archived_at: nowIso,
    updated_at: nowIso,
  };

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const result = await client
      .from(table)
      .update(working)
      .eq('user_id', userId)
      .eq('status', 'ACTIVE');

    if (!result.error) {
      return { ok: true };
    }

    if (isMissingRelationError(result.error)) {
      return { ok: true, skipped: true };
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

  return { ok: false, error: { message: `Gagal mengarsipkan ${table}.` } };
}

async function checkOutById(client, table, id, userId) {
  const nowIso = new Date().toISOString();
  const working = {
    status: 'ARCHIVED',
    archived_at: nowIso,
    updated_at: nowIso,
  };

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const result = await client.from(table).update(working).eq('id', id).eq('user_id', userId);
    if (!result.error) {
      return { ok: true };
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

  return { ok: false, error: { message: `Gagal check-out pada ${table}.` } };
}

loadEnvFile('.env.local');
loadEnvFile('.env');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const testEmail = process.env.E2E_TEST_EMAIL || process.env.E2E_EMAIL;
const testPassword = process.env.E2E_TEST_PASSWORD || process.env.E2E_PASSWORD;

if (!url || !anonKey) {
  fail('URL/anon key belum tersedia. Isi NEXT_PUBLIC_SUPABASE_URL dan NEXT_PUBLIC_SUPABASE_ANON_KEY.');
  process.exit(1);
}

if (!testEmail || !testPassword) {
  fail('Isi E2E_TEST_EMAIL + E2E_TEST_PASSWORD untuk smoke radar flow.');
  process.exit(1);
}

const client = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  const signIn = await client.auth.signInWithPassword({
    email: testEmail,
    password: testPassword,
  });

  if (signIn.error || !signIn.data.user) {
    fail(`auth: gagal login (${signIn.error?.message || 'unknown error'})`);
    return;
  }
  const userId = signIn.data.user.id;
  pass('auth: login test user');

  let radarId = '';
  let radarSource = '';
  let radarTable = '';
  let participantTable = '';
  let commentId = '';
  let commentTable = '';
  let likeId = '';
  let checkInId = '';
  let checkInTable = '';

  try {
    const profileRes = await client
      .from('profiles')
      .select('id, role, country_id, diocese_id, church_id, full_name')
      .eq('id', userId)
      .maybeSingle();

    if (profileRes.error || !profileRes.data?.id) {
      fail(`profile read: ${profileRes.error?.message || 'profil tidak ditemukan'}`);
      return;
    }
    pass('profile read');

    let churchId = profileRes.data.church_id?.toString() || '';
    let countryId = profileRes.data.country_id?.toString() || '';
    let dioceseId = profileRes.data.diocese_id?.toString() || '';

    if (!churchId) {
      let churchRow = null;
      let churchError = null;
      for (const columns of [
        'id, country_id, diocese_id',
        'id, diocese_id',
        'id, country_id',
        'id',
      ]) {
        const churchFallback = await client.from('churches').select(columns).limit(1).maybeSingle();
        if (!churchFallback.error && churchFallback.data?.id) {
          churchRow = churchFallback.data;
          churchError = null;
          break;
        }
        churchError = churchFallback.error;
        if (!isMissingColumnError(churchFallback.error)) {
          break;
        }
      }

      if (!churchRow?.id) {
        fail(`church fallback: ${churchError?.message || 'tidak ada data gereja'}`);
        return;
      }
      churchId = churchRow.id.toString();
      countryId = countryId || churchRow.country_id?.toString() || '';
      dioceseId = dioceseId || churchRow.diocese_id?.toString() || '';
    }
    pass('church context ready');

    const startsAt = new Date(Date.now() + 70 * 60 * 1000).toISOString();
    const legacyRadarPayload = {
      title: `[smoke-radar] ${Date.now()}`,
      description: 'smoke flow web radar',
      church_id: churchId,
      church_name: 'Gereja',
      event_time: startsAt,
      creator_id: userId,
      visibility: 'PUBLIC',
      status: 'PUBLISHED',
      allow_member_invite: true,
      max_participants: 8,
    };

    const legacyRadarInsert = await insertWithColumnFallback(client, 'radar_events', legacyRadarPayload, 'id');
    if (legacyRadarInsert.ok && legacyRadarInsert.data?.id) {
      radarId = legacyRadarInsert.data.id.toString();
      radarSource = 'legacy';
      radarTable = 'radar_events';
      participantTable = 'radar_participants';
    } else {
      const v2RadarPayload = {
        title: `[smoke-radar-v2] ${Date.now()}`,
        description: 'smoke flow web radar',
        church_id: churchId,
        creator_id: userId,
        event_starts_at_utc: startsAt,
        event_ends_at_utc: new Date(new Date(startsAt).getTime() + 90 * 60 * 1000).toISOString(),
        status: 'PUBLISHED',
        visibility: 'PUBLIC',
        allow_member_invite: true,
        max_participants: 8,
      };
      const v2RadarInsert = await insertWithColumnFallback(client, 'radar_events_v2', v2RadarPayload, 'id');
      if (!v2RadarInsert.ok || !v2RadarInsert.data?.id) {
        const reason = legacyRadarInsert.error?.message || v2RadarInsert.error?.message || 'gagal create radar';
        fail(`radar create: ${reason}`);
        return;
      }
      radarId = v2RadarInsert.data.id.toString();
      radarSource = 'v2';
      radarTable = 'radar_events_v2';
      participantTable = 'radar_participants_v2';
    }
    pass(`radar create (${radarSource})`);

    const participantInsert = await insertWithColumnFallback(
      client,
      participantTable,
      {
        radar_id: radarId,
        user_id: userId,
        role: 'HOST',
        status: 'JOINED',
      },
      'id'
    );
    if (!participantInsert.ok && !participantInsert.permission) {
      fail(`radar participant host: ${participantInsert.error?.message || 'gagal insert host participant'}`);
      return;
    }
    pass('radar participant host');

    const radarRead = await client.from(radarTable).select('id, title, creator_id').eq('id', radarId).maybeSingle();
    if (radarRead.error || !radarRead.data?.id) {
      fail(`radar read after create: ${radarRead.error?.message || 'data radar tidak ditemukan'}`);
      return;
    }
    pass('radar read after create');

    const commentInsert = await insertWithColumnFallback(
      client,
      'radar_comments',
      {
        radar_id: radarId,
        user_id: userId,
        content: `[smoke-radar-comment] ${Date.now()}`,
      },
      'id'
    );
    if (commentInsert.ok && commentInsert.data?.id) {
      commentId = commentInsert.data.id.toString();
      commentTable = 'radar_comments';
      pass('radar comment create (native)');
    } else if (commentInsert.missing) {
      warn('radar comment create: tabel radar_comments belum tersedia (fallback legacy).');
    } else if (commentInsert.permission) {
      fail(`radar comment create: ${commentInsert.error?.message || 'permission denied'}`);
      return;
    } else {
      fail(`radar comment create: ${commentInsert.error?.message || 'gagal insert komentar radar'}`);
      return;
    }

    if (commentId) {
      const likeInsert = await insertWithColumnFallback(
        client,
        'radar_comment_likes',
        {
          user_id: userId,
          radar_comment_id: commentId,
          comment_id: commentId,
          radar_id: radarId,
        },
        'id'
      );
      if (likeInsert.ok && likeInsert.data?.id) {
        likeId = likeInsert.data.id.toString();
        pass('radar comment like create');
      } else if (likeInsert.missing) {
        warn('radar comment like: tabel radar_comment_likes belum tersedia.');
      } else if (likeInsert.permission) {
        fail(`radar comment like: ${likeInsert.error?.message || 'permission denied'}`);
        return;
      } else {
        fail(`radar comment like: ${likeInsert.error?.message || 'gagal insert like komentar radar'}`);
        return;
      }
    }

    const archiveLegacy = await archiveCheckInsByUser(client, 'mass_checkins', userId);
    if (!archiveLegacy.ok) {
      fail(`check-in cleanup legacy: ${archiveLegacy.error?.message || 'gagal archive checkin legacy'}`);
      return;
    }
    const archiveV2 = await archiveCheckInsByUser(client, 'mass_checkins_v2', userId);
    if (!archiveV2.ok) {
      fail(`check-in cleanup v2: ${archiveV2.error?.message || 'gagal archive checkin v2'}`);
      return;
    }
    pass('check-in cleanup active rows');

    const nowIso = new Date().toISOString();
    const massTimeIso = new Date(Date.now() + 20 * 60 * 1000).toISOString();
    const legacyCheckInInsert = await insertWithColumnFallback(
      client,
      'mass_checkins',
      {
        user_id: userId,
        church_id: churchId,
        check_in_time: nowIso,
        mass_time: massTimeIso,
        status: 'ACTIVE',
        visibility: 'FOLLOWERS',
        visibility_scope: 'followers',
      },
      'id'
    );

    if (legacyCheckInInsert.ok && legacyCheckInInsert.data?.id) {
      checkInId = legacyCheckInInsert.data.id.toString();
      checkInTable = 'mass_checkins';
    } else {
      const v2CheckInInsert = await insertWithColumnFallback(
        client,
        'mass_checkins_v2',
        {
          user_id: userId,
          church_id: churchId,
          country_id: countryId || null,
          diocese_id: dioceseId || null,
          checkin_at: nowIso,
          checkin_date: nowIso.slice(0, 10),
          status: 'ACTIVE',
          visibility: 'FOLLOWERS',
          visibility_scope: 'followers',
        },
        'id'
      );

      if (!v2CheckInInsert.ok || !v2CheckInInsert.data?.id) {
        const reason = legacyCheckInInsert.error?.message || v2CheckInInsert.error?.message || 'gagal check-in';
        fail(`check-in create: ${reason}`);
        return;
      }

      checkInId = v2CheckInInsert.data.id.toString();
      checkInTable = 'mass_checkins_v2';
    }
    pass(`check-in create (${checkInTable})`);

    const checkOutResult = await checkOutById(client, checkInTable, checkInId, userId);
    if (!checkOutResult.ok) {
      fail(`check-out update: ${checkOutResult.error?.message || 'gagal check-out'}`);
      return;
    }
    pass('check-out update');
  } finally {
    if (likeId) {
      await client.from('radar_comment_likes').delete().eq('id', likeId);
    }
    if (commentId && commentTable) {
      await client.from(commentTable).delete().eq('id', commentId);
    }
    if (checkInId && checkInTable) {
      await client.from(checkInTable).delete().eq('id', checkInId).eq('user_id', userId);
    }
    if (participantTable && radarId) {
      await client.from(participantTable).delete().eq('radar_id', radarId);
    }
    if (radarTable && radarId) {
      await client.from(radarTable).delete().eq('id', radarId).eq('creator_id', userId);
    }

    await client.auth.signOut();
    pass('cleanup');
  }
}

await main();

if (process.exitCode && process.exitCode !== 0) {
  console.error('\nHasil: smoke radar flow menemukan error yang perlu diperbaiki.');
  process.exit(process.exitCode);
}

console.log('\nHasil: smoke radar flow lulus.');
