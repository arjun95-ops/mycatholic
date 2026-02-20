'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { id } from 'date-fns/locale';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Calendar,
  Check,
  CheckCircle2,
  ChevronsUpDown,
  History,
  LogOut,
  Loader2,
  MapPin,
  MapPinPlus,
  Search,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
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
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useAuth } from '@/lib/features/auth/use-auth';
import { AuthService, type AuthLocationOption } from '@/lib/features/auth/auth-service';
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
  dioceseId?: string;
  countryId?: string;
  churchName?: string;
  dioceseName?: string;
  countryName?: string;
  creatorId?: string;
  allowMemberInvite?: boolean;
  status?: string;
  visibility?: string;
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
  inviterAvatarUrl?: string;
  inviteeAvatarUrl?: string;
  inviteSource?: string;
  status: string;
  createdAt?: string;
  radarId?: string;
  radarChurchId?: string;
  radarTitle?: string;
  radarChurchName?: string;
  radarDioceseName?: string;
  radarCountryName?: string;
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
type CheckInVisibilityScope = 'followers' | 'public' | 'private';

type CheckInPresenceItem = {
  userId: string;
  fullName?: string;
  username?: string;
  avatarUrl?: string;
  checkAt?: string;
};

const ACTIVE_CHECKIN_MAX_AGE_MS = 3 * 60 * 60 * 1000;

function isAcceptedInvite(value: unknown) {
  const status = normalizeInviteStatus(value);
  return status === 'ACCEPTED' || status === 'JOINED' || status === 'APPROVED';
}

function isMissingColumnError(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes('42703') ||
    lower.includes('does not exist') ||
    (lower.includes('could not find') && lower.includes('column'))
  );
}

function isMissingRelationError(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes('42p01') ||
    (lower.includes('relation') && lower.includes('does not exist')) ||
    (lower.includes('table') && lower.includes('does not exist')) ||
    lower.includes('could not find the table') ||
    (lower.includes('schema cache') && (lower.includes('table') || lower.includes('relation')))
  );
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

function isAmbiguousReferenceError(message: string) {
  const lower = message.toLowerCase();
  return lower.includes('42702') || lower.includes('is ambiguous');
}

function shouldFallbackToFinishedStatus(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes('archived') &&
    (
      lower.includes('invalid input value') ||
      lower.includes('enum') ||
      lower.includes('check constraint')
    )
  );
}

function extractMissingColumnName(message: string): string | null {
  const withQuote = message.match(/column\s+"([^"]+)"/i);
  if (withQuote?.[1]) return withQuote[1];

  const withSingleQuote = message.match(/column\s+'([^']+)'/i);
  if (withSingleQuote?.[1]) return withSingleQuote[1];

  const schemaCachePattern = message.match(/could not find the ['"]([^'"]+)['"] column/i);
  if (schemaCachePattern?.[1]) return schemaCachePattern[1];

  return null;
}

function extractFirstStringField(
  row: Record<string, unknown> | null | undefined,
  keys: string[]
): string {
  if (!row) return '';
  for (const key of keys) {
    const value = row[key];
    if (value === null || value === undefined) continue;
    const text = value.toString().trim();
    if (text) return text;
  }
  return '';
}

function normalizeInviteStatus(value: unknown) {
  return value?.toString().toUpperCase() || 'PENDING';
}

function isPendingInvite(value: unknown) {
  const status = normalizeInviteStatus(value);
  return status === 'PENDING' || status === 'INVITED' || status === 'REQUESTED';
}

function isActionablePersonalInviteStatus(value: unknown) {
  return isPendingInvite(value) || isAcceptedInvite(value);
}

function formatInviteStatus(value: unknown) {
  const status = normalizeInviteStatus(value);
  if (status === 'ACCEPTED' || status === 'JOINED' || status === 'APPROVED') return 'Diterima';
  if (status === 'DECLINED' || status === 'REJECTED') return 'Ditolak';
  if (status === 'CANCELLED') return 'Dibatalkan';
  if (status === 'EXPIRED') return 'Kedaluwarsa';
  return 'Menunggu';
}

function getInviteStatusBadgeClass(value: unknown) {
  const status = normalizeInviteStatus(value);
  if (status === 'ACCEPTED' || status === 'JOINED' || status === 'APPROVED') {
    return 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700';
  }
  if (status === 'DECLINED' || status === 'REJECTED' || status === 'CANCELLED') {
    return 'border-rose-500/35 bg-rose-500/10 text-rose-700';
  }
  if (status === 'EXPIRED') {
    return 'border-amber-500/35 bg-amber-500/10 text-amber-700';
  }
  return 'border-primary/30 bg-primary/10 text-primary';
}

function getInviteComment(value?: string, fallbackTitle?: string) {
  const raw = value?.trim();
  if (!raw) return '';

  const normalized = raw.toLowerCase();
  const normalizedTitle = fallbackTitle?.trim().toLowerCase() || '';
  if (normalizedTitle && normalized === normalizedTitle) return '';

  const genericMessages = new Set([
    'misa bersama',
    'mengajak anda misa bersama',
  ]);
  if (genericMessages.has(normalized)) return '';

  if (
    normalized.includes('mengundang anda ke radar') ||
    normalized.includes('mengajak anda misa di') ||
    normalized.includes('undangan radar misa')
  ) {
    return '';
  }

  return raw;
}

function isPersonalInvite(item: RadarInviteItem) {
  const source = item.inviteSource?.trim().toUpperCase();
  if (source === 'PERSONAL') return true;

  const visibility = normalizeRadarVisibility(item.radarVisibility);
  return visibility === 'PRIVATE' || visibility === 'PERSONAL';
}

function normalizeRadarVisibility(value: unknown) {
  const normalized = value?.toString().trim().toUpperCase();
  if (!normalized) return 'PUBLIC';
  if (normalized === 'PRIVATE' || normalized === 'PERSONAL') return 'PRIVATE';
  return normalized;
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

function useDebouncedValue(value: string, delay = 250) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timeout);
  }, [delay, value]);

  return debounced;
}

function canCreateRadarByRole(role?: string | null) {
  const normalized = role?.trim().toLowerCase() ?? '';
  return normalized === 'umat' || normalized === 'katekumen';
}

function normalizeCheckInVisibilityScope(value: unknown): CheckInVisibilityScope {
  const normalized = value?.toString().trim().toLowerCase();
  if (normalized === 'private') return 'private';
  if (normalized === 'public' || normalized === 'church') return 'public';
  return 'followers';
}

