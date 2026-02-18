'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { id } from 'date-fns/locale';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Calendar,
  CheckCircle2,
  Clock3,
  LogOut,
  Loader2,
  MapPin,
  Plus,
  Search,
  Users,
  Compass,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useAuth } from '@/lib/features/auth/use-auth';
import { useChurches, useMassSchedules } from '@/lib/features/schedule/use-schedule';
import { supabase } from '@/lib/supabase/client';
import { cn, createRandomUUID } from '@/lib/utils';

type RadarSource = 'legacy' | 'v2';

type RadarCardItem = {
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
  status?: string;
  source: RadarSource;
};

type InviteTarget = {
  id: string;
  full_name?: string;
  username?: string;
  avatar_url?: string;
  role?: string;
  allow_mass_invite?: boolean;
};

type RadarInviteItem = {
  id: string;
  inviteId?: string;
  notificationId?: string;
  inviterId?: string;
  inviteeId?: string;
  inviterName?: string;
  inviteeName?: string;
  inviteSource?: string;
  status: string;
  createdAt?: string;
  radarId?: string;
  radarTitle?: string;
  radarChurchName?: string;
  radarStartsAt?: string;
  radarSource?: RadarSource;
  radarVisibility?: string;
  message?: string;
  direction: 'incoming' | 'outgoing';
};

type ActiveCheckIn = {
  id: string;
  table: 'mass_checkins' | 'mass_checkins_v2';
  churchId?: string;
  checkAt?: string;
};

type RadarMembershipStatus = 'JOINED' | 'PENDING';
type PublicFilter = 'today' | 'tomorrow' | 'week' | 'all';
type PublicSort = 'soonest' | 'popular';

type CheckInPresenceItem = {
  userId: string;
  fullName?: string;
  username?: string;
  avatarUrl?: string;
  checkAt?: string;
};

function isMissingColumnError(message: string) {
  const lower = message.toLowerCase();
  return lower.includes('42703') || lower.includes('does not exist');
}

function isDuplicateError(message: string) {
  const lower = message.toLowerCase();
  return lower.includes('23505') || lower.includes('duplicate key');
}

