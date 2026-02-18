// Schedule Service

import { supabase } from '@/lib/supabase/client';
import type { Church, MassSchedule } from '@/lib/types';
import { createRandomUUID } from '@/lib/utils';

function normalizeDayOfWeek(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (Number.isNaN(parsed)) return 0;
  if (parsed === 7) return 0;
  if (parsed < 0 || parsed > 6) return 0;
  return parsed;
}

function normalizeTime(value: unknown): string {
  const raw = value?.toString().trim() ?? '';
  if (!raw) return '00:00';

  if (raw.includes('T')) {
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) {
      const hh = date.getHours().toString().padStart(2, '0');
      const mm = date.getMinutes().toString().padStart(2, '0');
      return `${hh}:${mm}`;
    }
  }

  const match = raw.match(/(\d{1,2}):(\d{2})/);
  if (!match) return '00:00';

  const hour = Number(match[1]).toString().padStart(2, '0');
  const minute = Number(match[2]).toString().padStart(2, '0');
  return `${hour}:${minute}`;
}

function timeToMinutes(value: string): number {
  const [hours = '0', minutes = '0'] = value.split(':');
  return Number(hours) * 60 + Number(minutes);
}

function isCompatibilityError(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes('relationship') ||
    lower.includes('could not find') ||
    lower.includes('does not exist') ||
    lower.includes('42703') ||
    lower.includes('pgrst200') ||
    lower.includes('pgrst205')
  );
}

function mapChurchRow(row: Record<string, unknown>): Church {
  return {
    id: row.id?.toString() ?? createRandomUUID(),
    diocese_id: row.diocese_id?.toString() ?? '',
    name: row.name?.toString() || row.parish?.toString() || 'Gereja',
    address: row.address?.toString(),
    latitude: typeof row.latitude === 'number' ? row.latitude : undefined,
    longitude: typeof row.longitude === 'number' ? row.longitude : undefined,
    phone: row.phone?.toString(),
    website: row.website?.toString(),
    image_url: row.image_url?.toString(),
    created_at: row.created_at?.toString() ?? new Date().toISOString(),
  };
}

function mapMassScheduleRow(row: Record<string, unknown>): MassSchedule {
  return {
    id: row.id?.toString() ?? createRandomUUID(),
    church_id: row.church_id?.toString() ?? '',
    day_of_week: normalizeDayOfWeek(row.day_of_week ?? row.day_number),
    mass_time: normalizeTime(row.mass_time ?? row.start_time ?? row.time_start),
    language: row.language?.toString() || 'Indonesia',
    notes:
      row.notes?.toString() ||
      row.title?.toString() ||
      row.name?.toString() ||
      row.mass_name?.toString(),
    is_active: row.is_active !== false,
    created_at: row.created_at?.toString() ?? new Date().toISOString(),
  };
}

export class ScheduleService {
  static async getChurches(limit = 200): Promise<Church[]> {
    const { data, error } = await supabase
      .from('churches')
      .select('id, diocese_id, name, address, latitude, longitude, image_url, created_at')
      .order('name', { ascending: true })
      .limit(limit);

    if (error) {
      console.error('Error fetching churches:', error);
      return [];
    }

    return ((data ?? []) as Record<string, unknown>[]).map(mapChurchRow);
  }

  static async getMassSchedules(params?: {
    churchId?: string;
    dayOfWeek?: number;
  }): Promise<MassSchedule[]> {
    const churchId = params?.churchId?.trim();
    const dayFilter = typeof params?.dayOfWeek === 'number' ? normalizeDayOfWeek(params.dayOfWeek) : undefined;

    let primaryQuery = supabase
      .from('mass_schedules')
      .select('*, churches(id, name)')
      .limit(500);

    if (churchId) {
      primaryQuery = primaryQuery.eq('church_id', churchId);
    }

    const primary = await primaryQuery;
    let rows = primary.data as Record<string, unknown>[] | null;
    let error = primary.error;

    if (error && isCompatibilityError(error.message)) {
      let fallbackQuery = supabase.from('mass_schedules').select('*').limit(500);
      if (churchId) {
        fallbackQuery = fallbackQuery.eq('church_id', churchId);
      }

      const fallback = await fallbackQuery;
      rows = fallback.data as Record<string, unknown>[] | null;
      error = fallback.error;
    }

    if (error) {
      console.error('Error fetching mass schedules:', error);
      return [];
    }

    let schedules = ((rows ?? []) as Record<string, unknown>[])
      .map(mapMassScheduleRow)
      .filter((item) => !churchId || item.church_id === churchId);

    if (typeof dayFilter === 'number') {
      schedules = schedules.filter((item) => normalizeDayOfWeek(item.day_of_week) === dayFilter);
    }

    schedules.sort((a, b) => {
      const dayCompare = normalizeDayOfWeek(a.day_of_week) - normalizeDayOfWeek(b.day_of_week);
      if (dayCompare !== 0) return dayCompare;
      return timeToMinutes(a.mass_time) - timeToMinutes(b.mass_time);
    });

    return schedules;
  }
}
