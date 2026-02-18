'use client';

import { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { id as idLocale } from 'date-fns/locale';
import {
  ArrowLeft,
  Calendar,
  Loader2,
  LogOut,
  MapPin,
  MessageSquare,
  UserCheck2,
  UserX2,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/lib/features/auth/use-auth';
import { supabase } from '@/lib/supabase/client';
import { createRandomUUID } from '@/lib/utils';

type RadarSource = 'legacy' | 'v2';
type MembershipState = 'NONE' | 'PENDING' | 'JOINED';

type RadarDetailItem = {
  id: string;
  title: string;
  description?: string;
  startsAt?: string;
  maxParticipants?: number;
  participantCount: number;
  churchId?: string;
  churchName?: string;
  creatorId?: string;
  allowMemberInvite?: boolean;
  requireHostApproval?: boolean;
  status?: string;
  source: RadarSource;
};

type RadarParticipantItem = {
  id: string;
  userId: string;
  source: RadarSource;
  status: string;
  role?: string;
  createdAt?: string;
  joinedAt?: string;
  fullName?: string;
  username?: string;
  avatarUrl?: string;
};

function isMissingColumnError(message: string) {
  const lower = message.toLowerCase();
  return lower.includes('42703') || lower.includes('does not exist');
}

function isMissingRelationError(message: string) {
  const lower = message.toLowerCase();
  return lower.includes('42p01') || lower.includes('relation') && lower.includes('does not exist');
}

function isPermissionError(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes('42501') ||
    lower.includes('permission denied') ||
    lower.includes('row-level security')
  );
}

function isFunctionMissingError(message: string) {
  const lower = message.toLowerCase();
  return lower.includes('could not find the function') || lower.includes('does not exist');
}

function isNotAuthenticatedError(message: string) {
  return message.toLowerCase().includes('not authenticated');
}

function extractMissingColumnName(message: string): string | null {
  const withQuote = message.match(/column\s+"([^"]+)"/i);
  if (withQuote?.[1]) return withQuote[1];
  const withSingleQuote = message.match(/column\s+'([^']+)'/i);
  if (withSingleQuote?.[1]) return withSingleQuote[1];
  return null;
}

function normalizeMembershipStatus(value: unknown) {
  return value?.toString().trim().toUpperCase() || '';
}

function isJoinedMembershipStatus(status: string) {
  return ['JOINED', 'HOST', 'MEMBER', 'APPROVED'].includes(status);
}

function isPendingMembershipStatus(status: string) {
  return ['PENDING', 'REQUESTED', 'INVITED'].includes(status);
}

function formatDateTimeLabel(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return format(date, 'dd MMM yyyy HH:mm', { locale: idLocale });
}

function formatParticipantStatus(status: string) {
  const normalized = normalizeMembershipStatus(status);
  if (normalized === 'JOINED' || normalized === 'HOST' || normalized === 'MEMBER') return 'Bergabung';
  if (normalized === 'PENDING') return 'Menunggu';
  if (normalized === 'REJECTED') return 'Ditolak';
  if (normalized === 'LEFT') return 'Keluar';
  if (normalized === 'KICKED') return 'Dikeluarkan';
  return normalized || 'Tidak diketahui';
}

async function selectRadarEventWithFallback(
  table: 'radar_events' | 'radar_events_v2',
  radarId: string,
  columns: {
    primary: string;
    fallback?: string;
  }
) {
  const primaryResult = await supabase
    .from(table)
    .select(columns.primary)
    .eq('id', radarId)
    .maybeSingle();

  if (!primaryResult.error) {
    return {
      data: (primaryResult.data as Record<string, unknown> | null) ?? null,
      error: null as { message: string } | null,
    };
  }

  if (!isMissingColumnError(primaryResult.error.message) || !columns.fallback) {
    return {
      data: null,
      error: { message: primaryResult.error.message },
    };
  }

  const fallbackResult = await supabase
    .from(table)
    .select(columns.fallback)
    .eq('id', radarId)
    .maybeSingle();

  if (!fallbackResult.error) {
    return {
      data: (fallbackResult.data as Record<string, unknown> | null) ?? null,
      error: null as { message: string } | null,
    };
  }

  return {
    data: null,
    error: { message: fallbackResult.error.message },
  };
}

async function updateWithColumnFallback(
  table: string,
  payload: Record<string, unknown>,
  matchers: Record<string, unknown>
) {
  const working = { ...payload };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    let query = supabase.from(table).update(working);
    for (const [key, value] of Object.entries(matchers)) {
      query = query.eq(key, value);
    }
    const result = await query;

    if (!result.error) {
      return { error: null };
    }

    const missingColumn = extractMissingColumnName(result.error.message);
    if (missingColumn && missingColumn in working && isMissingColumnError(result.error.message)) {
      delete working[missingColumn];
      continue;
    }

    return { error: result.error };
  }

  return { error: { message: `Gagal update ${table}` } };
}