function isForeignKeyError(message: string) {
  const lower = message.toLowerCase();
  return lower.includes('23503') || lower.includes('foreign key constraint');
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

function normalizeInviteStatus(value: unknown) {
  return value?.toString().toUpperCase() || 'PENDING';
}

function isPendingInvite(value: unknown) {
  return normalizeInviteStatus(value) === 'PENDING';
}

function formatInviteStatus(value: unknown) {
  const status = normalizeInviteStatus(value);
  if (status === 'ACCEPTED') return 'Diterima';
  if (status === 'DECLINED' || status === 'REJECTED') return 'Ditolak';
  if (status === 'CANCELLED') return 'Dibatalkan';
  if (status === 'EXPIRED') return 'Kedaluwarsa';
  return 'Menunggu';
}

function isPersonalInvite(item: RadarInviteItem) {
  const source = item.inviteSource?.trim().toUpperCase();
  if (source === 'PERSONAL') return true;

  const visibility = item.radarVisibility?.trim().toUpperCase();
  return visibility === 'PRIVATE' || visibility === 'PERSONAL';
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

function toLocalDateTimeValue(value: Date) {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const date = `${value.getDate()}`.padStart(2, '0');
  const hour = `${value.getHours()}`.padStart(2, '0');
  const minute = `${value.getMinutes()}`.padStart(2, '0');
  return `${year}-${month}-${date}T${hour}:${minute}`;
}

function toLocalDateValue(value: Date) {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const date = `${value.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${date}`;
}

function formatDateTimeLabel(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return format(date, 'dd MMM yyyy HH:mm', { locale: id });
}

function canCreateRadarByRole(role?: string | null) {
  const normalized = role?.trim().toLowerCase() ?? '';
  return normalized === 'umat' || normalized === 'katekumen';
}

function formatRoleLabel(role?: string) {
  if (!role) return 'Umat';
  const normalized = role.trim().toLowerCase();
  if (!normalized) return 'Umat';
  if (normalized === 'katekumen') return 'Katekumen';
  if (normalized === 'pastor') return 'Pastor';
  if (normalized === 'suster') return 'Suster';
  if (normalized === 'bruder') return 'Bruder';
  if (normalized === 'frater') return 'Frater';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

async function insertWithColumnFallback(
  table: string,
  payload: Record<string, unknown>,
  options?: { select?: string }
) {
  const working = { ...payload };

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const result = options?.select
      ? await supabase
        .from(table)
        .insert(working)
        .select(options.select)
        .maybeSingle()
      : await supabase.from(table).insert(working);

    if (!result.error) {
      return {
        data: (result.data as Record<string, unknown> | null) ?? null,
        error: null,
        duplicate: false,
      };
    }

    if (isDuplicateError(result.error.message)) {
      return {
        data: (result.data as Record<string, unknown> | null) ?? null,
        error: null,
        duplicate: true,
      };
    }

    const missingColumn = extractMissingColumnName(result.error.message);
    if (
      missingColumn &&
      missingColumn in working &&
      isMissingColumnError(result.error.message)
    ) {
      delete working[missingColumn];
      continue;
    }

    return { data: null, error: result.error, duplicate: false };
  }

  return {
    data: null,
    error: { message: `Gagal insert ke ${table} setelah beberapa percobaan` },
    duplicate: false,
  };
}

async function fetchRadarParticipantRows(eventIds: string[]) {
  if (eventIds.length === 0) return [];

  const allRows: Record<string, unknown>[] = [];
  for (const table of ['radar_participants', 'radar_participants_v2']) {
    const result = await supabase
      .from(table)
      .select('radar_id')
      .in('radar_id', eventIds);

    if (!result.error) {
      allRows.push(...((result.data ?? []) as Record<string, unknown>[]));
    }
  }

  return allRows;
}

async function getChurchHierarchyIds(churchId?: string) {
  const trimmedChurchId = churchId?.trim();
  if (!trimmedChurchId) {
    return { countryId: '', dioceseId: '' };
  }

  const withHierarchy = await supabase
    .from('churches')
    .select('id, country_id, diocese_id')
    .eq('id', trimmedChurchId)
    .maybeSingle();

  let row = withHierarchy.data as Record<string, unknown> | null;
  let fetchError = withHierarchy.error;
  if (fetchError && isMissingColumnError(fetchError.message)) {
    const fallback = await supabase
      .from('churches')
      .select('id')
      .eq('id', trimmedChurchId)
      .maybeSingle();
    row = fallback.data as Record<string, unknown> | null;
    fetchError = fallback.error;
  }

  if (fetchError || !row?.id) {
    return { countryId: '', dioceseId: '' };
  }

  return {
    countryId: row.country_id?.toString() || '',
    dioceseId: row.diocese_id?.toString() || '',
  };
}

async function getRadarEvents(userId?: string) {
  if (!userId) return [] as RadarCardItem[];

  const legacyWithVisibility = await supabase
    .from('radar_events')
    .select('id, title, description, event_time, max_participants, church_id, creator_id, allow_member_invite, status, visibility')
    .order('event_time', { ascending: true })
    .limit(50);
  const legacy =
    legacyWithVisibility.error && isMissingColumnError(legacyWithVisibility.error.message)
      ? await supabase
        .from('radar_events')
        .select('id, title, description, event_time, max_participants, church_id, creator_id, allow_member_invite, status')
        .order('event_time', { ascending: true })
        .limit(50)
      : legacyWithVisibility;

  const v2WithVisibility = await supabase
    .from('radar_events_v2')
    .select('id, title, description, event_starts_at_utc, max_participants, church_id, creator_id, allow_member_invite, status, visibility')
    .order('event_starts_at_utc', { ascending: true })
    .limit(50);
  const v2 =
    v2WithVisibility.error && isMissingColumnError(v2WithVisibility.error.message)
      ? await supabase
        .from('radar_events_v2')
        .select('id, title, description, event_starts_at_utc, max_participants, church_id, creator_id, allow_member_invite, status')
        .order('event_starts_at_utc', { ascending: true })
        .limit(50)
      : v2WithVisibility;

  if (legacy.error && v2.error) {
    console.error('Error fetching radar events:', legacy.error, v2.error);
    return [] as RadarCardItem[];
  }

  const combinedRows: Array<Record<string, unknown> & { __source: RadarSource }> = [
    ...((legacy.data ?? []) as Record<string, unknown>[]).map((row) => ({
      ...row,
      __source: 'legacy' as RadarSource,
    })),
    ...((v2.data ?? []) as Record<string, unknown>[]).map((row) => ({
      ...row,
      __source: 'v2' as RadarSource,
    })),
  ];

  const uniqueById = new Map<string, Record<string, unknown> & { __source: RadarSource }>();
  for (const row of combinedRows) {
    const id = row.id?.toString();
    if (!id) continue;

    if (!uniqueById.has(id)) {
      uniqueById.set(id, row);
      continue;
    }

    if (row.__source === 'v2') {
      uniqueById.set(id, row);
    }
  }

  const rows = Array.from(uniqueById.values()).filter((row) => {
    const visibility = row.visibility?.toString().trim().toUpperCase();
    const status = row.status?.toString().trim().toUpperCase();
    const isPublic = !visibility || visibility === 'PUBLIC';
    const isVisibleStatus =
      !status || ['PUBLISHED', 'UPDATED', 'ACTIVE', 'SCHEDULED'].includes(status);
    return isPublic && isVisibleStatus;
  });
  if (rows.length === 0) {
    return [];
  }

  const churchIds = rows
    .map((row) => row.church_id?.toString())
    .filter((id): id is string => Boolean(id));

  const churchMap = new Map<string, string>();
  if (churchIds.length > 0) {
    const churchResult = await supabase.from('churches').select('id, name').in('id', churchIds);
    if (!churchResult.error) {
      for (const row of (churchResult.data ?? []) as Record<string, unknown>[]) {
        const id = row.id?.toString();
        if (!id) continue;
        churchMap.set(id, row.name?.toString() || 'Gereja');
      }
    }
  }

  const participantMap = new Map<string, number>();
  const eventIds = rows.map((row) => row.id?.toString()).filter((id): id is string => Boolean(id));
  if (eventIds.length > 0) {
    const participantRows = await fetchRadarParticipantRows(eventIds);
    for (const row of participantRows) {
      const radarId = row.radar_id?.toString();
      if (!radarId) continue;
      participantMap.set(radarId, (participantMap.get(radarId) ?? 0) + 1);
    }
  }

  return rows.map((row) => {
    const id = row.id?.toString() ?? createRandomUUID();
    const startsAt = row.event_starts_at_utc?.toString() || row.event_time?.toString();
    const churchId = row.church_id?.toString();
    return {
      id,
      title: row.title?.toString() || 'Radar Misa',
      description: row.description?.toString(),
      startsAt,
      maxParticipants: Number(row.max_participants ?? 0) || undefined,
      participantCount: participantMap.get(id) ?? 0,
      churchId,
      churchName: churchMap.get(churchId || ''),
      creatorId: row.creator_id?.toString(),
      allowMemberInvite:
        typeof row.allow_member_invite === 'boolean' ? row.allow_member_invite : undefined,
      status: row.status?.toString(),
      source: row.__source,
    } satisfies RadarCardItem;
  });
}

async function getOwnerRadarEvents(userId?: string) {
  if (!userId) return [] as RadarCardItem[];

  const legacyWithVisibility = await supabase
    .from('radar_events')
    .select('id, title, description, event_time, max_participants, church_id, creator_id, allow_member_invite, status, visibility')
    .eq('creator_id', userId)
    .order('event_time', { ascending: false })
    .limit(300);
  const legacy =
    legacyWithVisibility.error && isMissingColumnError(legacyWithVisibility.error.message)
      ? await supabase
        .from('radar_events')
        .select('id, title, description, event_time, max_participants, church_id, creator_id, allow_member_invite, status')
        .eq('creator_id', userId)
        .order('event_time', { ascending: false })
        .limit(300)
      : legacyWithVisibility;

  const v2WithVisibility = await supabase
    .from('radar_events_v2')
    .select('id, title, description, event_starts_at_utc, max_participants, church_id, creator_id, allow_member_invite, status, visibility')
    .eq('creator_id', userId)
    .order('event_starts_at_utc', { ascending: false })
    .limit(300);
  const v2 =
    v2WithVisibility.error && isMissingColumnError(v2WithVisibility.error.message)
      ? await supabase
        .from('radar_events_v2')
        .select('id, title, description, event_starts_at_utc, max_participants, church_id, creator_id, allow_member_invite, status')
        .eq('creator_id', userId)
        .order('event_starts_at_utc', { ascending: false })
        .limit(300)
      : v2WithVisibility;

  if (legacy.error && v2.error) {
    console.error('Error fetching owner radar events:', legacy.error, v2.error);
    return [] as RadarCardItem[];
  }

  const combinedRows: Array<Record<string, unknown> & { __source: RadarSource }> = [
    ...((legacy.data ?? []) as Record<string, unknown>[]).map((row) => ({
      ...row,
      __source: 'legacy' as RadarSource,
    })),
    ...((v2.data ?? []) as Record<string, unknown>[]).map((row) => ({
      ...row,
      __source: 'v2' as RadarSource,
    })),
  ];

  const uniqueById = new Map<string, Record<string, unknown> & { __source: RadarSource }>();
  for (const row of combinedRows) {
    const id = row.id?.toString();
    if (!id) continue;
    if (!uniqueById.has(id)) {
      uniqueById.set(id, row);
      continue;
    }
    if (row.__source === 'v2') {
      uniqueById.set(id, row);
    }
  }

  const rows = Array.from(uniqueById.values()).filter((row) => {
    const visibility = row.visibility?.toString().trim().toUpperCase();
    const status = row.status?.toString().trim().toUpperCase();
    const isPublic = !visibility || visibility === 'PUBLIC';
    const isVisibleStatus =
      !status || ['PUBLISHED', 'UPDATED', 'ACTIVE', 'SCHEDULED'].includes(status);
    return isPublic && isVisibleStatus;
  });
  if (rows.length === 0) return [];

  const churchIds = rows
    .map((row) => row.church_id?.toString())
    .filter((id): id is string => Boolean(id));
  const churchMap = new Map<string, string>();
  if (churchIds.length > 0) {
    const churchResult = await supabase.from('churches').select('id, name').in('id', churchIds);
    if (!churchResult.error) {
      for (const row of (churchResult.data ?? []) as Record<string, unknown>[]) {
        const id = row.id?.toString();
        if (!id) continue;
        churchMap.set(id, row.name?.toString() || 'Gereja');
      }
    }
  }

  const participantMap = new Map<string, number>();
  const eventIds = rows.map((row) => row.id?.toString()).filter((id): id is string => Boolean(id));
  if (eventIds.length > 0) {
    const participantRows = await fetchRadarParticipantRows(eventIds);
    for (const row of participantRows) {
      const radarId = row.radar_id?.toString();
      if (!radarId) continue;
      participantMap.set(radarId, (participantMap.get(radarId) ?? 0) + 1);
    }
  }

  return rows
    .map((row) => {
      const id = row.id?.toString() ?? createRandomUUID();
      const startsAt = row.event_starts_at_utc?.toString() || row.event_time?.toString();
      const churchId = row.church_id?.toString();
      return {
        id,
        title: row.title?.toString() || 'Radar Misa',
        description: row.description?.toString(),
        startsAt,
        maxParticipants: Number(row.max_participants ?? 0) || undefined,
        participantCount: participantMap.get(id) ?? 0,
        churchId,
        churchName: churchMap.get(churchId || ''),
        creatorId: row.creator_id?.toString(),
        allowMemberInvite:
          typeof row.allow_member_invite === 'boolean' ? row.allow_member_invite : undefined,
        status: row.status?.toString(),
        source: row.__source,
      } satisfies RadarCardItem;
    })
    .sort((a, b) => new Date(b.startsAt || '').getTime() - new Date(a.startsAt || '').getTime());
}

async function getRadarEventById(radarId?: string): Promise<RadarCardItem | null> {
  const id = radarId?.trim();
  if (!id) return null;

  const legacyWithChurch = await supabase
    .from('radar_events')
    .select('id, title, description, event_time, max_participants, church_id, creator_id, allow_member_invite, status, church_name')
    .eq('id', id)
    .maybeSingle();

  const legacy =
    legacyWithChurch.error && isMissingColumnError(legacyWithChurch.error.message)
      ? await supabase
        .from('radar_events')
        .select('id, title, description, event_time, max_participants, church_id, creator_id, allow_member_invite, status')
        .eq('id', id)
        .maybeSingle()
      : legacyWithChurch;

  const v2WithChurch = await supabase
    .from('radar_events_v2')
    .select('id, title, description, event_starts_at_utc, max_participants, church_id, creator_id, allow_member_invite, status, church_name')
    .eq('id', id)
    .maybeSingle();
  const v2 =
    v2WithChurch.error && isMissingColumnError(v2WithChurch.error.message)
      ? await supabase
        .from('radar_events_v2')
        .select('id, title, description, event_starts_at_utc, max_participants, church_id, creator_id, allow_member_invite, status')
        .eq('id', id)
        .maybeSingle()
      : v2WithChurch;

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

  const participantRows = await fetchRadarParticipantRows([id]);
  const participantCount = participantRows.filter((item) => item.radar_id?.toString() === id).length;
  return {
    id,
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
    status: row.status?.toString(),
    source,
  } satisfies RadarCardItem;
}

async function getLastCheckIn(userId?: string) {
  if (!userId) return null;

  const tableCandidates = ['mass_checkins', 'mass_checkins_v2'];
  const timestamps: number[] = [];

  for (const table of tableCandidates) {
    const result = await supabase
      .from(table)
      .select('checkin_at, check_in_time, mass_time, created_at')
      .eq('user_id', userId)
      .limit(20);

    if (result.error) {
      continue;
    }

    for (const row of (result.data ?? []) as Record<string, unknown>[]) {
      const raw =
        row.checkin_at?.toString() ||
        row.check_in_time?.toString() ||
        row.mass_time?.toString() ||
        row.created_at?.toString();

      if (!raw) continue;
      const time = new Date(raw).getTime();
      if (!Number.isNaN(time)) {
        timestamps.push(time);
      }
    }
  }

  if (timestamps.length === 0) return null;
  return new Date(Math.max(...timestamps)).toISOString();
}

async function getActiveCheckIn(userId?: string): Promise<ActiveCheckIn | null> {
  if (!userId) return null;

  const candidates: ActiveCheckIn[] = [];
  const tableCandidates: Array<'mass_checkins' | 'mass_checkins_v2'> = ['mass_checkins', 'mass_checkins_v2'];

  for (const table of tableCandidates) {
    const withStatus = await supabase
      .from(table)
      .select('id, church_id, checkin_at, check_in_time, mass_time, created_at, status')
      .eq('user_id', userId)
      .eq('status', 'ACTIVE')
      .order('created_at', { ascending: false })
      .limit(1);

    if (withStatus.error) {
      continue;
    }

    const row = ((withStatus.data ?? []) as Record<string, unknown>[])[0];
    if (!row?.id) continue;
    candidates.push({
      id: row.id.toString(),
      table,
      churchId: row.church_id?.toString(),
      checkAt:
        row.checkin_at?.toString() ||
        row.check_in_time?.toString() ||
        row.mass_time?.toString() ||
        row.created_at?.toString(),
    });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => new Date(b.checkAt || '').getTime() - new Date(a.checkAt || '').getTime());
  return candidates[0];
}

async function getRadarMembershipMap(userId?: string, eventIds: string[] = []) {
  if (!userId || eventIds.length === 0) return {} as Record<string, RadarMembershipStatus>;

  const membership = new Map<string, RadarMembershipStatus>();

  for (const table of ['radar_participants', 'radar_participants_v2']) {
    const withStatus = await supabase
      .from(table)
      .select('radar_id, status')
      .eq('user_id', userId)
      .in('radar_id', eventIds);

    let rows = withStatus.data as Record<string, unknown>[] | null;
    let resultError = withStatus.error;

    if (resultError && isMissingColumnError(resultError.message)) {
      const fallback = await supabase
        .from(table)
        .select('radar_id')
        .eq('user_id', userId)
        .in('radar_id', eventIds);
      rows = fallback.data as Record<string, unknown>[] | null;
      resultError = fallback.error;
    }

    if (resultError) {
      if (!isPermissionError(resultError.message)) {
        console.error(`Error fetching radar membership from ${table}:`, resultError);
      }
      continue;
    }

    for (const row of (rows ?? []) as Record<string, unknown>[]) {
      const id = row.radar_id?.toString();
      if (!id) continue;

      const status = normalizeMembershipStatus(row.status);
      const current = membership.get(id);
      if (isJoinedMembershipStatus(status)) {
        membership.set(id, 'JOINED');
      } else if (isPendingMembershipStatus(status)) {
        if (current !== 'JOINED') {
          membership.set(id, 'PENDING');
        }
      } else if (!status) {
        if (!current) {
          membership.set(id, 'JOINED');
        }
      }
    }
  }

  return Object.fromEntries(membership.entries());
}

async function createRadarEvent(params: {
  userId: string;
  churchId: string;
  churchName?: string;
  title: string;
  description: string;
  startsAtIso: string;
  maxParticipants?: number;
}) {
  const {
    userId,
    churchId,
    churchName,
    title,
    description,
    startsAtIso,
    maxParticipants,
  } = params;

  const legacyPayload: Record<string, unknown> = {
    title,
    description,
    church_id: churchId,
    church_name: churchName || 'Gereja',
    event_time: startsAtIso,
    creator_id: userId,
    visibility: 'PUBLIC',
    status: 'PUBLISHED',
    allow_member_invite: true,
    require_host_approval: false,
    max_participants: maxParticipants,
  };

  const legacyCreated = await insertWithColumnFallback('radar_events', legacyPayload, { select: 'id' });
  if (!legacyCreated.error && legacyCreated.data?.id) {
    await insertWithColumnFallback(
      'radar_participants',
      {
        radar_id: legacyCreated.data.id.toString(),
        user_id: userId,
        role: 'HOST',
        status: 'JOINED',
      },
      undefined
    );
    return legacyCreated.data.id.toString();
  }

  const v2Payload: Record<string, unknown> = {
    title,
    description,
    church_id: churchId,
    creator_id: userId,
    event_starts_at_utc: startsAtIso,
    event_ends_at_utc: new Date(new Date(startsAtIso).getTime() + 90 * 60 * 1000).toISOString(),
    status: 'PUBLISHED',
    allow_member_invite: true,
    max_participants: maxParticipants,
  };

  const v2Insert = await insertWithColumnFallback('radar_events_v2', v2Payload, { select: 'id' });
  if (!v2Insert.error && v2Insert.data?.id) {
    await insertWithColumnFallback(
      'radar_participants_v2',
      {
        radar_id: v2Insert.data.id.toString(),
        user_id: userId,
        role: 'HOST',
        status: 'JOINED',
      },
      undefined
    );
    return v2Insert.data.id.toString();
  }

  throw new Error(
    legacyCreated.error?.message ||
    v2Insert.error?.message ||
    'Gagal membuat radar'
  );
}

async function createPersonalRadarInvite(params: {
  creatorId: string;
  creatorName?: string;
  targetId: string;
  churchId: string;
  churchName?: string;
  startsAtIso: string;
  message?: string;
}) {
  const {
    creatorId,
    creatorName,
    targetId,
    churchId,
    churchName,
    startsAtIso,
    message,
  } = params;

  if (!creatorId || !targetId) {
    throw new Error('User tidak valid untuk ajak misa personal.');
  }
  if (creatorId === targetId) {
    throw new Error('Tidak bisa mengajak misa ke akun sendiri.');
  }

  const title = 'Misa Bersama';
  const cleanMessage = message?.trim() || 'Mengajak Anda Misa bersama';
  const radarTimeText = formatDateTimeLabel(startsAtIso) || startsAtIso;

  const churchHierarchy = await getChurchHierarchyIds(churchId);
  if (churchHierarchy.countryId && churchHierarchy.dioceseId) {
    const rpcInvite = await supabase.rpc('radar_v2_send_invite', {
      p_source: 'PERSONAL',
      p_invitee_id: targetId,
      p_country_id: churchHierarchy.countryId,
      p_diocese_id: churchHierarchy.dioceseId,
      p_church_id: churchId,
      p_event_starts_at_utc: startsAtIso,
      p_note: cleanMessage,
      p_expires_at: startsAtIso,
    });

    if (!rpcInvite.error) {
      const rpcRaw = Array.isArray(rpcInvite.data) ? rpcInvite.data[0] : rpcInvite.data;
      const radarId = (rpcRaw as Record<string, unknown> | null)?.radar_id?.toString();
      return radarId || '';
    }

    if (
      !isFunctionMissingError(rpcInvite.error.message) &&
      !isPermissionError(rpcInvite.error.message) &&
      !isNotAuthenticatedError(rpcInvite.error.message)
    ) {
      throw new Error(rpcInvite.error.message);
    }
  }

  const finalizePersonalInvite = async (input: { radarId: string; radarSource: RadarSource }) => {
    const participantTables =
      input.radarSource === 'v2'
        ? (['radar_participants_v2', 'radar_participants'] as const)
        : (['radar_participants', 'radar_participants_v2'] as const);

    let participantInserted = false;
    let participantErrorMessage = '';
    for (const table of participantTables) {
      const participantInsert = await insertWithColumnFallback(table, {
        radar_id: input.radarId,
        user_id: creatorId,
        role: 'HOST',
        status: 'JOINED',
      });
      if (!participantInsert.error) {
        participantInserted = true;
        break;
      }
      participantErrorMessage = participantInsert.error.message;
      if (!isMissingColumnError(participantInsert.error.message)) {
        break;
      }
    }

    if (!participantInserted && participantErrorMessage) {
      throw new Error(participantErrorMessage);
    }

    let inviteInsert = await insertWithColumnFallback(
      'radar_invites',
      {
        inviter_id: creatorId,
        invitee_id: targetId,
        radar_id: input.radarId,
        source: 'PERSONAL',
        status: 'PENDING',
        note: cleanMessage,
      },
      { select: 'id' }
    );

    if (inviteInsert.error && isForeignKeyError(inviteInsert.error.message)) {
      inviteInsert = await insertWithColumnFallback(
        'radar_invites',
        {
          inviter_id: creatorId,
          invitee_id: targetId,
          source: 'PERSONAL',
          status: 'PENDING',
          note: cleanMessage,
        },
        { select: 'id' }
      );
    }

    if (inviteInsert.duplicate) {
      throw new Error('Undangan personal untuk user ini sudah aktif.');
    }
    if (inviteInsert.error) {
      throw new Error(inviteInsert.error.message);
    }

    const inviteId = inviteInsert.data?.id?.toString();
    const notifyMessage = `${creatorName || 'Seseorang'} mengajak Anda Misa di ${churchName || 'Gereja'} (${radarTimeText})`;
    const notificationResult = await insertWithColumnFallback('notifications', {
      user_id: targetId,
      type: 'radar_invite',
      title: 'Ajak Misa Personal',
      message: notifyMessage,
      sender_id: creatorId,
      actor_id: creatorId,
      data: {
        invite_id: inviteId,
        radar_id: input.radarId,
        radar_source: input.radarSource,
        source: 'PERSONAL',
        title,
        starts_at: startsAtIso,
        church_name: churchName,
      },
    });
    if (notificationResult.error && !isMissingColumnError(notificationResult.error.message)) {
      throw new Error(notificationResult.error.message);
    }

    return input.radarId;
  };

  const legacyPayload: Record<string, unknown> = {
    title,
    description: cleanMessage,
    church_id: churchId,
    church_name: churchName || 'Gereja',
    event_time: startsAtIso,
    creator_id: creatorId,
    visibility: 'PRIVATE',
    status: 'PUBLISHED',
    max_participants: 2,
    allow_member_invite: false,
    require_host_approval: false,
  };

  const legacyCreated = await insertWithColumnFallback('radar_events', legacyPayload, { select: 'id' });
  if (!legacyCreated.error && legacyCreated.data?.id) {
    return finalizePersonalInvite({
      radarId: legacyCreated.data.id.toString(),
      radarSource: 'legacy',
    });
  }

  const v2Payload: Record<string, unknown> = {
    title,
    description: cleanMessage,
    church_id: churchId,
    event_starts_at_utc: startsAtIso,
    creator_id: creatorId,
    visibility: 'PRIVATE',
    status: 'PUBLISHED',
    max_participants: 2,
    allow_member_invite: false,
    require_host_approval: false,
  };
  const v2Created = await insertWithColumnFallback('radar_events_v2', v2Payload, { select: 'id' });
  if (!v2Created.error && v2Created.data?.id) {
    return finalizePersonalInvite({
      radarId: v2Created.data.id.toString(),
      radarSource: 'v2',
    });
  }

  throw new Error(
    legacyCreated.error?.message ||
    v2Created.error?.message ||
    'Gagal membuat ajak misa personal.'
  );
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

  const fallbackMembershipStatus: 'JOINED' | 'PENDING' =
    eventPolicy?.require_host_approval === true ? 'PENDING' : 'JOINED';

  const primaryTable = source === 'v2' ? 'radar_participants_v2' : 'radar_participants';
  const secondaryTable = source === 'v2' ? 'radar_participants' : 'radar_participants_v2';

  for (const table of [primaryTable, secondaryTable]) {
    const result = await insertWithColumnFallback(
      table,
      {
        radar_id: radarId,
        user_id: userId,
        role: 'MEMBER',
        status: fallbackMembershipStatus,
      },
      undefined
    );

    if (!result.error) {
      return fallbackMembershipStatus;
    }
  }

  throw new Error('Gagal bergabung ke radar. Cek kebijakan akses radar di Supabase.');
}

async function setCheckInNow(params: {
  userId: string;
  churchId: string;
  countryId?: string;
  dioceseId?: string;
  massScheduleId?: string;
  checkinDate?: string;
  massTime?: string;
  churchTimezone?: string;
}) {
  const {
    userId,
    churchId,
    countryId,
    dioceseId,
    massScheduleId,
    checkinDate,
    massTime,
    churchTimezone,
  } = params;
  const nowIso = new Date().toISOString();
  const selectedDate = (checkinDate || nowIso.split('T')[0]).trim();
  const selectedMassTime = massTime?.trim() || '';
  const timeParts = selectedMassTime.match(/^(\d{1,2}):(\d{2})/);
  let massDateTimeIso = nowIso;
  if (timeParts) {
    const massDate = new Date(`${selectedDate}T${timeParts[1].padStart(2, '0')}:${timeParts[2]}:00`);
    if (!Number.isNaN(massDate.getTime())) {
      massDateTimeIso = massDate.toISOString();
    }
  }
  const resolvedChurchTimezone = (churchTimezone || 'Asia/Jakarta').trim() || 'Asia/Jakarta';

  const archivePayload: Record<string, unknown> = {
    status: 'ARCHIVED',
    archived_at: nowIso,
    updated_at: nowIso,
  };
  for (const table of ['mass_checkins', 'mass_checkins_v2']) {
    const working = { ...archivePayload };
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const archiveResult = await supabase
        .from(table)
        .update(working)
        .eq('user_id', userId)
        .eq('status', 'ACTIVE');

      if (!archiveResult.error) {
        break;
      }
      const missingColumn = extractMissingColumnName(archiveResult.error.message);
      if (
        missingColumn &&
        missingColumn in working &&
        isMissingColumnError(archiveResult.error.message)
      ) {
        delete working[missingColumn];
        continue;
      }
      break;
    }
  }

  if (countryId && dioceseId) {
    const rpcResult = await supabase.rpc('radar_v2_set_checkin', {
      p_country_id: countryId,
      p_diocese_id: dioceseId,
      p_church_id: churchId,
      p_mass_schedule_id: massScheduleId || null,
      p_checkin_date: selectedDate,
      p_visibility: 'PUBLIC',
      p_church_timezone: resolvedChurchTimezone,
    });

    if (!rpcResult.error) {
      return;
    }

    if (
      !isFunctionMissingError(rpcResult.error.message) &&
      !isPermissionError(rpcResult.error.message) &&
      !isNotAuthenticatedError(rpcResult.error.message)
    ) {
      throw new Error(rpcResult.error.message);
    }
  }

  const legacyPayload: Record<string, unknown> = {
    user_id: userId,
    church_id: churchId,
    check_in_time: nowIso,
    mass_time: massDateTimeIso,
    visibility: 'PUBLIC',
    status: 'ACTIVE',
  };

  const legacyInsert = await insertWithColumnFallback('mass_checkins', legacyPayload);
  if (!legacyInsert.error) {
    return;
  }

  const v2Payload: Record<string, unknown> = {
    user_id: userId,
    church_id: churchId,
    checkin_at: nowIso,
    checkin_date: selectedDate,
    church_timezone: resolvedChurchTimezone,
    visibility: 'PUBLIC',
    status: 'ACTIVE',
  };

  if (countryId) {
    v2Payload.country_id = countryId;
  }
  if (dioceseId) {
    v2Payload.diocese_id = dioceseId;
  }
  if (massScheduleId) {
    v2Payload.mass_schedule_id = massScheduleId;
  }

  const v2Insert = await insertWithColumnFallback('mass_checkins_v2', v2Payload);
  if (!v2Insert.error) {
    return;
  }

  throw new Error(
    legacyInsert.error?.message ||
    v2Insert.error?.message ||
    'Gagal check-in sekarang'
  );
}

async function setCheckOutNow(params: { userId: string; active: ActiveCheckIn }) {
  const { userId, active } = params;
  const nowIso = new Date().toISOString();
  const workingPayload: Record<string, unknown> = {
    status: 'ARCHIVED',
    archived_at: nowIso,
    updated_at: nowIso,
  };

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const result = await supabase
      .from(active.table)
      .update(workingPayload)
      .eq('id', active.id)
      .eq('user_id', userId);

    if (!result.error) {
      return;
    }

    const missingColumn = extractMissingColumnName(result.error.message);
    if (
      missingColumn &&
      missingColumn in workingPayload &&
      isMissingColumnError(result.error.message)
    ) {
      delete workingPayload[missingColumn];
      continue;
    }

    if (isPermissionError(result.error.message)) {
      throw new Error('Tidak punya izin check-out pada data check-in ini.');
    }

    throw new Error(result.error.message);
  }

  throw new Error('Gagal check-out sekarang.');
}

