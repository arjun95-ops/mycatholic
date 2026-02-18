// Auth Service

import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import {
  isSupabaseConfigured,
  supabase,
  supabaseConfigError,
} from '@/lib/supabase/client';
import type { Profile, User } from '@/lib/types';

type ProfileUpsertPayload = Record<string, unknown>;
type ProfileSyncResult = {
  success: boolean;
  reason?: string;
  details?: string;
};

export type RegisterRole = 'umat' | 'pastor' | 'suster' | 'bruder' | 'frater';
export type RegisterGender = 'male' | 'female';
export type RegisterMaritalStatus = 'single' | 'widowed';
export type RegisterFaithStatus = 'baptized' | 'catechumen';

export interface RegisterPayload {
  email: string;
  password: string;
  fullName: string;
  baptismName?: string;
  birthDate: string;
  gender: RegisterGender;
  maritalStatus: RegisterMaritalStatus;
  ethnicity?: string;
  countryId?: string;
  dioceseId?: string;
  parishId?: string;
  countryName?: string;
  dioceseName?: string;
  parishName?: string;
  role: RegisterRole;
  faithStatus: RegisterFaithStatus;
  agreeTerms: boolean;
  agreeFaithVerification: boolean;
}

export interface AuthLocationOption {
  id: string;
  name: string;
}

const PROFILE_REQUIRED_COLUMNS = [
  'id',
  'email',
  'full_name',
  'birth_date',
  'gender',
  'marital_status',
  'country_id',
  'diocese_id',
  'church_id',
  'role',
  'faith_status',
  'is_catechumen',
  'verification_status',
  'account_status',
  'profile_filled',
] as const;

const OPTIONAL_PROFILE_COLUMNS = [
  'baptism_name',
  'ethnicity',
  'country',
  'diocese',
  'parish',
  'account_status',
  'faith_status',
  'terms_accepted_at',
  'faith_verification_consent_at',
] as const;

const LOCATION_FETCH_LIMIT = 120;

function compactPayload<T extends Record<string, unknown>>(payload: T): T {
  const entries = Object.entries(payload).filter(([, value]) => {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string' && value.trim().length === 0) return false;
    return true;
  });

  return Object.fromEntries(entries) as T;
}

function normalizeText(value: unknown): string {
  return value?.toString().trim().toLowerCase() ?? '';
}

function normalizeDate(value: unknown): string {
  const raw = value?.toString().trim() ?? '';
  if (!raw) return '';
  return raw.split('T')[0] ?? raw;
}

function normalizeBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const raw = value?.toString().trim().toLowerCase() ?? '';
  return raw === 'true' || raw === '1';
}

function isMissingColumnError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('does not exist') || lower.includes('42703');
}

function isSchemaCacheMissingColumnError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('schema cache') &&
    lower.includes('could not find') &&
    lower.includes('column')
  );
}

function extractMissingColumnName(message: string): string | null {
  const doubleQuotedColumn = message.match(/column\s+"([^"]+)"/i);
  if (doubleQuotedColumn?.[1]) return doubleQuotedColumn[1];

  const singleQuotedColumn = message.match(/column\s+'([^']+)'/i);
  if (singleQuotedColumn?.[1]) return singleQuotedColumn[1];

  const columnBeforeKeywordSingle = message.match(/'([^']+)'\s+column/i);
  if (columnBeforeKeywordSingle?.[1]) return columnBeforeKeywordSingle[1];

  const columnBeforeKeywordDouble = message.match(/"([^"]+)"\s+column/i);
  if (columnBeforeKeywordDouble?.[1]) return columnBeforeKeywordDouble[1];

  return null;
}

function normalizeSupabaseError(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return typeof error === 'string' ? error : 'Unknown error';
  }

  const candidate = error as Record<string, unknown>;
  const code = candidate.code?.toString() ?? '';
  const message = candidate.message?.toString() ?? '';
  const details = candidate.details?.toString() ?? '';
  return [code, message, details].filter(Boolean).join(' | ') || 'Unknown error';
}

function requireSupabaseConfiguration() {
  if (!isSupabaseConfigured) {
    throw new Error(
      supabaseConfigError ??
        'Supabase belum dikonfigurasi. Isi NEXT_PUBLIC_SUPABASE_URL dan NEXT_PUBLIC_SUPABASE_ANON_KEY.'
    );
  }
}