async function insertWithColumnFallback(
  table: string,
  payload: Record<string, unknown>,
  options?: { onConflict?: string }
) {
  const working = { ...payload };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const query = options?.onConflict
      ? supabase.from(table).upsert(working, { onConflict: options.onConflict })
      : supabase.from(table).insert(working);
    const result = await query;
    if (!result.error) {
      return { error: null };
    }

    const missingColumn = extractMissingColumnName(result.error.message);
    if (missingColumn && missingColumn in working && isMissingColumnError(result.error.message)) {
      delete working[missingColumn];
      continue;
    }

    return { error: result.error };
  }

  return { error: { message: `Gagal insert/upsert ${table}` } };
}

async function fetchProfileMap(userIds: string[]) {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  const map = new Map<string, { fullName?: string; username?: string; avatarUrl?: string }>();
  if (uniqueIds.length === 0) return map;

  const result = await supabase
    .from('profiles')
    .select('id, full_name, username, avatar_url')
    .in('id', uniqueIds);

  if (result.error) {
    return map;
  }

  for (const row of (result.data ?? []) as Record<string, unknown>[]) {
    const id = row.id?.toString();
    if (!id) continue;
    map.set(id, {
      fullName: row.full_name?.toString(),
      username: row.username?.toString(),
      avatarUrl: row.avatar_url?.toString(),
    });
  }

  return map;
}

async function fetchRadarParticipants(radarId: string): Promise<RadarParticipantItem[]> {
  const rows: RadarParticipantItem[] = [];

  for (const source of ['legacy', 'v2'] as const) {
    const table = source === 'v2' ? 'radar_participants_v2' : 'radar_participants';
    const withProfile = await supabase
      .from(table)
      .select(
        'id, radar_id, user_id, status, role, created_at, joined_at, profiles:user_id(id, full_name, username, avatar_url)'
      )
      .eq('radar_id', radarId)
      .order('created_at', { ascending: true });

    let data = withProfile.data as Record<string, unknown>[] | null;
    let resultError = withProfile.error;
    let includeProfile = true;

    if (resultError && isMissingColumnError(resultError.message)) {
      const fallback = await supabase
        .from(table)
        .select('id, radar_id, user_id, status, role, created_at')
        .eq('radar_id', radarId)
        .order('created_at', { ascending: true });
      data = fallback.data as Record<string, unknown>[] | null;
      resultError = fallback.error;
      includeProfile = false;
    }

    if (resultError) {
      if (!isPermissionError(resultError.message)) {
        console.error(`Error fetching participants from ${table}:`, resultError);
      }
      continue;
    }

    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const userId = row.user_id?.toString();
      if (!userId) continue;

      const profile = includeProfile && row.profiles && typeof row.profiles === 'object'
        ? (row.profiles as Record<string, unknown>)
        : null;
      const status = normalizeMembershipStatus(row.status) || 'JOINED';

      rows.push({
        id: row.id?.toString() || createRandomUUID(),
        userId,
        source,
        status,
        role: row.role?.toString(),
        createdAt: row.created_at?.toString(),
        joinedAt: row.joined_at?.toString() || row.created_at?.toString(),
        fullName: profile?.full_name?.toString(),
        username: profile?.username?.toString(),
        avatarUrl: profile?.avatar_url?.toString(),
      } satisfies RadarParticipantItem);
    }
  }

  const byUser = new Map<string, RadarParticipantItem>();
  const sourceRank: Record<RadarSource, number> = { legacy: 1, v2: 2 };
  for (const item of rows) {
    const existing = byUser.get(item.userId);
    if (!existing) {
      byUser.set(item.userId, item);
      continue;
    }

    const existingJoined = isJoinedMembershipStatus(existing.status);
    const currentJoined = isJoinedMembershipStatus(item.status);
    if (currentJoined && !existingJoined) {
      byUser.set(item.userId, item);
      continue;
    }
    if (!currentJoined && existingJoined) {
      continue;
    }
    if (sourceRank[item.source] > sourceRank[existing.source]) {
      byUser.set(item.userId, item);
      continue;
    }
    const existingTime = new Date(existing.createdAt || '').getTime();
    const currentTime = new Date(item.createdAt || '').getTime();
    if (!Number.isNaN(currentTime) && (Number.isNaN(existingTime) || currentTime > existingTime)) {
      byUser.set(item.userId, item);
    }
  }

  const deduped = Array.from(byUser.values());
  const missingProfileIds = deduped
    .filter((item) => !item.fullName && !item.username && !item.avatarUrl)
    .map((item) => item.userId);
  const fallbackProfiles = await fetchProfileMap(missingProfileIds);

  const resolved = deduped.map((item) => {
    const fallback = fallbackProfiles.get(item.userId);
    return {
      ...item,
      fullName: item.fullName || fallback?.fullName,
      username: item.username || fallback?.username,
      avatarUrl: item.avatarUrl || fallback?.avatarUrl,
    };
  });

  const roleRank = (role?: string) => {
    const normalized = role?.trim().toUpperCase();
    if (normalized === 'HOST') return 0;
    if (normalized === 'ADMIN') return 1;
    return 2;
  };
  const statusRank = (status: string) => {
    if (isJoinedMembershipStatus(status)) return 0;
    if (isPendingMembershipStatus(status)) return 1;
    return 2;
  };

  resolved.sort((a, b) => {
    const roleDiff = roleRank(a.role) - roleRank(b.role);
    if (roleDiff !== 0) return roleDiff;

    const statusDiff = statusRank(a.status) - statusRank(b.status);
    if (statusDiff !== 0) return statusDiff;

    const aTime = new Date(a.createdAt || '').getTime();
    const bTime = new Date(b.createdAt || '').getTime();
    return aTime - bTime;
  });

  return resolved;
}