async function getCheckInPresence(params: {
  churchId?: string;
  currentUserId?: string;
  limit?: number;
}): Promise<CheckInPresenceItem[]> {
  const { churchId, currentUserId, limit = 8 } = params;
  const selectedChurchId = churchId?.trim();
  if (!selectedChurchId) return [];

  const byUser = new Map<string, { userId: string; checkAt?: string }>();

  for (const table of ['mass_checkins', 'mass_checkins_v2']) {
    const withStatus = await supabase
      .from(table)
      .select('user_id, checkin_at, check_in_time, mass_time, created_at, status')
      .eq('church_id', selectedChurchId)
      .eq('status', 'ACTIVE')
      .order('created_at', { ascending: false })
      .limit(80);

    let rows = withStatus.data as Record<string, unknown>[] | null;
    let resultError = withStatus.error;
    let usedStatusFilter = true;

    if (resultError && isMissingColumnError(resultError.message)) {
      const fallback = await supabase
        .from(table)
        .select('user_id, checkin_at, check_in_time, mass_time, created_at')
        .eq('church_id', selectedChurchId)
        .order('created_at', { ascending: false })
        .limit(80);
      rows = fallback.data as Record<string, unknown>[] | null;
      resultError = fallback.error;
      usedStatusFilter = false;
    }

    if (resultError) {
      if (!isPermissionError(resultError.message)) {
        console.error(`Error fetching check-in presence from ${table}:`, resultError);
      }
      continue;
    }

    for (const row of (rows ?? []) as Record<string, unknown>[]) {
      const userId = row.user_id?.toString();
      if (!userId || userId === currentUserId) continue;

      const checkAt =
        row.checkin_at?.toString() ||
        row.check_in_time?.toString() ||
        row.mass_time?.toString() ||
        row.created_at?.toString();
      if (!checkAt) continue;

      const checkTime = new Date(checkAt).getTime();
      if (Number.isNaN(checkTime)) continue;
      if (!usedStatusFilter) {
        // Legacy fallback without status can include stale rows.
        if (checkTime < Date.now() - 6 * 60 * 60 * 1000) {
          continue;
        }
      }

      const existing = byUser.get(userId);
      if (!existing) {
        byUser.set(userId, { userId, checkAt });
        continue;
      }

      const existingTime = new Date(existing.checkAt || '').getTime();
      if (Number.isNaN(existingTime) || checkTime > existingTime) {
        byUser.set(userId, { userId, checkAt });
      }
    }
  }

  const ordered = Array.from(byUser.values())
    .sort((a, b) => new Date(b.checkAt || '').getTime() - new Date(a.checkAt || '').getTime())
    .slice(0, Math.max(1, limit));

  if (ordered.length === 0) return [];

  const profiles = await getProfilesMap(ordered.map((item) => item.userId));
  return ordered.map((item) => {
    const profile = profiles.get(item.userId);
    return {
      userId: item.userId,
      fullName: profile?.full_name,
      username: profile?.username,
      avatarUrl: profile?.avatar_url,
      checkAt: item.checkAt,
    } satisfies CheckInPresenceItem;
  });
}

async function searchInviteTargets(keyword: string, currentUserId?: string) {
  const query = keyword.trim();
  if (query.length < 2) return [] as InviteTarget[];

  const withUsername = await supabase
    .from('profiles')
    .select('id, full_name, username, avatar_url, role, allow_mass_invite')
    .or(`full_name.ilike.%${query}%,username.ilike.%${query}%`)
    .limit(12);

  let rows = withUsername.data as Record<string, unknown>[] | null;
  let searchError = withUsername.error;
  if (searchError && isMissingColumnError(searchError.message)) {
    const fallback = await supabase
      .from('profiles')
      .select('id, full_name, avatar_url, role')
      .ilike('full_name', `%${query}%`)
      .limit(12);
    rows = fallback.data as Record<string, unknown>[] | null;
    searchError = fallback.error;
  }

  if (searchError) {
    console.error('Error searching invite targets:', searchError);
    return [] as InviteTarget[];
  }

  return ((rows ?? []) as Record<string, unknown>[])
    .map((row) => ({
      id: row.id?.toString() ?? '',
      full_name: row.full_name?.toString(),
      username: row.username?.toString(),
      avatar_url: row.avatar_url?.toString(),
      role: row.role?.toString(),
      allow_mass_invite:
        typeof row.allow_mass_invite === 'boolean' ? row.allow_mass_invite : true,
    }))
    .filter((item) => Boolean(item.id) && item.id !== currentUserId);
}

async function getInviteTargetById(userId?: string): Promise<InviteTarget | null> {
  if (!userId) return null;

  const withUsername = await supabase
    .from('profiles')
    .select('id, full_name, username, avatar_url, role, allow_mass_invite')
    .eq('id', userId)
    .maybeSingle();

  let row = withUsername.data as Record<string, unknown> | null;
  let fetchError = withUsername.error;
  if (fetchError && isMissingColumnError(fetchError.message)) {
    const fallback = await supabase
      .from('profiles')
      .select('id, full_name, avatar_url, role')
      .eq('id', userId)
      .maybeSingle();
    row = fallback.data as Record<string, unknown> | null;
    fetchError = fallback.error;
  }

  if (fetchError || !row?.id) {
    return null;
  }

  return {
    id: row.id.toString(),
    full_name: row.full_name?.toString(),
    username: row.username?.toString(),
    avatar_url: row.avatar_url?.toString(),
    role: row.role?.toString(),
    allow_mass_invite:
      typeof row.allow_mass_invite === 'boolean' ? row.allow_mass_invite : true,
  };
}

