'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { id as idLocale } from 'date-fns/locale';
import {
  ArrowLeft,
  BellRing,
  Calendar,
  CalendarPlus,
  Flag,
  Heart,
  Loader2,
  LogOut,
  MapPin,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Reply,
  Share2,
  Shield,
  Trash2,
  UserCheck2,
  UserX2,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/lib/features/auth/use-auth';
import { ChatService } from '@/lib/features/chat/chat-service';
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
  dioceseId?: string;
  countryId?: string;
  churchName?: string;
  dioceseName?: string;
  countryName?: string;
  creatorId?: string;
  allowMemberInvite?: boolean;
  requireHostApproval?: boolean;
  status?: string;
  visibility?: string;
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

type RadarCommentItem = {
  id: string;
  radarId: string;
  userId: string;
  fullName?: string;
  username?: string;
  avatarUrl?: string;
  content: string;
  parentId?: string;
  imageUrl?: string;
  likesCount: number;
  isLiked: boolean;
  createdAt?: string;
  source: 'native' | 'legacy' | 'v2';
};

const RADAR_REPORT_REASONS = ['Spam', 'Konten Menyesatkan', 'Pelecehan', 'Penipuan', 'Lainnya'];

function readErrorMessage(error: unknown) {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && 'message' in error && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  try {
    const raw = JSON.stringify(error);
    return raw === '{}' ? '' : raw;
  } catch {
    return '';
  }
}

function isMissingColumnError(message: unknown) {
  const lower = readErrorMessage(message).toLowerCase();
  return (
    lower.includes('42703') ||
    lower.includes('does not exist') ||
    (lower.includes('could not find') && lower.includes('column'))
  );
}

function isMissingRelationError(message: unknown) {
  const lower = readErrorMessage(message).toLowerCase();
  return (
    lower.includes('42p01') ||
    (lower.includes('relation') && lower.includes('does not exist')) ||
    (lower.includes('table') && lower.includes('does not exist')) ||
    lower.includes('could not find the table') ||
    (lower.includes('schema cache') && (lower.includes('table') || lower.includes('relation')))
  );
}

function isPermissionError(message: unknown) {
  const lower = readErrorMessage(message).toLowerCase();
  return (
    lower.includes('42501') ||
    lower.includes('permission denied') ||
    lower.includes('row-level security')
  );
}

function isFunctionMissingError(message: unknown) {
  const lower = readErrorMessage(message).toLowerCase();
  return lower.includes('could not find the function') || lower.includes('does not exist');
}

function isNotAuthenticatedError(message: unknown) {
  return readErrorMessage(message).toLowerCase().includes('not authenticated');
}

function isMissingSchemaObjectError(message: unknown) {
  const lower = readErrorMessage(message).toLowerCase();
  return (
    isMissingRelationError(message) ||
    isMissingColumnError(message) ||
    lower.includes('pgrst202') ||
    lower.includes('schema cache')
  );
}

function isDuplicateError(message: unknown) {
  const lower = readErrorMessage(message).toLowerCase();
  return lower.includes('23505') || lower.includes('duplicate key');
}

function extractMissingColumnName(message: unknown): string | null {
  const raw = readErrorMessage(message);
  if (!raw) return null;
  const withQuote = raw.match(/column\s+"([^"]+)"/i);
  if (withQuote?.[1]) return withQuote[1];
  const withSingleQuote = raw.match(/column\s+'([^']+)'/i);
  if (withSingleQuote?.[1]) return withSingleQuote[1];
  const schemaCachePattern = raw.match(/could not find the ['"]([^'"]+)['"] column/i);
  if (schemaCachePattern?.[1]) return schemaCachePattern[1];
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

function toLocalDateTimeValue(value?: string) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hour = `${date.getHours()}`.padStart(2, '0');
  const minute = `${date.getMinutes()}`.padStart(2, '0');
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function toGoogleCalendarDate(value: Date) {
  const year = value.getUTCFullYear();
  const month = `${value.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${value.getUTCDate()}`.padStart(2, '0');
  const hour = `${value.getUTCHours()}`.padStart(2, '0');
  const minute = `${value.getUTCMinutes()}`.padStart(2, '0');
  const second = `${value.getUTCSeconds()}`.padStart(2, '0');
  return `${year}${month}${day}T${hour}${minute}${second}Z`;
}

function normalizeRadarVisibility(value: unknown) {
  const normalized = value?.toString().trim().toUpperCase();
  if (!normalized) return 'PUBLIC';
  if (normalized === 'PRIVATE' || normalized === 'PERSONAL') return 'PRIVATE';
  return normalized;
}

function formatRadarLocationLabel(location: {
  countryName?: string;
  dioceseName?: string;
  churchName?: string;
}) {
  return [location.countryName, location.dioceseName, location.churchName]
    .map((value) => value?.trim() || '')
    .filter(Boolean)
    .join(' • ');
}