async function fetchRadarDetail(radarId: string): Promise<RadarDetailItem | null> {
  const legacy = await selectRadarEventWithFallback('radar_events', radarId, {
    primary:
      'id, title, description, event_time, max_participants, church_id, church_name, creator_id, allow_member_invite, require_host_approval, status',
    fallback:
      'id, title, description, event_time, max_participants, church_id, church_name, creator_id, allow_member_invite, status',
  });

  const v2 = await selectRadarEventWithFallback('radar_events_v2', radarId, {
    primary:
      'id, title, description, event_starts_at_utc, max_participants, church_id, church_name, creator_id, allow_member_invite, require_host_approval, status',
    fallback:
      'id, title, description, event_starts_at_utc, max_participants, church_id, church_name, creator_id, allow_member_invite, status',
  });

  let row: Record<string, unknown> | null = null;
  let source: RadarSource | null = null;
  if (!v2.error && v2.data?.id) {
    row = v2.data as Record<string, unknown>;
    source = 'v2';
  } else if (!legacy.error && legacy.data?.id) {
    row = legacy.data as Record<string, unknown>;
    source = 'legacy';
  }

  if (!row || !source) {
    return null;
  }

  const churchId = row.church_id?.toString() || '';
  let churchName = row.church_name?.toString() || '';
  if (!churchName && churchId) {
    const churchResult = await supabase
      .from('churches')
      .select('id, name')
      .eq('id', churchId)
      .maybeSingle();
    if (!churchResult.error && churchResult.data?.id) {
      churchName = churchResult.data.name?.toString() || '';
    }
  }

  const participants = await fetchRadarParticipants(radarId);
  const participantCount = participants.filter((item) => isJoinedMembershipStatus(item.status)).length;

  return {
    id: row.id?.toString() || radarId,
    title: row.title?.toString() || 'Radar Misa',
    description: row.description?.toString(),
    startsAt: row.event_starts_at_utc?.toString() || row.event_time?.toString(),
    maxParticipants: Number(row.max_participants ?? 0) || undefined,
    participantCount,
    churchId: churchId || undefined,
    churchName: churchName || undefined,
    creatorId: row.creator_id?.toString(),
    allowMemberInvite:
      typeof row.allow_member_invite === 'boolean' ? row.allow_member_invite : undefined,
    requireHostApproval:
      typeof row.require_host_approval === 'boolean' ? row.require_host_approval : undefined,
    status: row.status?.toString(),
    source,
  };
}

async function fetchMyMembershipStatus(userId?: string, radarId?: string): Promise<MembershipState> {
  if (!userId || !radarId) return 'NONE';

  const rows: Array<{ status: string; source: RadarSource }> = [];
  for (const source of ['legacy', 'v2'] as const) {
    const table = source === 'v2' ? 'radar_participants_v2' : 'radar_participants';
    const withRole = await supabase
      .from(table)
      .select('status, role')
      .eq('radar_id', radarId)
      .eq('user_id', userId)
      .maybeSingle();

    let data = withRole.data as Record<string, unknown> | null;
    let resultError = withRole.error;
    if (resultError && isMissingColumnError(resultError.message)) {
      const fallback = await supabase
        .from(table)
        .select('status')
        .eq('radar_id', radarId)
        .eq('user_id', userId)
        .maybeSingle();
      data = fallback.data as Record<string, unknown> | null;
      resultError = fallback.error;
    }

    if (resultError) {
      if (!isPermissionError(resultError.message) && !isMissingColumnError(resultError.message)) {
        console.error(`Error fetching my status from ${table}:`, resultError);
      }
      continue;
    }
    if (!data) continue;

    const status = normalizeMembershipStatus(data.status);
    const role = normalizeMembershipStatus(data.role);
    rows.push({
      status: role === 'HOST' && !status ? 'JOINED' : status || (role === 'HOST' ? 'JOINED' : 'JOINED'),
      source,
    });
  }

  if (rows.some((row) => isJoinedMembershipStatus(row.status))) return 'JOINED';
  if (rows.some((row) => isPendingMembershipStatus(row.status))) return 'PENDING';
  return 'NONE';
}