async function sendRadarInvite(params: {
  inviterId: string;
  inviterName?: string;
  inviteeId: string;
  radar: RadarCardItem;
}) {
  const { inviterId, inviterName, inviteeId, radar } = params;
  if (!inviterId || !inviteeId) {
    throw new Error('User tidak valid untuk undangan radar.');
  }
  if (inviterId === inviteeId) {
    throw new Error('Tidak bisa mengundang diri sendiri.');
  }

  const eventTable = radar.source === 'v2' ? 'radar_events_v2' : 'radar_events';
  const eventWithPolicy = await supabase
    .from(eventTable)
    .select('id, creator_id, allow_member_invite')
    .eq('id', radar.id)
    .maybeSingle();

  let eventRow = eventWithPolicy.data as Record<string, unknown> | null;
  let eventError = eventWithPolicy.error;
  if (eventError && isMissingColumnError(eventError.message)) {
    const fallback = await supabase
      .from(eventTable)
      .select('id, creator_id')
      .eq('id', radar.id)
      .maybeSingle();
    eventRow = fallback.data as Record<string, unknown> | null;
    eventError = fallback.error;
  }

  if (eventError && !isPermissionError(eventError.message)) {
    throw new Error(eventError.message);
  }

  if (eventRow?.id) {
    const creatorId = eventRow.creator_id?.toString() || '';
    const allowMemberInvite = eventRow.allow_member_invite === true;
    const isHost = creatorId === inviterId;
    if (!isHost && !allowMemberInvite) {
      throw new Error('Host tidak mengizinkan undangan peserta pada radar ini.');
    }
    if (!isHost && allowMemberInvite) {
      const participantTables =
        radar.source === 'v2'
          ? (['radar_participants_v2', 'radar_participants'] as const)
          : (['radar_participants', 'radar_participants_v2'] as const);

      let inviterIsJoinedMember = false;
      for (const table of participantTables) {
        const participant = await supabase
          .from(table)
          .select('status')
          .eq('radar_id', radar.id)
          .eq('user_id', inviterId)
          .maybeSingle();

        if (participant.error) {
          if (!isMissingColumnError(participant.error.message) && !isPermissionError(participant.error.message)) {
            throw new Error(participant.error.message);
          }
          continue;
        }
        if (!participant.data) continue;
        const memberStatus = normalizeMembershipStatus(participant.data.status);
        if (isJoinedMembershipStatus(memberStatus) || !memberStatus) {
          inviterIsJoinedMember = true;
          break;
        }
      }

      if (!inviterIsJoinedMember) {
        throw new Error('Anda harus bergabung dulu ke radar sebelum mengundang user lain.');
      }
    }
  }

  if (radar.source === 'v2') {
    const rpcInvite = await supabase.rpc('radar_v2_send_invite', {
      p_source: 'RADAR_GROUP',
      p_invitee_id: inviteeId,
      p_radar_id: radar.id,
      p_note: radar.title,
    });

    if (!rpcInvite.error) {
      return;
    }
    if (
      !isFunctionMissingError(rpcInvite.error.message) &&
      !isPermissionError(rpcInvite.error.message) &&
      !isNotAuthenticatedError(rpcInvite.error.message)
    ) {
      throw new Error(rpcInvite.error.message);
    }
  }

  const existingInvite = await supabase
    .from('radar_invites')
    .select('id, status')
    .eq('radar_id', radar.id)
    .eq('invitee_id', inviteeId)
    .maybeSingle();
  if (!existingInvite.error && existingInvite.data) {
    const existingStatus = normalizeInviteStatus(existingInvite.data.status);
    if (existingStatus === 'PENDING') {
      throw new Error('Undangan untuk user ini sudah dikirim.');
    }
    if (existingStatus === 'ACCEPTED') {
      throw new Error('User ini sudah menerima undangan sebelumnya.');
    }
  }

  const participantTables =
    radar.source === 'v2'
      ? (['radar_participants_v2', 'radar_participants'] as const)
      : (['radar_participants', 'radar_participants_v2'] as const);
  for (const table of participantTables) {
    const participant = await supabase
      .from(table)
      .select('status')
      .eq('radar_id', radar.id)
      .eq('user_id', inviteeId)
      .maybeSingle();
    if (participant.error) {
      if (!isMissingColumnError(participant.error.message) && !isPermissionError(participant.error.message)) {
        throw new Error(participant.error.message);
      }
      continue;
    }

    if (!participant.data) continue;
    const memberStatus = normalizeMembershipStatus(participant.data.status);
    if (isJoinedMembershipStatus(memberStatus) || !memberStatus) {
      throw new Error('User ini sudah menjadi peserta radar.');
    }
    if (isPendingMembershipStatus(memberStatus)) {
      throw new Error('User ini sudah memiliki permintaan/join status pending.');
    }
  }

  let inviteInsert = await insertWithColumnFallback(
    'radar_invites',
    {
      inviter_id: inviterId,
      invitee_id: inviteeId,
      radar_id: radar.id,
      source: 'RADAR_GROUP',
      status: 'PENDING',
      note: radar.title,
    },
    { select: 'id' }
  );

  if (inviteInsert.error && isForeignKeyError(inviteInsert.error.message)) {
    // Some environments still pin radar_id FK to legacy table only.
    inviteInsert = await insertWithColumnFallback(
      'radar_invites',
      {
        inviter_id: inviterId,
        invitee_id: inviteeId,
        source: 'RADAR_GROUP',
        status: 'PENDING',
        note: radar.title,
      },
      { select: 'id' }
    );
  }

  if (inviteInsert.duplicate) {
    throw new Error('User ini sudah memiliki undangan aktif untuk radar tersebut.');
  }

  if (inviteInsert.error) {
    if (isPermissionError(inviteInsert.error.message)) {
      throw new Error('Tidak punya izin mengirim undangan pada radar ini.');
    }
    throw new Error(inviteInsert.error.message);
  }

  const inviteId = inviteInsert.data?.id?.toString();

  const startsAtText = radar.startsAt
    ? formatDateTimeLabel(radar.startsAt)
    : 'jadwal akan diumumkan';
  const message = `${inviterName || 'Seseorang'} mengundang Anda ke radar: ${radar.title} (${startsAtText})`;

  const notificationPayload: Record<string, unknown> = {
    user_id: inviteeId,
    type: 'radar_invite',
    title: 'Undangan Radar Misa',
    message,
    sender_id: inviterId,
    actor_id: inviterId,
    data: {
      invite_id: inviteId,
      radar_id: radar.id,
      radar_source: radar.source,
      source: 'RADAR_GROUP',
      title: radar.title,
      starts_at: radar.startsAt,
      church_name: radar.churchName,
    },
  };

  const notificationResult = await insertWithColumnFallback('notifications', notificationPayload);
  if (notificationResult.error && !isMissingColumnError(notificationResult.error.message)) {
    throw new Error(notificationResult.error.message);
  }
}

async function getProfilesMap(userIds: string[]) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) {
    return new Map<string, InviteTarget>();
  }

  const result = await supabase
    .from('profiles')
    .select('id, full_name, username, avatar_url, role')
    .in('id', ids);

  if (result.error) {
    console.error('Error fetching profile map:', result.error);
    return new Map<string, InviteTarget>();
  }

  const map = new Map<string, InviteTarget>();
  for (const row of (result.data ?? []) as Record<string, unknown>[]) {
    const id = row.id?.toString();
    if (!id) continue;
    map.set(id, {
      id,
      full_name: row.full_name?.toString(),
      username: row.username?.toString(),
      avatar_url: row.avatar_url?.toString(),
      role: row.role?.toString(),
    });
  }

  return map;
}

async function getRadarMap(radarIds: string[]) {
  const ids = [...new Set(radarIds.filter(Boolean))];
  const map = new Map<string, {
    title?: string;
    startsAt?: string;
    source: RadarSource;
    visibility?: string;
    churchName?: string;
  }>();

  if (ids.length === 0) {
    return map;
  }

  const legacyWithVisibility = await supabase
    .from('radar_events')
    .select('id, title, event_time, visibility, church_name')
    .in('id', ids);
  const legacy =
    legacyWithVisibility.error && isMissingColumnError(legacyWithVisibility.error.message)
      ? await supabase
        .from('radar_events')
        .select('id, title, event_time')
        .in('id', ids)
      : legacyWithVisibility;
  if (!legacy.error) {
    for (const row of (legacy.data ?? []) as Record<string, unknown>[]) {
      const id = row.id?.toString();
      if (!id) continue;
      map.set(id, {
        title: row.title?.toString(),
        startsAt: row.event_time?.toString(),
        source: 'legacy',
        visibility: row.visibility?.toString(),
        churchName: row.church_name?.toString(),
      });
    }
  }

  const v2WithVisibility = await supabase
    .from('radar_events_v2')
    .select('id, title, event_starts_at_utc, visibility, church_name')
    .in('id', ids);
  const v2 =
    v2WithVisibility.error && isMissingColumnError(v2WithVisibility.error.message)
      ? await supabase
        .from('radar_events_v2')
        .select('id, title, event_starts_at_utc')
        .in('id', ids)
      : v2WithVisibility;
  if (!v2.error) {
    for (const row of (v2.data ?? []) as Record<string, unknown>[]) {
      const id = row.id?.toString();
      if (!id) continue;
      map.set(id, {
        title: row.title?.toString(),
        startsAt: row.event_starts_at_utc?.toString(),
        source: 'v2',
        visibility: row.visibility?.toString(),
        churchName: row.church_name?.toString(),
      });
    }
  }

  return map;
}

async function getInviteRows(direction: 'incoming' | 'outgoing', userId?: string) {
  if (!userId) return [] as Record<string, unknown>[];

  const field = direction === 'incoming' ? 'invitee_id' : 'inviter_id';

  const withRadar = await supabase
    .from('radar_invites')
    .select('id, inviter_id, invitee_id, status, created_at, radar_id, source')
    .eq(field, userId)
    .order('created_at', { ascending: false })
    .limit(30);

  if (!withRadar.error) {
    return (withRadar.data ?? []) as Record<string, unknown>[];
  }

  if (!isMissingColumnError(withRadar.error.message)) {
    if (!isPermissionError(withRadar.error.message)) {
      console.error('Error fetching radar_invites:', withRadar.error);
    }
    return [];
  }

  const fallback = await supabase
    .from('radar_invites')
    .select('id, inviter_id, invitee_id, status, created_at')
    .eq(field, userId)
    .order('created_at', { ascending: false })
    .limit(30);

  if (fallback.error) {
    if (!isPermissionError(fallback.error.message)) {
      console.error('Error fetching radar_invites fallback:', fallback.error);
    }
    return [];
  }

  return (fallback.data ?? []) as Record<string, unknown>[];
}

async function getIncomingRadarInvites(userId?: string): Promise<RadarInviteItem[]> {
  if (!userId) return [];

  const tableRows = await getInviteRows('incoming', userId);
  const inviteMap = new Map<string, RadarInviteItem>();

  for (const row of tableRows) {
    const id = row.id?.toString();
    if (!id) continue;
    inviteMap.set(id, {
      id,
      inviteId: id,
      inviterId: row.inviter_id?.toString(),
      inviteeId: row.invitee_id?.toString(),
      inviteSource: row.source?.toString(),
      status: normalizeInviteStatus(row.status),
      createdAt: row.created_at?.toString(),
      radarId: row.radar_id?.toString(),
      direction: 'incoming',
    });
  }

  const notificationsWithRead = await supabase
    .from('notifications')
    .select('id, user_id, type, title, message, data, sender_id, actor_id, created_at, is_read, read_at')
    .eq('user_id', userId)
    .eq('type', 'radar_invite')
    .order('created_at', { ascending: false })
    .limit(50);

  let notificationRows = notificationsWithRead.data as Record<string, unknown>[] | null;
  let notificationError = notificationsWithRead.error;
  if (notificationError && isMissingColumnError(notificationError.message)) {
    const fallback = await supabase
      .from('notifications')
      .select('id, user_id, type, title, message, data, sender_id, actor_id, created_at, read_at')
      .eq('user_id', userId)
      .eq('type', 'radar_invite')
      .order('created_at', { ascending: false })
      .limit(50);
    notificationRows = fallback.data as Record<string, unknown>[] | null;
    notificationError = fallback.error;
  }

  if (!notificationError) {
    for (const row of (notificationRows ?? []) as Record<string, unknown>[]) {
      const data = (row.data as Record<string, unknown> | null) ?? {};
      const inviteId = data.invite_id?.toString();
      const isRead = typeof row.is_read === 'boolean' ? row.is_read : Boolean(row.read_at);
      const status = isRead ? 'SEEN' : 'PENDING';

      const targetId =
        (inviteId && inviteMap.has(inviteId) ? inviteId : null) ||
        `notif:${row.id?.toString() || createRandomUUID()}`;
      const existing = inviteMap.get(targetId);

      inviteMap.set(targetId, {
        id: targetId,
        inviteId: inviteId || existing?.inviteId,
        notificationId: row.id?.toString() || existing?.notificationId,
        inviterId:
          row.sender_id?.toString() ||
          row.actor_id?.toString() ||
          data.inviter_id?.toString() ||
          existing?.inviterId,
        inviteeId: userId,
        status: existing?.status || status,
        createdAt: row.created_at?.toString() || existing?.createdAt,
        radarId: data.radar_id?.toString() || existing?.radarId,
        radarTitle: data.title?.toString() || existing?.radarTitle,
        radarChurchName: data.church_name?.toString() || existing?.radarChurchName,
        radarStartsAt: data.starts_at?.toString() || existing?.radarStartsAt,
        radarSource:
          (data.radar_source?.toString() as RadarSource | undefined) ||
          existing?.radarSource,
        inviteSource:
          data.source?.toString() ||
          existing?.inviteSource,
        message: row.message?.toString() || existing?.message,
        direction: 'incoming',
      });
    }
  } else if (!isPermissionError(notificationError.message)) {
    console.error('Error fetching radar invite notifications:', notificationError);
  }

  const invites = Array.from(inviteMap.values());
  const profileIds = invites
    .flatMap((invite) => [invite.inviterId, invite.inviteeId])
    .filter((id): id is string => Boolean(id));
  const radarIds = invites
    .map((invite) => invite.radarId)
    .filter((id): id is string => Boolean(id));

  const [profiles, radars] = await Promise.all([
    getProfilesMap(profileIds),
    getRadarMap(radarIds),
  ]);

  return invites
    .map((invite) => {
      const inviter = invite.inviterId ? profiles.get(invite.inviterId) : undefined;
      const invitee = invite.inviteeId ? profiles.get(invite.inviteeId) : undefined;
      const radar = invite.radarId ? radars.get(invite.radarId) : undefined;

      return {
        ...invite,
        inviterName: inviter?.full_name || invite.inviterName,
        inviteeName: invitee?.full_name || invite.inviteeName,
        radarTitle: invite.radarTitle || radar?.title,
        radarChurchName: invite.radarChurchName || radar?.churchName,
        radarStartsAt: invite.radarStartsAt || radar?.startsAt,
        radarSource: invite.radarSource || radar?.source,
        radarVisibility: invite.radarVisibility || radar?.visibility,
        inviteSource: invite.inviteSource || (radar?.visibility?.toUpperCase() === 'PRIVATE' ? 'PERSONAL' : undefined),
        status: normalizeInviteStatus(invite.status),
      };
    })
    .sort((a, b) => {
      const aTime = new Date(a.createdAt || '').getTime();
      const bTime = new Date(b.createdAt || '').getTime();
      return bTime - aTime;
    });
}