function toLegacyCheckInVisibility(scope: CheckInVisibilityScope) {
  if (scope === 'private') return 'PRIVATE';
  if (scope === 'followers') return 'FOLLOWERS';
  return 'PUBLIC';
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

function normalizeScheduleDayOfWeek(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return -1;
  const day = Math.trunc(parsed);
  if (day === 0) return 7;
  return day;
}

function formatScheduleDayShortLabel(value: unknown) {
  const day = normalizeScheduleDayOfWeek(value);
  if (day === 1) return 'Sen';
  if (day === 2) return 'Sel';
  if (day === 3) return 'Rab';
  if (day === 4) return 'Kam';
  if (day === 5) return 'Jum';
  if (day === 6) return 'Sab';
  if (day === 7) return 'Min';
  return '';
}

function parseClockTime(value: string) {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  return {
    hour,
    minute,
  };
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

type SearchableCheckInSelectProps = {
  label: string;
  value: string;
  selectedLabel: string;
  options: AuthLocationOption[];
  placeholder: string;
  searchPlaceholder: string;
  emptyMessage: string;
  loadingMessage: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  isLoading?: boolean;
};

function SearchableCheckInSelect({
  label,
  value,
  selectedLabel,
  options,
  placeholder,
  searchPlaceholder,
  emptyMessage,
  loadingMessage,
  searchValue,
  onSearchChange,
  onValueChange,
  disabled = false,
  isLoading = false,
}: SearchableCheckInSelectProps) {
  const [open, setOpen] = useState(false);
  const triggerLabel = selectedLabel || (isLoading ? loadingMessage : placeholder);

  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">{label}</label>
      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen && searchValue) {
            onSearchChange('');
          }
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="h-10 w-full justify-between rounded-md border border-input bg-background px-3 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            disabled={disabled}
          >
            <span className={cn('truncate', !selectedLabel && 'text-muted-foreground')}>
              {triggerLabel}
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[var(--radix-popover-trigger-width)] rounded-xl border-border/70 bg-card/95 p-0"
        >
          <Command shouldFilter={false} className="rounded-xl bg-transparent">
            <CommandInput
              placeholder={searchPlaceholder}
              value={searchValue}
              onValueChange={onSearchChange}
            />
            <CommandList className="max-h-64">
              {isLoading ? (
                <p className="px-3 py-3 text-sm text-muted-foreground">{loadingMessage}</p>
              ) : options.length === 0 ? (
                <p className="px-3 py-3 text-sm text-muted-foreground">{emptyMessage}</p>
              ) : (
                <CommandGroup>
                  {options.map((item) => (
                    <CommandItem
                      key={item.id}
                      value={`${item.name}-${item.id}`}
                      onSelect={() => {
                        onValueChange(item.id);
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          'h-4 w-4',
                          value === item.id ? 'text-primary opacity-100' : 'opacity-0'
                        )}
                      />
                      <span className="truncate">{item.name}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
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

async function getChurchLocationNamesByIds(churchIds: string[]) {
  const ids = [...new Set(churchIds.map((id) => id.trim()).filter(Boolean))];
  const map = new Map<string, {
    churchName?: string;
    dioceseId?: string;
    dioceseName?: string;
    countryId?: string;
    countryName?: string;
  }>();
  if (ids.length === 0) {
    return map;
  }

  const churchSelectCandidates = [
    'id, name, diocese_id, country_id',
    'id, name, diocese_id',
    'id, name, country_id',
    'id, name',
  ];
  let churchRows: Record<string, unknown>[] = [];
  let churchFetchError = '';
  for (const columns of churchSelectCandidates) {
    const result = await supabase
      .from('churches')
      .select(columns)
      .in('id', ids);
    if (!result.error) {
      churchRows = ((result.data ?? []) as unknown) as Record<string, unknown>[];
      churchFetchError = '';
      break;
    }
    if (isPermissionError(result.error.message) || isMissingRelationError(result.error.message)) {
      return map;
    }
    churchFetchError = result.error.message;
    if (!isMissingColumnError(result.error.message)) {
      break;
    }
  }
  if (churchRows.length === 0 && churchFetchError) {
    console.error('Error loading church locations map:', churchFetchError);
  }

  const dioceseIds = [...new Set(churchRows.map((row) => row.diocese_id?.toString() || '').filter(Boolean))];
  const countryIds = [...new Set(churchRows.map((row) => row.country_id?.toString() || '').filter(Boolean))];

  const dioceseNameById = new Map<string, string>();
  const dioceseCountryById = new Map<string, string>();
  if (dioceseIds.length > 0) {
    const dioceseSelectCandidates = [
      'id, name, country_id',
      'id, name',
    ];
    for (const columns of dioceseSelectCandidates) {
      const result = await supabase
        .from('dioceses')
        .select(columns)
        .in('id', dioceseIds);
      if (!result.error) {
        for (const row of ((result.data ?? []) as unknown) as Record<string, unknown>[]) {
          const id = row.id?.toString() || '';
          if (!id) continue;
          const name = row.name?.toString().trim();
          if (name) {
            dioceseNameById.set(id, name);
          }
          const countryId = row.country_id?.toString() || '';
          if (countryId) {
            dioceseCountryById.set(id, countryId);
          }
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

  const countryIdSet = new Set(countryIds);
  for (const countryId of dioceseCountryById.values()) {
    countryIdSet.add(countryId);
  }
  const countryNameById = new Map<string, string>();
  if (countryIdSet.size > 0) {
    const result = await supabase
      .from('countries')
      .select('id, name')
      .in('id', Array.from(countryIdSet));
    if (!result.error) {
      for (const row of (result.data ?? []) as Record<string, unknown>[]) {
        const id = row.id?.toString() || '';
        if (!id) continue;
        const name = row.name?.toString().trim();
        if (name) {
          countryNameById.set(id, name);
        }
      }
    }
  }

  for (const row of churchRows) {
    const id = row.id?.toString() || '';
    if (!id) continue;
    const churchName = row.name?.toString().trim() || '';
    const dioceseId = row.diocese_id?.toString() || '';
    const countryId = row.country_id?.toString() || dioceseCountryById.get(dioceseId) || '';
    map.set(id, {
      churchName: churchName || undefined,
      dioceseId: dioceseId || undefined,
      dioceseName: dioceseNameById.get(dioceseId),
      countryId: countryId || undefined,
      countryName: countryNameById.get(countryId),
    });
  }

  return map;
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
  const churchLocationMap = await getChurchLocationNamesByIds(churchIds);

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
    const location = churchId ? churchLocationMap.get(churchId) : undefined;
    return {
      id,
      title: row.title?.toString() || 'Radar Misa',
      description: row.description?.toString(),
      startsAt,
      maxParticipants: Number(row.max_participants ?? 0) || undefined,
      participantCount: participantMap.get(id) ?? 0,
      churchId,
      dioceseId: location?.dioceseId,
      countryId: location?.countryId,
      churchName: location?.churchName,
      dioceseName: location?.dioceseName,
      countryName: location?.countryName,
      creatorId: row.creator_id?.toString(),
      allowMemberInvite:
        typeof row.allow_member_invite === 'boolean' ? row.allow_member_invite : undefined,
      status: row.status?.toString(),
      visibility: row.visibility?.toString(),
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
  const churchLocationMap = await getChurchLocationNamesByIds(churchIds);

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
      const location = churchId ? churchLocationMap.get(churchId) : undefined;
      return {
        id,
        title: row.title?.toString() || 'Radar Misa',
        description: row.description?.toString(),
        startsAt,
        maxParticipants: Number(row.max_participants ?? 0) || undefined,
        participantCount: participantMap.get(id) ?? 0,
        churchId,
        dioceseId: location?.dioceseId,
        countryId: location?.countryId,
        churchName: location?.churchName,
        dioceseName: location?.dioceseName,
        countryName: location?.countryName,
        creatorId: row.creator_id?.toString(),
        allowMemberInvite:
          typeof row.allow_member_invite === 'boolean' ? row.allow_member_invite : undefined,
        status: row.status?.toString(),
        visibility: row.visibility?.toString(),
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
    .select('id, title, description, event_time, max_participants, church_id, creator_id, allow_member_invite, status, visibility, church_name')
    .eq('id', id)
    .maybeSingle();

  const legacy =
    legacyWithChurch.error && isMissingColumnError(legacyWithChurch.error.message)
      ? await supabase
        .from('radar_events')
        .select('id, title, description, event_time, max_participants, church_id, creator_id, allow_member_invite, status, visibility')
        .eq('id', id)
        .maybeSingle()
      : legacyWithChurch;

  const v2WithChurch = await supabase
    .from('radar_events_v2')
    .select('id, title, description, event_starts_at_utc, max_participants, church_id, creator_id, allow_member_invite, status, visibility, church_name')
    .eq('id', id)
    .maybeSingle();
  const v2 =
    v2WithChurch.error && isMissingColumnError(v2WithChurch.error.message)
      ? await supabase
        .from('radar_events_v2')
        .select('id, title, description, event_starts_at_utc, max_participants, church_id, creator_id, allow_member_invite, status, visibility')
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
  let dioceseName = '';
  let countryName = '';
  let churchLocation:
    | {
      churchName?: string;
      dioceseId?: string;
      dioceseName?: string;
      countryId?: string;
      countryName?: string;
    }
    | undefined;
  if (churchId) {
    churchLocation = (await getChurchLocationNamesByIds([churchId])).get(churchId);
    if (!churchName) {
      churchName = churchLocation?.churchName || '';
    }
    dioceseName = churchLocation?.dioceseName || '';
    countryName = churchLocation?.countryName || '';
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
    dioceseId: churchLocation?.dioceseId,
    countryId: churchLocation?.countryId,
    churchName: churchName || undefined,
    dioceseName: dioceseName || undefined,
    countryName: countryName || undefined,
    creatorId: row.creator_id?.toString(),
    allowMemberInvite:
      typeof row.allow_member_invite === 'boolean' ? row.allow_member_invite : undefined,
    status: row.status?.toString(),
    visibility: row.visibility?.toString(),
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

    let rows = (withStatus.data ?? []) as Record<string, unknown>[];
    let resultError = withStatus.error;
    let strictActiveFilter = true;
    if (resultError && isMissingColumnError(resultError.message)) {
      strictActiveFilter = false;
      const fallback = await supabase
        .from(table)
        .select('id, church_id, checkin_at, check_in_time, mass_time, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(20);
      rows = (fallback.data ?? []) as Record<string, unknown>[];
      resultError = fallback.error;
    }

    if (resultError) continue;

    const pickFreshFallbackRow = () => {
      for (const item of rows) {
        const rawTime =
          item.checkin_at?.toString() ||
          item.check_in_time?.toString() ||
          item.mass_time?.toString() ||
          item.created_at?.toString();
        if (!rawTime) continue;
        const time = new Date(rawTime).getTime();
        if (Number.isNaN(time)) continue;
        if (time >= Date.now() - ACTIVE_CHECKIN_MAX_AGE_MS) {
          return item;
        }
      }
      return null;
    };

    const row = strictActiveFilter ? rows[0] : pickFreshFallbackRow();
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
  const latestCandidate = candidates[0];
  const latestTime = new Date(latestCandidate.checkAt || '').getTime();
  if (!Number.isNaN(latestTime) && Date.now() - latestTime > ACTIVE_CHECKIN_MAX_AGE_MS) {
    try {
      await setCheckOutNow({ userId, active: latestCandidate });
    } catch (error) {
      console.warn('Failed to auto-expire stale check-in:', error);
    }
    return null;
  }
  return latestCandidate;
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
  allowMemberInvite?: boolean;
  requireHostApproval?: boolean;
  massScheduleId?: string;
}) {
  const {
    userId,
    churchId,
    churchName,
    title,
    description,
    startsAtIso,
    maxParticipants,
    allowMemberInvite = true,
    requireHostApproval = false,
    massScheduleId,
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
    allow_member_invite: allowMemberInvite,
    require_host_approval: requireHostApproval,
    max_participants: maxParticipants,
  };
  if (massScheduleId) {
    legacyPayload.schedule_id = massScheduleId;
    legacyPayload.mass_schedule_id = massScheduleId;
  }

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
    allow_member_invite: allowMemberInvite,
    require_host_approval: requireHostApproval,
    join_mode: requireHostApproval ? 'APPROVAL' : 'OPEN',
    max_participants: maxParticipants,
  };
  if (massScheduleId) {
    v2Payload.mass_schedule_id = massScheduleId;
    v2Payload.schedule_id = massScheduleId;
  }

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
  const startsAtDate = startsAtIso.slice(0, 10);

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
      const rpcRow = (rpcRaw as Record<string, unknown> | null) ?? null;
      const radarIdFromRpc = extractFirstStringField(rpcRow, [
        'radar_id',
        'event_id',
        'radar_event_id',
        'created_radar_id',
      ]);
      if (radarIdFromRpc) {
        return radarIdFromRpc;
      }

      const inviteIdFromRpc = extractFirstStringField(rpcRow, [
        'invite_id',
        'radar_invite_id',
      ]);
      if (inviteIdFromRpc) {
        // V2 PERSONAL invite can be valid without radar_id (mobile parity).
        return '';
      }

      const v2InviteLookup = await supabase
        .from('radar_invites_v2')
        .select('id, radar_id')
        .eq('inviter_id', creatorId)
        .eq('invitee_id', targetId)
        .eq('source', 'PERSONAL')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!v2InviteLookup.error && v2InviteLookup.data?.id) {
        const radarId = v2InviteLookup.data.radar_id?.toString();
        return radarId || '';
      }

      const legacyInviteLookup = await supabase
        .from('radar_invites')
        .select('id, radar_id')
        .eq('inviter_id', creatorId)
        .eq('invitee_id', targetId)
        .eq('source', 'PERSONAL')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!legacyInviteLookup.error && legacyInviteLookup.data?.id) {
        const radarId = legacyInviteLookup.data.radar_id?.toString();
        return radarId || '';
      }

      console.warn('radar_v2_send_invite succeeded but invite row was not found; fallback to legacy invite flow.');
    } else if (
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
        title: 'Ajak Misa Personal',
        message: cleanMessage,
        church_id: churchId,
        church_name: churchName || 'Gereja',
        country_id: churchHierarchy.countryId,
        diocese_id: churchHierarchy.dioceseId,
        event_time: startsAtIso,
        event_starts_at_utc: startsAtIso,
        mass_date: startsAtDate,
        mass_time: startsAtIso,
        expires_at: startsAtIso,
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
          title: 'Ajak Misa Personal',
          message: cleanMessage,
          church_id: churchId,
          church_name: churchName || 'Gereja',
          country_id: churchHierarchy.countryId,
          diocese_id: churchHierarchy.dioceseId,
          event_time: startsAtIso,
          event_starts_at_utc: startsAtIso,
          mass_date: startsAtDate,
          mass_time: startsAtIso,
          expires_at: startsAtIso,
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
        church_id: churchId,
        country_id: churchHierarchy.countryId,
        diocese_id: churchHierarchy.dioceseId,
        church_name: churchName,
        note: cleanMessage,
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
      if (!isAmbiguousReferenceError(rpc.error.message)) {
        throw new Error(rpc.error.message);
      }
      console.warn('radar_v2_join_event RPC fallback to direct insert:', rpc.error.message);
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
      if (!isAmbiguousReferenceError(rpc.error.message)) {
        throw new Error(rpc.error.message);
      }
      console.warn('join_radar_event RPC fallback to direct insert:', rpc.error.message);
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
  visibilityScope?: CheckInVisibilityScope;
  notifyFollowers?: boolean;
  notifyChurch?: boolean;
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
    visibilityScope,
    notifyFollowers,
    notifyChurch,
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
  const normalizedScope = normalizeCheckInVisibilityScope(visibilityScope);
  const legacyVisibility = toLegacyCheckInVisibility(normalizedScope);
  const resolvedNotifyFollowers =
    normalizedScope === 'private' ? false : Boolean(notifyFollowers ?? true);
  const resolvedNotifyChurch =
    normalizedScope === 'public' ? Boolean(notifyChurch ?? false) : false;

  const archivePayload: Record<string, unknown> = {
    status: 'ARCHIVED',
    archived_at: nowIso,
    updated_at: nowIso,
  };
  for (const table of ['mass_checkins', 'mass_checkins_v2']) {
    const working = { ...archivePayload };
    const archiveByStatus = async () =>
      supabase
        .from(table)
        .update(working)
        .eq('user_id', userId)
        .eq('status', 'ACTIVE');

    let archiveResult = await archiveByStatus();
    for (let attempt = 0; attempt < 6; attempt += 1) {
      if (!archiveResult.error) break;
      if (
        working.status === 'ARCHIVED' &&
        shouldFallbackToFinishedStatus(archiveResult.error.message)
      ) {
        working.status = 'FINISHED';
        archiveResult = await archiveByStatus();
        continue;
      }
      const missingColumn = extractMissingColumnName(archiveResult.error.message);
      if (
        missingColumn &&
        missingColumn in working &&
        isMissingColumnError(archiveResult.error.message)
      ) {
        delete working[missingColumn];
        archiveResult = await archiveByStatus();
        continue;
      }
      break;
    }
    if (!archiveResult.error) continue;

    const archiveMessage = archiveResult.error.message;
    const statusMissing =
      isMissingColumnError(archiveMessage) &&
      (
        extractMissingColumnName(archiveMessage) === 'status' ||
        archiveMessage.toLowerCase().includes('status')
      );
    if (!statusMissing) continue;

    let latestRowId = '';
    const latestByCreatedAt = await supabase
      .from(table)
      .select('id, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!latestByCreatedAt.error && latestByCreatedAt.data?.id) {
      latestRowId = latestByCreatedAt.data.id.toString();
    } else if (
      latestByCreatedAt.error &&
      isMissingColumnError(latestByCreatedAt.error.message)
    ) {
      const latestFallback = await supabase
        .from(table)
        .select('id')
        .eq('user_id', userId)
        .limit(1)
        .maybeSingle();
      if (!latestFallback.error && latestFallback.data?.id) {
        latestRowId = latestFallback.data.id.toString();
      }
    }
    if (!latestRowId) continue;

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const fallbackArchive = await supabase
        .from(table)
        .update(working)
        .eq('id', latestRowId)
        .eq('user_id', userId);

      if (!fallbackArchive.error) break;
      if (
        working.status === 'ARCHIVED' &&
        shouldFallbackToFinishedStatus(fallbackArchive.error.message)
      ) {
        working.status = 'FINISHED';
        continue;
      }
      const missingColumn = extractMissingColumnName(fallbackArchive.error.message);
      if (
        missingColumn &&
        missingColumn in working &&
        isMissingColumnError(fallbackArchive.error.message)
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
      p_visibility: legacyVisibility,
      p_church_timezone: resolvedChurchTimezone,
    });

    if (!rpcResult.error) {
      return;
    }

    if (!(
      isFunctionMissingError(rpcResult.error.message) ||
      isPermissionError(rpcResult.error.message) ||
      isNotAuthenticatedError(rpcResult.error.message)
    )) {
      console.warn('radar_v2_set_checkin RPC fallback to direct insert:', rpcResult.error.message);
    }
  }

  const legacyPayload: Record<string, unknown> = {
    user_id: userId,
    church_id: churchId,
    check_in_time: nowIso,
    mass_time: massDateTimeIso,
    visibility: legacyVisibility,
    visibility_scope: normalizedScope,
    notify_followers: resolvedNotifyFollowers,
    notify_church: resolvedNotifyChurch,
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
    visibility: legacyVisibility,
    visibility_scope: normalizedScope,
    notify_followers: resolvedNotifyFollowers,
    notify_church: resolvedNotifyChurch,
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

    if (
      workingPayload.status === 'ARCHIVED' &&
      shouldFallbackToFinishedStatus(result.error.message)
    ) {
      workingPayload.status = 'FINISHED';
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
  const followingIds = new Set<string>();
  if (currentUserId) {
    const following = await supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', currentUserId);

    if (!following.error) {
      for (const row of (following.data ?? []) as Record<string, unknown>[]) {
        const followingId = row.following_id?.toString();
        if (followingId) {
          followingIds.add(followingId);
        }
      }
    } else if (!isPermissionError(following.error.message)) {
      console.error('Error fetching follow map for check-in presence:', following.error);
    }
  }

  for (const table of ['mass_checkins', 'mass_checkins_v2']) {
    let rows: Record<string, unknown>[] | null = null;
    let resultError: { message: string } | null = null;

    for (const columns of [
      'user_id, checkin_at, check_in_time, mass_time, created_at, status, visibility, visibility_scope',
      'user_id, checkin_at, check_in_time, mass_time, created_at, status, visibility',
      'user_id, checkin_at, check_in_time, mass_time, created_at, status',
    ]) {
      const result = await supabase
        .from(table)
        .select(columns)
        .eq('church_id', selectedChurchId)
        .eq('status', 'ACTIVE')
        .order('created_at', { ascending: false })
        .limit(80);

      if (!result.error) {
        rows = result.data as unknown as Record<string, unknown>[] | null;
        resultError = null;
        break;
      }

      resultError = result.error;
      if (!isMissingColumnError(result.error.message)) {
        break;
      }
    }

    if (resultError && isMissingColumnError(resultError.message)) {
      resultError = null;
      for (const columns of [
        'user_id, checkin_at, check_in_time, mass_time, created_at, visibility, visibility_scope',
        'user_id, checkin_at, check_in_time, mass_time, created_at, visibility',
        'user_id, checkin_at, check_in_time, mass_time, created_at',
      ]) {
        const fallback = await supabase
          .from(table)
          .select(columns)
          .eq('church_id', selectedChurchId)
          .order('created_at', { ascending: false })
          .limit(80);

        if (!fallback.error) {
          rows = fallback.data as unknown as Record<string, unknown>[] | null;
          resultError = null;
          break;
        }

        resultError = fallback.error;
        if (!isMissingColumnError(fallback.error.message)) {
          break;
        }
      }
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
      const visibilityScope = normalizeCheckInVisibilityScope(
        row.visibility_scope?.toString() || row.visibility?.toString()
      );
      if (visibilityScope === 'private') continue;
      if (visibilityScope === 'followers' && !followingIds.has(userId)) continue;

      const checkAt =
        row.checkin_at?.toString() ||
        row.check_in_time?.toString() ||
        row.mass_time?.toString() ||
        row.created_at?.toString();
      if (!checkAt) continue;

      const checkTime = new Date(checkAt).getTime();
      if (Number.isNaN(checkTime)) continue;
      // Keep parity with mobile: active check-in is treated as stale after 3 hours.
      if (checkTime < Date.now() - ACTIVE_CHECKIN_MAX_AGE_MS) {
        continue;
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

async function getLatestPersonalInviteForRadar(params: {
  radarId: string;
  userId: string;
  radarSource?: RadarSource;
}): Promise<RadarInviteItem | null> {
  const radarId = params.radarId.trim();
  const userId = params.userId.trim();
  if (!radarId || !userId) return null;

  const selectCandidates = [
    'id, inviter_id, invitee_id, status, created_at, radar_id, source, note',
    'id, inviter_id, invitee_id, status, created_at, radar_id, note',
    'id, inviter_id, invitee_id, status, created_at, radar_id',
  ];

  let row: Record<string, unknown> | null = null;
  let lastError = '';
  for (const columns of selectCandidates) {
    const result = await supabase
      .from('radar_invites')
      .select(columns)
      .eq('radar_id', radarId)
      .eq('invitee_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!result.error) {
      row = (result.data as Record<string, unknown> | null) ?? null;
      break;
    }

    if (isPermissionError(result.error.message)) {
      return null;
    }
    lastError = result.error.message;
    if (!isMissingColumnError(result.error.message)) {
      break;
    }
  }

  if (!row?.id) {
    if (lastError && !isMissingColumnError(lastError)) {
      console.error('Error reading personal invite for radar:', lastError);
    }
    return null;
  }

  const status = normalizeInviteStatus(row.status);
  if (!isActionablePersonalInviteStatus(status)) {
    return null;
  }

  return {
    id: row.id.toString(),
    inviteId: row.id.toString(),
    inviterId: row.inviter_id?.toString(),
    inviteeId: row.invitee_id?.toString(),
    inviteSource: row.source?.toString() || 'PERSONAL',
    status,
    createdAt: row.created_at?.toString(),
    radarId: row.radar_id?.toString() || radarId,
    radarSource: params.radarSource,
    message: row.note?.toString(),
    direction: 'incoming',
  } satisfies RadarInviteItem;
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
  if (normalizeRadarVisibility(radar.visibility) === 'PRIVATE') {
    throw new Error('Radar private tidak mendukung undangan grup.');
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
    if (isPendingInvite(existingStatus)) {
      throw new Error('Undangan untuk user ini sudah dikirim.');
    }
    if (existingStatus === 'ACCEPTED' || existingStatus === 'JOINED' || existingStatus === 'APPROVED') {
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
      diocese_name: radar.dioceseName,
      country_name: radar.countryName,
      diocese_id: radar.dioceseId,
      country_id: radar.countryId,
      note: radar.title,
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
    churchId?: string;
    churchName?: string;
  }>();

  if (ids.length === 0) {
    return map;
  }

  const legacyWithVisibility = await supabase
    .from('radar_events')
    .select('id, title, event_time, visibility, church_id, church_name')
    .in('id', ids);
  const legacy =
    legacyWithVisibility.error && isMissingColumnError(legacyWithVisibility.error.message)
      ? await supabase
        .from('radar_events')
        .select('id, title, event_time, church_id')
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
        churchId: row.church_id?.toString(),
        churchName: row.church_name?.toString(),
      });
    }
  }

  const v2WithVisibility = await supabase
    .from('radar_events_v2')
    .select('id, title, event_starts_at_utc, visibility, church_id, church_name')
    .in('id', ids);
  const v2 =
    v2WithVisibility.error && isMissingColumnError(v2WithVisibility.error.message)
      ? await supabase
        .from('radar_events_v2')
        .select('id, title, event_starts_at_utc, church_id')
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
        churchId: row.church_id?.toString(),
        churchName: row.church_name?.toString(),
      });
    }
  }

  return map;
}

async function getInviteRows(direction: 'incoming' | 'outgoing', userId?: string) {
  if (!userId) return [] as Record<string, unknown>[];

  const field = direction === 'incoming' ? 'invitee_id' : 'inviter_id';

  const rowsById = new Map<string, Record<string, unknown>>();

  const fetchFromTable = async (table: 'radar_invites' | 'radar_invites_v2') => {
    const selectCandidates =
      table === 'radar_invites_v2'
        ? [
          'id, inviter_id, invitee_id, status, created_at, radar_id, source, note, church_id, diocese_id, country_id, event_starts_at_utc',
          'id, inviter_id, invitee_id, status, created_at, radar_id, source, note, church_id, event_starts_at_utc',
          'id, inviter_id, invitee_id, status, created_at, radar_id, source, note, event_starts_at_utc',
          'id, inviter_id, invitee_id, status, created_at, radar_id, source, note',
          'id, inviter_id, invitee_id, status, created_at, radar_id, source',
          'id, inviter_id, invitee_id, status, created_at',
        ]
        : [
          'id, inviter_id, invitee_id, status, created_at, radar_id, source, note, church_id, diocese_id, country_id, event_starts_at_utc, event_time',
          'id, inviter_id, invitee_id, status, created_at, radar_id, source, note, church_id, event_starts_at_utc, event_time',
          'id, inviter_id, invitee_id, status, created_at, radar_id, source, note, event_time',
          'id, inviter_id, invitee_id, status, created_at, radar_id, source, note',
          'id, inviter_id, invitee_id, status, created_at, radar_id, source',
          'id, inviter_id, invitee_id, status, created_at',
        ];

    let lastErrorMessage = '';
    for (const columns of selectCandidates) {
      const result = await supabase
        .from(table)
        .select(columns)
        .eq(field, userId)
        .order('created_at', { ascending: false })
        .limit(40);

      if (!result.error) {
        for (const row of (result.data ?? []) as unknown as Record<string, unknown>[]) {
          const id = row.id?.toString();
          const key = id || `${table}:${createRandomUUID()}`;
          const nextRow = {
            ...row,
            _source_table: table,
          } satisfies Record<string, unknown>;
          const existing = rowsById.get(key);
          if (!existing || table === 'radar_invites_v2') {
            rowsById.set(key, nextRow);
          }
        }
        return;
      }

      if (isPermissionError(result.error.message) || isMissingRelationError(result.error.message)) {
        return;
      }

      lastErrorMessage = result.error.message;
      if (!isMissingColumnError(result.error.message)) {
        console.error(`Error fetching ${table}:`, result.error);
        return;
      }
    }

    if (lastErrorMessage) {
      console.error(`Error fetching ${table} fallback:`, lastErrorMessage);
    }
  };

  await Promise.all([
    fetchFromTable('radar_invites'),
    fetchFromTable('radar_invites_v2'),
  ]);

  return Array.from(rowsById.values()).sort((a, b) => {
    const aTime = new Date(a.created_at?.toString() || '').getTime();
    const bTime = new Date(b.created_at?.toString() || '').getTime();
    return bTime - aTime;
  });
}

async function getIncomingRadarInvites(userId?: string): Promise<RadarInviteItem[]> {
  if (!userId) return [];

  const tableRows = await getInviteRows('incoming', userId);
  const inviteMap = new Map<string, RadarInviteItem>();

  for (const row of tableRows) {
    const id = row.id?.toString();
    if (!id) continue;
    const sourceTable = row._source_table?.toString();
    inviteMap.set(id, {
      id,
      inviteId: id,
      inviterId: row.inviter_id?.toString(),
      inviteeId: row.invitee_id?.toString(),
      inviteSource: row.source?.toString(),
      status: normalizeInviteStatus(row.status),
      createdAt: row.created_at?.toString(),
      radarId: row.radar_id?.toString(),
      radarChurchId: row.church_id?.toString(),
      radarStartsAt: row.event_starts_at_utc?.toString() || row.event_time?.toString(),
      radarSource:
        sourceTable === 'radar_invites_v2'
          ? (row.radar_id ? 'v2' : undefined)
          : undefined,
      message: row.note?.toString() || row.message?.toString(),
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
      const notifNote = data.note?.toString();

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
        radarChurchId: data.church_id?.toString() || existing?.radarChurchId,
        radarTitle: data.title?.toString() || existing?.radarTitle,
        radarCountryName: data.country_name?.toString() || existing?.radarCountryName,
        radarDioceseName: data.diocese_name?.toString() || existing?.radarDioceseName,
        radarChurchName: data.church_name?.toString() || existing?.radarChurchName,
        radarStartsAt: data.starts_at?.toString() || existing?.radarStartsAt,
        radarSource:
          (data.radar_source?.toString() as RadarSource | undefined) ||
          existing?.radarSource,
        inviteSource:
          data.source?.toString() ||
          existing?.inviteSource,
        message: existing?.message || notifNote || row.message?.toString(),
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
  const churchIds = invites
    .map((invite) => {
      if (invite.radarChurchId) return invite.radarChurchId;
      if (!invite.radarId) return '';
      return radars.get(invite.radarId)?.churchId || '';
    })
    .filter((id): id is string => Boolean(id));
  const churchLocations = await getChurchLocationNamesByIds(churchIds);

  return invites
    .map((invite) => {
      const inviter = invite.inviterId ? profiles.get(invite.inviterId) : undefined;
      const invitee = invite.inviteeId ? profiles.get(invite.inviteeId) : undefined;
      const radar = invite.radarId ? radars.get(invite.radarId) : undefined;
      const churchId = invite.radarChurchId || radar?.churchId;
      const location = churchId ? churchLocations.get(churchId) : undefined;

      return {
        ...invite,
        radarChurchId: churchId,
        inviterName: inviter?.full_name || invite.inviterName,
        inviteeName: invitee?.full_name || invite.inviteeName,
        inviterAvatarUrl: inviter?.avatar_url || invite.inviterAvatarUrl,
        inviteeAvatarUrl: invitee?.avatar_url || invite.inviteeAvatarUrl,
        radarTitle: invite.radarTitle || radar?.title,
        radarCountryName: invite.radarCountryName || location?.countryName,
        radarDioceseName: invite.radarDioceseName || location?.dioceseName,
        radarChurchName: invite.radarChurchName || radar?.churchName || location?.churchName,
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
    radarChurchId: row.church_id?.toString(),
    radarStartsAt: row.event_starts_at_utc?.toString() || row.event_time?.toString(),
    radarSource:
      row._source_table?.toString() === 'radar_invites_v2'
        ? (row.radar_id ? 'v2' : undefined)
        : undefined,
    message: row.note?.toString() || row.message?.toString(),
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
  const churchIds = invites
    .map((invite) => {
      if (invite.radarChurchId) return invite.radarChurchId;
      if (!invite.radarId) return '';
      return radars.get(invite.radarId)?.churchId || '';
    })
    .filter((id): id is string => Boolean(id));
  const churchLocations = await getChurchLocationNamesByIds(churchIds);

  return invites
    .map((invite) => {
      const radar = invite.radarId ? radars.get(invite.radarId) : undefined;
      const churchId = invite.radarChurchId || radar?.churchId;
      const location = churchId ? churchLocations.get(churchId) : undefined;
      return {
        ...invite,
        radarChurchId: churchId,
        inviterName: invite.inviterId ? profiles.get(invite.inviterId)?.full_name : undefined,
        inviteeName: invite.inviteeId ? profiles.get(invite.inviteeId)?.full_name : undefined,
        inviterAvatarUrl: invite.inviterId ? profiles.get(invite.inviterId)?.avatar_url : undefined,
        inviteeAvatarUrl: invite.inviteeId ? profiles.get(invite.inviteeId)?.avatar_url : undefined,
        radarTitle:
          invite.radarTitle ||
          (invite.radarId ? radars.get(invite.radarId)?.title : undefined),
        radarCountryName: invite.radarCountryName || location?.countryName,
        radarDioceseName: invite.radarDioceseName || location?.dioceseName,
        radarChurchName:
          invite.radarChurchName ||
          (invite.radarId ? radars.get(invite.radarId)?.churchName : undefined) ||
          location?.churchName,
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
      };
    })
    .sort((a, b) => {
      const aTime = new Date(a.createdAt || '').getTime();
      const bTime = new Date(b.createdAt || '').getTime();
      return bTime - aTime;
    });
}

async function resolveRadarSourceById(radarId: string): Promise<RadarSource | null> {
  const id = radarId.trim();
  if (!id) return null;

  const v2 = await supabase
    .from('radar_events_v2')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (!v2.error && v2.data?.id) {
    return 'v2';
  }
  if (
    v2.error &&
    !isPermissionError(v2.error.message) &&
    !isMissingColumnError(v2.error.message) &&
    !isMissingRelationError(v2.error.message)
  ) {
    throw new Error(v2.error.message);
  }

  const legacy = await supabase
    .from('radar_events')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (!legacy.error && legacy.data?.id) {
    return 'legacy';
  }
  if (
    legacy.error &&
    !isPermissionError(legacy.error.message) &&
    !isMissingColumnError(legacy.error.message) &&
    !isMissingRelationError(legacy.error.message)
  ) {
    throw new Error(legacy.error.message);
  }

  return null;
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

async function ensureRadarInviteChatAccess(params: {
  chatId: string;
  radarId: string;
  source: RadarSource;
  userId: string;
  fallbackTitle?: string;
}) {
  const { chatId, radarId, source, userId, fallbackTitle } = params;
  const nowIso = new Date().toISOString();

  if (source === 'v2') {
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

    const v2Member = await insertWithColumnFallback('radar_chat_members_v2', {
      chat_group_id: chatId,
      user_id: userId,
      role: 'MEMBER',
      status: 'JOINED',
      joined_at: nowIso,
    });
    if (
      v2Member.error &&
      !isPermissionError(v2Member.error.message) &&
      !isMissingColumnError(v2Member.error.message) &&
      !isMissingRelationError(v2Member.error.message)
    ) {
      throw new Error(v2Member.error.message);
    }
  }

  const existingChat = await supabase
    .from('social_chats')
    .select('id')
    .eq('id', chatId)
    .maybeSingle();

  if (
    existingChat.error &&
    !isPermissionError(existingChat.error.message) &&
    !isMissingColumnError(existingChat.error.message) &&
    !isMissingRelationError(existingChat.error.message)
  ) {
    throw new Error(existingChat.error.message);
  }

  if (!existingChat.error && !existingChat.data?.id) {
    const eventTable = source === 'v2' ? 'radar_events_v2' : 'radar_events';
    const eventWithPolicy = await supabase
      .from(eventTable)
      .select('id, title, creator_id, allow_member_invite')
      .eq('id', radarId)
      .maybeSingle();

    let eventRow = eventWithPolicy.data as Record<string, unknown> | null;
    let eventError = eventWithPolicy.error;
    if (eventError && isMissingColumnError(eventError.message)) {
      const fallback = await supabase
        .from(eventTable)
        .select('id, title, creator_id')
        .eq('id', radarId)
        .maybeSingle();
      eventRow = fallback.data as Record<string, unknown> | null;
      eventError = fallback.error;
    }
    if (
      eventError &&
      !isPermissionError(eventError.message) &&
      !isMissingColumnError(eventError.message) &&
      !isMissingRelationError(eventError.message)
    ) {
      throw new Error(eventError.message);
    }

    const creatorId = eventRow?.creator_id?.toString() || userId;
    const groupName = eventRow?.title?.toString().trim() || fallbackTitle?.trim() || 'Radar Misa';
    const participants = Array.from(new Set([userId, creatorId].filter(Boolean)));
    const allowMemberInvite =
      typeof eventRow?.allow_member_invite === 'boolean'
        ? eventRow.allow_member_invite
        : true;

    const createChat = await insertWithColumnFallback('social_chats', {
      id: chatId,
      is_group: true,
      group_name: groupName,
      admin_id: creatorId,
      creator_id: creatorId,
      participants,
      invite_mode: 'open',
      invite_link_enabled: false,
      allow_member_invite: allowMemberInvite,
      updated_at: nowIso,
    });
    if (
      createChat.error &&
      !isPermissionError(createChat.error.message) &&
      !isMissingColumnError(createChat.error.message) &&
      !isMissingRelationError(createChat.error.message)
    ) {
      throw new Error(createChat.error.message);
    }
  }

  const chatMember = await insertWithColumnFallback('chat_members', {
    chat_id: chatId,
    user_id: userId,
    role: 'member',
    status: 'JOINED',
    joined_at: nowIso,
  });
  if (
    chatMember.error &&
    !isPermissionError(chatMember.error.message) &&
    !isMissingColumnError(chatMember.error.message) &&
    !isMissingRelationError(chatMember.error.message)
  ) {
    throw new Error(chatMember.error.message);
  }
}

async function resolveInviteChatId(params: {
  invite: RadarInviteItem;
  userId: string;
}): Promise<string | null> {
  const { invite, userId } = params;
  let radarId = invite.radarId?.trim() || '';
  let source = invite.radarSource ?? null;

  if (!radarId && invite.inviteId) {
    const inviteRow = await supabase
      .from('radar_invites')
      .select('radar_id')
      .eq('id', invite.inviteId)
      .maybeSingle();

    if (!inviteRow.error && inviteRow.data?.radar_id) {
      radarId = inviteRow.data.radar_id.toString();
    } else if (
      inviteRow.error &&
      !isPermissionError(inviteRow.error.message) &&
      !isMissingColumnError(inviteRow.error.message) &&
      !isMissingRelationError(inviteRow.error.message)
    ) {
      throw new Error(inviteRow.error.message);
    }
  }

  if (!radarId) return null;
  if (!source) {
    source = await resolveRadarSourceById(radarId);
  }
  if (!source) return null;

  const chatId = await resolveRadarChatId({
    radarId,
    source,
  });
  if (!chatId) return null;

  await ensureRadarInviteChatAccess({
    chatId,
    radarId,
    source,
    userId,
    fallbackTitle: invite.radarTitle,
  });

  return chatId;
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
  let joinStatus: RadarMembershipStatus | null = null;

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
      joinStatus = await joinRadarEvent({
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
    joinStatus,
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
  const [isPublicFilterDialogOpen, setIsPublicFilterDialogOpen] = useState(false);
  const [publicMassTime, setPublicMassTime] = useState('');
  const [publicCountryId, setPublicCountryId] = useState('');
  const [publicDioceseId, setPublicDioceseId] = useState('');
  const [publicChurchId, setPublicChurchId] = useState('');
  const [publicCountrySearch, setPublicCountrySearch] = useState('');
  const [publicDioceseSearch, setPublicDioceseSearch] = useState('');
  const [publicChurchSearch, setPublicChurchSearch] = useState('');

  const [createTitle, setCreateTitle] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createCountryId, setCreateCountryId] = useState('');
  const [createDioceseId, setCreateDioceseId] = useState('');
  const [createCountrySearch, setCreateCountrySearch] = useState('');
  const [createDioceseSearch, setCreateDioceseSearch] = useState('');
  const [createChurchSearch, setCreateChurchSearch] = useState('');
  const [createChurchId, setCreateChurchId] = useState('');
  const [createDate, setCreateDate] = useState(
    toLocalDateValue(new Date(Date.now() + 24 * 60 * 60 * 1000))
  );
  const [createScheduleId, setCreateScheduleId] = useState('');
  const [createManualTime, setCreateManualTime] = useState('');
  const [createMaxParticipants, setCreateMaxParticipants] = useState(50);
  const [createAllowMemberInvite, setCreateAllowMemberInvite] = useState(true);
  const [createRequireHostApproval, setCreateRequireHostApproval] = useState(false);
  const [inviteKeyword, setInviteKeyword] = useState(targetNameFromQuery);
  const [selectedInviteRadarId, setSelectedInviteRadarId] = useState('');
  const [invitingTargetId, setInvitingTargetId] = useState<string | null>(null);
  const [respondingInviteId, setRespondingInviteId] = useState<string | null>(null);
  const [openingInviteChatId, setOpeningInviteChatId] = useState<string | null>(null);
  const [isSubmittingPersonalInvite, setIsSubmittingPersonalInvite] = useState(false);
  const [isPersonalLocationInitialized, setIsPersonalLocationInitialized] = useState(false);
  const [personalCountryId, setPersonalCountryId] = useState('');
  const [personalDioceseId, setPersonalDioceseId] = useState('');
  const [personalCountrySearch, setPersonalCountrySearch] = useState('');
  const [personalDioceseSearch, setPersonalDioceseSearch] = useState('');
  const [personalChurchSearch, setPersonalChurchSearch] = useState('');
  const [personalChurchId, setPersonalChurchId] = useState('');
  const [personalDate, setPersonalDate] = useState(
    toLocalDateValue(new Date(Date.now() + 24 * 60 * 60 * 1000))
  );
  const [personalScheduleId, setPersonalScheduleId] = useState('');
  const [personalManualTime, setPersonalManualTime] = useState('');
  const [personalMessage, setPersonalMessage] = useState('Mengajak Anda Misa bersama');
  const [checkInCountryId, setCheckInCountryId] = useState('');
  const [checkInDioceseId, setCheckInDioceseId] = useState('');
  const [checkInCountrySearch, setCheckInCountrySearch] = useState('');
  const [checkInDioceseSearch, setCheckInDioceseSearch] = useState('');
  const [checkInChurchSearch, setCheckInChurchSearch] = useState('');
  const [checkInChurchId, setCheckInChurchId] = useState('');
  const [checkInDate, setCheckInDate] = useState(toLocalDateValue(new Date()));
  const [checkInScheduleId, setCheckInScheduleId] = useState('');
  const [checkInManualTime, setCheckInManualTime] = useState('');
  const [checkInVisibilityScope, setCheckInVisibilityScope] = useState<CheckInVisibilityScope>('followers');
  const [checkInNotifyFollowers, setCheckInNotifyFollowers] = useState(true);
  const [checkInNotifyChurch, setCheckInNotifyChurch] = useState(false);
  const hasHandledOpenCreateQueryRef = useRef(false);
  const hasHandledOpenCheckInQueryRef = useRef(false);
  const debouncedPublicCountrySearch = useDebouncedValue(publicCountrySearch);
  const debouncedPublicDioceseSearch = useDebouncedValue(publicDioceseSearch);
  const debouncedPublicChurchSearch = useDebouncedValue(publicChurchSearch);
  const debouncedCreateCountrySearch = useDebouncedValue(createCountrySearch);
  const debouncedCreateDioceseSearch = useDebouncedValue(createDioceseSearch);
  const debouncedCreateChurchSearch = useDebouncedValue(createChurchSearch);
  const debouncedCheckInCountrySearch = useDebouncedValue(checkInCountrySearch);
  const debouncedCheckInDioceseSearch = useDebouncedValue(checkInDioceseSearch);
  const debouncedCheckInChurchSearch = useDebouncedValue(checkInChurchSearch);
  const debouncedPersonalCountrySearch = useDebouncedValue(personalCountrySearch);
  const debouncedPersonalDioceseSearch = useDebouncedValue(personalDioceseSearch);
  const debouncedPersonalChurchSearch = useDebouncedValue(personalChurchSearch);

  useEffect(() => {
    setActiveTab(normalizedRequestedTab);
  }, [normalizedRequestedTab]);

  useEffect(() => {
    if (!targetNameFromQuery) return;
    setInviteKeyword((current) => current || targetNameFromQuery);
  }, [targetNameFromQuery]);
  useEffect(() => {
    if (hasHandledOpenCreateQueryRef.current) return;
    if (!openCreateFromQuery) return;
    if (!canCreateRadar) return;
    hasHandledOpenCreateQueryRef.current = true;
    setIsCreateDialogOpen(true);
  }, [canCreateRadar, openCreateFromQuery]);

  useEffect(() => {
    if (profile?.country_id) {
      setCreateCountryId((current) => current || profile.country_id || '');
    }
    if (profile?.diocese_id) {
      setCreateDioceseId((current) => current || profile.diocese_id || '');
    }

    if (!createChurchId && churches.length > 0) {
      const preferredChurch = profile?.church_id && churches.some((church) => church.id === profile.church_id)
        ? profile.church_id
        : churches[0].id;
      setCreateChurchId(preferredChurch || '');
    }
  }, [churches, createChurchId, profile?.church_id, profile?.country_id, profile?.diocese_id]);
  useEffect(() => {
    setCreateScheduleId('');
    setCreateManualTime('');
  }, [createChurchId, createDate]);
  useEffect(() => {
    if (!createChurchId) return;
    if (createCountryId && createDioceseId) return;

    let isMounted = true;
    const hydrateCreateHierarchy = async () => {
      const hierarchy = await getChurchHierarchyIds(createChurchId);
      if (!isMounted) return;
      if (!createCountryId && hierarchy.countryId) {
        setCreateCountryId((current) => current || hierarchy.countryId);
      }
      if (!createDioceseId && hierarchy.dioceseId) {
        setCreateDioceseId((current) => current || hierarchy.dioceseId);
      }
    };

    void hydrateCreateHierarchy();
    return () => {
      isMounted = false;
    };
  }, [createChurchId, createCountryId, createDioceseId]);

  useEffect(() => {
    if (isPersonalLocationInitialized) return;
    if (churches.length === 0) return;

    let isMounted = true;
    const prefillPersonalLocation = async () => {
      if (profile?.country_id) {
        setPersonalCountryId((current) => current || profile.country_id || '');
      }
      if (profile?.diocese_id) {
        setPersonalDioceseId((current) => current || profile.diocese_id || '');
      }

      const preferredChurch =
        profile?.church_id && churches.some((church) => church.id === profile.church_id)
          ? profile.church_id
          : churches[0].id;

      if (preferredChurch) {
        setPersonalChurchId((current) => current || preferredChurch);
      }

      if (preferredChurch && (!profile?.country_id || !profile?.diocese_id)) {
        const hierarchy = await getChurchHierarchyIds(preferredChurch);
        if (!isMounted) return;
        if (!profile?.country_id && hierarchy.countryId) {
          setPersonalCountryId((current) => current || hierarchy.countryId);
        }
        if (!profile?.diocese_id && hierarchy.dioceseId) {
          setPersonalDioceseId((current) => current || hierarchy.dioceseId);
        }
      }

      if (!isMounted) return;
      setIsPersonalLocationInitialized(true);
    };

    void prefillPersonalLocation();
    return () => {
      isMounted = false;
    };
  }, [
    churches,
    isPersonalLocationInitialized,
    profile?.church_id,
    profile?.country_id,
    profile?.diocese_id,
  ]);
  useEffect(() => {
    setPersonalScheduleId('');
    setPersonalManualTime('');
  }, [personalChurchId, personalDate]);
  useEffect(() => {
    if (!personalChurchId) return;
    if (personalCountryId && personalDioceseId) return;

    let isMounted = true;
    const hydratePersonalHierarchy = async () => {
      const hierarchy = await getChurchHierarchyIds(personalChurchId);
      if (!isMounted) return;
      if (!personalCountryId && hierarchy.countryId) {
        setPersonalCountryId((current) => current || hierarchy.countryId);
      }
      if (!personalDioceseId && hierarchy.dioceseId) {
        setPersonalDioceseId((current) => current || hierarchy.dioceseId);
      }
    };

    void hydratePersonalHierarchy();
    return () => {
      isMounted = false;
    };
  }, [personalChurchId, personalCountryId, personalDioceseId]);
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
    setCheckInManualTime('');
  }, [checkInChurchId, checkInDate]);
  useEffect(() => {
    if (checkInVisibilityScope !== 'public' && checkInNotifyChurch) {
      setCheckInNotifyChurch(false);
    }
    if (checkInVisibilityScope === 'private' && checkInNotifyFollowers) {
      setCheckInNotifyFollowers(false);
    }
  }, [checkInNotifyChurch, checkInNotifyFollowers, checkInVisibilityScope]);

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
  const { data: personalSchedules = [], isLoading: isLoadingPersonalSchedules } = useMassSchedules({
    churchId: personalChurchId || undefined,
  });
  const { data: createSchedules = [], isLoading: isLoadingCreateSchedules } = useMassSchedules({
    churchId: createChurchId || undefined,
  });
  const { data: publicChurchSchedules = [], isLoading: isLoadingPublicChurchSchedules } = useMassSchedules({
    churchId: publicChurchId || undefined,
  });
  const { data: createCountries = [], isLoading: isLoadingCreateCountries } = useQuery({
    queryKey: ['create-radar-countries', debouncedCreateCountrySearch],
    queryFn: () => AuthService.getCountries(debouncedCreateCountrySearch),
    staleTime: 5 * 60 * 1000,
  });
  const { data: createDioceses = [], isLoading: isLoadingCreateDioceses } = useQuery({
    queryKey: ['create-radar-dioceses', createCountryId, debouncedCreateDioceseSearch],
    queryFn: () => AuthService.getDioceses(createCountryId, debouncedCreateDioceseSearch),
    enabled: Boolean(createCountryId),
    staleTime: 5 * 60 * 1000,
  });
  const { data: createParishes = [], isLoading: isLoadingCreateParishes } = useQuery({
    queryKey: ['create-radar-parishes', createDioceseId, debouncedCreateChurchSearch],
    queryFn: () => AuthService.getParishes(createDioceseId, debouncedCreateChurchSearch),
    enabled: Boolean(createDioceseId),
    staleTime: 5 * 60 * 1000,
  });
  const { data: checkInCountries = [], isLoading: isLoadingCheckInCountries } = useQuery({
    queryKey: ['checkin-countries', debouncedCheckInCountrySearch],
    queryFn: () => AuthService.getCountries(debouncedCheckInCountrySearch),
    staleTime: 5 * 60 * 1000,
  });
  const { data: checkInDioceses = [], isLoading: isLoadingCheckInDioceses } = useQuery({
    queryKey: ['checkin-dioceses', checkInCountryId, debouncedCheckInDioceseSearch],
    queryFn: () => AuthService.getDioceses(checkInCountryId, debouncedCheckInDioceseSearch),
    enabled: Boolean(checkInCountryId),
    staleTime: 5 * 60 * 1000,
  });
  const { data: checkInParishes = [], isLoading: isLoadingCheckInParishes } = useQuery({
    queryKey: ['checkin-parishes', checkInDioceseId, debouncedCheckInChurchSearch],
    queryFn: () => AuthService.getParishes(checkInDioceseId, debouncedCheckInChurchSearch),
    enabled: Boolean(checkInDioceseId),
    staleTime: 5 * 60 * 1000,
  });
  const { data: personalCountries = [], isLoading: isLoadingPersonalCountries } = useQuery({
    queryKey: ['personal-invite-countries', debouncedPersonalCountrySearch],
    queryFn: () => AuthService.getCountries(debouncedPersonalCountrySearch),
    staleTime: 5 * 60 * 1000,
  });
  const { data: personalDioceses = [], isLoading: isLoadingPersonalDioceses } = useQuery({
    queryKey: ['personal-invite-dioceses', personalCountryId, debouncedPersonalDioceseSearch],
    queryFn: () => AuthService.getDioceses(personalCountryId, debouncedPersonalDioceseSearch),
    enabled: Boolean(personalCountryId),
    staleTime: 5 * 60 * 1000,
  });
  const { data: personalParishes = [], isLoading: isLoadingPersonalParishes } = useQuery({
    queryKey: ['personal-invite-parishes', personalDioceseId, debouncedPersonalChurchSearch],
    queryFn: () => AuthService.getParishes(personalDioceseId, debouncedPersonalChurchSearch),
    enabled: Boolean(personalDioceseId),
    staleTime: 5 * 60 * 1000,
  });
  const { data: publicCountries = [], isLoading: isLoadingPublicCountries } = useQuery({
    queryKey: ['radar-public-countries', debouncedPublicCountrySearch],
    queryFn: () => AuthService.getCountries(debouncedPublicCountrySearch),
    staleTime: 5 * 60 * 1000,
  });
  const { data: publicDioceses = [], isLoading: isLoadingPublicDioceses } = useQuery({
    queryKey: ['radar-public-dioceses', publicCountryId, debouncedPublicDioceseSearch],
    queryFn: () => AuthService.getDioceses(publicCountryId, debouncedPublicDioceseSearch),
    enabled: Boolean(publicCountryId),
    staleTime: 5 * 60 * 1000,
  });
  const { data: publicCountryDioceses = [], isLoading: isLoadingPublicCountryDioceses } = useQuery({
    queryKey: ['radar-public-country-dioceses', publicCountryId],
    queryFn: () => AuthService.getDioceses(publicCountryId, ''),
    enabled: Boolean(publicCountryId),
    staleTime: 5 * 60 * 1000,
  });
  const { data: publicParishes = [], isLoading: isLoadingPublicParishes } = useQuery({
    queryKey: ['radar-public-parishes', publicDioceseId, debouncedPublicChurchSearch],
    queryFn: () => AuthService.getParishes(publicDioceseId, debouncedPublicChurchSearch),
    enabled: Boolean(publicDioceseId),
    staleTime: 5 * 60 * 1000,
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
    if (hasHandledOpenCheckInQueryRef.current) return;
    if (!openCheckinFromQuery) return;
    if (activeCheckIn) {
      hasHandledOpenCheckInQueryRef.current = true;
      return;
    }
    hasHandledOpenCheckInQueryRef.current = true;
    let isMounted = true;

    const openCheckInFromQueryWithPrefill = async () => {
      const fallbackChurchId = defaultCheckInChurchId || churches[0]?.id || '';
      if (profile?.country_id) {
        setCheckInCountryId((current) => current || profile.country_id || '');
      }
      if (profile?.diocese_id) {
        setCheckInDioceseId((current) => current || profile.diocese_id || '');
      }

      if (fallbackChurchId) {
        setCheckInChurchId((current) => current || fallbackChurchId);
      }
      if (fallbackChurchId && (!profile?.country_id || !profile?.diocese_id)) {
        const hierarchy = await getChurchHierarchyIds(fallbackChurchId);
        if (!isMounted) return;
        if (!profile?.country_id && hierarchy.countryId) {
          setCheckInCountryId((current) => current || hierarchy.countryId);
        }
        if (!profile?.diocese_id && hierarchy.dioceseId) {
          setCheckInDioceseId((current) => current || hierarchy.dioceseId);
        }
      }

      if (!isMounted) return;
      setCheckInCountrySearch('');
      setCheckInDioceseSearch('');
      setCheckInChurchSearch('');
      setCheckInScheduleId('');
      setCheckInManualTime('');
      setCheckInDate(toLocalDateValue(new Date()));
      setIsCheckInDialogOpen(true);
    };

    void openCheckInFromQueryWithPrefill();
    return () => {
      isMounted = false;
    };
  }, [activeCheckIn, churches, defaultCheckInChurchId, openCheckinFromQuery, profile?.country_id, profile?.diocese_id]);
  useEffect(() => {
    if (!activeCheckIn) {
      setIsPresenceExpanded(false);
    }
  }, [activeCheckIn]);
  const createDateLabel = useMemo(() => {
    const date = new Date(`${createDate}T00:00:00`);
    if (Number.isNaN(date.getTime())) return createDate;
    return format(date, 'EEEE, dd MMM yyyy', { locale: id });
  }, [createDate]);
  const createDayOfWeek = useMemo(() => {
    const date = new Date(`${createDate}T00:00:00`);
    if (Number.isNaN(date.getTime())) {
      const today = new Date().getDay();
      return today === 0 ? 7 : today;
    }
    const day = date.getDay();
    return day === 0 ? 7 : day;
  }, [createDate]);
  const createScheduleOptions = useMemo(
    () =>
      createSchedules.filter(
        (schedule) =>
          normalizeScheduleDayOfWeek(schedule.day_of_week) === createDayOfWeek
      ),
    [createDayOfWeek, createSchedules]
  );
  const selectedCreateSchedule = useMemo(
    () => createScheduleOptions.find((schedule) => schedule.id === createScheduleId) || null,
    [createScheduleId, createScheduleOptions]
  );
  const selectedCreateTime = useMemo(
    () => selectedCreateSchedule?.mass_time || createManualTime.trim(),
    [createManualTime, selectedCreateSchedule?.mass_time]
  );
  const createChurchOptions = useMemo(() => {
    if (createChurchSearch.trim().length > 0) {
      return createParishes;
    }
    const fromDiocese = createDioceseId
      ? churches
        .filter((church) => church.diocese_id === createDioceseId)
        .map((church) => ({ id: church.id, name: church.name }))
      : [];
    if (fromDiocese.length > 0) return fromDiocese;
    if (createParishes.length > 0) return createParishes;
    return churches.map((church) => ({ id: church.id, name: church.name }));
  }, [churches, createChurchSearch, createDioceseId, createParishes]);
  const createCountryName = useMemo(
    () => createCountries.find((country) => country.id === createCountryId)?.name || '',
    [createCountries, createCountryId]
  );
  const createDioceseName = useMemo(
    () => createDioceses.find((diocese) => diocese.id === createDioceseId)?.name || '',
    [createDioceses, createDioceseId]
  );
  const isCreateHierarchyUnavailable = useMemo(() => {
    const hasSelectedCountry = Boolean(createCountryId || profile?.country_id);
    if (!hasSelectedCountry) {
      return !isLoadingCreateCountries && createCountries.length === 0;
    }
    return !createDioceseId && !isLoadingCreateDioceses && createDioceses.length === 0;
  }, [
    createCountries.length,
    createCountryId,
    createDioceseId,
    createDioceses.length,
    isLoadingCreateCountries,
    isLoadingCreateDioceses,
    profile?.country_id,
  ]);
  const createChurchName = useMemo(
    () =>
      churches.find((church) => church.id === createChurchId)?.name ||
      createChurchOptions.find((church) => church.id === createChurchId)?.name ||
      '',
    [churches, createChurchId, createChurchOptions]
  );
  const checkInDateLabel = useMemo(() => {
    const date = new Date(`${checkInDate}T00:00:00`);
    if (Number.isNaN(date.getTime())) return checkInDate;
    return format(date, 'EEEE, dd MMM yyyy', { locale: id });
  }, [checkInDate]);
  const checkInDayOfWeek = useMemo(() => {
    const date = new Date(`${checkInDate}T00:00:00`);
    if (Number.isNaN(date.getTime())) {
      const today = new Date().getDay();
      return today === 0 ? 7 : today;
    }
    const day = date.getDay();
    return day === 0 ? 7 : day;
  }, [checkInDate]);
  const scheduleOptionsForDate = useMemo(
    () =>
      checkInSchedules.filter(
        (schedule) =>
          normalizeScheduleDayOfWeek(schedule.day_of_week) === checkInDayOfWeek
      ),
    [checkInDayOfWeek, checkInSchedules]
  );
  const selectedCheckInSchedule = useMemo(
    () =>
      scheduleOptionsForDate.find((schedule) => schedule.id === checkInScheduleId) ||
      null,
    [checkInScheduleId, scheduleOptionsForDate]
  );
  const selectedCheckInTime = useMemo(
    () => selectedCheckInSchedule?.mass_time || checkInManualTime.trim(),
    [checkInManualTime, selectedCheckInSchedule?.mass_time]
  );
  const personalDayOfWeek = useMemo(() => {
    const date = new Date(`${personalDate}T00:00:00`);
    if (Number.isNaN(date.getTime())) {
      const today = new Date().getDay();
      return today === 0 ? 7 : today;
    }
    const day = date.getDay();
    return day === 0 ? 7 : day;
  }, [personalDate]);
  const personalDateLabel = useMemo(() => {
    const date = new Date(`${personalDate}T00:00:00`);
    if (Number.isNaN(date.getTime())) return personalDate;
    return format(date, 'EEEE, dd MMM yyyy', { locale: id });
  }, [personalDate]);
  const personalScheduleOptions = useMemo(
    () =>
      personalSchedules.filter(
        (schedule) => normalizeScheduleDayOfWeek(schedule.day_of_week) === personalDayOfWeek
      ),
    [personalDayOfWeek, personalSchedules]
  );
  const selectedPersonalSchedule = useMemo(
    () => personalScheduleOptions.find((schedule) => schedule.id === personalScheduleId) || null,
    [personalScheduleId, personalScheduleOptions]
  );
  const selectedPersonalTime = useMemo(
    () => selectedPersonalSchedule?.mass_time || personalManualTime.trim(),
    [personalManualTime, selectedPersonalSchedule?.mass_time]
  );
  useEffect(() => {
    if (checkInScheduleId || checkInManualTime || scheduleOptionsForDate.length !== 1) return;
    setCheckInScheduleId(scheduleOptionsForDate[0].id);
  }, [checkInManualTime, checkInScheduleId, scheduleOptionsForDate]);
  useEffect(() => {
    if (createScheduleId || createManualTime || createScheduleOptions.length !== 1) return;
    setCreateScheduleId(createScheduleOptions[0].id);
  }, [createManualTime, createScheduleId, createScheduleOptions]);
  useEffect(() => {
    if (personalScheduleId || personalManualTime || personalScheduleOptions.length !== 1) return;
    setPersonalScheduleId(personalScheduleOptions[0].id);
  }, [personalManualTime, personalScheduleId, personalScheduleOptions]);
  const churchDioceseById = useMemo(() => {
    const map = new Map<string, string>();
    for (const church of churches) {
      map.set(church.id, church.diocese_id || '');
    }
    return map;
  }, [churches]);
  const publicChurchOptions = useMemo(() => {
    if (publicChurchSearch.trim().length > 0) {
      return publicParishes;
    }
    const fromDiocese = publicDioceseId
      ? churches
        .filter((church) => church.diocese_id === publicDioceseId)
        .map((church) => ({ id: church.id, name: church.name }))
      : [];
    if (fromDiocese.length > 0) return fromDiocese;
    if (publicParishes.length > 0) return publicParishes;
    return churches.map((church) => ({ id: church.id, name: church.name }));
  }, [churches, publicChurchSearch, publicDioceseId, publicParishes]);
  const publicCountryName = useMemo(
    () => publicCountries.find((country) => country.id === publicCountryId)?.name || '',
    [publicCountries, publicCountryId]
  );
  const publicDioceseName = useMemo(
    () => publicDioceses.find((diocese) => diocese.id === publicDioceseId)?.name || '',
    [publicDioceseId, publicDioceses]
  );
  const publicChurchName = useMemo(
    () =>
      publicChurchOptions.find((church) => church.id === publicChurchId)?.name ||
      churches.find((church) => church.id === publicChurchId)?.name ||
      '',
    [churches, publicChurchId, publicChurchOptions]
  );
  const hasPublicAdvancedFilter = Boolean(
    publicMassTime.trim() || publicCountryId || publicDioceseId || publicChurchId
  );
  const publicFilterLocationLabel = useMemo(() => {
    if (publicChurchName) return publicChurchName;
    if (publicChurchId) return 'Gereja dipilih';
    if (publicDioceseName) return publicDioceseName;
    if (publicDioceseId) return 'Keuskupan dipilih';
    if (publicCountryName) return publicCountryName;
    if (publicCountryId) return 'Negara dipilih';
    return 'Semua lokasi';
  }, [publicChurchId, publicChurchName, publicCountryId, publicCountryName, publicDioceseId, publicDioceseName]);
  const publicFilterTimeLabel = publicMassTime.trim() || 'Semua jam';
  const publicSchedulePreview = useMemo(
    () => publicChurchSchedules.slice(0, 8),
    [publicChurchSchedules]
  );
  const filteredUpcomingEvents = useMemo(() => {
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startTomorrow = new Date(startToday);
    startTomorrow.setDate(startTomorrow.getDate() + 1);
    const startAfterTomorrow = new Date(startTomorrow);
    startAfterTomorrow.setDate(startAfterTomorrow.getDate() + 1);
    const startNextWeek = new Date(startToday);
    startNextWeek.setDate(startNextWeek.getDate() + 7);
    const countryDioceseSet = new Set(publicCountryDioceses.map((diocese) => diocese.id));
    const selectedMassTime = publicMassTime.trim();

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
    }).filter((event) => {
      const eventChurchId = event.churchId?.trim() || '';
      const eventDioceseId =
        event.dioceseId?.trim() ||
        (eventChurchId ? churchDioceseById.get(eventChurchId)?.trim() || '' : '');
      const eventCountryId = event.countryId?.trim() || '';

      if (publicChurchId && eventChurchId !== publicChurchId) {
        return false;
      }
      if (!publicChurchId && publicDioceseId && eventDioceseId !== publicDioceseId) {
        return false;
      }
      if (!publicChurchId && !publicDioceseId && publicCountryId) {
        if (eventCountryId) {
          if (eventCountryId !== publicCountryId) return false;
        } else {
          if (isLoadingPublicCountryDioceses) return true;
          if (countryDioceseSet.size === 0) return false;
          if (!eventDioceseId || !countryDioceseSet.has(eventDioceseId)) return false;
        }
      }

      if (selectedMassTime) {
        if (!event.startsAt) return false;
        const startsAt = new Date(event.startsAt);
        if (Number.isNaN(startsAt.getTime())) return false;
        const eventTime = `${startsAt.getHours().toString().padStart(2, '0')}:${startsAt
          .getMinutes()
          .toString()
          .padStart(2, '0')}`;
        if (eventTime !== selectedMassTime) return false;
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
  }, [
    churchDioceseById,
    publicChurchId,
    publicCountryDioceses,
    publicCountryId,
    publicDioceseId,
    publicFilter,
    isLoadingPublicCountryDioceses,
    publicMassTime,
    publicSort,
    upcomingEvents,
  ]);

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

    const publicOnly = base.filter((item) => normalizeRadarVisibility(item.visibility) === 'PUBLIC');

    if (!focusedRadar) return publicOnly;
    if (normalizeRadarVisibility(focusedRadar.visibility) !== 'PUBLIC') return publicOnly;
    if (publicOnly.some((item) => item.id === focusedRadar.id)) return publicOnly;
    return [focusedRadar, ...publicOnly];
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
    const membership = selectedInviteRadar.id ? radarMembershipMap[selectedInviteRadar.id] : undefined;
    if (normalizeRadarVisibility(selectedInviteRadar.visibility) !== 'PUBLIC') return false;
    if (selectedInviteRadar.creatorId === user.id) return true;
    if (selectedInviteRadar.allowMemberInvite === false) return false;
    return membership === 'JOINED';
  }, [radarMembershipMap, selectedInviteRadar, user?.id]);

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
  const actionablePersonalInviteByRadarId = useMemo(() => {
    const map = new Map<string, RadarInviteItem>();
    for (const invite of incomingInvites) {
      if (!isPersonalInvite(invite) || !invite.radarId || !invite.inviteId) continue;
      if (!isActionablePersonalInviteStatus(invite.status)) continue;
      if (!map.has(invite.radarId)) {
        map.set(invite.radarId, invite);
      }
    }
    return map;
  }, [incomingInvites]);
  const pendingPrivateInviteSet = useMemo(
    () => new Set(Array.from(actionablePersonalInviteByRadarId.keys())),
    [actionablePersonalInviteByRadarId]
  );
  const personalChurchOptions = useMemo(() => {
    const fallbackChurches = churches.map((church) => ({ id: church.id, name: church.name }));
    const searchKeyword = personalChurchSearch.trim().toLowerCase();

    if (searchKeyword.length > 0) {
      if (personalDioceseId) {
        return personalParishes;
      }
      return fallbackChurches
        .filter((church) => church.name.toLowerCase().includes(searchKeyword))
        .slice(0, 100);
    }

    if (personalDioceseId) {
      const fromDiocese = churches
        .filter((church) => church.diocese_id === personalDioceseId)
        .map((church) => ({ id: church.id, name: church.name }));
      if (fromDiocese.length > 0) return fromDiocese;
      if (personalParishes.length > 0) return personalParishes;
    }

    return fallbackChurches;
  }, [churches, personalChurchSearch, personalDioceseId, personalParishes]);
  const personalCountryName = useMemo(() => {
    const selected = personalCountries.find((country) => country.id === personalCountryId)?.name;
    if (selected) return selected;
    if (profile?.country_id === personalCountryId) {
      return typeof profile.country === 'string'
        ? profile.country
        : profile.country?.name || profile.country_text || '';
    }
    return '';
  }, [personalCountries, personalCountryId, profile?.country, profile?.country_id, profile?.country_text]);
  const personalDioceseName = useMemo(() => {
    const selected = personalDioceses.find((diocese) => diocese.id === personalDioceseId)?.name;
    if (selected) return selected;
    if (profile?.diocese_id === personalDioceseId) {
      return typeof profile.diocese === 'string'
        ? profile.diocese
        : profile.diocese?.name || profile.diocese_text || '';
    }
    return '';
  }, [personalDioceseId, personalDioceses, profile?.diocese, profile?.diocese_id, profile?.diocese_text]);
  const isPersonalHierarchyUnavailable = useMemo(() => {
    const hasSelectedCountry = Boolean(personalCountryId || profile?.country_id);
    if (!hasSelectedCountry) {
      return !isLoadingPersonalCountries && personalCountries.length === 0;
    }
    return !personalDioceseId && !isLoadingPersonalDioceses && personalDioceses.length === 0;
  }, [
    isLoadingPersonalCountries,
    isLoadingPersonalDioceses,
    personalCountries.length,
    personalCountryId,
    personalDioceseId,
    personalDioceses.length,
    profile?.country_id,
  ]);
  const personalChurchName = useMemo(
    () =>
      personalChurchOptions.find((church) => church.id === personalChurchId)?.name ||
      churches.find((church) => church.id === personalChurchId)?.name ||
      '',
    [churches, personalChurchId, personalChurchOptions]
  );
  const checkInChurchOptions = useMemo(() => {
    if (checkInChurchSearch.trim().length > 0) {
      return checkInParishes;
    }
    const fromDiocese = checkInDioceseId
      ? churches
        .filter((church) => church.diocese_id === checkInDioceseId)
        .map((church) => ({ id: church.id, name: church.name }))
      : [];
    if (fromDiocese.length > 0) return fromDiocese;
    if (checkInParishes.length > 0) return checkInParishes;
    return churches.map((church) => ({ id: church.id, name: church.name }));
  }, [checkInChurchSearch, checkInDioceseId, checkInParishes, churches]);
  const canCheckInNow = checkInChurchOptions.length > 0 || checkInCountries.length > 0;
  const checkInChurchName = useMemo(
    () =>
      checkInChurchOptions.find((church) => church.id === checkInChurchId)?.name ||
      churches.find((church) => church.id === checkInChurchId)?.name ||
      'Gereja',
    [checkInChurchId, checkInChurchOptions, churches]
  );
  const checkInCountryName = useMemo(() => {
    const selected = checkInCountries.find((country) => country.id === checkInCountryId)?.name;
    if (selected) return selected;
    if (profile?.country_id === checkInCountryId) {
      return typeof profile.country === 'string'
        ? profile.country
        : profile.country?.name || profile.country_text || '';
    }
    return '';
  }, [checkInCountries, checkInCountryId, profile?.country, profile?.country_id, profile?.country_text]);
  const checkInDioceseName = useMemo(() => {
    const selected = checkInDioceses.find((diocese) => diocese.id === checkInDioceseId)?.name;
    if (selected) return selected;
    if (profile?.diocese_id === checkInDioceseId) {
      return typeof profile.diocese === 'string'
        ? profile.diocese
        : profile.diocese?.name || profile.diocese_text || '';
    }
    return '';
  }, [checkInDioceses, checkInDioceseId, profile?.diocese, profile?.diocese_id, profile?.diocese_text]);
  const activeCheckInChurchName = useMemo(
    () => churches.find((church) => church.id === activePresenceChurchId)?.name || 'gereja terpilih',
    [activePresenceChurchId, churches]
  );
  const canNotifyFollowers = checkInVisibilityScope !== 'private';
  const canNotifyChurch = checkInVisibilityScope === 'public';
  const focusedRadarMembership = focusedRadar?.id ? radarMembershipMap[focusedRadar.id] : undefined;
  const isFocusedRadarJoined = focusedRadarMembership === 'JOINED';
  const isFocusedRadarPending = focusedRadarMembership === 'PENDING';
  const isFocusedRadarPrivate = normalizeRadarVisibility(focusedRadar?.visibility) === 'PRIVATE';
  const focusedRadarLocationLabel = focusedRadar ? formatRadarLocationLabel(focusedRadar) : '';
  const focusedPendingPersonalInvite =
    focusedRadar?.id ? actionablePersonalInviteByRadarId.get(focusedRadar.id) : undefined;
  const isCheckingFocusedPrivateInvite =
    isFocusedRadarPrivate &&
    !focusedPendingPersonalInvite &&
    !isFocusedRadarJoined &&
    !isFocusedRadarPending &&
    isLoadingIncomingInvites;
  const selectedInviteRadarMembership = selectedInviteRadar?.id
    ? radarMembershipMap[selectedInviteRadar.id]
    : undefined;
  const selectedInviteRadarBlockedMessage = useMemo(() => {
    if (!selectedInviteRadar || !user?.id) return '';
    if (normalizeRadarVisibility(selectedInviteRadar.visibility) !== 'PUBLIC') {
      return 'Radar private tidak mendukung undangan grup.';
    }
    if (selectedInviteRadar.creatorId === user.id) return '';
    if (selectedInviteRadar.allowMemberInvite === false) {
      return 'Host radar ini menonaktifkan undangan member. Hanya host yang bisa mengundang.';
    }
    if (selectedInviteRadarMembership !== 'JOINED') {
      return 'Anda harus bergabung ke radar ini dulu sebelum mengundang user lain.';
    }
    return '';
  }, [selectedInviteRadar, selectedInviteRadarMembership, user?.id]);
  const focusedRadarBlockedMessage = useMemo(() => {
    if (!focusedRadar || !user?.id) return '';
    if (normalizeRadarVisibility(focusedRadar.visibility) !== 'PUBLIC') {
      return 'Radar private tidak mendukung undangan grup.';
    }
    if (focusedRadar.creatorId === user.id) return '';
    if (focusedRadar.allowMemberInvite === false) {
      return 'Host menonaktifkan undangan member untuk radar ini.';
    }
    if (focusedRadarMembership !== 'JOINED') {
      return 'Gabung radar dulu untuk bisa mengundang user lain.';
    }
    return '';
  }, [focusedRadar, focusedRadarMembership, user?.id]);
  const canInviteOnFocusedRadar = useMemo(() => {
    if (!focusedRadar || !user?.id) return false;
    if (normalizeRadarVisibility(focusedRadar.visibility) !== 'PUBLIC') return false;
    if (focusedRadar.creatorId === user.id) return true;
    if (focusedRadar.allowMemberInvite === false) return false;
    return focusedRadarMembership === 'JOINED';
  }, [focusedRadar, focusedRadarMembership, user?.id]);

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
  const isProfileTargetSelf = Boolean(targetFromProfile?.id && user?.id && targetFromProfile.id === user.id);

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

    const selectedTime = selectedCreateTime;
    if (!selectedTime) {
      toast.error('Pilih jadwal misa atau isi jam manual terlebih dahulu');
      return;
    }

    const parsedTime = parseClockTime(selectedTime);
    if (!parsedTime) {
      toast.error('Format jam misa tidak valid');
      return;
    }

    const startsAt = new Date(
      `${createDate}T${parsedTime.hour.toString().padStart(2, '0')}:${parsedTime.minute.toString().padStart(2, '0')}:00`
    );
    if (Number.isNaN(startsAt.getTime())) {
      toast.error('Waktu radar tidak valid');
      return;
    }
    if (!startsAt.getTime() || startsAt.getTime() <= Date.now()) {
      toast.error('Waktu misa harus di masa depan');
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

      await createRadarEvent({
        userId: user.id,
        churchId: createChurchId,
        churchName: selectedChurch?.name || createChurchName || undefined,
        title,
        description: createDescription.trim(),
        startsAtIso: startsAt.toISOString(),
        maxParticipants: createMaxParticipants,
        allowMemberInvite: createAllowMemberInvite,
        requireHostApproval: createRequireHostApproval,
        massScheduleId: selectedCreateSchedule?.id,
      });

      toast.success('Radar berhasil dibuat');
      setIsCreateDialogOpen(false);
      setCreateTitle('');
      setCreateDescription('');
      setCreateDate(toLocalDateValue(new Date(Date.now() + 24 * 60 * 60 * 1000)));
      setCreateScheduleId('');
      setCreateManualTime('');
      setCreateMaxParticipants(50);
      setCreateAllowMemberInvite(true);
      setCreateRequireHostApproval(false);
      setCreateCountrySearch('');
      setCreateDioceseSearch('');
      setCreateChurchSearch('');
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

  const handleOpenCheckInDialog = async () => {
    const fallbackChurchId = checkInChurchId || defaultCheckInChurchId || churches[0]?.id || '';
    if (!fallbackChurchId && checkInCountries.length === 0 && checkInChurchOptions.length === 0) {
      toast.error('Belum ada data gereja untuk check-in');
      return;
    }
    if (!checkInCountryId && profile?.country_id) {
      setCheckInCountryId(profile.country_id);
    }
    if (!checkInDioceseId && profile?.diocese_id) {
      setCheckInDioceseId(profile.diocese_id);
    }
    if (fallbackChurchId && !checkInChurchId) {
      setCheckInChurchId(fallbackChurchId);
    }
    if (fallbackChurchId && (!checkInCountryId || !checkInDioceseId)) {
      const hierarchy = await getChurchHierarchyIds(fallbackChurchId);
      if (!checkInCountryId && hierarchy.countryId) {
        setCheckInCountryId(hierarchy.countryId);
      }
      if (!checkInDioceseId && hierarchy.dioceseId) {
        setCheckInDioceseId(hierarchy.dioceseId);
      }
    }
    setCheckInCountrySearch('');
    setCheckInDioceseSearch('');
    setCheckInChurchSearch('');
    setCheckInScheduleId('');
    setCheckInManualTime('');
    setCheckInDate(toLocalDateValue(new Date()));
    setCheckInVisibilityScope('followers');
    setCheckInNotifyFollowers(true);
    setCheckInNotifyChurch(false);
    setIsCheckInDialogOpen(true);
  };

  const handleResetPublicAdvancedFilters = () => {
    setPublicMassTime('');
    setPublicCountryId('');
    setPublicDioceseId('');
    setPublicChurchId('');
    setPublicCountrySearch('');
    setPublicDioceseSearch('');
    setPublicChurchSearch('');
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
    if (!selectedCheckInSchedule && !checkInManualTime.trim()) {
      toast.error('Pilih jadwal misa atau isi jam manual');
      return;
    }

    setIsCheckingIn(true);
    try {
      const hierarchy = await getChurchHierarchyIds(checkInChurchId);
      const resolvedCountryId = checkInCountryId || profile?.country_id || hierarchy.countryId;
      const resolvedDioceseId = checkInDioceseId || profile?.diocese_id || hierarchy.dioceseId;
      await setCheckInNow({
        userId: user.id,
        churchId: checkInChurchId,
        countryId: resolvedCountryId,
        dioceseId: resolvedDioceseId,
        massScheduleId: selectedCheckInSchedule?.id,
        checkinDate: checkInDate,
        massTime: selectedCheckInSchedule?.mass_time || checkInManualTime.trim() || undefined,
        visibilityScope: checkInVisibilityScope,
        notifyFollowers: checkInVisibilityScope === 'private' ? false : checkInNotifyFollowers,
        notifyChurch: checkInVisibilityScope === 'public' ? checkInNotifyChurch : false,
      });
      toast.success(selectedCheckInTime ? `Check-in berhasil (${selectedCheckInTime})` : 'Check-in berhasil');
      setIsCheckInDialogOpen(false);
      setIsPresenceExpanded(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['active-checkin', user.id] }),
        queryClient.invalidateQueries({ queryKey: ['last-checkin', user.id] }),
        queryClient.invalidateQueries({ queryKey: ['radar-events', user.id] }),
        queryClient.invalidateQueries({ queryKey: ['checkin-presence'] }),
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
      setIsPresenceExpanded(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['active-checkin', user.id] }),
        queryClient.invalidateQueries({ queryKey: ['last-checkin', user.id] }),
        queryClient.invalidateQueries({ queryKey: ['checkin-presence'] }),
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
      const isPrivateRadar = normalizeRadarVisibility(radar.visibility) === 'PRIVATE';
      if (isPrivateRadar) {
        let actionableInvite = actionablePersonalInviteByRadarId.get(radar.id);
        if (!actionableInvite) {
          actionableInvite =
            (await getLatestPersonalInviteForRadar({
              radarId: radar.id,
              userId: user.id,
              radarSource: radar.source,
            })) || undefined;
        }
        if (!actionableInvite) {
          const freshIncomingInvites = await getIncomingRadarInvites(user.id);
          actionableInvite =
            freshIncomingInvites.find(
              (invite) =>
                invite.radarId === radar.id &&
                Boolean(invite.inviteId) &&
                isPersonalInvite(invite) &&
                isActionablePersonalInviteStatus(invite.status)
            ) || undefined;
        }
        if (!actionableInvite || !actionableInvite.inviteId) {
          await queryClient.invalidateQueries({ queryKey: ['radar-incoming-invites', user.id] });
          toast.error('Anda tidak memiliki undangan aktif untuk radar private ini.');
          return;
        }

        if (isPendingInvite(actionableInvite.status)) {
          const response = await respondToRadarInvite({
            userId: user.id,
            userName: profile?.full_name || user.email || 'User',
            invite: actionableInvite,
            accept: true,
          });
          if (response.joinWarning) {
            toast.warning(`Undangan diterima, tetapi join radar belum berhasil: ${response.joinWarning}`);
          } else if (response.joinStatus === 'PENDING') {
            toast.success('Undangan diterima. Menunggu persetujuan host radar.');
          } else {
            toast.success('Undangan berhasil diterima.');
          }

          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['radar-incoming-invites', user.id] }),
            queryClient.invalidateQueries({ queryKey: ['radar-outgoing-invites', user.id] }),
            queryClient.invalidateQueries({ queryKey: ['radar-membership-map', user.id] }),
            queryClient.invalidateQueries({ queryKey: ['radar-events', user.id] }),
          ]);

          if (!response.joinWarning && response.joinStatus !== 'PENDING') {
            const chatId = await resolveInviteChatId({
              invite: actionableInvite,
              userId: user.id,
            });
            if (chatId) {
              router.push(`/chat/${encodeURIComponent(chatId)}`);
              return;
            }
          }
          router.push(`/radar/${encodeURIComponent(radar.id)}`);
          return;
        }

        let joinStatus: RadarMembershipStatus = 'JOINED';
        try {
          joinStatus = await joinRadarEvent({
            radarId: radar.id,
            userId: user.id,
            source: radar.source,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error || '');
          if (!isDuplicateError(message)) {
            throw error;
          }
        }
        toast.success(
          joinStatus === 'PENDING'
            ? 'Permintaan bergabung dikirim. Menunggu persetujuan host.'
            : 'Berhasil bergabung ke radar private.'
        );
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['radar-membership-map', user.id] }),
          queryClient.invalidateQueries({ queryKey: ['radar-events', user.id] }),
        ]);

        if (joinStatus === 'PENDING') {
          router.push(`/radar/${encodeURIComponent(radar.id)}`);
          return;
        }

        const chatId = await resolveInviteChatId({
          invite: actionableInvite,
          userId: user.id,
        });
        if (chatId) {
          router.push(`/chat/${encodeURIComponent(chatId)}`);
          return;
        }
        router.push(`/radar/${encodeURIComponent(radar.id)}`);
        return;
      }

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
    if (!canInviteOnFocusedRadar) {
      toast.info(focusedRadarBlockedMessage || 'Anda belum bisa mengundang user untuk radar ini.');
      return;
    }
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
    if (normalizeRadarVisibility(selectedInviteRadar.visibility) !== 'PUBLIC') {
      toast.error('Radar private tidak mendukung undangan grup.');
      return;
    }
    if (!canInviteOnSelectedRadar) {
      toast.error(selectedInviteRadarBlockedMessage || 'Anda belum bisa mengundang user pada radar ini.');
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
    if (targetFromProfile.id === user.id) {
      toast.info('Anda tidak bisa mengirim Ajak Misa personal ke akun sendiri.');
      return;
    }
    if (!personalChurchId) {
      toast.error('Pilih gereja untuk ajak misa personal.');
      return;
    }
    if (!personalDate) {
      toast.error('Pilih tanggal misa terlebih dahulu.');
      return;
    }
    if (!selectedPersonalSchedule && !personalManualTime.trim()) {
      toast.error('Pilih jadwal misa atau isi jam manual.');
      return;
    }

    const timeMatch = selectedPersonalTime.match(/^(\d{1,2}):(\d{2})/);
    if (!timeMatch) {
      toast.error('Jam misa personal tidak valid.');
      return;
    }
    const startsAt = new Date(
      `${personalDate}T${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}:00`
    );
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
      setPersonalScheduleId('');
      setPersonalManualTime('');
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
      } else if (accept && response.joinStatus === 'PENDING') {
        toast.success('Undangan diterima. Menunggu persetujuan host radar.');
      } else {
        toast.success(accept ? 'Undangan diterima' : 'Undangan ditolak');
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['radar-incoming-invites', user.id] }),
        queryClient.invalidateQueries({ queryKey: ['radar-outgoing-invites', user.id] }),
        queryClient.invalidateQueries({ queryKey: ['radar-membership-map', user.id] }),
        queryClient.invalidateQueries({ queryKey: ['radar-events', user.id] }),
      ]);

      if (accept && !response.joinWarning && response.joinStatus !== 'PENDING') {
        try {
          const chatId = await resolveInviteChatId({
            invite,
            userId: user.id,
          });
          if (chatId) {
            router.push(`/chat/${encodeURIComponent(chatId)}`);
          }
        } catch (error) {
          console.warn('Unable to open radar chat after invite acceptance:', error);
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal merespons undangan');
    } finally {
      setRespondingInviteId(null);
    }
  };

  const handleOpenInviteChat = async (invite: RadarInviteItem) => {
    if (!user?.id) {
      toast.error('Anda harus login');
      return;
    }

    if (!isAcceptedInvite(invite.status)) {
      toast.info('Chat bisa dibuka setelah undangan diterima.');
      return;
    }

    setOpeningInviteChatId(invite.id);
    try {
      const chatId = await resolveInviteChatId({
        invite,
        userId: user.id,
      });
      if (!chatId) {
        toast.info('Grup chat untuk undangan ini belum siap.');
        return;
      }
      router.push(`/chat/${encodeURIComponent(chatId)}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal membuka chat undangan.');
    } finally {
      setOpeningInviteChatId(null);
    }
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="overflow-hidden rounded-[26px] border border-sky-500/20 bg-gradient-to-br from-sky-600 via-sky-500 to-cyan-500 p-5 text-white shadow-lg sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/85">Radar</p>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">Radar Misa</h1>
            <p className="mt-1.5 text-sm text-white/90">
              Cari misa, check-in kehadiran, dan kirim ajakan misa personal.
            </p>
          </div>
          <Button
            className="rounded-xl border border-white/35 bg-white/15 text-white shadow-sm backdrop-blur hover:bg-white/20"
            onClick={() => setIsCreateDialogOpen(true)}
            disabled={!canCreateRadar}
            title={!canCreateRadar ? 'Fitur buat radar hanya untuk Umat & Katekumen.' : undefined}
          >
            <MapPinPlus className="mr-2 h-4 w-4" />
            Buat Radar
          </Button>
        </div>
      </div>

      <Card
        className={cn(
          'overflow-hidden rounded-2xl border shadow-sm transition-colors',
          activeCheckIn
            ? 'border-emerald-500/35 bg-emerald-500'
            : 'border-border/70 bg-card'
        )}
      >
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  'inline-flex h-10 w-10 items-center justify-center rounded-full',
                  activeCheckIn ? 'bg-white/20 text-white' : 'bg-primary/10 text-primary'
                )}
              >
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <div>
                <p className={cn('text-sm font-semibold', activeCheckIn ? 'text-white' : 'text-foreground')}>
                  {activeCheckIn
                    ? `Sedang misa di ${activeCheckInChurchName}`
                    : 'Saya Sedang Misa'}
                </p>
                <p className={cn('text-xs', activeCheckIn ? 'text-white/85' : 'text-muted-foreground')}>
                  {activeCheckIn
                    ? `Check-in aktif sejak ${formatDateTimeLabel(activeCheckIn.checkAt)}`
                    : `Terakhir check-in: ${lastCheckIn ? formatDateTimeLabel(lastCheckIn) : 'Belum pernah'}`}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {!activeCheckIn ? (
                <Button
                  variant="default"
                  className="rounded-xl bg-primary hover:bg-primary-hover"
                  onClick={handleOpenCheckInDialog}
                  disabled={isCheckingIn || !canCheckInNow}
                >
                  {isCheckingIn ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Menyimpan...
                    </>
                  ) : (
                    'Check-in'
                  )}
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    className="rounded-xl border-white/45 bg-white text-emerald-600 hover:bg-white/90"
                    onClick={() => setIsPresenceExpanded((prev) => !prev)}
                    disabled={isCheckingIn}
                  >
                    <Users className="mr-2 h-4 w-4" />
                    {isPresenceExpanded ? 'Sembunyikan Umat' : 'Lihat Umat'}
                  </Button>
                  <Button
                    variant="outline"
                    className="rounded-xl border-white/35 bg-transparent text-white hover:bg-white/10"
                    onClick={handleCheckOutNow}
                    disabled={isCheckingIn}
                  >
                    {isCheckingIn ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Menyimpan...
                      </>
                    ) : (
                      <>
                        <LogOut className="mr-2 h-4 w-4" />
                        Check-out
                      </>
                    )}
                  </Button>
                </>
              )}
            </div>
          </div>
          {!activeCheckIn && !canCheckInNow && (
            <p className="mt-2 text-xs font-medium text-amber-700">
              Data lokasi gereja belum tersedia. Coba lagi sebentar.
            </p>
          )}
          {activeCheckIn && activePresenceChurchId && isPresenceExpanded && (
            <div className="mt-4 rounded-xl border border-white/30 bg-white/95 p-3">
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
                  Belum ada user lain yang check-in aktif di {activeCheckInChurchName}.
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

      <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
        <QuickAction
          icon={<MapPinPlus className="h-4 w-4" />}
          label="Buat Radar"
          isActive={isCreateDialogOpen}
          onClick={() => {
            if (!canCreateRadar) {
              toast.error('Fitur buat radar hanya untuk Umat & Katekumen.');
              return;
            }
            setIsCreateDialogOpen(true);
          }}
        />
        <QuickAction
          icon={<Search className="h-4 w-4" />}
          label="Cari Misa"
          isActive={activeTab === 'cari'}
          onClick={() => setActiveTab('cari')}
        />
        <QuickAction
          icon={<History className="h-4 w-4" />}
          label="Riwayat"
          isActive={activeTab === 'riwayat'}
          onClick={() => setActiveTab('riwayat')}
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
                    disabled={
                      isFocusedRadarJoined ||
                      isFocusedRadarPending ||
                      joiningRadarId === focusedRadar.id ||
                      isCheckingFocusedPrivateInvite
                    }
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
                    ) : isCheckingFocusedPrivateInvite ? (
                      'Memeriksa Undangan...'
                    ) : isFocusedRadarPrivate && !focusedPendingPersonalInvite ? (
                      'Periksa Undangan'
                    ) : (
                      isFocusedRadarPrivate ? 'Terima Undangan' : 'Gabung'
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
                {focusedRadarLocationLabel && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-4 w-4" />
                    {focusedRadarLocationLabel}
                  </span>
                )}
              </div>
              {focusedRadarBlockedMessage && (
                <p className="mt-3 text-xs font-medium text-amber-700">
                  {focusedRadarBlockedMessage}
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
            <span className="inline-flex items-center gap-1.5">
              <Search className="h-3.5 w-3.5" />
              Cari
            </span>
          </TabsTrigger>
          <TabsTrigger
            value="riwayat"
            className="h-10 rounded-lg text-sm font-semibold data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
          >
            <span className="inline-flex items-center gap-1.5">
              <History className="h-3.5 w-3.5" />
              Riwayat
            </span>
          </TabsTrigger>
          <TabsTrigger
            value="ajak"
            className="h-10 rounded-lg text-sm font-semibold data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
          >
            <span className="inline-flex items-center gap-1.5">
              <MapPinPlus className="h-3.5 w-3.5" />
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
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-lg"
                  onClick={() => setIsPublicFilterDialogOpen(true)}
                >
                  <ChevronsUpDown className="mr-2 h-4 w-4" />
                  Filter Lanjutan
                </Button>
                {hasPublicAdvancedFilter && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="rounded-lg text-muted-foreground hover:text-foreground"
                    onClick={handleResetPublicAdvancedFilters}
                  >
                    Reset Filter
                  </Button>
                )}
                <p className="text-xs text-muted-foreground">
                  {publicFilterLocationLabel} • {publicFilterTimeLabel}
                </p>
              </div>
              {publicChurchId && (
                <div className="mt-3 rounded-lg border border-border/70 bg-muted/10 px-3 py-2.5">
                  <p className="text-xs font-semibold text-muted-foreground">
                    Jadwal di {publicChurchName || 'gereja terpilih'}
                  </p>
                  {isLoadingPublicChurchSchedules ? (
                    <p className="mt-1 text-xs text-muted-foreground">Memuat jadwal misa...</p>
                  ) : publicSchedulePreview.length === 0 ? (
                    <p className="mt-1 text-xs text-muted-foreground">Belum ada jadwal misa tersedia.</p>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {publicSchedulePreview.map((schedule) => (
                        <span
                          key={schedule.id}
                          className="rounded-full border border-border/70 bg-background px-2.5 py-1 text-[11px] font-medium text-foreground"
                        >
                          {formatScheduleDayShortLabel(schedule.day_of_week)} {schedule.mass_time}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                Menampilkan {filteredUpcomingEvents.length} radar.
              </p>
            </Card>

            <RadarList
              radars={filteredUpcomingEvents}
              isLoading={isLoading}
              joinedRadarSet={joinedRadarSet}
              pendingRadarSet={pendingRadarSet}
              pendingPrivateInviteSet={pendingPrivateInviteSet}
              isCheckingPrivateInvites={isLoadingIncomingInvites}
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
            pendingPrivateInviteSet={pendingPrivateInviteSet}
            isCheckingPrivateInvites={isLoadingIncomingInvites}
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
                ) : isProfileTargetSelf ? (
                  <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-700">
                    Anda tidak bisa mengirim Ajak Misa personal ke akun sendiri.
                  </div>
                ) : (
                  <>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="space-y-3">
                        <SearchableCheckInSelect
                          label="Negara"
                          value={personalCountryId}
                          selectedLabel={personalCountryName}
                          options={personalCountries}
                          placeholder={isLoadingPersonalCountries ? 'Memuat negara...' : 'Pilih negara'}
                          searchPlaceholder="Cari negara"
                          emptyMessage="Tidak ada data negara"
                          loadingMessage="Memuat negara..."
                          searchValue={personalCountrySearch}
                          onSearchChange={setPersonalCountrySearch}
                          onValueChange={(value) => {
                            setPersonalCountryId(value);
                            setPersonalDioceseId('');
                            setPersonalChurchId('');
                            setPersonalDioceseSearch('');
                            setPersonalChurchSearch('');
                          }}
                          disabled={isLoadingPersonalCountries}
                          isLoading={isLoadingPersonalCountries}
                        />

                        <SearchableCheckInSelect
                          label="Keuskupan"
                          value={personalDioceseId}
                          selectedLabel={personalDioceseName}
                          options={personalDioceses}
                          placeholder={
                            !personalCountryId
                              ? 'Pilih negara dulu'
                              : isLoadingPersonalDioceses
                                ? 'Memuat keuskupan...'
                                : 'Pilih keuskupan'
                          }
                          searchPlaceholder="Cari keuskupan"
                          emptyMessage={!personalCountryId ? 'Pilih negara dulu' : 'Tidak ada data keuskupan'}
                          loadingMessage="Memuat keuskupan..."
                          searchValue={personalDioceseSearch}
                          onSearchChange={setPersonalDioceseSearch}
                          onValueChange={(value) => {
                            setPersonalDioceseId(value);
                            setPersonalChurchId('');
                            setPersonalChurchSearch('');
                          }}
                          disabled={!personalCountryId || isLoadingPersonalDioceses}
                          isLoading={isLoadingPersonalDioceses}
                        />

                        <SearchableCheckInSelect
                          label="Gereja"
                          value={personalChurchId}
                          selectedLabel={personalChurchName}
                          options={personalChurchOptions}
                          placeholder={
                            !personalDioceseId && !isPersonalHierarchyUnavailable
                              ? 'Pilih keuskupan dulu'
                              : isLoadingPersonalParishes
                                ? 'Memuat gereja...'
                                : 'Pilih gereja'
                          }
                          searchPlaceholder="Cari gereja"
                          emptyMessage={
                            !personalDioceseId && !isPersonalHierarchyUnavailable
                              ? 'Pilih keuskupan dulu'
                              : 'Tidak ada data gereja'
                          }
                          loadingMessage="Memuat gereja..."
                          searchValue={personalChurchSearch}
                          onSearchChange={setPersonalChurchSearch}
                          onValueChange={setPersonalChurchId}
                          disabled={(!personalDioceseId && !isPersonalHierarchyUnavailable) || isLoadingPersonalParishes}
                          isLoading={isLoadingPersonalParishes}
                        />
                        {isPersonalHierarchyUnavailable && (
                          <p className="text-[11px] text-muted-foreground">
                            Data negara/keuskupan belum lengkap. Anda tetap bisa pilih gereja langsung.
                          </p>
                        )}
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Tanggal Misa
                        </label>
                        <Input
                          type="date"
                          value={personalDate}
                          onChange={(event) => setPersonalDate(event.target.value)}
                        />
                        <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                          Lokasi dipilih:{' '}
                          <span className="font-medium text-foreground">
                            {personalChurchName || personalDioceseName || personalCountryName || 'Belum dipilih'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className={cn('mt-3 space-y-3 rounded-xl border border-border/70 bg-muted/20 p-3', !personalChurchId && 'opacity-70')}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Jadwal Misa
                        </p>
                        <span className="text-[11px] text-muted-foreground">{personalDateLabel}</span>
                      </div>
                      {!personalChurchId ? (
                        <p className="text-sm text-muted-foreground">Pilih gereja dulu untuk menampilkan jadwal misa.</p>
                      ) : isLoadingPersonalSchedules ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Memuat jadwal misa...
                        </div>
                      ) : personalScheduleOptions.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          Jadwal misa untuk tanggal ini belum tersedia. Gunakan jam manual.
                        </p>
                      ) : (
                        <div className="grid gap-2 sm:grid-cols-2">
                          {personalScheduleOptions.map((schedule) => {
                            const isSelected = personalScheduleId === schedule.id;
                            return (
                              <button
                                key={schedule.id}
                                type="button"
                                onClick={() => {
                                  setPersonalScheduleId((current) => (current === schedule.id ? '' : schedule.id));
                                  setPersonalManualTime('');
                                }}
                                className={cn(
                                  'rounded-lg border px-3 py-2 text-left transition-colors',
                                  isSelected
                                    ? 'border-primary bg-primary/10 text-primary'
                                    : 'border-border/70 bg-card hover:border-primary/40'
                                )}
                              >
                                <p className="text-sm font-semibold">{schedule.mass_time}</p>
                                <p className="text-[11px] text-muted-foreground">
                                  {schedule.notes || schedule.language || 'Misa'}
                                </p>
                              </button>
                            );
                          })}
                        </div>
                      )}

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground" htmlFor="personal-manual-time">
                            Atau isi jam manual
                          </label>
                          {personalManualTime && (
                            <button
                              type="button"
                              className="text-[11px] font-semibold text-primary hover:text-primary/80"
                              onClick={() => setPersonalManualTime('')}
                            >
                              Reset
                            </button>
                          )}
                        </div>
                        <Input
                          id="personal-manual-time"
                          type="time"
                          value={personalManualTime}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            setPersonalManualTime(nextValue);
                            if (nextValue) {
                              setPersonalScheduleId('');
                            }
                          }}
                          disabled={!personalChurchId}
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
                        disabled={
                          isSubmittingPersonalInvite ||
                          !personalChurchId ||
                          !personalDate ||
                          !selectedPersonalTime
                        }
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
              {selectedInviteRadarBlockedMessage && (
                <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-700">
                  {selectedInviteRadarBlockedMessage}
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
                          targetFromProfile.id === user?.id ||
                          !selectedInviteRadar ||
                          !canInviteOnSelectedRadar ||
                          invitingTargetId === targetFromProfile.id ||
                          targetFromProfile.allow_mass_invite === false
                        }
                      >
                        {targetFromProfile.id === user?.id ? (
                          'Akun Anda'
                        ) : targetFromProfile.allow_mass_invite === false ? (
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
                          target.id === user?.id ||
                          !selectedInviteRadar ||
                          !canInviteOnSelectedRadar ||
                          invitingTargetId === target.id ||
                          target.allow_mass_invite === false
                        }
                      >
                        {target.id === user?.id ? (
                          'Akun Anda'
                        ) : target.allow_mass_invite === false ? (
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
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold">Masuk</h3>
                <span className="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                  {incomingPersonalInvites.length}
                </span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Terima atau tolak ajak misa personal dari user lain.
              </p>

              <div className="mt-4 space-y-2">
                {isLoadingIncomingInvites ? (
                  <p className="text-sm text-muted-foreground">Memuat undangan masuk...</p>
                ) : incomingPersonalInvites.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Belum ada ajak misa personal.</p>
                ) : (
                  incomingPersonalInvites.map((invite) => {
                    const inviteComment = getInviteComment(invite.message, invite.radarTitle);
                    const inviteLocation = [
                      invite.radarCountryName,
                      invite.radarDioceseName,
                      invite.radarChurchName,
                    ]
                      .map((value) => value?.trim() || '')
                      .filter(Boolean)
                      .join(' • ');
                    return (
                      <div key={invite.id} className="overflow-hidden rounded-xl border border-border/70 bg-card">
                        <div className="flex">
                          <div className="w-1 bg-primary/80" />
                          <div className="flex-1 space-y-3 px-3 py-3">
                            <div className="flex items-start gap-3">
                              <Avatar className="h-10 w-10 border border-border/70">
                                <AvatarImage src={invite.inviterAvatarUrl} alt={invite.inviterName || 'Seseorang'} />
                                <AvatarFallback>
                                  {(invite.inviterName || 'S')
                                    .split(' ')
                                    .map((part) => part[0] || '')
                                    .join('')
                                    .slice(0, 2)
                                    .toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <p className="truncate text-sm font-semibold">{invite.inviterName || 'Seseorang'}</p>
                                  <span
                                    className={cn(
                                      'rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                                      getInviteStatusBadgeClass(invite.status)
                                    )}
                                  >
                                    {formatInviteStatus(invite.status)}
                                  </span>
                                </div>
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  {invite.radarTitle || 'Undangan radar misa'}
                                </p>
                                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                                  {inviteLocation && <span>{inviteLocation}</span>}
                                  {invite.radarStartsAt && (
                                    <span className="inline-flex items-center gap-1">
                                      <Calendar className="h-3.5 w-3.5" />
                                      {formatDateTimeLabel(invite.radarStartsAt)}
                                    </span>
                                  )}
                                </div>
                                {inviteComment && (
                                  <div className="mt-2 rounded-lg border border-border/60 bg-muted/40 px-2.5 py-2 text-xs italic text-muted-foreground">
                                    "{inviteComment}"
                                  </div>
                                )}
                              </div>
                            </div>

                            {isPendingInvite(invite.status) && (
                              <div className="flex flex-wrap gap-2">
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
                                {invite.radarId && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => router.push(`/radar/${encodeURIComponent(invite.radarId || '')}`)}
                                  >
                                    Lihat Radar
                                  </Button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </Card>

            <Card className="p-6">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold">Dikirim</h3>
                <span className="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                  {outgoingPersonalInvites.length}
                </span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Pantau status ajak misa personal yang sudah Anda kirim.
              </p>

              <div className="mt-4 space-y-2">
                {isLoadingOutgoingInvites ? (
                  <p className="text-sm text-muted-foreground">Memuat undangan terkirim...</p>
                ) : outgoingPersonalInvites.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Belum ada ajak misa personal terkirim.</p>
                ) : (
                  outgoingPersonalInvites.map((invite) => {
                    const inviteComment = getInviteComment(invite.message, invite.radarTitle);
                    const inviteDate = invite.radarStartsAt || invite.createdAt;
                    const inviteLocation = [
                      invite.radarCountryName,
                      invite.radarDioceseName,
                      invite.radarChurchName,
                    ]
                      .map((value) => value?.trim() || '')
                      .filter(Boolean)
                      .join(' • ');
                    const canOpenInviteChat = isAcceptedInvite(invite.status);
                    return (
                      <div key={invite.id} className="overflow-hidden rounded-xl border border-border/70 bg-card">
                        <div className="flex">
                          <div className="w-1 bg-sky-500/80" />
                          <div className="flex-1 space-y-2 px-3 py-3">
                            <div className="flex items-start gap-3">
                              <Avatar className="h-10 w-10 border border-border/70">
                                <AvatarImage src={invite.inviteeAvatarUrl} alt={invite.inviteeName || 'User'} />
                                <AvatarFallback>
                                  {(invite.inviteeName || 'U')
                                    .split(' ')
                                    .map((part) => part[0] || '')
                                    .join('')
                                    .slice(0, 2)
                                    .toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <p className="truncate text-sm font-semibold">{invite.inviteeName || 'User'}</p>
                                  <span
                                    className={cn(
                                      'rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                                      getInviteStatusBadgeClass(invite.status)
                                    )}
                                  >
                                    {formatInviteStatus(invite.status)}
                                  </span>
                                </div>
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  {invite.radarTitle || 'Undangan radar'}
                                </p>
                                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                                  {inviteLocation && <span>{inviteLocation}</span>}
                                  {inviteDate && (
                                    <span className="inline-flex items-center gap-1">
                                      <Calendar className="h-3.5 w-3.5" />
                                      {formatDateTimeLabel(inviteDate)}
                                    </span>
                                  )}
                                </div>
                                {inviteComment && (
                                  <div className="mt-2 rounded-lg border border-border/60 bg-muted/40 px-2.5 py-2 text-xs italic text-muted-foreground">
                                    "{inviteComment}"
                                  </div>
                                )}
                              </div>
                            </div>
                            {(canOpenInviteChat || invite.radarId) && (
                              <div className="flex justify-end gap-2">
                                {canOpenInviteChat && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleOpenInviteChat(invite)}
                                    disabled={openingInviteChatId === invite.id}
                                  >
                                    {openingInviteChatId === invite.id ? (
                                      <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Membuka...
                                      </>
                                    ) : (
                                      'Buka Chat'
                                    )}
                                  </Button>
                                )}
                                {invite.radarId && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => router.push(`/radar/${encodeURIComponent(invite.radarId || '')}`)}
                                  >
                                    Lihat Radar
                                  </Button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog
        open={isPublicFilterDialogOpen}
        onOpenChange={(open) => {
          setIsPublicFilterDialogOpen(open);
          if (!open) {
            setPublicCountrySearch('');
            setPublicDioceseSearch('');
            setPublicChurchSearch('');
          }
        }}
      >
        <DialogContent className="w-[95vw] max-w-xl gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b border-border/70 px-4 py-3 sm:px-5 sm:py-4">
            <DialogTitle>Filter Misa Publik</DialogTitle>
            <DialogDescription>
              Sesuaikan lokasi dan jam misa untuk menemukan radar yang paling relevan.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[70vh] overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Jam Misa
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    id="public-mass-time"
                    type="time"
                    value={publicMassTime}
                    onChange={(event) => setPublicMassTime(event.target.value)}
                  />
                  {publicMassTime && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="shrink-0"
                      onClick={() => setPublicMassTime('')}
                    >
                      Reset
                    </Button>
                  )}
                </div>
              </div>

              <div className="space-y-3 rounded-xl border border-border/70 bg-muted/20 p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Lokasi
                </p>

                <SearchableCheckInSelect
                  label="Negara"
                  value={publicCountryId}
                  selectedLabel={publicCountryName}
                  options={publicCountries}
                  placeholder={isLoadingPublicCountries ? 'Memuat negara...' : 'Pilih negara'}
                  searchPlaceholder="Cari negara"
                  emptyMessage="Tidak ada data negara"
                  loadingMessage="Memuat negara..."
                  searchValue={publicCountrySearch}
                  onSearchChange={setPublicCountrySearch}
                  onValueChange={(value) => {
                    setPublicCountryId(value);
                    setPublicDioceseId('');
                    setPublicChurchId('');
                    setPublicDioceseSearch('');
                    setPublicChurchSearch('');
                  }}
                  disabled={isLoadingPublicCountries}
                  isLoading={isLoadingPublicCountries}
                />

                <SearchableCheckInSelect
                  label="Keuskupan"
                  value={publicDioceseId}
                  selectedLabel={publicDioceseName}
                  options={publicDioceses}
                  placeholder={
                    !publicCountryId
                      ? 'Pilih negara dulu'
                      : isLoadingPublicDioceses
                        ? 'Memuat keuskupan...'
                        : 'Pilih keuskupan'
                  }
                  searchPlaceholder="Cari keuskupan"
                  emptyMessage={!publicCountryId ? 'Pilih negara dulu' : 'Tidak ada data keuskupan'}
                  loadingMessage="Memuat keuskupan..."
                  searchValue={publicDioceseSearch}
                  onSearchChange={setPublicDioceseSearch}
                  onValueChange={(value) => {
                    setPublicDioceseId(value);
                    setPublicChurchId('');
                    setPublicChurchSearch('');
                  }}
                  disabled={!publicCountryId || isLoadingPublicDioceses}
                  isLoading={isLoadingPublicDioceses}
                />

                <SearchableCheckInSelect
                  label="Gereja"
                  value={publicChurchId}
                  selectedLabel={publicChurchName}
                  options={publicChurchOptions}
                  placeholder={
                    !publicDioceseId
                      ? 'Pilih keuskupan dulu'
                      : isLoadingPublicParishes
                        ? 'Memuat gereja...'
                        : 'Pilih gereja'
                  }
                  searchPlaceholder="Cari gereja"
                  emptyMessage={!publicDioceseId ? 'Pilih keuskupan dulu' : 'Tidak ada data gereja'}
                  loadingMessage="Memuat gereja..."
                  searchValue={publicChurchSearch}
                  onSearchChange={setPublicChurchSearch}
                  onValueChange={setPublicChurchId}
                  disabled={!publicDioceseId || isLoadingPublicParishes}
                  isLoading={isLoadingPublicParishes}
                />
              </div>
            </div>
          </div>

          <div className="border-t border-border/70 px-4 py-3 sm:px-5">
            <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
              Lokasi: <span className="font-medium text-foreground">{publicFilterLocationLabel}</span> • Jam:{' '}
              <span className="font-medium text-foreground">{publicFilterTimeLabel}</span>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={handleResetPublicAdvancedFilters}>
                Reset
              </Button>
              <Button type="button" onClick={() => setIsPublicFilterDialogOpen(false)}>
                Terapkan
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isCheckInDialogOpen}
        onOpenChange={(open) => {
          setIsCheckInDialogOpen(open);
          if (!open) {
            setCheckInCountrySearch('');
            setCheckInDioceseSearch('');
            setCheckInChurchSearch('');
            setCheckInScheduleId('');
            setCheckInManualTime('');
          }
        }}
      >
        <DialogContent className="w-[95vw] max-w-2xl gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b border-border/70 px-4 py-3 sm:px-5 sm:py-4">
            <DialogTitle>Check-in Misa</DialogTitle>
            <DialogDescription>
              Pilih lokasi gereja, tentukan jadwal atau jam manual, lalu simpan check-in.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[72vh] overflow-y-auto px-4 py-4 sm:max-h-[74vh] sm:px-5 sm:py-5">
            <div className="space-y-5">
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  1. Lokasi Gereja
                </p>
                <SearchableCheckInSelect
                  label="Negara"
                  value={checkInCountryId}
                  selectedLabel={checkInCountryName}
                  options={checkInCountries}
                  placeholder={isLoadingCheckInCountries ? 'Memuat negara...' : 'Pilih negara'}
                  searchPlaceholder="Cari negara"
                  emptyMessage="Tidak ada data negara"
                  loadingMessage="Memuat negara..."
                  searchValue={checkInCountrySearch}
                  onSearchChange={setCheckInCountrySearch}
                  onValueChange={(value) => {
                    setCheckInCountryId(value);
                    setCheckInDioceseId('');
                    setCheckInChurchId('');
                    setCheckInDioceseSearch('');
                    setCheckInChurchSearch('');
                  }}
                  disabled={isLoadingCheckInCountries}
                  isLoading={isLoadingCheckInCountries}
                />

                <SearchableCheckInSelect
                  label="Keuskupan"
                  value={checkInDioceseId}
                  selectedLabel={checkInDioceseName}
                  options={checkInDioceses}
                  placeholder={
                    !checkInCountryId
                      ? 'Pilih negara dulu'
                      : isLoadingCheckInDioceses
                        ? 'Memuat keuskupan...'
                        : 'Pilih keuskupan'
                  }
                  searchPlaceholder="Cari keuskupan"
                  emptyMessage={!checkInCountryId ? 'Pilih negara dulu' : 'Tidak ada data keuskupan'}
                  loadingMessage="Memuat keuskupan..."
                  searchValue={checkInDioceseSearch}
                  onSearchChange={setCheckInDioceseSearch}
                  onValueChange={(value) => {
                    setCheckInDioceseId(value);
                    setCheckInChurchId('');
                    setCheckInChurchSearch('');
                  }}
                  disabled={!checkInCountryId || isLoadingCheckInDioceses}
                  isLoading={isLoadingCheckInDioceses}
                />

                <SearchableCheckInSelect
                  label="Gereja"
                  value={checkInChurchId}
                  selectedLabel={checkInChurchName === 'Gereja' ? '' : checkInChurchName}
                  options={checkInChurchOptions}
                  placeholder={
                    !checkInDioceseId
                      ? 'Pilih keuskupan dulu'
                      : isLoadingCheckInParishes
                        ? 'Memuat gereja...'
                        : 'Pilih gereja'
                  }
                  searchPlaceholder="Cari gereja"
                  emptyMessage={!checkInDioceseId ? 'Pilih keuskupan dulu' : 'Tidak ada data gereja'}
                  loadingMessage="Memuat gereja..."
                  searchValue={checkInChurchSearch}
                  onSearchChange={setCheckInChurchSearch}
                  onValueChange={setCheckInChurchId}
                  disabled={!checkInDioceseId || isLoadingCheckInParishes}
                  isLoading={isLoadingCheckInParishes}
                />

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
              </div>

              <div className={cn('space-y-3 rounded-xl border border-border/70 bg-muted/20 p-3', !checkInChurchId && 'opacity-70')}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    2. Jadwal Misa
                  </p>
                  <span className="text-[11px] text-muted-foreground">{checkInDateLabel}</span>
                </div>
                {checkInChurchId && (
                  <p className="text-xs text-muted-foreground">
                    Pilih jadwal di <span className="font-medium text-foreground">{checkInChurchName}</span>.
                  </p>
                )}

                {!checkInChurchId ? (
                  <p className="text-xs text-muted-foreground">Pilih gereja terlebih dahulu.</p>
                ) : isLoadingCheckInSchedules ? (
                  <p className="text-xs text-muted-foreground">Memuat jadwal misa...</p>
                ) : scheduleOptionsForDate.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Jadwal misa belum tersedia untuk tanggal ini. Gunakan jam manual.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {scheduleOptionsForDate.map((schedule) => {
                      const isSelected = checkInScheduleId === schedule.id;
                      return (
                        <button
                          key={schedule.id}
                          type="button"
                          onClick={() => {
                            setCheckInScheduleId((current) => (current === schedule.id ? '' : schedule.id));
                            setCheckInManualTime('');
                          }}
                          className={cn(
                            'rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                            isSelected
                              ? 'border-primary/40 bg-primary text-primary-foreground'
                              : 'border-border/80 bg-background hover:border-primary/35'
                          )}
                        >
                          {schedule.mass_time}
                        </button>
                      );
                    })}
                  </div>
                )}

                <div className="space-y-1.5 rounded-lg border border-border/70 bg-background/80 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs font-semibold text-muted-foreground" htmlFor="checkin-manual-time">
                      Jam Manual
                    </label>
                    {checkInManualTime && (
                      <button
                        type="button"
                        className="text-[11px] font-semibold text-primary hover:underline"
                        onClick={() => setCheckInManualTime('')}
                      >
                        Reset
                      </button>
                    )}
                  </div>
                  <Input
                    id="checkin-manual-time"
                    type="time"
                    value={checkInManualTime}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setCheckInManualTime(nextValue);
                      if (nextValue) {
                        setCheckInScheduleId('');
                      }
                    }}
                    disabled={!checkInChurchId}
                  />
                </div>
              </div>

              <div className="space-y-3 rounded-xl border border-border/70 bg-muted/10 p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  3. Siapa yang Bisa Lihat
                </p>
                <div className="grid gap-2 sm:grid-cols-3">
                  {[
                    {
                      value: 'followers' as const,
                      label: 'Pengikut',
                      description: 'Hanya pengikut bisa lihat',
                    },
                    {
                      value: 'public' as const,
                      label: 'Publik Gereja',
                      description: 'Umat di gereja yang sama',
                    },
                    {
                      value: 'private' as const,
                      label: 'Hanya Saya',
                      description: 'Tidak terlihat user lain',
                    },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setCheckInVisibilityScope(option.value)}
                      className={cn(
                        'rounded-lg border px-2.5 py-2 text-left transition-colors',
                        checkInVisibilityScope === option.value
                          ? 'border-primary/40 bg-primary/10 text-primary'
                          : 'border-border/70 bg-background text-foreground hover:border-primary/30'
                      )}
                    >
                      <p className="text-xs font-semibold">{option.label}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{option.description}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2 rounded-xl border border-border/70 bg-muted/10 p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  4. Notifikasi
                </p>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={canNotifyFollowers ? checkInNotifyFollowers : false}
                    onChange={(event) => setCheckInNotifyFollowers(event.target.checked)}
                    disabled={!canNotifyFollowers}
                    className="mt-0.5 h-4 w-4 rounded border-input accent-primary disabled:opacity-50"
                  />
                  <span>Beritahu pengikut</span>
                </label>
                {canNotifyChurch && (
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={checkInNotifyChurch}
                      onChange={(event) => setCheckInNotifyChurch(event.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
                    />
                    <span>Beritahu umat gereja</span>
                  </label>
                )}
              </div>
            </div>
          </div>

          <div className="border-t border-border/70 px-4 py-3 sm:px-5">
            <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
              Check-in akan dicatat untuk <span className="font-medium text-foreground">{checkInChurchName}</span>.
              {selectedCheckInTime
                ? ` Jadwal/Jam: ${selectedCheckInTime}.`
                : ' Pilih jadwal misa atau isi jam manual terlebih dahulu.'}
            </div>

            <div className="mt-3 flex justify-end gap-2">
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
                disabled={isCheckingIn || !checkInChurchId || !selectedCheckInTime}
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
            <div className="space-y-3 rounded-xl border border-border/70 bg-muted/10 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                1. Detail Ajakan
              </p>
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

              <div className="space-y-2 rounded-lg border border-border/70 bg-background/80 p-2.5">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Lokasi Misa
                </p>
                <div className="grid gap-2 sm:grid-cols-3">
                  <SearchableCheckInSelect
                    label="Negara"
                    value={createCountryId}
                    selectedLabel={createCountryName}
                    options={createCountries}
                    placeholder={isLoadingCreateCountries ? 'Memuat negara...' : 'Pilih negara'}
                    searchPlaceholder="Cari negara"
                    emptyMessage="Tidak ada data negara"
                    loadingMessage="Memuat negara..."
                    searchValue={createCountrySearch}
                    onSearchChange={setCreateCountrySearch}
                    onValueChange={(value) => {
                      setCreateCountryId(value);
                      setCreateDioceseId('');
                      setCreateChurchId('');
                      setCreateDioceseSearch('');
                      setCreateChurchSearch('');
                    }}
                    isLoading={isLoadingCreateCountries}
                  />

                  <SearchableCheckInSelect
                    label="Keuskupan"
                    value={createDioceseId}
                    selectedLabel={createDioceseName}
                    options={createDioceses}
                    placeholder={
                      !createCountryId
                        ? 'Pilih negara dulu'
                        : isLoadingCreateDioceses
                          ? 'Memuat keuskupan...'
                          : 'Pilih keuskupan'
                    }
                    searchPlaceholder="Cari keuskupan"
                    emptyMessage={!createCountryId ? 'Pilih negara dulu' : 'Tidak ada data keuskupan'}
                    loadingMessage="Memuat keuskupan..."
                    searchValue={createDioceseSearch}
                    onSearchChange={setCreateDioceseSearch}
                    onValueChange={(value) => {
                      setCreateDioceseId(value);
                      setCreateChurchId('');
                      setCreateChurchSearch('');
                    }}
                    disabled={!createCountryId || isLoadingCreateDioceses}
                    isLoading={isLoadingCreateDioceses}
                  />

                  <SearchableCheckInSelect
                    label="Gereja"
                    value={createChurchId}
                    selectedLabel={createChurchName}
                    options={createChurchOptions}
                    placeholder={
                      !createDioceseId && !isCreateHierarchyUnavailable
                        ? 'Pilih keuskupan dulu'
                        : isLoadingCreateParishes
                          ? 'Memuat gereja...'
                          : 'Pilih gereja'
                    }
                    searchPlaceholder="Cari gereja"
                    emptyMessage={
                      !createDioceseId && !isCreateHierarchyUnavailable
                        ? 'Pilih keuskupan dulu'
                        : 'Tidak ada data gereja'
                    }
                    loadingMessage="Memuat gereja..."
                    searchValue={createChurchSearch}
                    onSearchChange={setCreateChurchSearch}
                    onValueChange={setCreateChurchId}
                    disabled={(!createDioceseId && !isCreateHierarchyUnavailable) || isLoadingCreateParishes}
                    isLoading={isLoadingCreateParishes}
                  />
                  {isCreateHierarchyUnavailable && (
                    <p className="text-[11px] text-muted-foreground">
                      Data negara/keuskupan belum lengkap. Anda tetap bisa pilih gereja langsung.
                    </p>
                  )}
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
            </div>

            <div className={cn('space-y-3 rounded-xl border border-border/70 bg-muted/20 p-3', !createChurchId && 'opacity-70')}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  2. Jadwal Misa
                </p>
                <span className="text-[11px] text-muted-foreground">{createDateLabel}</span>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="create-radar-date">
                  Tanggal Misa
                </label>
                <Input
                  id="create-radar-date"
                  type="date"
                  min={toLocalDateValue(new Date())}
                  value={createDate}
                  onChange={(event) => setCreateDate(event.target.value)}
                />
              </div>

              {!createChurchId ? (
                <p className="text-xs text-muted-foreground">Pilih gereja terlebih dahulu.</p>
              ) : isLoadingCreateSchedules ? (
                <p className="text-xs text-muted-foreground">Memuat jadwal misa...</p>
              ) : createScheduleOptions.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Belum ada jadwal misa pada tanggal ini. Gunakan jam manual.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {createScheduleOptions.map((schedule) => {
                    const isSelected = createScheduleId === schedule.id;
                    return (
                      <button
                        key={schedule.id}
                        type="button"
                        onClick={() => {
                          setCreateScheduleId((current) => (current === schedule.id ? '' : schedule.id));
                          setCreateManualTime('');
                        }}
                        className={cn(
                          'rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                          isSelected
                            ? 'border-primary/40 bg-primary text-primary-foreground'
                            : 'border-border/80 bg-background hover:border-primary/35'
                        )}
                      >
                        {schedule.mass_time}
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="space-y-1.5 rounded-lg border border-border/70 bg-background/80 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-semibold text-muted-foreground" htmlFor="create-radar-manual-time">
                    Jam Manual
                  </label>
                  {createManualTime && (
                    <button
                      type="button"
                      className="text-[11px] font-semibold text-primary hover:underline"
                      onClick={() => setCreateManualTime('')}
                    >
                      Reset
                    </button>
                  )}
                </div>
                <Input
                  id="create-radar-manual-time"
                  type="time"
                  value={createManualTime}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setCreateManualTime(nextValue);
                    if (nextValue) {
                      setCreateScheduleId('');
                    }
                  }}
                  disabled={!createChurchId}
                />
              </div>

              {selectedCreateTime && (
                <p className="text-xs font-medium text-muted-foreground">
                  Waktu terpilih: {createDateLabel} • {selectedCreateTime}
                </p>
              )}
            </div>

            <div className="space-y-3 rounded-xl border border-border/70 bg-muted/10 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                3. Pengaturan Acara
              </p>

              <div className="space-y-2 rounded-lg border border-border/70 bg-background/80 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">Kuota Peserta</p>
                  <span className="text-sm font-semibold text-primary">{createMaxParticipants} orang</span>
                </div>
                <Slider
                  value={[createMaxParticipants]}
                  min={2}
                  max={100}
                  step={1}
                  onValueChange={(value) => {
                    if (value.length > 0) {
                      setCreateMaxParticipants(value[0]);
                    }
                  }}
                />
              </div>

              <div className="space-y-3 rounded-lg border border-border/70 bg-background/80 p-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">Izinkan Peserta Mengundang Teman</p>
                    <p className="text-xs text-muted-foreground">
                      Jika aktif, peserta lain bisa mengajak teman mereka.
                    </p>
                  </div>
                  <Switch
                    checked={createAllowMemberInvite}
                    onCheckedChange={setCreateAllowMemberInvite}
                    disabled={isSubmittingCreate}
                  />
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">Butuh Persetujuan Host</p>
                    <p className="text-xs text-muted-foreground">
                      Jika aktif, peserta baru harus Anda setujui dulu.
                    </p>
                  </div>
                  <Switch
                    checked={createRequireHostApproval}
                    onCheckedChange={setCreateRequireHostApproval}
                    disabled={isSubmittingCreate}
                  />
                </div>
              </div>
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
  description?: string;
  onClick?: () => void;
  isActive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
    >
      <div
        className={cn(
          'rounded-xl border px-3 py-2.5 text-center transition-all hover:-translate-y-0.5',
          isActive
            ? 'border-primary/40 bg-primary text-primary-foreground shadow-sm'
            : 'border-border/70 bg-card hover:border-primary/30'
        )}
      >
        <div
          className={cn(
            'mx-auto mb-1.5 inline-flex h-8 w-8 items-center justify-center rounded-full',
            isActive ? 'bg-white/20 text-current' : 'bg-primary/10 text-primary'
          )}
        >
          {icon}
        </div>
        <p className="text-xs font-semibold">{label}</p>
        {description ? (
          <p className={cn('mt-0.5 text-[11px]', isActive ? 'text-primary-foreground/85' : 'text-muted-foreground')}>
            {description}
          </p>
        ) : null}
      </div>
    </button>
  );
}

function RadarList({
  radars,
  isLoading,
  joinedRadarSet,
  pendingRadarSet,
  pendingPrivateInviteSet,
  isCheckingPrivateInvites = false,
  joiningRadarId,
  onJoin,
  onOpenDetail,
  showJoinAction = true,
}: {
  radars: RadarCardItem[];
  isLoading: boolean;
  joinedRadarSet: Set<string>;
  pendingRadarSet?: Set<string>;
  pendingPrivateInviteSet?: Set<string>;
  isCheckingPrivateInvites?: boolean;
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
        const isPrivateRadar = normalizeRadarVisibility(radar.visibility) === 'PRIVATE';
        const radarLocationLabel = formatRadarLocationLabel(radar);
        const hasPrivateInvite = pendingPrivateInviteSet?.has(radar.id) ?? false;
        const isCheckingPrivateInvite =
          isPrivateRadar &&
          !hasPrivateInvite &&
          !isJoined &&
          !isPending &&
          isCheckingPrivateInvites;
        const disableJoin =
          isJoined ||
          isPending ||
          isJoining ||
          isCheckingPrivateInvite;

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
                      disabled={disableJoin}
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
                      ) : isCheckingPrivateInvite ? (
                        'Memeriksa Undangan...'
                      ) : isPrivateRadar && !hasPrivateInvite ? (
                        'Periksa Undangan'
                      ) : (
                        isPrivateRadar ? 'Terima Undangan' : 'Gabung'
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
                {radarLocationLabel && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-4 w-4" />
                    {radarLocationLabel}
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