async function joinRadarEvent(params: {
  radarId: string;
  userId: string;
  source: RadarSource;
}) {
  const { radarId, userId, source } = params;

  if (source === 'v2') {
    const rpc = await supabase.rpc('radar_v2_join_event', {
      p_radar_id: radarId,
      p_force_join: false,
    });
    if (!rpc.error) {
      const raw = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
      const status = (raw as Record<string, unknown> | null)?.status?.toString().toUpperCase();
      return status === 'PENDING' ? 'PENDING' : 'JOINED';
    }
    if (
      !isFunctionMissingError(rpc.error.message) &&
      !isPermissionError(rpc.error.message) &&
      !isNotAuthenticatedError(rpc.error.message)
    ) {
      throw new Error(rpc.error.message);
    }
  } else {
    const rpc = await supabase.rpc('join_radar_event', {
      p_radar_id: radarId,
      p_user_id: userId,
    });
    if (!rpc.error) {
      const raw = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
      const status = (raw as Record<string, unknown> | null)?.status?.toString().toUpperCase();
      return status === 'PENDING' ? 'PENDING' : 'JOINED';
    }
    if (
      !isFunctionMissingError(rpc.error.message) &&
      !isPermissionError(rpc.error.message) &&
      !isNotAuthenticatedError(rpc.error.message)
    ) {
      throw new Error(rpc.error.message);
    }
  }

  const eventTable = source === 'v2' ? 'radar_events_v2' : 'radar_events';
  const policyWithApproval = await supabase
    .from(eventTable)
    .select('id, require_host_approval')
    .eq('id', radarId)
    .maybeSingle();
  let eventPolicy = policyWithApproval.data as Record<string, unknown> | null;
  let eventPolicyError = policyWithApproval.error;
  if (eventPolicyError && isMissingColumnError(eventPolicyError.message)) {
    const fallback = await supabase
      .from(eventTable)
      .select('id')
      .eq('id', radarId)
      .maybeSingle();
    eventPolicy = fallback.data as Record<string, unknown> | null;
    eventPolicyError = fallback.error;
  }
  if (eventPolicyError && !isPermissionError(eventPolicyError.message)) {
    throw new Error(eventPolicyError.message);
  }

  const status: 'JOINED' | 'PENDING' =
    eventPolicy?.require_host_approval === true ? 'PENDING' : 'JOINED';
  const participantTables =
    source === 'v2'
      ? (['radar_participants_v2', 'radar_participants'] as const)
      : (['radar_participants', 'radar_participants_v2'] as const);

  for (const table of participantTables) {
    const insertResult = await insertWithColumnFallback(table, {
      radar_id: radarId,
      user_id: userId,
      role: 'MEMBER',
      status,
    });
    if (!insertResult.error) {
      return status;
    }
  }

  throw new Error('Gagal bergabung ke radar.');
}

async function updateParticipantDecision(params: {
  radarId: string;
  targetUserId: string;
  actorId: string;
  source: RadarSource;
  approve: boolean;
}) {
  const { radarId, targetUserId, actorId, source, approve } = params;
  const eventTable = source === 'v2' ? 'radar_events_v2' : 'radar_events';
  const withChatRoom = await supabase
    .from(eventTable)
    .select('id, creator_id, chat_room_id')
    .eq('id', radarId)
    .maybeSingle();
  let eventRow = withChatRoom.data as Record<string, unknown> | null;
  let eventError = withChatRoom.error;
  if (eventError && isMissingColumnError(eventError.message)) {
    const fallback = await supabase
      .from(eventTable)
      .select('id, creator_id')
      .eq('id', radarId)
      .maybeSingle();
    eventRow = fallback.data as Record<string, unknown> | null;
    eventError = fallback.error;
  }

  if (eventError && !isPermissionError(eventError.message)) {
    throw new Error(eventError.message);
  }

  if (!eventRow?.id || eventRow.creator_id?.toString() !== actorId) {
    throw new Error('Hanya host yang boleh memproses peserta pending.');
  }

  const nextStatus = approve ? 'JOINED' : 'REJECTED';
  const nowIso = new Date().toISOString();
  const participantTables =
    source === 'v2'
      ? (['radar_participants_v2', 'radar_participants'] as const)
      : (['radar_participants', 'radar_participants_v2'] as const);

  let updated = false;
  let lastError = '';

  for (const table of participantTables) {
    const payload: Record<string, unknown> = approve
      ? {
          status: nextStatus,
          role: 'MEMBER',
          joined_at: nowIso,
          left_at: null,
          kicked_at: null,
        }
      : {
          status: nextStatus,
        };
    const result = await updateWithColumnFallback(
      table,
      payload,
      {
        radar_id: radarId,
        user_id: targetUserId,
        status: 'PENDING',
      }
    );

    if (!result.error) {
      updated = true;
      break;
    }
    lastError = result.error.message || '';
    if (
      !isMissingColumnError(lastError) &&
      !isMissingRelationError(lastError) &&
      !isPermissionError(lastError)
    ) {
      break;
    }
  }

  if (!updated) {
    throw new Error(lastError || 'Gagal memperbarui status peserta.');
  }

  if (approve) {
    if (source === 'v2') {
      const chatGroup = await supabase
        .from('radar_chat_groups_v2')
        .select('id')
        .eq('radar_id', radarId)
        .maybeSingle();
      const chatGroupId = chatGroup.data?.id?.toString();
      if (chatGroupId) {
        await insertWithColumnFallback(
          'radar_chat_members_v2',
          {
            chat_group_id: chatGroupId,
            user_id: targetUserId,
            role: 'MEMBER',
            status: 'JOINED',
            joined_at: nowIso,
          },
          { onConflict: 'chat_group_id, user_id' }
        );
      }
    } else {
      const chatRoomId = eventRow.chat_room_id?.toString();
      if (chatRoomId) {
        await insertWithColumnFallback(
          'chat_members',
          {
            chat_id: chatRoomId,
            user_id: targetUserId,
          },
          { onConflict: 'chat_id, user_id' }
        );
      }
    }
  }

  await insertWithColumnFallback('notifications', {
    user_id: targetUserId,
    type: approve ? 'radar_join_approved' : 'radar_join_rejected',
    title: approve ? 'Permintaan Join Disetujui' : 'Permintaan Join Ditolak',
    message: approve
      ? 'Host menyetujui permintaan Anda untuk bergabung ke radar.'
      : 'Host menolak permintaan Anda untuk bergabung ke radar.',
    sender_id: actorId,
    actor_id: actorId,
    data: {
      radar_id: radarId,
      status: nextStatus,
    },
  });
}