async function getOutgoingRadarInvites(userId?: string): Promise<RadarInviteItem[]> {
  if (!userId) return [];

  const rows = await getInviteRows('outgoing', userId);
  if (rows.length === 0) return [];

  const invites: RadarInviteItem[] = rows.map((row) => ({
    id: row.id?.toString() || createRandomUUID(),
    inviteId: row.id?.toString(),
    inviterId: row.inviter_id?.toString(),
    inviteeId: row.invitee_id?.toString(),
    inviteSource: row.source?.toString(),
    status: normalizeInviteStatus(row.status),
    createdAt: row.created_at?.toString(),
    radarId: row.radar_id?.toString(),
    direction: 'outgoing',
  }));

  const profileIds = invites
    .flatMap((invite) => [invite.inviterId, invite.inviteeId])
    .filter((id): id is string => Boolean(id));
  const radarIds = invites
    .map((invite) => invite.radarId)
    .filter((id): id is string => Boolean(id));

  const [profiles, radars] = await Promise.all([
    getProfilesMap(profileIds),
    getRadarMap(radarIds),
  ]);

  return invites
    .map((invite) => ({
      ...invite,
      inviterName: invite.inviterId ? profiles.get(invite.inviterId)?.full_name : undefined,
      inviteeName: invite.inviteeId ? profiles.get(invite.inviteeId)?.full_name : undefined,
      radarTitle:
        invite.radarTitle ||
        (invite.radarId ? radars.get(invite.radarId)?.title : undefined),
      radarChurchName:
        invite.radarChurchName ||
        (invite.radarId ? radars.get(invite.radarId)?.churchName : undefined),
      radarStartsAt:
        invite.radarStartsAt ||
        (invite.radarId ? radars.get(invite.radarId)?.startsAt : undefined),
      radarSource:
        invite.radarSource ||
        (invite.radarId ? radars.get(invite.radarId)?.source : undefined),
      radarVisibility:
        invite.radarVisibility ||
        (invite.radarId ? radars.get(invite.radarId)?.visibility : undefined),
      inviteSource:
        invite.inviteSource ||
        (invite.radarId && radars.get(invite.radarId)?.visibility?.toUpperCase() === 'PRIVATE'
          ? 'PERSONAL'
          : undefined),
      status: normalizeInviteStatus(invite.status),
    }))
    .sort((a, b) => {
      const aTime = new Date(a.createdAt || '').getTime();
      const bTime = new Date(b.createdAt || '').getTime();
      return bTime - aTime;
    });
}

async function markNotificationRead(notificationId: string) {
  if (!notificationId) return;

  const withIsRead = await supabase
    .from('notifications')
    .update({
      is_read: true,
      read_at: new Date().toISOString(),
    })
    .eq('id', notificationId);

  if (!withIsRead.error) return;
  if (!isMissingColumnError(withIsRead.error.message)) return;

  await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId);
}