export class AuthService {
  // Sign in with email and password
  static async signIn(email: string, password: string) {
    requireSupabaseConfiguration();

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      throw new Error(error.message);
    }

    return data;
  }

  // Sign up new user and sync profile row for mobile/admin compatibility
  static async signUp(payload: RegisterPayload) {
    requireSupabaseConfiguration();

    if (!payload.agreeTerms) {
      throw new Error('Anda harus menyetujui syarat dan ketentuan.');
    }
    if (!payload.agreeFaithVerification) {
      throw new Error('Anda harus menyetujui persetujuan verifikasi data iman.');
    }

    const normalizedCountryId = payload.countryId?.trim();
    const normalizedDioceseId = payload.dioceseId?.trim();
    const normalizedParishId = payload.parishId?.trim();
    if (!normalizedCountryId || !normalizedDioceseId || !normalizedParishId) {
      throw new Error('Negara, keuskupan, dan paroki wajib dipilih dari daftar.');
    }

    const normalizedBirthDate = payload.birthDate.trim();
    if (!normalizedBirthDate) {
      throw new Error('Tanggal lahir wajib diisi.');
    }

    const parsedBirthDate = new Date(`${normalizedBirthDate}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (Number.isNaN(parsedBirthDate.getTime())) {
      throw new Error('Format tanggal lahir tidak valid.');
    }
    if (parsedBirthDate > today) {
      throw new Error('Tanggal lahir tidak boleh lebih dari hari ini.');
    }

    const now = new Date().toISOString();
    const normalizedEmail = payload.email.trim().toLowerCase();
    const isCatechumen = payload.faithStatus === 'catechumen';
    const userMetadata = compactPayload({
      full_name: payload.fullName.trim(),
      baptism_name: payload.baptismName?.trim(),
      role: payload.role,
      faith_status: payload.faithStatus,
      is_catechumen: isCatechumen,
      marital_status: payload.maritalStatus,
      gender: payload.gender,
      profile_filled: true,
      verification_status: 'unverified',
      account_status: 'unverified',
      terms_accepted_at: now,
      faith_verification_consent_at: now,
      birth_date: normalizedBirthDate,
      ethnicity: payload.ethnicity?.trim(),
      suku: payload.ethnicity?.trim(),
      jenis_kelamin: payload.gender,
      country_id: normalizedCountryId,
      diocese_id: normalizedDioceseId,
      church_id: normalizedParishId,
      country: payload.countryName?.trim(),
      country_name: payload.countryName?.trim(),
      diocese: payload.dioceseName?.trim(),
      diocese_name: payload.dioceseName?.trim(),
      parish: payload.parishName?.trim(),
      parish_name: payload.parishName?.trim(),
    });

    const options: {
      data: Record<string, unknown>;
      emailRedirectTo?: string;
    } = { data: userMetadata };

    if (typeof window !== 'undefined') {
      options.emailRedirectTo = `${window.location.origin}/verify-email`;
    }

    const { data, error } = await supabase.auth.signUp({
      email: normalizedEmail,
      password: payload.password,
      options,
    });

    if (error) {
      throw new Error(error.message);
    }

    if (data.user) {
      const syncResult = await this.syncProfileRowWithRetry({
        userId: data.user.id,
        email: normalizedEmail,
        metadata: userMetadata,
      });
      if (!syncResult.success) {
        console.error(
          'Register profile sync failed:',
          syncResult.reason ?? 'unknown',
          syncResult.details ?? ''
        );
        throw new Error(
          'Akun mungkin sudah dibuat, tetapi sinkronisasi data profil gagal. Silakan login setelah verifikasi email atau hubungi admin.'
        );
      }
    }

    return data;
  }

  // Sign out
  static async signOut() {
    requireSupabaseConfiguration();

    const { error } = await supabase.auth.signOut();

    if (error) {
      throw new Error(error.message);
    }
  }

  // Get current user
  static async getCurrentUser(): Promise<User | null> {
    if (!isSupabaseConfigured) {
      return null;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user;
  }

  // Get current session
  static async getCurrentSession() {
    if (!isSupabaseConfigured) {
      return null;
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session;
  }

  // Resolve account status across legacy/new columns
  static resolveAccountStatus(profile: Profile | null): string {
    const rawStatus = profile?.account_status ?? profile?.verification_status ?? 'unverified';
    return rawStatus.toString().toLowerCase();
  }

  static ensureUserIsAllowed(user: User | null, profile: Profile | null) {
    if (!user) {
      return { allowed: false, reason: 'Anda belum login' };
    }

    if (!user.email_confirmed_at) {
      return { allowed: false, reason: 'Email belum diverifikasi. Cek inbox email Anda.' };
    }

    if (!profile) {
      return { allowed: false, reason: 'Profil tidak ditemukan. Hubungi admin.' };
    }

    const accountStatus = this.resolveAccountStatus(profile);
    if (accountStatus === 'banned' || accountStatus === 'rejected') {
      return { allowed: false, reason: 'Akun Anda dinonaktifkan atau ditolak oleh admin.' };
    }

    return { allowed: true, reason: null as string | null };
  }

  // Get user profile
  static async getProfile(userId: string): Promise<Profile | null> {
    const selectWithRelations = `
      *,
      country:countries(id, name, code),
      diocese:dioceses(id, name),
      church:churches(id, name)
    `;

    const withRelations = await supabase
      .from('profiles')
      .select(selectWithRelations)
      .eq('id', userId)
      .maybeSingle();

    if (!withRelations.error) {
      return withRelations.data as Profile | null;
    }

    const fallback = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (fallback.error) {
      console.error('Error fetching profile:', fallback.error);
      return null;
    }

    return fallback.data as Profile | null;
  }

  static async getOrCreateProfile(user: User): Promise<Profile | null> {
    const existing = await this.getProfile(user.id);
    if (existing) return existing;

    const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
    const isCatechumenMeta = normalizeBool(metadata.is_catechumen);
    const faithStatus =
      normalizeText(metadata.faith_status) === 'catechumen' || isCatechumenMeta
        ? 'catechumen'
        : 'baptized';
    const accountStatus = normalizeText(metadata.account_status || metadata.verification_status) || 'unverified';

    const payload = compactPayload({
      id: user.id,
      email: user.email?.trim().toLowerCase(),
      full_name: metadata.full_name?.toString().trim() || user.email?.split('@')[0],
      baptism_name: metadata.baptism_name,
      birth_date: metadata.birth_date,
      gender: metadata.gender,
      ethnicity: metadata.ethnicity,
      marital_status: metadata.marital_status,
      country_id: metadata.country_id,
      diocese_id: metadata.diocese_id,
      church_id: metadata.church_id,
      country: metadata.country ?? metadata.country_name,
      diocese: metadata.diocese ?? metadata.diocese_name,
      parish: metadata.parish ?? metadata.parish_name,
      role: metadata.role ?? 'umat',
      faith_status: faithStatus,
      is_catechumen: faithStatus === 'catechumen',
      verification_status: metadata.verification_status ?? 'unverified',
      account_status: accountStatus,
      profile_filled: metadata.profile_filled ?? false,
      terms_accepted_at: metadata.terms_accepted_at,
      faith_verification_consent_at: metadata.faith_verification_consent_at,
      updated_at: new Date().toISOString(),
    });

    if (Object.keys(payload).length > 0) {
      const mutablePayload = { ...payload };

      while (true) {
        const { error } = await supabase
          .from('profiles')
          .upsert(mutablePayload, { onConflict: 'id' });

        if (!error) {
          break;
        }

        const lowerError = `${error.message} ${error.details ?? ''}`.toLowerCase();
        if (!isMissingColumnError(lowerError)) {
          console.warn('Self-heal profile upsert skipped:', normalizeSupabaseError(error));
          break;
        }

        const missingOptionalColumn = OPTIONAL_PROFILE_COLUMNS.find((column) =>
          lowerError.includes(column.toLowerCase())
        );

        if (!missingOptionalColumn || !(missingOptionalColumn in mutablePayload)) {
          console.warn('Self-heal profile upsert skipped:', normalizeSupabaseError(error));
          break;
        }

        delete mutablePayload[missingOptionalColumn];
      }
    }

    return this.getProfile(user.id);
  }

  // Update profile
  static async updateProfile(userId: string, updates: Partial<Profile>): Promise<Profile> {
    const payload = {
      ...updates,
      updated_at: new Date().toISOString(),
    } as Record<string, unknown>;

    if (
      typeof payload.country_text === 'string' &&
      payload.country_text.trim() &&
      (payload.country == null || `${payload.country}`.trim() === '')
    ) {
      payload.country = payload.country_text;
    }

    if (
      typeof payload.diocese_text === 'string' &&
      payload.diocese_text.trim() &&
      (payload.diocese == null || `${payload.diocese}`.trim() === '')
    ) {
      payload.diocese = payload.diocese_text;
    }

    if (
      typeof payload.parish_text === 'string' &&
      payload.parish_text.trim() &&
      (payload.parish == null || `${payload.parish}`.trim() === '')
    ) {
      payload.parish = payload.parish_text;
    }

    const workingPayload = { ...payload };

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const { data, error } = await supabase
        .from('profiles')
        .update(workingPayload)
        .eq('id', userId)
        .select('*')
        .maybeSingle();

      if (!error) {
        if (data) return data as Profile;
        break;
      }

      const normalizedError = `${error.message} ${error.details ?? ''}`;
      const missingColumn = extractMissingColumnName(normalizedError);
      const canSelfHeal =
        isMissingColumnError(normalizedError) ||
        isSchemaCacheMissingColumnError(normalizedError);

      if (
        canSelfHeal &&
        missingColumn &&
        missingColumn in workingPayload
      ) {
        delete workingPayload[missingColumn];
        continue;
      }

      throw new Error(error.message);
    }

    const fallbackProfile = await this.getProfile(userId);
    if (!fallbackProfile) {
      throw new Error('Gagal memperbarui profil karena schema tidak kompatibel.');
    }

    return fallbackProfile;
  }

  // Reset password (send email)
  static async resetPassword(email: string) {
    requireSupabaseConfiguration();

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (error) {
      throw new Error(error.message);
    }
  }

  // Update password
  static async updatePassword(password: string) {
    requireSupabaseConfiguration();

    const { error } = await supabase.auth.updateUser({
      password,
    });

    if (error) {
      throw new Error(error.message);
    }
  }

  // Subscribe to auth changes
  static onAuthStateChange(callback: (event: AuthChangeEvent, session: Session | null) => void) {
    return supabase.auth.onAuthStateChange(callback);
  }

  static async getCountries(search = ''): Promise<AuthLocationOption[]> {
    let query = supabase
      .from('countries')
      .select('id, name')
      .order('name', { ascending: true })
      .limit(LOCATION_FETCH_LIMIT);

    const keyword = search.trim();
    if (keyword) {
      query = query.ilike('name', `%${keyword}%`);
    }

    const { data, error } = await query;
    if (error) {
      console.error('Error fetching countries:', normalizeSupabaseError(error));
      return [];
    }

    return ((data ?? []) as Record<string, unknown>[])
      .map((row) => ({
        id: row.id?.toString() ?? '',
        name: row.name?.toString().trim() ?? '',
      }))
      .filter((item) => item.id && item.name);
  }

  static async getDioceses(countryId: string, search = ''): Promise<AuthLocationOption[]> {
    if (!countryId) return [];

    let query = supabase
      .from('dioceses')
      .select('id, name')
      .eq('country_id', countryId)
      .order('name', { ascending: true })
      .limit(LOCATION_FETCH_LIMIT);

    const keyword = search.trim();
    if (keyword) {
      query = query.ilike('name', `%${keyword}%`);
    }

    const { data, error } = await query;
    if (error) {
      console.error('Error fetching dioceses:', normalizeSupabaseError(error));
      return [];
    }

    return ((data ?? []) as Record<string, unknown>[])
      .map((row) => ({
        id: row.id?.toString() ?? '',
        name: row.name?.toString().trim() ?? '',
      }))
      .filter((item) => item.id && item.name);
  }

  static async getParishes(dioceseId: string, search = ''): Promise<AuthLocationOption[]> {
    if (!dioceseId) return [];

    let query = supabase
      .from('churches')
      .select('id, name')
      .eq('diocese_id', dioceseId)
      .order('name', { ascending: true })
      .limit(LOCATION_FETCH_LIMIT);

    const keyword = search.trim();
    if (keyword) {
      query = query.ilike('name', `%${keyword}%`);
    }

    const { data, error } = await query;
    if (error) {
      console.error('Error fetching parishes:', normalizeSupabaseError(error));
      return [];
    }

    return ((data ?? []) as Record<string, unknown>[])
      .map((row) => ({
        id: row.id?.toString() ?? '',
        name: row.name?.toString().trim() ?? '',
      }))
      .filter((item) => item.id && item.name);
  }

  private static async syncProfileRowWithRetry(params: {
    userId: string;
    email: string;
    metadata: ProfileUpsertPayload;
  }): Promise<ProfileSyncResult> {
    let lastResult: ProfileSyncResult = {
      success: false,
      reason: 'unknown',
    };

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      lastResult = await this.trySyncProfileRow(params);
      if (lastResult.success) {
        return lastResult;
      }

      if (attempt < 3) {
        await new Promise((resolve) => {
          setTimeout(resolve, 200 * attempt);
        });
      }
    }

    return lastResult;
  }

  private static async trySyncProfileRow(params: {
    userId: string;
    email: string;
    metadata: ProfileUpsertPayload;
  }): Promise<ProfileSyncResult> {
    const payload = compactPayload({
      id: params.userId,
      email: params.email,
      full_name: params.metadata.full_name,
      baptism_name: params.metadata.baptism_name,
      birth_date: params.metadata.birth_date,
      gender: params.metadata.gender,
      ethnicity: params.metadata.ethnicity,
      marital_status: params.metadata.marital_status,
      country_id: params.metadata.country_id,
      diocese_id: params.metadata.diocese_id,
      church_id: params.metadata.church_id,
      country: params.metadata.country,
      diocese: params.metadata.diocese,
      parish: params.metadata.parish,
      role: params.metadata.role,
      faith_status: params.metadata.faith_status,
      is_catechumen: params.metadata.is_catechumen,
      verification_status: params.metadata.verification_status,
      account_status: params.metadata.account_status,
      profile_filled: params.metadata.profile_filled,
      terms_accepted_at: params.metadata.terms_accepted_at,
      faith_verification_consent_at: params.metadata.faith_verification_consent_at,
      updated_at: new Date().toISOString(),
    });

    const workingPayload = { ...payload };
    while (true) {
      const { error } = await supabase
        .from('profiles')
        .upsert(workingPayload, { onConflict: 'id' });

      if (!error) {
        break;
      }

      const lowerError = `${error.message} ${error.details ?? ''}`.toLowerCase();
      if (!isMissingColumnError(lowerError)) {
        console.error('Profile sync failed after sign up:', error);
        return {
          success: false,
          reason: 'upsert_failed',
          details: error.message,
        };
      }

      const missingOptionalColumn = OPTIONAL_PROFILE_COLUMNS.find((column) =>
        lowerError.includes(column.toLowerCase())
      );

      if (!missingOptionalColumn || !(missingOptionalColumn in workingPayload)) {
        console.error('Profile sync failed after sign up:', error);
        return {
          success: false,
          reason: 'missing_required_column',
          details: error.message,
        };
      }

      delete workingPayload[missingOptionalColumn];
    }

    const verification = await supabase
      .from('profiles')
      .select(PROFILE_REQUIRED_COLUMNS.join(', '))
      .eq('id', params.userId)
      .single();

    if (verification.error || !verification.data) {
      return {
        success: false,
        reason: 'post_sync_verify_failed',
        details: verification.error?.message,
      };
    }

    const valid = this.isProfilePayloadValid(
      verification.data as unknown as Record<string, unknown>,
      workingPayload
    );

    if (!valid) {
      return {
        success: false,
        reason: 'profile_data_mismatch',
      };
    }

    return { success: true };
  }

  private static isProfilePayloadValid(
    dbData: Record<string, unknown>,
    expected: Record<string, unknown>
  ) {
    return [
      normalizeText(dbData.id) === normalizeText(expected.id),
      normalizeText(dbData.email) === normalizeText(expected.email),
      normalizeText(dbData.full_name) === normalizeText(expected.full_name),
      normalizeDate(dbData.birth_date) === normalizeDate(expected.birth_date),
      normalizeText(dbData.gender) === normalizeText(expected.gender),
      normalizeText(dbData.marital_status) === normalizeText(expected.marital_status),
      normalizeText(dbData.country_id) === normalizeText(expected.country_id),
      normalizeText(dbData.diocese_id) === normalizeText(expected.diocese_id),
      normalizeText(dbData.church_id) === normalizeText(expected.church_id),
      normalizeText(dbData.role) === normalizeText(expected.role),
      normalizeText(dbData.faith_status) === normalizeText(expected.faith_status),
      normalizeBool(dbData.is_catechumen) === normalizeBool(expected.is_catechumen),
      normalizeText(dbData.verification_status) === normalizeText(expected.verification_status),
      normalizeText(dbData.account_status) === normalizeText(expected.account_status),
      normalizeBool(dbData.profile_filled) === normalizeBool(expected.profile_filled),
    ].every(Boolean);
  }
}