async function resolveRadarChatId(params: {
  radarId: string;
  source: RadarSource;
}): Promise<string | null> {
  const { radarId, source } = params;
  if (!radarId.trim()) return null;

  if (source === 'v2') {
    const detailRpc = await supabase.rpc('radar_v2_get_event_detail', {
      p_radar_id: radarId,
    });

    if (!detailRpc.error) {
      const raw = Array.isArray(detailRpc.data) ? detailRpc.data[0] : detailRpc.data;
      const row = (raw as Record<string, unknown> | null) ?? {};
      const chatGroupId =
        row.chat_group_id?.toString().trim() ||
        row.chat_room_id?.toString().trim() ||
        '';
      if (chatGroupId) return chatGroupId;
    } else if (
      !isFunctionMissingError(detailRpc.error.message) &&
      !isPermissionError(detailRpc.error.message) &&
      !isNotAuthenticatedError(detailRpc.error.message)
    ) {
      throw new Error(detailRpc.error.message);
    }

    const chatGroup = await supabase
      .from('radar_chat_groups_v2')
      .select('id')
      .eq('radar_id', radarId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (chatGroup.error) {
      if (
        isPermissionError(chatGroup.error.message) ||
        isMissingColumnError(chatGroup.error.message) ||
        isMissingRelationError(chatGroup.error.message)
      ) {
        return null;
      }
      throw new Error(chatGroup.error.message);
    }

    const chatGroupId = chatGroup.data?.id?.toString().trim();
    return chatGroupId || null;
  }

  const withChatRoom = await supabase
    .from('radar_events')
    .select('chat_room_id')
    .eq('id', radarId)
    .maybeSingle();
  let eventRow = withChatRoom.data as Record<string, unknown> | null;
  let eventError = withChatRoom.error;
  if (eventError && isMissingColumnError(eventError.message)) {
    const fallback = await supabase
      .from('radar_events')
      .select('id')
      .eq('id', radarId)
      .maybeSingle();
    eventRow = fallback.data as Record<string, unknown> | null;
    eventError = fallback.error;
  }
  if (eventError) {
    if (isPermissionError(eventError.message) || isMissingRelationError(eventError.message)) {
      return null;
    }
    throw new Error(eventError.message);
  }

  const chatRoomId = eventRow?.chat_room_id?.toString().trim();
  return chatRoomId || null;
}

async function ensureRadarChatReady(params: {
  radar: RadarDetailItem;
  userId: string;
  isHost: boolean;
}): Promise<string | null> {
  const { radar, userId, isHost } = params;
  const chatId = await resolveRadarChatId({ radarId: radar.id, source: radar.source });
  if (!chatId) return null;
  const nowIso = new Date().toISOString();

  if (radar.source === 'v2') {
    const bridge = await supabase.rpc('radar_v2_ensure_chat_bridge', {
      p_chat_group_id: chatId,
      p_user_id: userId,
    });
    if (
      bridge.error &&
      !isFunctionMissingError(bridge.error.message) &&
      !isPermissionError(bridge.error.message) &&
      !isNotAuthenticatedError(bridge.error.message)
    ) {
      throw new Error(bridge.error.message);
    }

    await insertWithColumnFallback(
      'radar_chat_members_v2',
      {
        chat_group_id: chatId,
        user_id: userId,
        role: isHost ? 'HOST' : 'MEMBER',
        status: 'JOINED',
        joined_at: nowIso,
      },
      { onConflict: 'chat_group_id, user_id' }
    );
  }

  const existingChat = await supabase
    .from('social_chats')
    .select('id')
    .eq('id', chatId)
    .maybeSingle();
  if (existingChat.error) {
    if (
      !isPermissionError(existingChat.error.message) &&
      !isMissingColumnError(existingChat.error.message) &&
      !isMissingRelationError(existingChat.error.message)
    ) {
      throw new Error(existingChat.error.message);
    }
  } else if (!existingChat.data?.id) {
    const participants = Array.from(
      new Set([userId, radar.creatorId].filter((value): value is string => Boolean(value)))
    );
    await insertWithColumnFallback(
      'social_chats',
      {
        id: chatId,
        is_group: true,
        group_name: radar.title || 'Radar Misa',
        admin_id: radar.creatorId || userId,
        creator_id: radar.creatorId || userId,
        participants,
        invite_mode: 'open',
        invite_link_enabled: false,
        allow_member_invite: radar.allowMemberInvite !== false,
        updated_at: nowIso,
      },
      undefined
    );
  }

  await insertWithColumnFallback(
    'chat_members',
    {
      chat_id: chatId,
      user_id: userId,
      role: isHost ? 'admin' : 'member',
      status: 'JOINED',
      joined_at: nowIso,
    },
    { onConflict: 'chat_id, user_id' }
  );

  return chatId;
}

async function leaveRadarEvent(params: {
  radar: RadarDetailItem;
  userId: string;
}) {
  const { radar, userId } = params;
  const nowIso = new Date().toISOString();

  if (radar.source === 'v2') {
    const rpcLeave = await supabase.rpc('radar_v2_leave_event', {
      p_radar_id: radar.id,
    });
    if (
      rpcLeave.error &&
      !isFunctionMissingError(rpcLeave.error.message) &&
      !isPermissionError(rpcLeave.error.message) &&
      !isNotAuthenticatedError(rpcLeave.error.message)
    ) {
      throw new Error(rpcLeave.error.message);
    }
    if (!rpcLeave.error) {
      return;
    }
  } else {
    const rpcLeave = await supabase.rpc('leave_radar_event', {
      p_radar_id: radar.id,
      p_user_id: userId,
    });
    if (
      rpcLeave.error &&
      !isFunctionMissingError(rpcLeave.error.message) &&
      !isPermissionError(rpcLeave.error.message) &&
      !isNotAuthenticatedError(rpcLeave.error.message)
    ) {
      throw new Error(rpcLeave.error.message);
    }
    if (!rpcLeave.error) {
      return;
    }
  }

  const participantTables =
    radar.source === 'v2'
      ? (['radar_participants_v2', 'radar_participants'] as const)
      : (['radar_participants', 'radar_participants_v2'] as const);

  let updated = false;
  let lastError = '';
  for (const table of participantTables) {
    const result = await updateWithColumnFallback(
      table,
      {
        status: 'LEFT',
        left_at: nowIso,
        updated_at: nowIso,
      },
      {
        radar_id: radar.id,
        user_id: userId,
      }
    );
    if (!result.error) {
      updated = true;
      break;
    }
    lastError = result.error.message || '';
    if (
      !isMissingColumnError(lastError) &&
      !isMissingRelationError(lastError) &&
      !isPermissionError(lastError)
    ) {
      break;
    }
  }

  if (!updated) {
    throw new Error(lastError || 'Gagal keluar dari radar.');
  }

  const chatId = await resolveRadarChatId({
    radarId: radar.id,
    source: radar.source,
  });
  if (!chatId) return;

  await supabase.from('chat_members').delete().eq('chat_id', chatId).eq('user_id', userId);
  if (radar.source === 'v2') {
    await updateWithColumnFallback(
      'radar_chat_members_v2',
      {
        status: 'LEFT',
        left_at: nowIso,
      },
      {
        chat_group_id: chatId,
        user_id: userId,
      }
    );
  }
}

export default function RadarDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const radarId = decodeURIComponent(params.id || '');

  const [isJoining, setIsJoining] = useState(false);
  const [isOpeningChat, setIsOpeningChat] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [processingUserId, setProcessingUserId] = useState<string | null>(null);

  const { data: radar, isLoading: isLoadingRadar } = useQuery({
    queryKey: ['radar-native-detail', radarId],
    queryFn: () => fetchRadarDetail(radarId),
    enabled: Boolean(radarId),
  });

  const { data: participants = [], isLoading: isLoadingParticipants } = useQuery({
    queryKey: ['radar-native-participants', radarId],
    queryFn: () => fetchRadarParticipants(radarId),
    enabled: Boolean(radarId),
  });

  const { data: myMembership = 'NONE' } = useQuery({
    queryKey: ['radar-native-my-membership', radarId, user?.id],
    queryFn: () => fetchMyMembershipStatus(user?.id, radarId),
    enabled: Boolean(radarId && user?.id),
  });

  const isHost = Boolean(radar?.creatorId && user?.id && radar.creatorId === user.id);
  const pendingParticipants = useMemo(
    () => participants.filter((item) => isPendingMembershipStatus(item.status)),
    [participants]
  );
  const activeParticipants = useMemo(
    () => participants.filter((item) => isJoinedMembershipStatus(item.status)),
    [participants]
  );
  const canInvite = isHost || (myMembership === 'JOINED' && radar?.allowMemberInvite !== false);
  const canOpenChat = Boolean(radar && user?.id && (isHost || myMembership === 'JOINED'));
  const canLeaveRadar = Boolean(radar && user?.id && !isHost && myMembership === 'JOINED');

  const handleJoin = async () => {
    if (!user?.id || !radar) {
      toast.error('Anda harus login untuk bergabung.');
      return;
    }

    setIsJoining(true);
    try {
      const result = await joinRadarEvent({
        radarId: radar.id,
        userId: user.id,
        source: radar.source,
      });

      toast.success(
        result === 'PENDING'
          ? 'Permintaan bergabung dikirim. Menunggu persetujuan host.'
          : 'Berhasil bergabung ke radar.'
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['radar-native-detail', radar.id] }),
        queryClient.invalidateQueries({ queryKey: ['radar-native-participants', radar.id] }),
        queryClient.invalidateQueries({ queryKey: ['radar-native-my-membership', radar.id, user.id] }),
        queryClient.invalidateQueries({ queryKey: ['radar-events', user.id] }),
        queryClient.invalidateQueries({ queryKey: ['radar-membership-map', user.id] }),
      ]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal bergabung ke radar.');
    } finally {
      setIsJoining(false);
    }
  };

  const handleOpenChat = async () => {
    if (!radar || !user?.id) {
      toast.error('Anda harus login untuk membuka chat radar.');
      return;
    }
    if (!isHost && myMembership !== 'JOINED') {
      toast.info('Gabung radar dulu sebelum membuka chat.');
      return;
    }

    setIsOpeningChat(true);
    try {
      const chatId = await ensureRadarChatReady({
        radar,
        userId: user.id,
        isHost,
      });
      if (!chatId) {
        toast.info('Ruang chat radar belum siap. Coba lagi sebentar.');
        return;
      }
      router.push(`/chat/${encodeURIComponent(chatId)}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal membuka chat radar.');
    } finally {
      setIsOpeningChat(false);
    }
  };

  const handleLeave = async () => {
    if (!radar || !user?.id) {
      toast.error('Anda harus login untuk keluar dari radar.');
      return;
    }
    if (isHost) {
      toast.info('Host tidak bisa keluar. Gunakan alur edit/hapus radar jika diperlukan.');
      return;
    }
    if (myMembership !== 'JOINED') {
      toast.info('Anda belum bergabung di radar ini.');
      return;
    }

    setIsLeaving(true);
    try {
      await leaveRadarEvent({
        radar,
        userId: user.id,
      });
      toast.success('Berhasil keluar dari radar.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['radar-native-detail', radar.id] }),
        queryClient.invalidateQueries({ queryKey: ['radar-native-participants', radar.id] }),
        queryClient.invalidateQueries({ queryKey: ['radar-native-my-membership', radar.id, user.id] }),
        queryClient.invalidateQueries({ queryKey: ['radar-events', user.id] }),
        queryClient.invalidateQueries({ queryKey: ['radar-membership-map', user.id] }),
      ]);
      router.push('/radar');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal keluar dari radar.');
    } finally {
      setIsLeaving(false);
    }
  };

  const handleDecision = async (participant: RadarParticipantItem, approve: boolean) => {
    if (!radar || !user?.id) return;
    setProcessingUserId(participant.userId);
    try {
      await updateParticipantDecision({
        radarId: radar.id,
        targetUserId: participant.userId,
        actorId: user.id,
        source: radar.source,
        approve,
      });
      toast.success(approve ? 'Peserta disetujui.' : 'Peserta ditolak.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['radar-native-detail', radar.id] }),
        queryClient.invalidateQueries({ queryKey: ['radar-native-participants', radar.id] }),
      ]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal memproses peserta.');
    } finally {
      setProcessingUserId(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 sm:space-y-5">
      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" onClick={() => router.push('/radar')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Kembali ke Radar
        </Button>
      </div>

      {isLoadingRadar ? (
        <Card className="p-10 text-center">
          <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Memuat detail radar...</p>
        </Card>
      ) : !radar ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          Radar tidak ditemukan atau sudah tidak tersedia.
        </Card>
      ) : (
        <>
          <Card className="border-primary/20 bg-card shadow-sm">
            <CardHeader className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-xl">{radar.title}</CardTitle>
                  {radar.description && (
                    <p className="mt-1 text-sm text-muted-foreground">{radar.description}</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {canInvite && (
                    <Button
                      variant="outline"
                      onClick={() => router.push(`/radar/${encodeURIComponent(radar.id)}/invite`)}
                    >
                      Ajak Misa
                    </Button>
                  )}
                  {canOpenChat && (
                    <Button variant="outline" onClick={handleOpenChat} disabled={isOpeningChat}>
                      {isOpeningChat ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Membuka Chat...
                        </>
                      ) : (
                        <>
                          <MessageSquare className="mr-2 h-4 w-4" />
                          Buka Chat
                        </>
                      )}
                    </Button>
                  )}
                  {canLeaveRadar && (
                    <Button
                      variant="outline"
                      onClick={handleLeave}
                      disabled={isLeaving}
                      className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    >
                      {isLeaving ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Keluar...
                        </>
                      ) : (
                        <>
                          <LogOut className="mr-2 h-4 w-4" />
                          Keluar
                        </>
                      )}
                    </Button>
                  )}
                  {!isHost && (
                    <Button
                      onClick={handleJoin}
                      disabled={
                        isJoining ||
                        isLeaving ||
                        isOpeningChat ||
                        myMembership === 'JOINED' ||
                        myMembership === 'PENDING'
                      }
                      className="bg-primary hover:bg-primary-hover"
                    >
                      {isJoining ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Bergabung...
                        </>
                      ) : myMembership === 'JOINED' ? (
                        'Sudah Bergabung'
                      ) : myMembership === 'PENDING' ? (
                        'Menunggu Host'
                      ) : (
                        'Gabung'
                      )}
                    </Button>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                {radar.startsAt && (
                  <span className="flex items-center gap-1">
                    <Calendar className="h-4 w-4" />
                    {formatDateTimeLabel(radar.startsAt)}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <Users className="h-4 w-4" />
                  {radar.participantCount}
                  {radar.maxParticipants ? ` / ${radar.maxParticipants}` : ''} peserta
                </span>
                {radar.churchName && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-4 w-4" />
                    {radar.churchName}
                  </span>
                )}
              </div>
            </CardHeader>
          </Card>

          {isHost && (
            <Card className="border-border/70 bg-card shadow-sm">
              <CardHeader>
                <CardTitle className="text-base">
                  Permintaan Bergabung ({pendingParticipants.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isLoadingParticipants ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Memuat peserta pending...
                  </div>
                ) : pendingParticipants.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Tidak ada permintaan bergabung.</p>
                ) : (
                  <div className="space-y-2">
                    {pendingParticipants.map((participant) => {
                      const isProcessing = processingUserId === participant.userId;
                      return (
                        <div
                          key={participant.id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <Avatar className="h-9 w-9 border border-border/60">
                              <AvatarImage src={participant.avatarUrl} alt={participant.fullName || participant.username || 'User'} />
                              <AvatarFallback>
                                {(participant.fullName || participant.username || 'U')
                                  .split(' ')
                                  .map((part) => part[0] || '')
                                  .join('')
                                  .slice(0, 2)
                                  .toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">
                                {participant.fullName || `@${participant.username || 'user'}`}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {formatParticipantStatus(participant.status)}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleDecision(participant, false)}
                              disabled={isProcessing}
                            >
                              {isProcessing ? (
                                <>
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  Proses...
                                </>
                              ) : (
                                <>
                                  <UserX2 className="mr-2 h-4 w-4" />
                                  Tolak
                                </>
                              )}
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => handleDecision(participant, true)}
                              disabled={isProcessing}
                            >
                              {isProcessing ? (
                                <>
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  Proses...
                                </>
                              ) : (
                                <>
                                  <UserCheck2 className="mr-2 h-4 w-4" />
                                  Setujui
                                </>
                              )}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card className="border-border/70 bg-card shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Peserta Radar ({activeParticipants.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoadingParticipants ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Memuat daftar peserta...
                </div>
              ) : activeParticipants.length === 0 ? (
                <p className="text-sm text-muted-foreground">Belum ada peserta aktif.</p>
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {activeParticipants.map((participant) => (
                    <div
                      key={participant.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar className="h-9 w-9 border border-border/60">
                          <AvatarImage src={participant.avatarUrl} alt={participant.fullName || participant.username || 'User'} />
                          <AvatarFallback>
                            {(participant.fullName || participant.username || 'U')
                              .split(' ')
                              .map((part) => part[0] || '')
                              .join('')
                              .slice(0, 2)
                              .toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {participant.fullName || `@${participant.username || 'user'}`}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {participant.role || 'MEMBER'} • {formatParticipantStatus(participant.status)}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