async function respondToRadarInvite(params: {
  userId: string;
  userName?: string;
  invite: RadarInviteItem;
  accept: boolean;
}) {
  const { userId, userName, invite, accept } = params;
  const nextStatus = accept ? 'ACCEPTED' : 'DECLINED';
  let joinWarning: string | null = null;

  if (invite.inviteId) {
    let updatedViaRpc = false;

    const useV2Respond =
      invite.radarSource === 'v2' ||
      invite.inviteSource?.trim().toUpperCase() === 'PERSONAL';

    if (useV2Respond) {
      const rpcV2 = await supabase.rpc('radar_v2_respond_invite', {
        p_invite_id: invite.inviteId,
        p_accept: accept,
      });
      updatedViaRpc = !rpcV2.error;
      if (
        rpcV2.error &&
        !isFunctionMissingError(rpcV2.error.message) &&
        !isPermissionError(rpcV2.error.message) &&
        !isNotAuthenticatedError(rpcV2.error.message)
      ) {
        throw new Error(rpcV2.error.message);
      }
    }

    if (!updatedViaRpc) {
      const rpcLegacy = await supabase.rpc('respond_radar_invite', {
        p_invite_id: invite.inviteId,
        p_accept: accept,
      });

      updatedViaRpc = !rpcLegacy.error;

      if (
        rpcLegacy.error &&
        !isFunctionMissingError(rpcLegacy.error.message) &&
        !isPermissionError(rpcLegacy.error.message) &&
        !isNotAuthenticatedError(rpcLegacy.error.message)
      ) {
        throw new Error(rpcLegacy.error.message);
      }
    }

    if (!updatedViaRpc) {
      const updateResult = await supabase
        .from('radar_invites')
        .update({
          status: nextStatus,
          responded_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', invite.inviteId)
        .eq('invitee_id', userId);

      if (
        updateResult.error &&
        !isPermissionError(updateResult.error.message) &&
        !isMissingColumnError(updateResult.error.message)
      ) {
        throw new Error(updateResult.error.message);
      }

      updatedViaRpc = !updateResult.error;
    }

    if (!updatedViaRpc && !invite.notificationId) {
      throw new Error('Undangan tidak dapat diperbarui.');
    }
  }

  if (invite.notificationId) {
    await markNotificationRead(invite.notificationId);
  }

  if (accept && invite.radarId && invite.radarSource) {
    try {
      await joinRadarEvent({
        radarId: invite.radarId,
        userId,
        source: invite.radarSource,
      });
    } catch (error) {
      joinWarning = error instanceof Error ? error.message : 'Gagal join radar setelah menerima undangan';
    }
  }

  if (invite.inviterId) {
    const notifyResult = await insertWithColumnFallback('notifications', {
      user_id: invite.inviterId,
      type: accept ? 'radar_invite_accepted' : 'radar_invite_declined',
      title: accept ? 'Undangan Radar Diterima' : 'Undangan Radar Ditolak',
      message: accept
        ? `${userName || 'Seseorang'} menerima undangan radar Anda.`
        : `${userName || 'Seseorang'} menolak undangan radar Anda.`,
      sender_id: userId,
      actor_id: userId,
      data: {
        invite_id: invite.inviteId,
        radar_id: invite.radarId,
      },
    });

    if (notifyResult.error && !isMissingColumnError(notifyResult.error.message)) {
      throw new Error(notifyResult.error.message);
    }
  }

  return {
    joinWarning,
  };
}

export default function RadarPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const { user, profile } = useAuth();
  const { data: churches = [] } = useChurches();
  const canCreateRadar = canCreateRadarByRole(profile?.role);

  const requestedTab = searchParams.get('tab');
  const targetIdFromQuery = searchParams.get('targetId')?.trim() ?? '';
  const targetNameFromQuery = searchParams.get('targetName')?.trim() ?? '';
  const radarIdFromQuery = searchParams.get('radarId')?.trim() ?? '';
  const openCheckinFromQuery = searchParams.get('openCheckin') === '1';
  const openCreateFromQuery = searchParams.get('openCreate') === '1';
  const normalizedRequestedTab =
    requestedTab === 'ajak' || requestedTab === 'riwayat' || requestedTab === 'cari'
      ? requestedTab
      : targetIdFromQuery
        ? 'ajak'
        : 'cari';

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isCheckInDialogOpen, setIsCheckInDialogOpen] = useState(false);
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false);
  const [isCheckingIn, setIsCheckingIn] = useState(false);
  const [joiningRadarId, setJoiningRadarId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'cari' | 'riwayat' | 'ajak'>(normalizedRequestedTab);
  const [isPresenceExpanded, setIsPresenceExpanded] = useState(false);
  const [publicFilter, setPublicFilter] = useState<PublicFilter>('all');
  const [publicSort, setPublicSort] = useState<PublicSort>('soonest');

  const [createTitle, setCreateTitle] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createChurchId, setCreateChurchId] = useState('');
  const [createStartsAt, setCreateStartsAt] = useState(
    toLocalDateTimeValue(new Date(Date.now() + 24 * 60 * 60 * 1000))
  );
  const [createMaxParticipants, setCreateMaxParticipants] = useState('30');
  const [inviteKeyword, setInviteKeyword] = useState(targetNameFromQuery);
  const [selectedInviteRadarId, setSelectedInviteRadarId] = useState('');
  const [invitingTargetId, setInvitingTargetId] = useState<string | null>(null);
  const [respondingInviteId, setRespondingInviteId] = useState<string | null>(null);
  const [isSubmittingPersonalInvite, setIsSubmittingPersonalInvite] = useState(false);
  const [personalChurchId, setPersonalChurchId] = useState('');
  const [personalStartsAt, setPersonalStartsAt] = useState(
    toLocalDateTimeValue(new Date(Date.now() + 24 * 60 * 60 * 1000))
  );
  const [personalMessage, setPersonalMessage] = useState('Mengajak Anda Misa bersama');
  const [checkInChurchId, setCheckInChurchId] = useState('');
  const [checkInDate, setCheckInDate] = useState(toLocalDateValue(new Date()));
  const [checkInScheduleId, setCheckInScheduleId] = useState('');

  useEffect(() => {
    setActiveTab(normalizedRequestedTab);
  }, [normalizedRequestedTab]);

  useEffect(() => {
    if (!targetNameFromQuery) return;
    setInviteKeyword((current) => current || targetNameFromQuery);
  }, [targetNameFromQuery]);
  useEffect(() => {
    if (!openCreateFromQuery) return;
    if (!canCreateRadar) return;
    setIsCreateDialogOpen(true);
  }, [canCreateRadar, openCreateFromQuery]);

  useEffect(() => {
    if (!createChurchId && churches.length > 0) {
      const preferredChurch = profile?.church_id && churches.some((church) => church.id === profile.church_id)
        ? profile.church_id
        : churches[0].id;
      setCreateChurchId(preferredChurch || '');
    }
  }, [churches, createChurchId, profile?.church_id]);

  useEffect(() => {
    if (personalChurchId || churches.length === 0) return;
    const preferredChurch = profile?.church_id && churches.some((church) => church.id === profile.church_id)
      ? profile.church_id
      : churches[0].id;
    setPersonalChurchId(preferredChurch || '');
  }, [churches, personalChurchId, profile?.church_id]);
  useEffect(() => {
    if (checkInChurchId || !churches.length) return;
    const preferredChurch =
      profile?.church_id && churches.some((church) => church.id === profile.church_id)
        ? profile.church_id
        : churches[0].id;
    setCheckInChurchId(preferredChurch || '');
  }, [churches, checkInChurchId, profile?.church_id]);
  useEffect(() => {
    setCheckInScheduleId('');
  }, [checkInChurchId, checkInDate]);

  const { data: events = [], isLoading } = useQuery({
    queryKey: ['radar-events', user?.id],
    queryFn: () => getRadarEvents(user?.id),
    enabled: Boolean(user?.id),
  });
  const { data: ownerHistoryEvents = [], isLoading: isLoadingOwnerHistory } = useQuery({
    queryKey: ['owner-radar-events', user?.id],
    queryFn: () => getOwnerRadarEvents(user?.id),
    enabled: Boolean(user?.id),
  });

  const { data: lastCheckIn } = useQuery({
    queryKey: ['last-checkin', user?.id],
    queryFn: () => getLastCheckIn(user?.id),
    enabled: Boolean(user?.id),
  });

  const { data: activeCheckIn } = useQuery({
    queryKey: ['active-checkin', user?.id],
    queryFn: () => getActiveCheckIn(user?.id),
    enabled: Boolean(user?.id),
    refetchInterval: 60_000,
  });
  const { data: focusedRadar, isLoading: isLoadingFocusedRadar } = useQuery({
    queryKey: ['radar-by-id', radarIdFromQuery],
    queryFn: () => getRadarEventById(radarIdFromQuery),
    enabled: radarIdFromQuery.length > 0,
    staleTime: 60_000,
  });
  const { data: checkInSchedules = [], isLoading: isLoadingCheckInSchedules } = useMassSchedules({
    churchId: checkInChurchId || undefined,
  });

  const eventIds = useMemo(() => {
    const ids = events.map((event) => event.id);
    if (focusedRadar?.id && !ids.includes(focusedRadar.id)) {
      ids.push(focusedRadar.id);
    }
    return ids;
  }, [events, focusedRadar?.id]);
  const { data: radarMembershipMap = {} } = useQuery({
    queryKey: ['radar-membership-map', user?.id, eventIds],
    queryFn: () => getRadarMembershipMap(user?.id, eventIds),
    enabled: Boolean(user?.id) && eventIds.length > 0,
  });
  const joinedRadarSet = useMemo(
    () =>
      new Set(
        Object.entries(radarMembershipMap)
          .filter(([, status]) => status === 'JOINED')
          .map(([id]) => id)
      ),
    [radarMembershipMap]
  );
  const pendingRadarSet = useMemo(
    () =>
      new Set(
        Object.entries(radarMembershipMap)
          .filter(([, status]) => status === 'PENDING')
          .map(([id]) => id)
      ),
    [radarMembershipMap]
  );

  const upcomingEvents = useMemo(
    () =>
      events.filter((event) => {
        if (!event.startsAt) return true;
        return new Date(event.startsAt).getTime() >= Date.now() - 24 * 60 * 60 * 1000;
      }),
    [events]
  );

  const defaultCheckInChurchId = useMemo(() => {
    if (profile?.church_id) return profile.church_id;
    if (upcomingEvents[0]?.churchId) return upcomingEvents[0].churchId;
    return churches[0]?.id;
  }, [churches, profile?.church_id, upcomingEvents]);
  useEffect(() => {
    if (!openCheckinFromQuery) return;
    if (activeCheckIn) return;
    const fallbackChurchId = defaultCheckInChurchId || churches[0]?.id || '';
    if (!fallbackChurchId) return;
    setCheckInChurchId((current) => current || fallbackChurchId);
    setCheckInDate(toLocalDateValue(new Date()));
    setIsCheckInDialogOpen(true);
  }, [activeCheckIn, churches, defaultCheckInChurchId, openCheckinFromQuery]);
  useEffect(() => {
    if (!activeCheckIn) {
      setIsPresenceExpanded(false);
    }
  }, [activeCheckIn]);
  const checkInDayOfWeek = useMemo(() => {
    const date = new Date(`${checkInDate}T00:00:00`);
    if (Number.isNaN(date.getTime())) return new Date().getDay();
    return date.getDay();
  }, [checkInDate]);
  const scheduleOptionsForDate = useMemo(
    () =>
      checkInSchedules.filter(
        (schedule) =>
          Number(schedule.day_of_week ?? -1) === checkInDayOfWeek
      ),
    [checkInDayOfWeek, checkInSchedules]
  );
  const selectedCheckInSchedule = useMemo(
    () =>
      scheduleOptionsForDate.find((schedule) => schedule.id === checkInScheduleId) ||
      null,
    [checkInScheduleId, scheduleOptionsForDate]
  );
  useEffect(() => {
    if (checkInScheduleId || scheduleOptionsForDate.length !== 1) return;
    setCheckInScheduleId(scheduleOptionsForDate[0].id);
  }, [checkInScheduleId, scheduleOptionsForDate]);
  const filteredUpcomingEvents = useMemo(() => {
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startTomorrow = new Date(startToday);
    startTomorrow.setDate(startTomorrow.getDate() + 1);
    const startAfterTomorrow = new Date(startTomorrow);
    startAfterTomorrow.setDate(startAfterTomorrow.getDate() + 1);
    const startNextWeek = new Date(startToday);
    startNextWeek.setDate(startNextWeek.getDate() + 7);

    const filtered = upcomingEvents.filter((event) => {
      if (!event.startsAt) return publicFilter === 'all';
      const startsAt = new Date(event.startsAt);
      if (Number.isNaN(startsAt.getTime())) return publicFilter === 'all';
      if (publicFilter === 'today') {
        return startsAt >= startToday && startsAt < startTomorrow;
      }
      if (publicFilter === 'tomorrow') {
        return startsAt >= startTomorrow && startsAt < startAfterTomorrow;
      }
      if (publicFilter === 'week') {
        return startsAt >= startToday && startsAt < startNextWeek;
      }
      return true;
    });

    const sorted = [...filtered];
    if (publicSort === 'popular') {
      sorted.sort((a, b) => {
        const participantDiff = (b.participantCount || 0) - (a.participantCount || 0);
        if (participantDiff !== 0) return participantDiff;
        return new Date(a.startsAt || '').getTime() - new Date(b.startsAt || '').getTime();
      });
      return sorted;
    }

    sorted.sort((a, b) => new Date(a.startsAt || '').getTime() - new Date(b.startsAt || '').getTime());
    return sorted;
  }, [publicFilter, publicSort, upcomingEvents]);

  const inviteRadarOptions = useMemo(() => {
    const upcomingMine = ownerHistoryEvents.filter((event) => {
      if (!event.startsAt) return true;
      return new Date(event.startsAt).getTime() >= Date.now() - 24 * 60 * 60 * 1000;
    });
    let base: RadarCardItem[] = [];
    if (upcomingMine.length > 0) {
      base = upcomingMine;
    } else if (ownerHistoryEvents.length > 0) {
      base = ownerHistoryEvents;
    } else if (upcomingEvents.length > 0) {
      base = upcomingEvents;
    } else {
      base = events;
    }

    if (!focusedRadar) return base;
    if (base.some((item) => item.id === focusedRadar.id)) return base;
    return [focusedRadar, ...base];
  }, [events, focusedRadar, ownerHistoryEvents, upcomingEvents]);

  const selectedInviteRadar = useMemo(() => {
    return (
      inviteRadarOptions.find((radar) => radar.id === selectedInviteRadarId) ||
      inviteRadarOptions[0] ||
      null
    );
  }, [inviteRadarOptions, selectedInviteRadarId]);
  useEffect(() => {
    if (!radarIdFromQuery) return;
    if (!inviteRadarOptions.some((item) => item.id === radarIdFromQuery)) return;
    setSelectedInviteRadarId((current) => (current === radarIdFromQuery ? current : radarIdFromQuery));
  }, [inviteRadarOptions, radarIdFromQuery]);
  const canInviteOnSelectedRadar = useMemo(() => {
    if (!selectedInviteRadar || !user?.id) return false;
    if (selectedInviteRadar.creatorId === user.id) return true;
    if (selectedInviteRadar.allowMemberInvite === false) return false;
    return true;
  }, [selectedInviteRadar, user?.id]);

  const { data: inviteTargets = [], isLoading: isLoadingInviteTargets } = useQuery({
    queryKey: ['radar-invite-targets', user?.id, inviteKeyword],
    queryFn: () => searchInviteTargets(inviteKeyword, user?.id),
    enabled: Boolean(user?.id) && inviteKeyword.trim().length >= 2,
    staleTime: 30_000,
  });

  const { data: targetFromProfile, isLoading: isLoadingTargetFromProfile } = useQuery({
    queryKey: ['radar-target-from-profile', targetIdFromQuery],
    queryFn: () => getInviteTargetById(targetIdFromQuery),
    enabled: targetIdFromQuery.length > 0,
    staleTime: 60_000,
  });

  const { data: incomingInvites = [], isLoading: isLoadingIncomingInvites } = useQuery({
    queryKey: ['radar-incoming-invites', user?.id],
    queryFn: () => getIncomingRadarInvites(user?.id),
    enabled: Boolean(user?.id),
    refetchInterval: 60_000,
  });

  const { data: outgoingInvites = [], isLoading: isLoadingOutgoingInvites } = useQuery({
    queryKey: ['radar-outgoing-invites', user?.id],
    queryFn: () => getOutgoingRadarInvites(user?.id),
    enabled: Boolean(user?.id),
    refetchInterval: 60_000,
  });
  const activePresenceChurchId = activeCheckIn?.churchId || defaultCheckInChurchId;
  const { data: checkInPresence = [], isLoading: isLoadingCheckInPresence } = useQuery({
    queryKey: ['checkin-presence', activePresenceChurchId, user?.id],
    queryFn: () =>
      getCheckInPresence({
        churchId: activePresenceChurchId,
        currentUserId: user?.id,
        limit: 8,
      }),
    enabled: Boolean(activeCheckIn && activePresenceChurchId),
    refetchInterval: 60_000,
  });

  useEffect(() => {
    const fallbackName = targetFromProfile?.full_name?.trim() || targetFromProfile?.username?.trim();
    if (!fallbackName) return;
    setInviteKeyword((current) => current || fallbackName);
  }, [targetFromProfile?.full_name, targetFromProfile?.username]);

  const incomingPersonalInvites = useMemo(
    () =>
      incomingInvites.filter(
        (invite) =>
          isPersonalInvite(invite) &&
          isPendingInvite(invite.status) &&
          Boolean(invite.inviteId)
      ),
    [incomingInvites]
  );
  const outgoingPersonalInvites = useMemo(
    () => outgoingInvites.filter((invite) => isPersonalInvite(invite) && Boolean(invite.inviteId)),
    [outgoingInvites]
  );
  const pendingIncomingCount = useMemo(
    () => incomingPersonalInvites.length,
    [incomingPersonalInvites]
  );
  const canCheckInNow = Boolean(defaultCheckInChurchId);
  const checkInChurchName = useMemo(
    () => churches.find((church) => church.id === checkInChurchId)?.name || 'Gereja',
    [checkInChurchId, churches]
  );
  const activeCheckInChurchName = useMemo(
    () => churches.find((church) => church.id === activePresenceChurchId)?.name || 'gereja terpilih',
    [activePresenceChurchId, churches]
  );
  const focusedRadarMembership = focusedRadar?.id ? radarMembershipMap[focusedRadar.id] : undefined;
  const isFocusedRadarJoined = focusedRadarMembership === 'JOINED';
  const isFocusedRadarPending = focusedRadarMembership === 'PENDING';
  const canInviteOnFocusedRadar = useMemo(() => {
    if (!focusedRadar || !user?.id) return false;
    if (focusedRadar.creatorId === user.id) return true;
    return focusedRadar.allowMemberInvite !== false;
  }, [focusedRadar, user?.id]);

  const inviteCandidateTargets = useMemo(() => {
    const list: InviteTarget[] = [];
    const used = new Set<string>();

    if (targetFromProfile?.id && targetFromProfile.id !== user?.id) {
      list.push(targetFromProfile);
      used.add(targetFromProfile.id);
    }

    for (const target of inviteTargets) {
      if (!target.id || target.id === user?.id || used.has(target.id)) continue;
      list.push(target);
      used.add(target.id);
    }

    return list;
  }, [inviteTargets, targetFromProfile, user?.id]);

  const handleCreateRadar = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user?.id) {
      toast.error('Anda harus login untuk membuat radar');
      return;
    }
    if (!canCreateRadar) {
      toast.error('Fitur buat radar hanya untuk Umat & Katekumen.');
      return;
    }

    if (!createChurchId) {
      toast.error('Pilih gereja terlebih dahulu');
      return;
    }

    const startsAt = new Date(createStartsAt);
    if (Number.isNaN(startsAt.getTime())) {
      toast.error('Waktu radar tidak valid');
      return;
    }

    const title = createTitle.trim();
    if (!title) {
      toast.error('Judul radar wajib diisi');
      return;
    }

    setIsSubmittingCreate(true);
    try {
      const selectedChurch = churches.find((church) => church.id === createChurchId);
      const parsedMax = Number(createMaxParticipants);
      const maxParticipants = Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : undefined;

      await createRadarEvent({
        userId: user.id,
        churchId: createChurchId,
        churchName: selectedChurch?.name,
        title,
        description: createDescription.trim(),
        startsAtIso: startsAt.toISOString(),
        maxParticipants,
      });

      toast.success('Radar berhasil dibuat');
      setIsCreateDialogOpen(false);
      setCreateTitle('');
      setCreateDescription('');
      setCreateStartsAt(toLocalDateTimeValue(new Date(Date.now() + 24 * 60 * 60 * 1000)));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['radar-events', user.id] }),
        queryClient.invalidateQueries({ queryKey: ['owner-radar-events', user.id] }),
      ]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal membuat radar');
    } finally {
      setIsSubmittingCreate(false);
    }
  };

  const handleOpenCheckInDialog = () => {
    const fallbackChurchId = defaultCheckInChurchId || churches[0]?.id || '';
    if (!fallbackChurchId) {
      toast.error('Belum ada data gereja untuk check-in');
      return;
    }
    if (!checkInChurchId) {
      setCheckInChurchId(fallbackChurchId);
    }
    setCheckInDate(toLocalDateValue(new Date()));
    setIsCheckInDialogOpen(true);
  };

  const handleSubmitCheckIn = async () => {
    if (!user?.id) {
      toast.error('Anda harus login untuk check-in');
      return;
    }

    if (!checkInChurchId) {
      toast.error('Pilih gereja terlebih dahulu');
      return;
    }

    setIsCheckingIn(true);
    try {
      const hierarchy = await getChurchHierarchyIds(checkInChurchId);
      const resolvedCountryId = profile?.country_id || hierarchy.countryId;
      const resolvedDioceseId = profile?.diocese_id || hierarchy.dioceseId;
      await setCheckInNow({
        userId: user.id,
        churchId: checkInChurchId,
        countryId: resolvedCountryId,
        dioceseId: resolvedDioceseId,
        massScheduleId: selectedCheckInSchedule?.id,
        checkinDate: checkInDate,
        massTime: selectedCheckInSchedule?.mass_time,
      });
      toast.success(
        selectedCheckInSchedule
          ? `Check-in berhasil (${selectedCheckInSchedule.mass_time})`
          : 'Check-in berhasil'
      );
      setIsCheckInDialogOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['active-checkin', user.id] }),
        queryClient.invalidateQueries({ queryKey: ['last-checkin', user.id] }),
        queryClient.invalidateQueries({ queryKey: ['radar-events', user.id] }),
        queryClient.invalidateQueries({ queryKey: ['checkin-presence', checkInChurchId, user.id] }),
      ]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal check-in');
    } finally {
      setIsCheckingIn(false);
    }
  };

  const handleCheckOutNow = async () => {
    if (!user?.id) {
      toast.error('Anda harus login untuk check-out');
      return;
    }
    if (!activeCheckIn) {
      toast.info('Belum ada check-in aktif.');
      return;
    }

    setIsCheckingIn(true);
    try {
      await setCheckOutNow({ userId: user.id, active: activeCheckIn });
      toast.success('Check-out berhasil');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['active-checkin', user.id] }),
        queryClient.invalidateQueries({ queryKey: ['last-checkin', user.id] }),
        queryClient.invalidateQueries({ queryKey: ['checkin-presence', defaultCheckInChurchId, user.id] }),
      ]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal check-out');
    } finally {
      setIsCheckingIn(false);
    }
  };

  const handleJoinRadar = async (radar: RadarCardItem) => {
    if (!user?.id) {
      toast.error('Anda harus login untuk bergabung');
      return;
    }

    setJoiningRadarId(radar.id);
    try {
      const joinStatus = await joinRadarEvent({
        radarId: radar.id,
        userId: user.id,
        source: radar.source,
      });

      toast.success(
        joinStatus === 'PENDING'
          ? 'Permintaan bergabung dikirim. Menunggu persetujuan host.'
          : 'Berhasil bergabung ke radar'
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['radar-membership-map', user.id] }),
        queryClient.invalidateQueries({ queryKey: ['radar-events', user.id] }),
      ]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal bergabung');
    } finally {
      setJoiningRadarId(null);
    }
  };

  const handleOpenRadarDetail = (radar: RadarCardItem) => {
    if (!radar.id) return;
    router.push(`/radar/${encodeURIComponent(radar.id)}`);
  };

  const handleOpenFocusedRadarInvite = () => {
    if (!focusedRadar) return;
    setSelectedInviteRadarId(focusedRadar.id);
    setActiveTab('ajak');
  };

  const handleClearFocusedRadar = () => {
    router.push('/radar');
  };

  const handleSendInvite = async (target: InviteTarget) => {
    if (!user?.id) {
      toast.error('Anda harus login untuk mengundang');
      return;
    }

    if (target.allow_mass_invite === false) {
      toast.info('User ini menonaktifkan fitur Ajak Misa dari profil.');
      return;
    }

    if (!selectedInviteRadar) {
      toast.error('Pilih radar terlebih dahulu');
      return;
    }
    if (!canInviteOnSelectedRadar) {
      toast.error('Host radar ini tidak mengizinkan undangan member.');
      return;
    }

    setInvitingTargetId(target.id);
    try {
      await sendRadarInvite({
        inviterId: user.id,
        inviterName: profile?.full_name || user.email || 'User',
        inviteeId: target.id,
        radar: selectedInviteRadar,
      });
      toast.success(`Undangan dikirim ke ${target.full_name || 'user'}`);
      await queryClient.invalidateQueries({ queryKey: ['radar-outgoing-invites', user.id] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal mengirim undangan');
    } finally {
      setInvitingTargetId(null);
    }
  };

  const handleSendPersonalInvite = async () => {
    if (!user?.id) {
      toast.error('Anda harus login untuk mengajak misa personal.');
      return;
    }
    if (!targetFromProfile) {
      toast.error('Target user tidak tersedia.');
      return;
    }
    if (targetFromProfile.allow_mass_invite === false) {
      toast.info('User ini menonaktifkan fitur Ajak Misa dari profil.');
      return;
    }
    if (!personalChurchId) {
      toast.error('Pilih gereja untuk ajak misa personal.');
      return;
    }

    const startsAt = new Date(personalStartsAt);
    if (Number.isNaN(startsAt.getTime())) {
      toast.error('Waktu ajak misa tidak valid.');
      return;
    }

    setIsSubmittingPersonalInvite(true);
    try {
      const selectedChurch = churches.find((church) => church.id === personalChurchId);
      await createPersonalRadarInvite({
        creatorId: user.id,
        creatorName: profile?.full_name || user.email || 'User',
        targetId: targetFromProfile.id,
        churchId: personalChurchId,
        churchName: selectedChurch?.name,
        startsAtIso: startsAt.toISOString(),
        message: personalMessage.trim(),
      });

      toast.success(`Ajak misa personal terkirim ke ${targetFromProfile.full_name || 'user'}`);
      setPersonalMessage('Mengajak Anda Misa bersama');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['radar-events', user.id] }),
        queryClient.invalidateQueries({ queryKey: ['owner-radar-events', user.id] }),
        queryClient.invalidateQueries({ queryKey: ['radar-outgoing-invites', user.id] }),
      ]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal mengirim ajak misa personal.');
    } finally {
      setIsSubmittingPersonalInvite(false);
    }
  };

  const handleRespondInvite = async (invite: RadarInviteItem, accept: boolean) => {
    if (!user?.id) {
      toast.error('Anda harus login');
      return;
    }
    if (!invite.inviteId) {
      toast.error('Undangan ini tidak valid atau sudah tidak tersedia.');
      return;
    }

    setRespondingInviteId(invite.id);
    try {
      const response = await respondToRadarInvite({
        userId: user.id,
        userName: profile?.full_name || user.email || 'User',
        invite,
        accept,
      });
      if (accept && response.joinWarning) {
        toast.warning(`Undangan diterima, tetapi join radar belum berhasil: ${response.joinWarning}`);
      } else {
        toast.success(accept ? 'Undangan diterima' : 'Undangan ditolak');
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['radar-incoming-invites', user.id] }),
        queryClient.invalidateQueries({ queryKey: ['radar-outgoing-invites', user.id] }),
        queryClient.invalidateQueries({ queryKey: ['radar-membership-map', user.id] }),
        queryClient.invalidateQueries({ queryKey: ['radar-events', user.id] }),
      ]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal merespons undangan');
    } finally {
      setRespondingInviteId(null);
    }
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/12 via-primary/5 to-background p-4 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary/80">Radar</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Radar Misa</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Cari komunitas misa, lakukan check-in, dan kirim ajakan misa personal.
            </p>
          </div>
          <Button
            className="rounded-xl bg-primary hover:bg-primary-hover"
            onClick={() => setIsCreateDialogOpen(true)}
            disabled={!canCreateRadar}
            title={!canCreateRadar ? 'Fitur buat radar hanya untuk Umat & Katekumen.' : undefined}
          >
            <Plus className="mr-2 h-4 w-4" />
            Buat Radar
          </Button>
        </div>
      </div>

      <Card className={cn('overflow-hidden rounded-2xl border shadow-sm', activeCheckIn ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-primary/25 bg-primary/5')}>
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">Check-in Misa</h2>
              <p className="text-sm text-muted-foreground">
                {activeCheckIn
                  ? `Sedang aktif sejak ${formatDateTimeLabel(activeCheckIn.checkAt)}`
                  : `Terakhir check-in: ${lastCheckIn ? formatDateTimeLabel(lastCheckIn) : 'Belum pernah'}`}
              </p>
              {defaultCheckInChurchId && (
                <p className="text-xs text-muted-foreground">
                  Gereja default: {churches.find((church) => church.id === defaultCheckInChurchId)?.name || 'Gereja'}
                </p>
              )}
              {!activeCheckIn && !canCheckInNow && (
                <p className="text-xs font-medium text-amber-700">
                  Lengkapi data paroki/keuskupan dulu agar check-in bisa digunakan.
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant={activeCheckIn ? 'outline' : 'default'}
                className={cn(
                  'rounded-xl',
                  activeCheckIn ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15' : 'bg-primary hover:bg-primary-hover'
                )}
                onClick={activeCheckIn ? handleCheckOutNow : handleOpenCheckInDialog}
                disabled={isCheckingIn || (!activeCheckIn && !canCheckInNow)}
              >
                {isCheckingIn ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Menyimpan...
                  </>
                ) : activeCheckIn ? (
                  <>
                    <LogOut className="mr-2 h-4 w-4" />
                    Check-out
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    Buka Wizard Check-in
                  </>
                )}
              </Button>
            </div>
          </div>
          {defaultCheckInChurchId && (
            <div className="mt-4 rounded-xl border border-border/70 bg-background/80 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Komunitas Sedang Misa
                </p>
                <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium">
                  {checkInPresence.length} orang
                </span>
              </div>
              {isLoadingCheckInPresence ? (
                <p className="mt-2 text-xs text-muted-foreground">Memuat kehadiran...</p>
              ) : checkInPresence.length === 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Belum ada user lain yang check-in aktif di {churches.find((church) => church.id === defaultCheckInChurchId)?.name || 'gereja ini'}.
                </p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  {checkInPresence.map((presence) => (
                    <div
                      key={presence.userId}
                      className="flex items-center gap-2 rounded-full border border-border/70 bg-card px-2.5 py-1"
                    >
                      <Avatar className="h-6 w-6">
                        <AvatarImage src={presence.avatarUrl} alt={presence.fullName || presence.username || 'User'} />
                        <AvatarFallback>
                          {(presence.fullName || presence.username || 'U')
                            .split(' ')
                            .map((part) => part[0] || '')
                            .join('')
                            .slice(0, 2)
                            .toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="leading-none">
                        <p className="text-[11px] font-medium">
                          {presence.fullName || `@${presence.username || 'user'}`}
                        </p>
                        {presence.checkAt && (
                          <p className="text-[10px] text-muted-foreground">
                            {formatDateTimeLabel(presence.checkAt)}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <QuickAction
          icon={<Search />}
          label="Cari Misa"
          description="Temukan radar misa terdekat"
          isActive={activeTab === 'cari'}
          onClick={() => setActiveTab('cari')}
        />
        <QuickAction
          icon={<Clock3 />}
          label="Riwayat"
          description="Lihat radar yang pernah Anda buat"
          isActive={activeTab === 'riwayat'}
          onClick={() => setActiveTab('riwayat')}
        />
        <QuickAction
          icon={<Compass />}
          label="Ajak Misa"
          description="Undang user lain langsung"
          isActive={activeTab === 'ajak'}
          onClick={() => setActiveTab('ajak')}
        />
      </div>

      {radarIdFromQuery && (
        <Card className="border-primary/25 bg-primary/5 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">Detail Radar</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-lg"
              onClick={handleClearFocusedRadar}
            >
              Kembali ke Radar
            </Button>
          </div>

          {isLoadingFocusedRadar ? (
            <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Memuat detail radar...
            </div>
          ) : !focusedRadar ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Radar tidak ditemukan atau sudah tidak tersedia.
            </p>
          ) : (
            <div className="mt-3 rounded-xl border border-border/70 bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold">{focusedRadar.title}</h3>
                  {focusedRadar.description && (
                    <p className="mt-1 text-sm text-muted-foreground">{focusedRadar.description}</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    onClick={() => handleJoinRadar(focusedRadar)}
                    disabled={isFocusedRadarJoined || isFocusedRadarPending || joiningRadarId === focusedRadar.id}
                    className="rounded-lg"
                  >
                    {joiningRadarId === focusedRadar.id ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Bergabung...
                      </>
                    ) : isFocusedRadarJoined ? (
                      'Sudah Bergabung'
                    ) : isFocusedRadarPending ? (
                      'Menunggu Host'
                    ) : (
                      'Gabung'
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleOpenFocusedRadarInvite}
                    disabled={!canInviteOnFocusedRadar}
                    className="rounded-lg"
                  >
                    Buka Ajak Misa
                  </Button>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                {focusedRadar.startsAt && (
                  <span className="flex items-center gap-1">
                    <Calendar className="h-4 w-4" />
                    {formatDateTimeLabel(focusedRadar.startsAt)}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <Users className="h-4 w-4" />
                  {focusedRadar.participantCount}
                  {focusedRadar.maxParticipants ? ` / ${focusedRadar.maxParticipants}` : ''} peserta
                </span>
                {focusedRadar.churchName && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-4 w-4" />
                    {focusedRadar.churchName}
                  </span>
                )}
              </div>
              {!canInviteOnFocusedRadar && (
                <p className="mt-3 text-xs font-medium text-amber-700">
                  Host menonaktifkan undangan member untuk radar ini.
                </p>
              )}
            </div>
          )}
        </Card>
      )}

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'cari' | 'riwayat' | 'ajak')} className="w-full">
        <TabsList className="grid h-auto w-full grid-cols-3 rounded-xl border border-border/70 bg-card p-1 shadow-sm">
          <TabsTrigger
            value="cari"
            className="h-10 rounded-lg text-sm font-semibold data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
          >
            Cari
          </TabsTrigger>
          <TabsTrigger
            value="riwayat"
            className="h-10 rounded-lg text-sm font-semibold data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
          >
            Riwayat
          </TabsTrigger>
          <TabsTrigger
            value="ajak"
            className="h-10 rounded-lg text-sm font-semibold data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
          >
            <span className="inline-flex items-center gap-1.5">
              Ajak Misa
              {pendingIncomingCount > 0 && (
                <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground">
                  {pendingIncomingCount}
                </span>
              )}
            </span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="cari" className="mt-4">
          <div className="space-y-3">
            <Card className="border-border/70 bg-card p-4 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap gap-2">
                  {[
                    { key: 'today' as const, label: 'Hari Ini' },
                    { key: 'tomorrow' as const, label: 'Besok' },
                    { key: 'week' as const, label: '7 Hari' },
                    { key: 'all' as const, label: 'Semua' },
                  ].map((option) => (
                    <Button
                      key={option.key}
                      type="button"
                      size="sm"
                      variant={publicFilter === option.key ? 'default' : 'outline'}
                      className={cn(publicFilter === option.key && 'bg-primary hover:bg-primary-hover')}
                      onClick={() => setPublicFilter(option.key)}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Urutkan
                  </label>
                  <select
                    value={publicSort}
                    onChange={(event) => setPublicSort(event.target.value as PublicSort)}
                    className="h-9 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  >
                    <option value="soonest">Terdekat</option>
                    <option value="popular">Terpopuler</option>
                  </select>
                </div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Menampilkan {filteredUpcomingEvents.length} radar.
              </p>
            </Card>

            <RadarList
              radars={filteredUpcomingEvents}
              isLoading={isLoading}
              joinedRadarSet={joinedRadarSet}
              pendingRadarSet={pendingRadarSet}
              joiningRadarId={joiningRadarId}
              onJoin={handleJoinRadar}
              onOpenDetail={handleOpenRadarDetail}
            />
          </div>
        </TabsContent>
        <TabsContent value="riwayat" className="mt-4">
          <RadarList
            radars={ownerHistoryEvents}
            isLoading={isLoadingOwnerHistory}
            joinedRadarSet={joinedRadarSet}
            pendingRadarSet={pendingRadarSet}
            joiningRadarId={joiningRadarId}
            onJoin={handleJoinRadar}
            onOpenDetail={handleOpenRadarDetail}
            showJoinAction={false}
          />
        </TabsContent>
        <TabsContent value="ajak" className="mt-4">
          <div className="space-y-4">
            {targetFromProfile && (
              <Card className="border-primary/25 bg-primary/5 p-5 sm:p-6">
                <div className="flex flex-wrap items-center gap-3">
                  <Avatar className="h-11 w-11 border border-border/70">
                    <AvatarImage src={targetFromProfile.avatar_url} alt={targetFromProfile.full_name || ''} />
                    <AvatarFallback>
                      {(targetFromProfile.full_name || 'U')
                        .split(' ')
                        .map((part) => part[0] || '')
                        .join('')
                        .slice(0, 2)
                        .toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold">Ajak Misa Personal</h3>
                    <p className="truncate text-sm text-muted-foreground">
                      Mengajak {targetFromProfile.full_name || 'user'} untuk misa bersama.
                    </p>
                  </div>
                </div>

                {targetFromProfile.allow_mass_invite === false ? (
                  <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-700">
                    User ini menonaktifkan fitur Ajak Misa dari profil.
                  </div>
                ) : (
                  <>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Gereja
                        </label>
                        <select
                          value={personalChurchId}
                          onChange={(event) => setPersonalChurchId(event.target.value)}
                          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                        >
                          <option value="">Pilih gereja</option>
                          {churches.map((church) => (
                            <option key={church.id} value={church.id}>
                              {church.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Jadwal Misa
                        </label>
                        <Input
                          type="datetime-local"
                          value={personalStartsAt}
                          onChange={(event) => setPersonalStartsAt(event.target.value)}
                        />
                      </div>
                    </div>

                    <div className="mt-3 space-y-1.5">
                      <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Catatan
                      </label>
                      <Textarea
                        value={personalMessage}
                        onChange={(event) => setPersonalMessage(event.target.value)}
                        placeholder="Tulis ajakan misa personal..."
                        rows={3}
                      />
                    </div>

                    <div className="mt-4 flex justify-end">
                      <Button
                        onClick={handleSendPersonalInvite}
                        disabled={isSubmittingPersonalInvite || !personalChurchId}
                        className="rounded-xl bg-primary hover:bg-primary-hover"
                      >
                        {isSubmittingPersonalInvite ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Mengirim...
                          </>
                        ) : (
                          'Kirim Ajak Misa Personal'
                        )}
                      </Button>
                    </div>
                  </>
                )}
              </Card>
            )}

            <Card className="border-primary/20 bg-card p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-base font-semibold">Kirim Undangan Radar Grup</h3>
                {selectedInviteRadar ? (
                  <span className="rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                    Radar aktif: {selectedInviteRadar.title}
                  </span>
                ) : (
                  <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-700">
                    Buat radar dulu
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Pilih radar lalu kirim undangan ke user lain. Flow ini sinkron dengan tabel `radar_invites`
                untuk web dan mobile.
              </p>
              {selectedInviteRadar && !canInviteOnSelectedRadar && (
                <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-700">
                  Host radar ini menonaktifkan undangan member. Hanya host yang bisa mengundang.
                </div>
              )}

              <div className="mt-4 grid gap-3 sm:grid-cols-[240px_minmax(0,1fr)]">
                <select
                  value={selectedInviteRadar?.id || ''}
                  onChange={(event) => setSelectedInviteRadarId(event.target.value)}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  disabled={inviteRadarOptions.length === 0}
                >
                  {inviteRadarOptions.length === 0 ? (
                    <option value="">Belum ada radar</option>
                  ) : (
                    inviteRadarOptions.map((radar) => (
                      <option key={radar.id} value={radar.id}>
                        {radar.title}
                      </option>
                    ))
                  )}
                </select>

                <Input
                  value={inviteKeyword}
                  onChange={(event) => setInviteKeyword(event.target.value)}
                  placeholder="Cari nama atau username user..."
                />
              </div>

              {targetIdFromQuery && (
                <div className="mt-4 rounded-xl border border-primary/25 bg-primary/5 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                    Target dari halaman profil
                  </p>
                  {isLoadingTargetFromProfile ? (
                    <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Memuat data user...
                    </div>
                  ) : targetFromProfile ? (
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar className="h-10 w-10 border border-border/70">
                          <AvatarImage src={targetFromProfile.avatar_url} alt={targetFromProfile.full_name || ''} />
                          <AvatarFallback>
                            {(targetFromProfile.full_name || 'U')
                              .split(' ')
                              .map((part) => part[0] || '')
                              .join('')
                              .slice(0, 2)
                              .toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">
                            {targetFromProfile.full_name || 'Tanpa Nama'}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            @{targetFromProfile.username || 'user'} • {formatRoleLabel(targetFromProfile.role)}
                          </p>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        className="rounded-lg"
                        onClick={() => handleSendInvite(targetFromProfile)}
                        disabled={
                          !selectedInviteRadar ||
                          !canInviteOnSelectedRadar ||
                          invitingTargetId === targetFromProfile.id ||
                          targetFromProfile.allow_mass_invite === false
                        }
                      >
                        {targetFromProfile.allow_mass_invite === false ? (
                          'Ajak Misa Nonaktif'
                        ) : invitingTargetId === targetFromProfile.id ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Mengirim...
                          </>
                        ) : (
                          'Undang Sekarang'
                        )}
                      </Button>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-muted-foreground">
                      Target dari profil tidak ditemukan atau sudah tidak tersedia.
                    </p>
                  )}
                </div>
              )}

              <div className="mt-4 space-y-2">
                {inviteKeyword.trim().length < 2 && !targetFromProfile ? (
                  <p className="text-sm text-muted-foreground">Ketik minimal 2 huruf untuk mencari user.</p>
                ) : isLoadingInviteTargets && inviteCandidateTargets.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Mencari user...</p>
                ) : inviteCandidateTargets.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Tidak ada user yang cocok.</p>
                ) : (
                  inviteCandidateTargets.map((target) => (
                    <div
                      key={target.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar className="h-10 w-10 border border-border/70">
                          <AvatarImage src={target.avatar_url} alt={target.full_name || ''} />
                          <AvatarFallback>
                            {(target.full_name || 'U')
                              .split(' ')
                              .map((part) => part[0] || '')
                              .join('')
                              .slice(0, 2)
                              .toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{target.full_name || 'Tanpa Nama'}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            @{target.username || 'user'} • {formatRoleLabel(target.role)}
                          </p>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => handleSendInvite(target)}
                        disabled={
                          !selectedInviteRadar ||
                          !canInviteOnSelectedRadar ||
                          invitingTargetId === target.id ||
                          target.allow_mass_invite === false
                        }
                      >
                        {target.allow_mass_invite === false ? (
                          'Nonaktif'
                        ) : invitingTargetId === target.id ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Mengirim...
                          </>
                        ) : (
                          'Undang'
                        )}
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </Card>

            <Card className="p-6">
              <h3 className="text-base font-semibold">Ajak Misa Masuk</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Terima atau tolak ajak misa personal dari user lain.
              </p>

              <div className="mt-4 space-y-2">
                {isLoadingIncomingInvites ? (
                  <p className="text-sm text-muted-foreground">Memuat undangan masuk...</p>
                ) : incomingPersonalInvites.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Belum ada ajak misa personal.</p>
                ) : (
                  incomingPersonalInvites.map((invite) => (
                    <div
                      key={invite.id}
                      className="space-y-2 rounded-lg border border-border/70 px-3 py-2"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">
                            {invite.inviterName || 'Seseorang'}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {invite.radarTitle || invite.message || 'Undangan radar misa'}
                          </p>
                          {invite.radarChurchName && (
                            <p className="text-[11px] text-muted-foreground">
                              {invite.radarChurchName}
                            </p>
                          )}
                          {invite.radarStartsAt && (
                            <p className="text-[11px] text-muted-foreground">
                              {formatDateTimeLabel(invite.radarStartsAt)}
                            </p>
                          )}
                        </div>
                        <span className="rounded-full bg-muted px-2 py-1 text-[11px] font-medium">
                          {formatInviteStatus(invite.status)}
                        </span>
                      </div>

                      {isPendingInvite(invite.status) && (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => handleRespondInvite(invite, true)}
                            disabled={respondingInviteId === invite.id}
                          >
                            {respondingInviteId === invite.id ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Memproses...
                              </>
                            ) : (
                              'Terima'
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleRespondInvite(invite, false)}
                            disabled={respondingInviteId === invite.id}
                          >
                            Tolak
                          </Button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </Card>

            <Card className="p-6">
              <h3 className="text-base font-semibold">Ajak Misa Terkirim</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Pantau status ajak misa personal yang sudah Anda kirim.
              </p>

              <div className="mt-4 space-y-2">
                {isLoadingOutgoingInvites ? (
                  <p className="text-sm text-muted-foreground">Memuat undangan terkirim...</p>
                ) : outgoingPersonalInvites.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Belum ada ajak misa personal terkirim.</p>
                ) : (
                  outgoingPersonalInvites.map((invite) => (
                    <div
                      key={invite.id}
                      className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border/70 px-3 py-2"
                    >
                      <div>
                        <p className="text-sm font-medium">{invite.inviteeName || 'User'}</p>
                        <p className="text-xs text-muted-foreground">
                          {invite.radarTitle || 'Undangan radar'}
                        </p>
                        {invite.radarChurchName && (
                          <p className="text-[11px] text-muted-foreground">
                            {invite.radarChurchName}
                          </p>
                        )}
                        {invite.createdAt && (
                          <p className="text-[11px] text-muted-foreground">
                            {formatDateTimeLabel(invite.createdAt)}
                          </p>
                        )}
                      </div>
                      <span className="rounded-full bg-muted px-2 py-1 text-[11px] font-medium">
                        {formatInviteStatus(invite.status)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={isCheckInDialogOpen} onOpenChange={setIsCheckInDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Check-in Misa</DialogTitle>
            <DialogDescription>
              Pilih gereja dan jadwal misa (opsional) agar check-in lebih akurat.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="checkin-church">
                Gereja
              </label>
              <select
                id="checkin-church"
                value={checkInChurchId}
                onChange={(event) => setCheckInChurchId(event.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              >
                <option value="">Pilih gereja</option>
                {churches.map((church) => (
                  <option key={church.id} value={church.id}>
                    {church.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="checkin-date">
                Tanggal Misa
              </label>
              <Input
                id="checkin-date"
                type="date"
                value={checkInDate}
                onChange={(event) => setCheckInDate(event.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="checkin-schedule">
                Jadwal Misa (Opsional)
              </label>
              <select
                id="checkin-schedule"
                value={checkInScheduleId}
                onChange={(event) => setCheckInScheduleId(event.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                disabled={!checkInChurchId || isLoadingCheckInSchedules}
              >
                <option value="">
                  {isLoadingCheckInSchedules
                    ? 'Memuat jadwal...'
                    : scheduleOptionsForDate.length === 0
                      ? 'Tidak ada jadwal untuk tanggal ini'
                      : 'Pilih jadwal misa'}
                </option>
                {scheduleOptionsForDate.map((schedule) => (
                  <option key={schedule.id} value={schedule.id}>
                    {schedule.mass_time} • {schedule.notes || 'Misa'}
                  </option>
                ))}
              </select>
            </div>

            <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
              Check-in akan dicatat untuk <span className="font-medium text-foreground">{checkInChurchName}</span>.
              {selectedCheckInSchedule ? ` Jadwal: ${selectedCheckInSchedule.mass_time}.` : ' Anda bisa lanjut tanpa memilih jadwal.'}
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsCheckInDialogOpen(false)}
                disabled={isCheckingIn}
              >
                Batal
              </Button>
              <Button
                type="button"
                onClick={handleSubmitCheckIn}
                disabled={isCheckingIn || !checkInChurchId}
                className="bg-primary hover:bg-primary-hover"
              >
                {isCheckingIn ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Menyimpan...
                  </>
                ) : (
                  'Simpan Check-in'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Buat Radar Misa</DialogTitle>
            <DialogDescription>
              Event ini akan tersimpan ke tabel radar yang sama dengan aplikasi mobile.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateRadar} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="radar-title">
                Judul
              </label>
              <Input
                id="radar-title"
                value={createTitle}
                onChange={(event) => setCreateTitle(event.target.value)}
                placeholder="Contoh: Misa OMK Minggu Pagi"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="radar-church">
                Gereja
              </label>
              <select
                id="radar-church"
                value={createChurchId}
                onChange={(event) => setCreateChurchId(event.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                required
              >
                <option value="" disabled>
                  Pilih gereja
                </option>
                {churches.map((church) => (
                  <option key={church.id} value={church.id}>
                    {church.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="radar-time">
                  Waktu
                </label>
                <Input
                  id="radar-time"
                  type="datetime-local"
                  value={createStartsAt}
                  onChange={(event) => setCreateStartsAt(event.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="radar-max">
                  Maks Peserta
                </label>
                <Input
                  id="radar-max"
                  type="number"
                  min={2}
                  max={500}
                  value={createMaxParticipants}
                  onChange={(event) => setCreateMaxParticipants(event.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="radar-description">
                Deskripsi
              </label>
              <Textarea
                id="radar-description"
                value={createDescription}
                onChange={(event) => setCreateDescription(event.target.value)}
                placeholder="Tambahkan catatan untuk radar ini"
                rows={3}
              />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsCreateDialogOpen(false)}
                disabled={isSubmittingCreate}
              >
                Batal
              </Button>
              <Button type="submit" disabled={isSubmittingCreate}>
                {isSubmittingCreate ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Menyimpan...
                  </>
                ) : (
                  'Simpan Radar'
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function QuickAction({
  icon,
  label,
  description,
  onClick,
  isActive = false,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  onClick?: () => void;
  isActive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
    >
      <Card
        className={cn(
          'border-border/70 bg-card shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md',
          isActive && 'border-primary/40 bg-primary/5'
        )}
      >
        <CardContent className="flex flex-col items-center p-6 text-center">
          <div className={cn('mb-3', isActive ? 'text-primary' : 'text-muted-foreground')}>{icon}</div>
          <h3 className="font-semibold">{label}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </CardContent>
      </Card>
    </button>
  );
}

function RadarList({
  radars,
  isLoading,
  joinedRadarSet,
  pendingRadarSet,
  joiningRadarId,
  onJoin,
  onOpenDetail,
  showJoinAction = true,
}: {
  radars: RadarCardItem[];
  isLoading: boolean;
  joinedRadarSet: Set<string>;
  pendingRadarSet?: Set<string>;
  joiningRadarId: string | null;
  onJoin: (radar: RadarCardItem) => Promise<void>;
  onOpenDetail?: (radar: RadarCardItem) => void;
  showJoinAction?: boolean;
}) {
  if (isLoading) {
    return (
      <Card className="p-12 text-center">
        <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-muted-foreground">Memuat radar misa...</p>
      </Card>
    );
  }

  if (radars.length === 0) {
    return (
      <Card className="p-12 text-center">
        <MapPin className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
        <h3 className="mb-2 text-lg font-semibold">
          {showJoinAction ? 'Belum ada Radar' : 'Belum ada riwayat radar'}
        </h3>
        <p className="text-muted-foreground">
          {showJoinAction
            ? 'Buat radar baru atau cari radar di sekitar Anda.'
            : 'Radar buatan Anda akan muncul di sini.'}
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {radars.map((radar) => {
        const isJoined = joinedRadarSet.has(radar.id);
        const isPending = pendingRadarSet?.has(radar.id) ?? false;
        const isJoining = joiningRadarId === radar.id;

        return (
          <Card
            key={radar.id}
            className="border-border/70 bg-card shadow-sm transition-shadow hover:shadow-md"
          >
            <CardHeader className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">{radar.title}</CardTitle>
                  {radar.description && (
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{radar.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {onOpenDetail && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onOpenDetail(radar)}
                    >
                      Detail
                    </Button>
                  )}
                  {showJoinAction && (
                    <Button
                      variant={isJoined ? 'secondary' : isPending ? 'outline' : 'default'}
                      disabled={isJoined || isPending || isJoining}
                      onClick={() => onJoin(radar)}
                    >
                      {isJoining ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Bergabung...
                        </>
                      ) : isJoined ? (
                        'Sudah Bergabung'
                      ) : isPending ? (
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
        );
      })}
    </div>
  );
}