function formatParticipantStatus(status: string) {
  const normalized = normalizeMembershipStatus(status);
  if (normalized === 'JOINED' || normalized === 'HOST' || normalized === 'MEMBER' || normalized === 'APPROVED') return 'Bergabung';
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

    if (resultError && isMissingColumnError(resultError)) {
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
      if (!isPermissionError(resultError) && !isMissingRelationError(resultError)) {
        console.error(`Error fetching participants from ${table}:`, readErrorMessage(resultError) || resultError);
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

async function fetchChurchLocationById(churchId?: string) {
  const id = churchId?.trim();
  if (!id) return null;

  const churchSelectCandidates = [
    'id, name, diocese_id, country_id',
    'id, name, diocese_id',
    'id, name, country_id',
    'id, name',
  ];
  let churchRow: Record<string, unknown> | null = null;
  for (const columns of churchSelectCandidates) {
    const result = await supabase
      .from('churches')
      .select(columns)
      .eq('id', id)
      .maybeSingle();
    if (!result.error) {
      churchRow = (result.data as Record<string, unknown> | null) ?? null;
      break;
    }
    if (isPermissionError(result.error.message) || isMissingRelationError(result.error.message)) {
      return null;
    }
    if (!isMissingColumnError(result.error.message)) {
      break;
    }
  }
  if (!churchRow?.id) return null;

  const churchName = churchRow.name?.toString().trim() || '';
  const dioceseId = churchRow.diocese_id?.toString().trim() || '';
  let countryId = churchRow.country_id?.toString().trim() || '';
  let dioceseName = '';

  if (dioceseId) {
    const dioceseSelectCandidates = ['id, name, country_id', 'id, name'];
    for (const columns of dioceseSelectCandidates) {
      const result = await supabase
        .from('dioceses')
        .select(columns)
        .eq('id', dioceseId)
        .maybeSingle();
      if (!result.error) {
        const row = (result.data as Record<string, unknown> | null) ?? null;
        dioceseName = row?.name?.toString().trim() || '';
        const dioceseCountryId = row?.country_id?.toString().trim() || '';
        if (!countryId && dioceseCountryId) {
          countryId = dioceseCountryId;
        }
        break;
      }
      if (
        isPermissionError(result.error.message) ||
        isMissingRelationError(result.error.message) ||
        !isMissingColumnError(result.error.message)
      ) {
        break;
      }
    }
  }

  let countryName = '';
  if (countryId) {
    const result = await supabase
      .from('countries')
      .select('id, name')
      .eq('id', countryId)
      .maybeSingle();
    if (!result.error && result.data?.id) {
      countryName = result.data.name?.toString().trim() || '';
    }
  }

  return {
    churchName: churchName || undefined,
    dioceseId: dioceseId || undefined,
    dioceseName: dioceseName || undefined,
    countryId: countryId || undefined,
    countryName: countryName || undefined,
  };
}

async function getRadarCommentLikeSummary(commentIds: string[], currentUserId?: string): Promise<{
  counts: Map<string, number>;
  liked: Set<string>;
}> {
  const counts = new Map<string, number>();
  const liked = new Set<string>();
  const uniqueCommentIds = [...new Set(commentIds.map((id) => id.trim()).filter(Boolean))];

  if (uniqueCommentIds.length === 0) {
    return { counts, liked };
  }

  const rpcSummary = await supabase.rpc('get_radar_comment_likes_summary', {
    p_comment_ids: uniqueCommentIds,
    p_user_id: currentUserId ?? null,
  });

  if (!rpcSummary.error) {
    for (const row of (rpcSummary.data ?? []) as Array<{
      comment_id?: string | null;
      likes_count?: number | string | null;
      is_liked?: boolean | null;
    }>) {
      const commentId = row.comment_id?.toString();
      if (!commentId) continue;
      counts.set(commentId, Number(row.likes_count ?? 0));
      if (row.is_liked) {
        liked.add(commentId);
      }
    }
    return { counts, liked };
  }

  if (!isMissingSchemaObjectError(rpcSummary.error.message)) {
    console.warn('Radar comment likes summary rpc failed:', rpcSummary.error.message);
  }

  const countRows = await supabase
    .from('radar_comment_likes')
    .select('radar_comment_id')
    .in('radar_comment_id', uniqueCommentIds);

  if (countRows.error) {
    if (!isMissingSchemaObjectError(countRows.error.message)) {
      console.warn('Radar comment likes count fallback failed:', countRows.error.message);
    }
    return { counts, liked };
  }

  for (const row of (countRows.data ?? []) as Array<{ radar_comment_id?: string | null }>) {
    const commentId = row.radar_comment_id?.toString();
    if (!commentId) continue;
    counts.set(commentId, (counts.get(commentId) ?? 0) + 1);
  }

  if (currentUserId) {
    const likedRows = await supabase
      .from('radar_comment_likes')
      .select('radar_comment_id')
      .eq('user_id', currentUserId)
      .in('radar_comment_id', uniqueCommentIds);

    if (likedRows.error) {
      if (!isMissingSchemaObjectError(likedRows.error.message)) {
        console.warn('Radar comment likes user flag fallback failed:', likedRows.error.message);
      }
      return { counts, liked };
    }

    for (const row of (likedRows.data ?? []) as Array<{ radar_comment_id?: string | null }>) {
      const commentId = row.radar_comment_id?.toString();
      if (!commentId) continue;
      liked.add(commentId);
    }
  }

  return { counts, liked };
}

async function toggleRadarCommentLike(params: {
  userId: string;
  commentId: string;
  radarId: string;
}): Promise<{ liked: boolean; count: number }> {
  const { userId, commentId, radarId } = params;

  const existingLike = await supabase
    .from('radar_comment_likes')
    .select('id')
    .eq('user_id', userId)
    .eq('radar_comment_id', commentId)
    .maybeSingle();

  if (existingLike.error) {
    if (isMissingSchemaObjectError(existingLike.error.message)) {
      throw new Error('Schema komentar radar belum siap. Jalankan db/radar_comments_hotfix.sql');
    }
    throw new Error(existingLike.error.message);
  }

  if (existingLike.data?.id) {
    const removeResult = await supabase.from('radar_comment_likes').delete().eq('id', existingLike.data.id);
    if (removeResult.error) {
      throw new Error(removeResult.error.message);
    }
  } else {
    const createResult = await supabase
      .from('radar_comment_likes')
      .insert({
        user_id: userId,
        radar_comment_id: commentId,
        radar_id: radarId,
      });
    if (createResult.error) {
      if (isMissingSchemaObjectError(createResult.error.message)) {
        throw new Error('Schema komentar radar belum siap. Jalankan db/radar_comments_hotfix.sql');
      }
      throw new Error(createResult.error.message);
    }
  }

  const countResult = await supabase
    .from('radar_comment_likes')
    .select('id', { count: 'exact', head: true })
    .eq('radar_comment_id', commentId);

  if (countResult.error) {
    return {
      liked: !Boolean(existingLike.data?.id),
      count: !Boolean(existingLike.data?.id) ? 1 : 0,
    };
  }

  return {
    liked: !Boolean(existingLike.data?.id),
    count: countResult.count ?? 0,
  };
}

async function fetchRadarComments(radarId: string, currentUserId?: string): Promise<RadarCommentItem[]> {
  const commentMap = new Map<string, RadarCommentItem>();

  const nativeSelectCandidates = [
    'id, radar_id, user_id, parent_id, content, image_url, created_at, profiles:user_id(id, full_name, username, avatar_url)',
    'id, radar_id, user_id, parent_id, content, created_at, profiles:user_id(id, full_name, username, avatar_url)',
    'id, radar_id, user_id, content, created_at, profiles:user_id(id, full_name, username, avatar_url)',
    'id, radar_id, user_id, parent_id, content, image_url, created_at',
    'id, radar_id, user_id, parent_id, content, created_at',
    'id, radar_id, user_id, content, created_at',
  ];
  let nativeRows: Record<string, unknown>[] = [];
  let nativeWithProfileJoin = false;
  let nativeErrorMessage = '';
  for (const columns of nativeSelectCandidates) {
    const result = await supabase
      .from('radar_comments')
      .select(columns)
      .eq('radar_id', radarId)
      .order('created_at', { ascending: true })
      .limit(200);
    if (!result.error) {
      nativeRows = ((result.data ?? []) as unknown) as Record<string, unknown>[];
      nativeWithProfileJoin = columns.includes('profiles:user_id(');
      nativeErrorMessage = '';
      break;
    }
    nativeErrorMessage = result.error.message;
    if (
      isPermissionError(result.error.message) ||
      isMissingRelationError(result.error.message) ||
      !isMissingColumnError(result.error.message)
    ) {
      break;
    }
  }

  if (nativeRows.length > 0) {
    const nativeCommentIds = nativeRows
      .map((row) => row.id?.toString())
      .filter((id): id is string => Boolean(id));
    const likeSummary = await getRadarCommentLikeSummary(nativeCommentIds, currentUserId);

    for (const row of nativeRows) {
      const id = row.id?.toString() || createRandomUUID();
      const userId = row.user_id?.toString() || '';
      if (!userId) continue;
      const content = row.content?.toString().trim() || '';
      if (!content) continue;
      const profile = nativeWithProfileJoin && row.profiles && typeof row.profiles === 'object'
        ? (row.profiles as Record<string, unknown>)
        : null;
      commentMap.set(id, {
        id,
        radarId: row.radar_id?.toString() || radarId,
        userId,
        fullName: profile?.full_name?.toString(),
        username: profile?.username?.toString(),
        avatarUrl: profile?.avatar_url?.toString(),
        content,
        parentId: row.parent_id?.toString() || undefined,
        imageUrl: row.image_url?.toString()?.trim() || undefined,
        likesCount: likeSummary.counts.get(id) ?? 0,
        isLiked: likeSummary.liked.has(id),
        createdAt: row.created_at?.toString(),
        source: 'native',
      });
    }
  } else if (
    nativeErrorMessage &&
    !isMissingSchemaObjectError(nativeErrorMessage) &&
    !isPermissionError(nativeErrorMessage)
  ) {
    console.error('Error fetching native radar comments:', nativeErrorMessage);
  }

  const legacyWithProfile = await supabase
    .from('radar_change_logs')
    .select(
      'id, radar_id, changed_by, change_type, description, created_at, profiles:changed_by(id, full_name, username, avatar_url)'
    )
    .eq('radar_id', radarId)
    .eq('change_type', 'COMMENT')
    .order('created_at', { ascending: true })
    .limit(40);

  let legacyRows = legacyWithProfile.data as Record<string, unknown>[] | null;
  let legacyError = legacyWithProfile.error;
  let legacyWithProfileJoin = true;
  if (
    legacyError &&
    (
      isMissingColumnError(legacyError.message) ||
      isMissingRelationError(legacyError.message)
    )
  ) {
    const fallback = await supabase
      .from('radar_change_logs')
      .select('id, radar_id, changed_by, change_type, description, created_at')
      .eq('radar_id', radarId)
      .eq('change_type', 'COMMENT')
      .order('created_at', { ascending: true })
      .limit(40);
    legacyRows = fallback.data as Record<string, unknown>[] | null;
    legacyError = fallback.error;
    legacyWithProfileJoin = false;
  }

  if (!legacyError) {
    for (const row of (legacyRows ?? []) as Record<string, unknown>[]) {
      const rawId = row.id?.toString() || createRandomUUID();
      const id = `legacy:${rawId}`;
      if (commentMap.has(id)) continue;
      const userId = row.changed_by?.toString() || '';
      if (!userId) continue;
      const content = row.description?.toString().trim() || '';
      if (!content) continue;
      const profile = legacyWithProfileJoin && row.profiles && typeof row.profiles === 'object'
        ? (row.profiles as Record<string, unknown>)
        : null;
      commentMap.set(id, {
        id,
        radarId: row.radar_id?.toString() || radarId,
        userId,
        fullName: profile?.full_name?.toString(),
        username: profile?.username?.toString(),
        avatarUrl: profile?.avatar_url?.toString(),
        content,
        likesCount: 0,
        isLiked: false,
        createdAt: row.created_at?.toString(),
        source: 'legacy',
      });
    }
  } else if (!isPermissionError(legacyError.message) && !isMissingRelationError(legacyError.message)) {
    console.error('Error fetching legacy radar comments:', legacyError.message);
  }

  const v2WithProfile = await supabase
    .from('radar_change_logs_v2')
    .select(
      'id, radar_id, actor_id, change_type, change_summary, created_at, profiles:actor_id(id, full_name, username, avatar_url)'
    )
    .eq('radar_id', radarId)
    .eq('change_type', 'COMMENT')
    .order('created_at', { ascending: true })
    .limit(40);

  let v2Rows = v2WithProfile.data as Record<string, unknown>[] | null;
  let v2Error = v2WithProfile.error;
  let v2WithProfileJoin = true;
  if (
    v2Error &&
    (
      isMissingColumnError(v2Error.message) ||
      isMissingRelationError(v2Error.message)
    )
  ) {
    const fallback = await supabase
      .from('radar_change_logs_v2')
      .select('id, radar_id, actor_id, change_type, change_summary, created_at')
      .eq('radar_id', radarId)
      .eq('change_type', 'COMMENT')
      .order('created_at', { ascending: true })
      .limit(40);
    v2Rows = fallback.data as Record<string, unknown>[] | null;
    v2Error = fallback.error;
    v2WithProfileJoin = false;
  }

  if (!v2Error) {
    for (const row of (v2Rows ?? []) as Record<string, unknown>[]) {
      const rawId = row.id?.toString() || createRandomUUID();
      const id = `v2:${rawId}`;
      if (commentMap.has(id)) continue;
      const userId = row.actor_id?.toString() || '';
      if (!userId) continue;
      const content = row.change_summary?.toString().trim() || '';
      if (!content) continue;
      const profile = v2WithProfileJoin && row.profiles && typeof row.profiles === 'object'
        ? (row.profiles as Record<string, unknown>)
        : null;
      commentMap.set(id, {
        id,
        radarId: row.radar_id?.toString() || radarId,
        userId,
        fullName: profile?.full_name?.toString(),
        username: profile?.username?.toString(),
        avatarUrl: profile?.avatar_url?.toString(),
        content,
        likesCount: 0,
        isLiked: false,
        createdAt: row.created_at?.toString(),
        source: 'v2',
      });
    }
  } else if (!isPermissionError(v2Error.message) && !isMissingRelationError(v2Error.message)) {
    console.error('Error fetching v2 radar comments:', v2Error.message);
  }

  const comments = Array.from(commentMap.values());
  const missingProfileIds = comments
    .filter((item) => !item.fullName && !item.username && !item.avatarUrl)
    .map((item) => item.userId);
  const fallbackProfiles = await fetchProfileMap(missingProfileIds);

  return comments
    .map((item) => {
      const fallbackProfile = fallbackProfiles.get(item.userId);
      return {
        ...item,
        fullName: item.fullName || fallbackProfile?.fullName,
        username: item.username || fallbackProfile?.username,
        avatarUrl: item.avatarUrl || fallbackProfile?.avatarUrl,
      };
    })
    .sort((a, b) => new Date(a.createdAt || '').getTime() - new Date(b.createdAt || '').getTime());
}

async function createRadarComment(params: {
  radar: RadarDetailItem;
  userId: string;
  content: string;
  options?: {
    parentId?: string;
    replyToName?: string;
    imageUrl?: string;
  };
}) {
  const { radar, userId, content, options } = params;
  const cleanContent = content.trim();
  const normalizedImageUrl = options?.imageUrl?.trim();
  if (!cleanContent && !normalizedImageUrl) {
    throw new Error('Komentar tidak boleh kosong.');
  }

  const mentionPrefix =
    options?.replyToName && !cleanContent.startsWith(`@${options.replyToName}`)
      ? `@${options.replyToName} `
      : '';
  const composedContent = `${mentionPrefix}${cleanContent}`.trim() || mentionPrefix.trim();

  const nativePayload: Record<string, unknown> = {
    user_id: userId,
    radar_id: radar.id,
    content: composedContent || ' ',
  };
  if (options?.parentId) {
    nativePayload.parent_id = options.parentId;
  }
  if (normalizedImageUrl) {
    nativePayload.image_url = normalizedImageUrl;
  }

  let nativeInsert = await supabase
    .from('radar_comments')
    .insert(nativePayload)
    .select('id')
    .maybeSingle();
  let triedParentFallback = false;
  let triedImageFallback = false;

  while (nativeInsert.error) {
    if (
      !triedParentFallback &&
      options?.parentId &&
      isMissingColumnError(nativeInsert.error.message) &&
      extractMissingColumnName(nativeInsert.error.message) === 'parent_id'
    ) {
      triedParentFallback = true;
      delete nativePayload.parent_id;
      nativeInsert = await supabase
        .from('radar_comments')
        .insert(nativePayload)
        .select('id')
        .maybeSingle();
      continue;
    }

    if (
      !triedImageFallback &&
      normalizedImageUrl &&
      isMissingColumnError(nativeInsert.error.message) &&
      extractMissingColumnName(nativeInsert.error.message) === 'image_url'
    ) {
      triedImageFallback = true;
      delete nativePayload.image_url;
      const baseContent = nativePayload.content?.toString().trim() || '';
      nativePayload.content = baseContent
        ? `${baseContent}\n[image] ${normalizedImageUrl}`
        : `[image] ${normalizedImageUrl}`;
      nativeInsert = await supabase
        .from('radar_comments')
        .insert(nativePayload)
        .select('id')
        .maybeSingle();
      continue;
    }
    break;
  }

  if (!nativeInsert.error) {
    return;
  }

  if (isPermissionError(nativeInsert.error.message)) {
    throw new Error('Anda tidak memiliki izin untuk menulis komentar radar ini.');
  }
  if (!isMissingSchemaObjectError(nativeInsert.error.message)) {
    throw new Error(nativeInsert.error.message);
  }

  const fallbackContent = normalizedImageUrl
    ? `${composedContent || ''}${composedContent ? '\n' : ''}[image] ${normalizedImageUrl}`
    : composedContent;
  const tableCandidates =
    radar.source === 'v2'
      ? (['radar_change_logs_v2', 'radar_change_logs'] as const)
      : (['radar_change_logs', 'radar_change_logs_v2'] as const);

  let lastError = '';
  for (const table of tableCandidates) {
    if (table === 'radar_change_logs_v2') {
      const insert = await insertWithColumnFallback('radar_change_logs_v2', {
        radar_id: radar.id,
        actor_id: userId,
        change_type: 'COMMENT',
        change_summary: fallbackContent,
        after_data: {
          comment: fallbackContent,
          source: 'web',
          reply_to: options?.replyToName || null,
        },
      });
      if (!insert.error) return;
      lastError = insert.error.message || '';
      if (
        !isMissingRelationError(lastError) &&
        !isMissingColumnError(lastError) &&
        !isPermissionError(lastError)
      ) {
        break;
      }
      continue;
    }

    const insert = await insertWithColumnFallback('radar_change_logs', {
      radar_id: radar.id,
      changed_by: userId,
      change_type: 'COMMENT',
      description: fallbackContent,
    });
    if (!insert.error) return;
    lastError = insert.error.message || '';
    if (
      !isMissingRelationError(lastError) &&
      !isMissingColumnError(lastError) &&
      !isPermissionError(lastError)
    ) {
      break;
    }
  }

  if (lastError && isPermissionError(lastError)) {
    throw new Error('Anda tidak memiliki izin untuk menulis komentar radar ini.');
  }
  throw new Error('Komentar radar belum tersedia di server ini.');
}

async function fetchRadarDetail(radarId: string): Promise<RadarDetailItem | null> {
  const legacy = await selectRadarEventWithFallback('radar_events', radarId, {
    primary:
      'id, title, description, event_time, max_participants, church_id, church_name, creator_id, allow_member_invite, require_host_approval, status, visibility',
    fallback:
      'id, title, description, event_time, max_participants, church_id, church_name, creator_id, allow_member_invite, status, visibility',
  });

  const v2 = await selectRadarEventWithFallback('radar_events_v2', radarId, {
    primary:
      'id, title, description, event_starts_at_utc, max_participants, church_id, church_name, creator_id, allow_member_invite, require_host_approval, status, visibility',
    fallback:
      'id, title, description, event_starts_at_utc, max_participants, church_id, church_name, creator_id, allow_member_invite, status, visibility',
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
  const churchLocation = churchId ? await fetchChurchLocationById(churchId) : null;
  let churchName = row.church_name?.toString() || '';
  if (!churchName) {
    churchName = churchLocation?.churchName || '';
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
    dioceseId: churchLocation?.dioceseId,
    countryId: churchLocation?.countryId,
    churchName: churchName || undefined,
    dioceseName: churchLocation?.dioceseName,
    countryName: churchLocation?.countryName,
    creatorId: row.creator_id?.toString(),
    allowMemberInvite:
      typeof row.allow_member_invite === 'boolean' ? row.allow_member_invite : undefined,
    requireHostApproval:
      typeof row.require_host_approval === 'boolean' ? row.require_host_approval : undefined,
    status: row.status?.toString(),
    visibility: row.visibility?.toString(),
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
    if (resultError && isMissingColumnError(resultError)) {
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
      if (!isPermissionError(resultError) && !isMissingColumnError(resultError) && !isMissingRelationError(resultError)) {
        console.error(`Error fetching my status from ${table}:`, readErrorMessage(resultError) || resultError);
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

async function respondInviteById(params: {
  inviteId: string;
  accept: boolean;
  userId: string;
}) {
  const { inviteId, accept, userId } = params;
  const nextStatus = accept ? 'ACCEPTED' : 'DECLINED';

  const rpcV2 = await supabase.rpc('radar_v2_respond_invite', {
    p_invite_id: inviteId,
    p_accept: accept,
  });
  if (!rpcV2.error) return;
  if (
    rpcV2.error &&
    !isFunctionMissingError(rpcV2.error.message) &&
    !isPermissionError(rpcV2.error.message) &&
    !isNotAuthenticatedError(rpcV2.error.message)
  ) {
    throw new Error(rpcV2.error.message);
  }

  const rpcLegacy = await supabase.rpc('respond_radar_invite', {
    p_invite_id: inviteId,
    p_accept: accept,
  });
  if (!rpcLegacy.error) return;
  if (
    rpcLegacy.error &&
    !isFunctionMissingError(rpcLegacy.error.message) &&
    !isPermissionError(rpcLegacy.error.message) &&
    !isNotAuthenticatedError(rpcLegacy.error.message)
  ) {
    throw new Error(rpcLegacy.error.message);
  }

  const updateResult = await supabase
    .from('radar_invites')
    .update({
      status: nextStatus,
      responded_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', inviteId)
    .eq('invitee_id', userId);
  if (
    updateResult.error &&
    !isMissingColumnError(updateResult.error.message) &&
    !isPermissionError(updateResult.error.message)
  ) {
    throw new Error(updateResult.error.message);
  }
}

async function acceptPersonalRadarInvite(params: {
  radarId: string;
  userId: string;
}) {
  const { radarId, userId } = params;
  if (!radarId.trim() || !userId.trim()) return;

  const withSource = await supabase
    .from('radar_invites')
    .select('id, status, source')
    .eq('radar_id', radarId)
    .eq('invitee_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let inviteRow = withSource.data as Record<string, unknown> | null;
  let inviteError = withSource.error;
  if (inviteError && isMissingColumnError(inviteError.message)) {
    const fallback = await supabase
      .from('radar_invites')
      .select('id, status')
      .eq('radar_id', radarId)
      .eq('invitee_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    inviteRow = fallback.data as Record<string, unknown> | null;
    inviteError = fallback.error;
  }

  if (inviteError) {
    if (!isPermissionError(inviteError.message) && !isMissingRelationError(inviteError.message)) {
      throw new Error(inviteError.message);
    }
    throw new Error('Anda tidak memiliki undangan aktif untuk radar private ini.');
  }
  if (!inviteRow?.id) {
    throw new Error('Anda tidak memiliki undangan aktif untuk radar private ini.');
  }

  const status = normalizeMembershipStatus(inviteRow.status);
  if (status === 'ACCEPTED' || status === 'JOINED' || status === 'APPROVED') return;
  if (status !== 'PENDING' && status !== 'INVITED' && status !== 'REQUESTED') {
    throw new Error('Undangan private Anda sudah tidak aktif.');
  }

  await respondInviteById({
    inviteId: inviteRow.id.toString(),
    accept: true,
    userId,
  });
}

async function fetchPersonalRadarInviteStatus(params: {
  radarId?: string;
  userId?: string;
}) {
  const radarId = params.radarId?.trim();
  const userId = params.userId?.trim();
  if (!radarId || !userId) return '';

  const withSource = await supabase
    .from('radar_invites')
    .select('status, source')
    .eq('radar_id', radarId)
    .eq('invitee_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let row = withSource.data as Record<string, unknown> | null;
  let fetchError = withSource.error;
  if (fetchError && isMissingColumnError(fetchError.message)) {
    const fallback = await supabase
      .from('radar_invites')
      .select('status')
      .eq('radar_id', radarId)
      .eq('invitee_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    row = fallback.data as Record<string, unknown> | null;
    fetchError = fallback.error;
  }

  if (fetchError) {
    if (!isPermissionError(fetchError.message) && !isMissingRelationError(fetchError.message)) {
      console.error('Failed to fetch personal invite status:', fetchError.message);
    }
    return '';
  }

  return normalizeMembershipStatus(row?.status);
}

async function updateRadarDetail(params: {
  radar: RadarDetailItem;
  title: string;
  description: string;
  startsAtIso: string;
}) {
  const { radar, title, description, startsAtIso } = params;
  const nowIso = new Date().toISOString();
  const tableCandidates =
    radar.source === 'v2'
      ? (['radar_events_v2', 'radar_events'] as const)
      : (['radar_events', 'radar_events_v2'] as const);

  let lastError = '';
  for (const table of tableCandidates) {
    const payload: Record<string, unknown> = {
      title,
      description,
      updated_at: nowIso,
    };
    if (table === 'radar_events_v2') {
      payload.event_starts_at_utc = startsAtIso;
      payload.event_ends_at_utc = new Date(new Date(startsAtIso).getTime() + 90 * 60 * 1000).toISOString();
    } else {
      payload.event_time = startsAtIso;
    }

    const result = await updateWithColumnFallback(table, payload, { id: radar.id });
    if (!result.error) {
      return;
    }
    lastError = result.error.message || '';
    if (
      !isMissingRelationError(lastError) &&
      !isMissingColumnError(lastError) &&
      !isPermissionError(lastError)
    ) {
      break;
    }
  }

  throw new Error(lastError || 'Gagal memperbarui radar.');
}

async function deleteRadarDetail(radar: RadarDetailItem) {
  const tableCandidates =
    radar.source === 'v2'
      ? (['radar_events_v2', 'radar_events'] as const)
      : (['radar_events', 'radar_events_v2'] as const);

  let deleted = false;
  let lastError = '';
  for (const table of tableCandidates) {
    const result = await supabase.from(table).delete().eq('id', radar.id);
    if (!result.error) {
      deleted = true;
      break;
    }
    lastError = result.error.message || '';
    if (
      !isMissingRelationError(lastError) &&
      !isMissingColumnError(lastError)
    ) {
      break;
    }
  }

  if (!deleted) {
    throw new Error(lastError || 'Gagal menghapus radar.');
  }

  for (const table of ['radar_invites', 'radar_participants', 'radar_participants_v2']) {
    const cleanup = await supabase.from(table).delete().eq('radar_id', radar.id);
    if (
      cleanup.error &&
      !isMissingRelationError(cleanup.error.message) &&
      !isMissingColumnError(cleanup.error.message)
    ) {
      console.warn(`Cleanup ${table} warning:`, cleanup.error.message);
    }
  }
}

async function submitRadarReport(params: {
  userId: string;
  radarId: string;
  reason: string;
  description?: string;
}) {
  const { userId, radarId, reason, description } = params;
  const insertReport = await insertWithColumnFallback('reports', {
    reporter_id: userId,
    target_entity: 'RADAR',
    target_id: radarId,
    reason,
    description: description?.trim() || '',
    status: 'OPEN',
  });
  if (insertReport.error && !isMissingRelationError(insertReport.error.message)) {
    throw new Error(insertReport.error.message);
  }

  await insertWithColumnFallback('radar_change_logs', {
    radar_id: radarId,
    changed_by: userId,
    change_type: 'REPORT',
    description: 'Melaporkan radar',
  });
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
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isReportDialogOpen, setIsReportDialogOpen] = useState(false);
  const [isUpdatingRadar, setIsUpdatingRadar] = useState(false);
  const [isDeletingRadar, setIsDeletingRadar] = useState(false);
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const [isSharingRadar, setIsSharingRadar] = useState(false);
  const [isSettingReminder, setIsSettingReminder] = useState(false);
  const [isReminderSet, setIsReminderSet] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editStartsAt, setEditStartsAt] = useState('');
  const [reportReason, setReportReason] = useState(RADAR_REPORT_REASONS[0]);
  const [reportDescription, setReportDescription] = useState('');
  const [commentText, setCommentText] = useState('');
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [replyTarget, setReplyTarget] = useState<{
    id?: string;
    name: string;
    threadable: boolean;
  } | null>(null);
  const [likingCommentId, setLikingCommentId] = useState<string | null>(null);

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
  const { data: radarComments = [], isLoading: isLoadingRadarComments } = useQuery({
    queryKey: ['radar-native-comments', radarId, user?.id],
    queryFn: () => fetchRadarComments(radarId, user?.id),
    enabled: Boolean(radarId),
    staleTime: 30_000,
  });

  const { data: myMembership = 'NONE' } = useQuery({
    queryKey: ['radar-native-my-membership', radarId, user?.id],
    queryFn: () => fetchMyMembershipStatus(user?.id, radarId),
    enabled: Boolean(radarId && user?.id),
  });
  const { data: churchAddress = '' } = useQuery({
    queryKey: ['radar-native-church-address', radar?.churchId],
    queryFn: async () => {
      const churchId = radar?.churchId?.trim();
      if (!churchId) return '';
      const result = await supabase
        .from('churches')
        .select('id, address, name')
        .eq('id', churchId)
        .maybeSingle();
      if (result.error) {
        if (!isPermissionError(result.error.message) && !isMissingRelationError(result.error.message)) {
          console.error('Failed to fetch church address:', result.error.message);
        }
        return '';
      }
      return result.data?.address?.toString().trim() || result.data?.name?.toString().trim() || '';
    },
    enabled: Boolean(radar?.churchId),
    staleTime: 5 * 60 * 1000,
  });

  const isHost = Boolean(radar?.creatorId && user?.id && radar.creatorId === user.id);
  const radarVisibility = normalizeRadarVisibility(radar?.visibility);
  const isPrivateRadar = radarVisibility === 'PRIVATE';
  const radarLocationLabel = radar ? formatRadarLocationLabel(radar) : '';
  const { data: privateInviteStatus = '' } = useQuery({
    queryKey: ['radar-native-private-invite-status', radarId, user?.id],
    queryFn: () =>
      fetchPersonalRadarInviteStatus({
        radarId,
        userId: user?.id,
      }),
    enabled: Boolean(radarId && user?.id && isPrivateRadar && !isHost && myMembership !== 'JOINED'),
    staleTime: 30_000,
  });
  const radarStartsAtDate = useMemo(() => {
    if (!radar?.startsAt) return null;
    const parsed = new Date(radar.startsAt);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
  }, [radar?.startsAt]);
  const isPastRadar = radarStartsAtDate ? radarStartsAtDate.getTime() <= Date.now() : false;
  const pendingParticipants = useMemo(
    () => participants.filter((item) => isPendingMembershipStatus(item.status)),
    [participants]
  );
  const activeParticipants = useMemo(
    () => participants.filter((item) => isJoinedMembershipStatus(item.status)),
    [participants]
  );
  const hasActivePrivateInvite = useMemo(() => {
    if (!isPrivateRadar) return true;
    const status = normalizeMembershipStatus(privateInviteStatus);
    return ['PENDING', 'INVITED', 'REQUESTED', 'ACCEPTED', 'JOINED', 'APPROVED'].includes(status);
  }, [isPrivateRadar, privateInviteStatus]);
  const canInvite = !isPrivateRadar && (isHost || (myMembership === 'JOINED' && radar?.allowMemberInvite !== false));
  const canOpenChat = Boolean(radar && user?.id && (isHost || myMembership === 'JOINED'));
  const canLeaveRadar = Boolean(radar && user?.id && !isHost && myMembership === 'JOINED');
  const canCommentOnRadar = Boolean(radar && user?.id && (isHost || myMembership === 'JOINED'));
  const canReportRadar = Boolean(radar && user?.id && !isHost);
  const canManageRadar = Boolean(radar && user?.id && isHost);
  const canSetReminder = Boolean(radar && radarStartsAtDate && !isPastRadar && (isHost || myMembership === 'JOINED'));
  const canShareRadar = Boolean(radar && !isPrivateRadar);
  const quotaText = radar?.maxParticipants && radar.maxParticipants > 0
    ? `Maks ${radar.maxParticipants} orang`
    : 'Kuota fleksibel';
  const invitePolicyText = radar?.allowMemberInvite === false ? 'Tidak diizinkan' : 'Diizinkan';
  const approvalPolicyText = radar?.requireHostApproval ? 'Aktif (moderasi host)' : 'Tidak';
  const radarCommentThreads = useMemo(() => {
    const repliesByParent = new Map<string, RadarCommentItem[]>();
    const topLevel: RadarCommentItem[] = [];
    const sorted = [...radarComments].sort(
      (a, b) => new Date(a.createdAt || '').getTime() - new Date(b.createdAt || '').getTime()
    );
    const byId = new Map(sorted.map((item) => [item.id, item]));

    for (const comment of sorted) {
      const parentId = comment.parentId?.trim();
      if (comment.source === 'native' && parentId && byId.has(parentId)) {
        const list = repliesByParent.get(parentId) ?? [];
        list.push(comment);
        repliesByParent.set(parentId, list);
        continue;
      }
      topLevel.push(comment);
    }

    topLevel.sort((a, b) => new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime());
    return { topLevel, repliesByParent };
  }, [radarComments]);

  useEffect(() => {
    if (!radar) return;
    setEditTitle((current) => current || radar.title || '');
    setEditDescription((current) => (current || radar.description || '').trimStart());
    setEditStartsAt((current) => current || toLocalDateTimeValue(radar.startsAt));
  }, [radar]);
  useEffect(() => {
    if (!radar?.id) {
      setIsReminderSet(false);
      return;
    }
    if (typeof window === 'undefined') return;
    setIsReminderSet(window.localStorage.getItem(`radar_reminder_set_${radar.id}`) === '1');
  }, [radar?.id]);

  const handleJoin = async () => {
    if (!user?.id || !radar) {
      toast.error('Anda harus login untuk bergabung.');
      return;
    }

    setIsJoining(true);
    try {
      let result: MembershipState = 'JOINED';
      if (isPrivateRadar) {
        await acceptPersonalRadarInvite({
          radarId: radar.id,
          userId: user.id,
        });
      }

      try {
        result = await joinRadarEvent({
          radarId: radar.id,
          userId: user.id,
          source: radar.source,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || '');
        if (!isDuplicateError(message)) {
          throw error;
        }
        result = 'JOINED';
      }

      toast.success(
        result === 'PENDING'
          ? 'Permintaan bergabung dikirim. Menunggu persetujuan host.'
          : 'Berhasil bergabung ke radar.'
      );

      if (isPrivateRadar && result !== 'PENDING') {
        const otherUserId = radar.creatorId && radar.creatorId !== user.id
          ? radar.creatorId
          : activeParticipants.find((item) => item.userId !== user.id)?.userId;
        if (otherUserId) {
          const directChat = await ChatService.createChat(user.id, otherUserId);
          router.push(`/chat/${encodeURIComponent(directChat.id)}`);
        }
      }

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
      if (isPrivateRadar) {
        const otherParticipant = activeParticipants.find((item) => item.userId !== user.id);
        const otherUserId = radar.creatorId && radar.creatorId !== user.id
          ? radar.creatorId
          : otherParticipant?.userId;
        if (!otherUserId) {
          toast.info('Menunggu lawan chat menerima undangan.');
          return;
        }
        const directChat = await ChatService.createChat(user.id, otherUserId);
        router.push(`/chat/${encodeURIComponent(directChat.id)}`);
        return;
      }

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

  const handleOpenMaps = () => {
    if (!radar) return;
    const mapQuery = (churchAddress || radar.churchName || radarLocationLabel || '').trim();
    if (!mapQuery) {
      toast.info('Alamat gereja belum tersedia.');
      return;
    }
    const target = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`;
    window.open(target, '_blank', 'noopener,noreferrer');
  };

  const handleShareRadar = async () => {
    if (!radar) return;
    if (isSharingRadar) return;
    if (typeof window === 'undefined') return;

    const radarUrl = `${window.location.origin}/radar/${encodeURIComponent(radar.id)}`;
    try {
      setIsSharingRadar(true);
      if (navigator.share) {
        await navigator.share({
          title: radar.title || 'Radar Misa',
          text: 'Lihat radar misa ini di MyCatholic',
          url: radarUrl,
        });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(radarUrl);
        toast.success('Link radar disalin.');
      } else {
        toast.info(radarUrl);
      }
    } catch (error) {
      const message = (error as Error | undefined)?.message?.toLowerCase() || '';
      if (!message.includes('abort')) {
        toast.error('Gagal membagikan radar.');
      }
    } finally {
      setIsSharingRadar(false);
    }
  };

  const handleSetReminder = async () => {
    if (!radar || !radarStartsAtDate) {
      toast.info('Waktu radar belum valid untuk pengingat.');
      return;
    }
    if (isPastRadar) {
      toast.info('Radar sudah lewat, pengingat tidak bisa diatur.');
      return;
    }
    if (isSettingReminder) return;

    const endAt = new Date(radarStartsAtDate.getTime() + 90 * 60 * 1000);
    const locationLabel = (churchAddress || radarLocationLabel || '').trim();
    const details = radar.description?.trim() || 'Pengingat radar misa MyCatholic';
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: radar.title || 'Radar Misa',
      dates: `${toGoogleCalendarDate(radarStartsAtDate)}/${toGoogleCalendarDate(endAt)}`,
      details,
      location: locationLabel,
    });
    const calendarUrl = `https://calendar.google.com/calendar/render?${params.toString()}`;

    try {
      setIsSettingReminder(true);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(`radar_reminder_set_${radar.id}`, '1');
        setIsReminderSet(true);
      }
      window.open(calendarUrl, '_blank', 'noopener,noreferrer');
      toast.success('Pengingat dibuka. Simpan event di kalender Anda.');
    } finally {
      setIsSettingReminder(false);
    }
  };

  const handleOpenReportDialog = () => {
    if (!canReportRadar) {
      toast.info('Hanya user non-host yang bisa melaporkan radar.');
      return;
    }
    setReportReason(RADAR_REPORT_REASONS[0]);
    setReportDescription('');
    setIsReportDialogOpen(true);
  };

  const handleSubmitReport = async () => {
    if (!radar || !user?.id) {
      toast.error('Anda harus login untuk melaporkan radar.');
      return;
    }
    setIsSubmittingReport(true);
    try {
      await submitRadarReport({
        userId: user.id,
        radarId: radar.id,
        reason: reportReason,
        description: reportDescription,
      });
      toast.success('Laporan berhasil dikirim.');
      setIsReportDialogOpen(false);
      setReportDescription('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal mengirim laporan.');
    } finally {
      setIsSubmittingReport(false);
    }
  };

  const handleSubmitComment = async () => {
    if (!radar || !user?.id) {
      toast.error('Anda harus login untuk menulis komentar radar.');
      return;
    }
    if (!canCommentOnRadar) {
      toast.info('Gabung radar dulu untuk menulis komentar.');
      return;
    }

    const content = commentText.trim();
    if (!content) {
      toast.error('Komentar tidak boleh kosong.');
      return;
    }
    if (content.length > 500) {
      toast.error('Komentar maksimal 500 karakter.');
      return;
    }

    setIsSubmittingComment(true);
    try {
      await createRadarComment({
        radar,
        userId: user.id,
        content,
        options: replyTarget
          ? {
            parentId: replyTarget.threadable ? replyTarget.id : undefined,
            replyToName: replyTarget.name,
          }
          : undefined,
      });
      setCommentText('');
      setReplyTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['radar-native-comments', radar.id] });
      toast.success('Komentar berhasil dikirim.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal mengirim komentar radar.');
    } finally {
      setIsSubmittingComment(false);
    }
  };

  const handleReplyToComment = (comment: RadarCommentItem) => {
    if (!canCommentOnRadar) {
      toast.info('Gabung radar dulu untuk membalas komentar.');
      return;
    }
    const name = comment.fullName?.trim() || comment.username?.trim() || 'user';
    const threadable = comment.source === 'native';
    setReplyTarget({
      id: threadable ? comment.id : undefined,
      name,
      threadable,
    });
    setCommentText((current) => current || `@${name} `);
    if (!threadable) {
      toast.info('Balasan komentar lama akan dikirim sebagai mention baru.');
    }
  };

  const handleToggleCommentLike = async (comment: RadarCommentItem) => {
    if (!radar) return;
    if (!user?.id) {
      toast.error('Anda harus login untuk menyukai komentar radar.');
      return;
    }
    if (!canCommentOnRadar) {
      toast.info('Gabung radar dulu untuk memberi like komentar.');
      return;
    }
    if (comment.source !== 'native') {
      toast.info('Like hanya tersedia untuk komentar radar terbaru.');
      return;
    }

    setLikingCommentId(comment.id);
    try {
      await toggleRadarCommentLike({
        userId: user.id,
        commentId: comment.id,
        radarId: radar.id,
      });
      await queryClient.invalidateQueries({ queryKey: ['radar-native-comments', radar.id] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal memberi like komentar radar.');
    } finally {
      setLikingCommentId(null);
    }
  };

  const handleOpenEditDialog = () => {
    if (!canManageRadar || !radar) return;
    setEditTitle(radar.title || '');
    setEditDescription(radar.description || '');
    setEditStartsAt(toLocalDateTimeValue(radar.startsAt));
    setIsEditDialogOpen(true);
  };

  const handleSubmitEdit = async () => {
    if (!radar || !user?.id) {
      toast.error('Anda harus login untuk mengubah radar.');
      return;
    }
    const nextTitle = editTitle.trim();
    if (!nextTitle) {
      toast.error('Judul radar wajib diisi.');
      return;
    }
    const startsAt = new Date(editStartsAt);
    if (Number.isNaN(startsAt.getTime())) {
      toast.error('Waktu radar tidak valid.');
      return;
    }

    setIsUpdatingRadar(true);
    try {
      await updateRadarDetail({
        radar,
        title: nextTitle,
        description: editDescription.trim(),
        startsAtIso: startsAt.toISOString(),
      });
      toast.success('Radar berhasil diperbarui.');
      setIsEditDialogOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['radar-native-detail', radar.id] }),
        queryClient.invalidateQueries({ queryKey: ['radar-events', user.id] }),
        queryClient.invalidateQueries({ queryKey: ['owner-radar-events', user.id] }),
      ]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal memperbarui radar.');
    } finally {
      setIsUpdatingRadar(false);
    }
  };

  const handleDeleteRadar = async () => {
    if (!radar || !user?.id) {
      toast.error('Anda harus login untuk menghapus radar.');
      return;
    }
    if (!canManageRadar) {
      toast.info('Hanya host yang bisa menghapus radar.');
      return;
    }
    const confirmed = window.confirm('Radar yang dihapus tidak bisa dikembalikan. Lanjutkan?');
    if (!confirmed) return;

    setIsDeletingRadar(true);
    try {
      await deleteRadarDetail(radar);
      toast.success('Radar berhasil dihapus.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['radar-events', user.id] }),
        queryClient.invalidateQueries({ queryKey: ['owner-radar-events', user.id] }),
      ]);
      router.push('/radar');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal menghapus radar.');
    } finally {
      setIsDeletingRadar(false);
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
                      <CalendarPlus className="mr-2 h-4 w-4" />
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
                  {canSetReminder && (
                    <Button
                      variant="outline"
                      onClick={handleSetReminder}
                      disabled={isSettingReminder}
                    >
                      {isSettingReminder ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Menyiapkan...
                        </>
                      ) : (
                        <>
                          <BellRing className="mr-2 h-4 w-4" />
                          {isReminderSet ? 'Pengingat Aktif' : 'Atur Pengingat'}
                        </>
                      )}
                    </Button>
                  )}
                  {canShareRadar && (
                    <Button
                      variant="outline"
                      onClick={handleShareRadar}
                      disabled={isSharingRadar}
                    >
                      {isSharingRadar ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Membagikan...
                        </>
                      ) : (
                        <>
                          <Share2 className="mr-2 h-4 w-4" />
                          Bagikan
                        </>
                      )}
                    </Button>
                  )}
                  {canReportRadar && (
                    <Button
                      variant="outline"
                      onClick={handleOpenReportDialog}
                    >
                      <Flag className="mr-2 h-4 w-4" />
                      Laporkan
                    </Button>
                  )}
                  {canManageRadar && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="icon" className="h-10 w-10">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem onClick={handleOpenEditDialog}>
                          <Pencil className="mr-2 h-4 w-4" />
                          Edit Radar
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={handleDeleteRadar}
                          disabled={isDeletingRadar}
                        >
                          <Trash2 className="mr-2 h-4 w-4 text-destructive" />
                          {isDeletingRadar ? 'Menghapus...' : 'Hapus Radar'}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                  {!isHost && (
                    <Button
                      onClick={handleJoin}
                      disabled={
                        isJoining ||
                        isLeaving ||
                        isOpeningChat ||
                        isDeletingRadar ||
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
                      ) : isPrivateRadar && !hasActivePrivateInvite ? (
                        'Periksa Undangan'
                      ) : (
                        isPrivateRadar ? 'Terima Undangan' : 'Gabung'
                      )}
                    </Button>
                  )}
                </div>
              </div>
              {isPrivateRadar && !isHost && myMembership === 'NONE' && !hasActivePrivateInvite && (
                <p className="text-xs font-medium text-amber-700">
                  Undangan private belum terdeteksi. Ketuk "Periksa Undangan" untuk sinkron ulang.
                </p>
              )}

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
                {radarLocationLabel && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-4 w-4" />
                    {radarLocationLabel}
                    <button
                      type="button"
                      onClick={handleOpenMaps}
                      className="ml-1 text-[11px] font-semibold text-primary transition-colors hover:text-primary/80"
                    >
                      Maps
                    </button>
                  </span>
                )}
              </div>
            </CardHeader>
          </Card>

          <Card className="border-border/70 bg-card shadow-sm">
            <CardHeader className="space-y-1.5 pb-3">
              <CardTitle className="text-base">Aturan Acara</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2.5">
                <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Users className="h-3.5 w-3.5" />
                  Kuota Peserta
                </p>
                <p className="mt-1.5 text-sm font-semibold">{quotaText}</p>
              </div>
              <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2.5">
                <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <CalendarPlus className="h-3.5 w-3.5" />
                  Invite Teman
                </p>
                <p className="mt-1.5 text-sm font-semibold">{invitePolicyText}</p>
              </div>
              <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2.5">
                <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Shield className="h-3.5 w-3.5" />
                  Persetujuan Host
                </p>
                <p className="mt-1.5 text-sm font-semibold">{approvalPolicyText}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card shadow-sm">
            <CardHeader className="space-y-1.5 pb-3">
              <CardTitle className="text-base">Komentar Radar</CardTitle>
              <p className="text-xs text-muted-foreground">
                Tulis komentar singkat untuk koordinasi atau catatan misa.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {canCommentOnRadar ? (
                <div className="space-y-2">
                  {replyTarget && (
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
                      <span className="truncate">
                        Membalas <span className="font-semibold">{replyTarget.name}</span>
                        {!replyTarget.threadable && ' (mention)'}
                      </span>
                      <button
                        type="button"
                        className="shrink-0 font-semibold text-primary hover:underline"
                        onClick={() => setReplyTarget(null)}
                      >
                        Batal
                      </button>
                    </div>
                  )}
                  <Textarea
                    value={commentText}
                    onChange={(event) => setCommentText(event.target.value)}
                    rows={3}
                    maxLength={500}
                    placeholder={replyTarget ? `Balas ${replyTarget.name}...` : 'Tulis komentar...'}
                    disabled={isSubmittingComment}
                  />
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] text-muted-foreground">
                      {commentText.trim().length}/500
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleSubmitComment}
                      disabled={isSubmittingComment || commentText.trim().length === 0}
                    >
                      {isSubmittingComment ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Mengirim...
                        </>
                      ) : (
                        replyTarget ? 'Kirim Balasan' : 'Kirim Komentar'
                      )}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                  Gabung radar dulu untuk menulis komentar.
                </div>
              )}

              <div className="space-y-2">
                {isLoadingRadarComments ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Memuat komentar...
                  </div>
                ) : radarCommentThreads.topLevel.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Belum ada komentar radar.</p>
                ) : (
                  radarCommentThreads.topLevel.map((comment) => {
                    const commentName = comment.fullName || `@${comment.username || 'user'}`;
                    const isNativeComment = comment.source === 'native';
                    const isLikingComment = likingCommentId === comment.id;
                    const replies = radarCommentThreads.repliesByParent.get(comment.id) ?? [];

                    return (
                      <div
                        key={comment.id}
                        className="rounded-xl border border-border/70 bg-background/80 px-3 py-2.5"
                      >
                        <div className="flex items-start gap-2.5">
                          <Avatar className="mt-0.5 h-8 w-8 border border-border/60">
                            <AvatarImage src={comment.avatarUrl} alt={commentName} />
                            <AvatarFallback>
                              {commentName
                                .split(' ')
                                .map((part) => part[0] || '')
                                .join('')
                                .slice(0, 2)
                                .toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="truncate text-xs font-semibold">{commentName}</p>
                              <span className="text-[11px] text-muted-foreground">
                                {formatDateTimeLabel(comment.createdAt)}
                              </span>
                            </div>
                            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{comment.content}</p>
                            {comment.imageUrl && (
                              <img
                                src={comment.imageUrl}
                                alt={`Lampiran ${commentName}`}
                                className="mt-2 max-h-48 rounded-lg border border-border/70 object-cover"
                              />
                            )}

                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                                onClick={() => handleReplyToComment(comment)}
                                disabled={!canCommentOnRadar}
                              >
                                <Reply className="mr-1.5 h-3.5 w-3.5" />
                                Balas
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                                onClick={() => handleToggleCommentLike(comment)}
                                disabled={!isNativeComment || isLikingComment || !canCommentOnRadar}
                              >
                                {isLikingComment ? (
                                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Heart
                                    className={
                                      comment.isLiked
                                        ? 'mr-1.5 h-3.5 w-3.5 text-rose-600 [&>path]:fill-current [&>path]:stroke-current'
                                        : 'mr-1.5 h-3.5 w-3.5'
                                    }
                                  />
                                )}
                                {comment.likesCount > 0 ? comment.likesCount : 'Suka'}
                              </Button>
                              {!isNativeComment && (
                                <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                                  Legacy
                                </span>
                              )}
                            </div>

                            {replies.length > 0 && (
                              <div className="mt-2.5 space-y-2 border-l border-border/70 pl-3">
                                {replies.map((reply) => {
                                  const replyName = reply.fullName || `@${reply.username || 'user'}`;
                                  const isNativeReply = reply.source === 'native';
                                  const isLikingReply = likingCommentId === reply.id;
                                  return (
                                    <div key={reply.id} className="rounded-lg border border-border/60 bg-card/70 px-2.5 py-2">
                                      <div className="flex items-start gap-2">
                                        <Avatar className="mt-0.5 h-7 w-7 border border-border/60">
                                          <AvatarImage src={reply.avatarUrl} alt={replyName} />
                                          <AvatarFallback className="text-[10px]">
                                            {replyName
                                              .split(' ')
                                              .map((part) => part[0] || '')
                                              .join('')
                                              .slice(0, 2)
                                              .toUpperCase()}
                                          </AvatarFallback>
                                        </Avatar>
                                        <div className="min-w-0 flex-1">
                                          <div className="flex flex-wrap items-center justify-between gap-2">
                                            <p className="truncate text-xs font-semibold">{replyName}</p>
                                            <span className="text-[10px] text-muted-foreground">
                                              {formatDateTimeLabel(reply.createdAt)}
                                            </span>
                                          </div>
                                          <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed">{reply.content}</p>
                                          {reply.imageUrl && (
                                            <img
                                              src={reply.imageUrl}
                                              alt={`Lampiran ${replyName}`}
                                              className="mt-2 max-h-40 rounded-md border border-border/70 object-cover"
                                            />
                                          )}
                                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                            <Button
                                              type="button"
                                              variant="ghost"
                                              size="sm"
                                              className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                                              onClick={() => handleReplyToComment(reply)}
                                              disabled={!canCommentOnRadar}
                                            >
                                              <Reply className="mr-1 h-3 w-3" />
                                              Balas
                                            </Button>
                                            <Button
                                              type="button"
                                              variant="ghost"
                                              size="sm"
                                              className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                                              onClick={() => handleToggleCommentLike(reply)}
                                              disabled={!isNativeReply || isLikingReply || !canCommentOnRadar}
                                            >
                                              {isLikingReply ? (
                                                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                              ) : (
                                                <Heart
                                                  className={
                                                    reply.isLiked
                                                      ? 'mr-1 h-3 w-3 text-rose-600 [&>path]:fill-current [&>path]:stroke-current'
                                                      : 'mr-1 h-3 w-3'
                                                  }
                                                />
                                              )}
                                              {reply.likesCount > 0 ? reply.likesCount : 'Suka'}
                                            </Button>
                                            {!isNativeReply && (
                                              <span className="rounded-full border border-border px-1.5 py-0.5 text-[9px] text-muted-foreground">
                                                Legacy
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </CardContent>
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

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-[620px]">
          <DialogHeader>
            <DialogTitle>Edit Radar</DialogTitle>
            <DialogDescription>Perbarui detail radar misa Anda.</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="radar-edit-title" className="text-sm font-medium">
                Judul
              </label>
              <Input
                id="radar-edit-title"
                value={editTitle}
                onChange={(event) => setEditTitle(event.target.value)}
                placeholder="Judul radar"
                disabled={isUpdatingRadar}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="radar-edit-time" className="text-sm font-medium">
                Waktu
              </label>
              <Input
                id="radar-edit-time"
                type="datetime-local"
                value={editStartsAt}
                onChange={(event) => setEditStartsAt(event.target.value)}
                disabled={isUpdatingRadar}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="radar-edit-description" className="text-sm font-medium">
                Deskripsi
              </label>
              <Textarea
                id="radar-edit-description"
                value={editDescription}
                onChange={(event) => setEditDescription(event.target.value)}
                rows={4}
                placeholder="Deskripsi radar"
                disabled={isUpdatingRadar}
              />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsEditDialogOpen(false)}
                disabled={isUpdatingRadar}
              >
                Batal
              </Button>
              <Button
                type="button"
                onClick={handleSubmitEdit}
                disabled={isUpdatingRadar || editTitle.trim().length === 0 || editStartsAt.trim().length === 0}
              >
                {isUpdatingRadar ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Menyimpan...
                  </>
                ) : (
                  'Simpan Perubahan'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isReportDialogOpen}
        onOpenChange={(open) => {
          setIsReportDialogOpen(open);
          if (!open) {
            setReportReason(RADAR_REPORT_REASONS[0]);
            setReportDescription('');
          }
        }}
      >
        <DialogContent className="max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Laporkan Radar</DialogTitle>
            <DialogDescription>Pilih alasan laporan untuk membantu moderasi.</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid gap-2">
              {RADAR_REPORT_REASONS.map((reason) => (
                <button
                  key={reason}
                  type="button"
                  onClick={() => setReportReason(reason)}
                  className={
                    reportReason === reason
                      ? 'rounded-xl border border-primary/45 bg-primary/10 px-3 py-2 text-left text-sm text-primary'
                      : 'rounded-xl border border-border bg-background/60 px-3 py-2 text-left text-sm hover:bg-muted/40'
                  }
                >
                  {reason}
                </button>
              ))}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="radar-report-description" className="text-sm font-medium">
                Detail Tambahan (Opsional)
              </label>
              <Textarea
                id="radar-report-description"
                value={reportDescription}
                onChange={(event) => setReportDescription(event.target.value)}
                rows={3}
                placeholder="Tambahkan konteks laporan jika perlu"
                disabled={isSubmittingReport}
              />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsReportDialogOpen(false)}
                disabled={isSubmittingReport}
              >
                Batal
              </Button>
              <Button
                type="button"
                onClick={handleSubmitReport}
                disabled={isSubmittingReport}
              >
                {isSubmittingReport ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Mengirim...
                  </>
                ) : (
                  'Kirim Laporan'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
