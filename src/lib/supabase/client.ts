// Supabase Client Configuration

import { createClient } from '@supabase/supabase-js';

const envSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? '';
const envSupabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? '';

const supabaseUrl = envSupabaseUrl || 'https://placeholder.supabase.co';
const supabaseAnonKey = envSupabaseAnonKey || 'public-anon-key-placeholder';
console.log('Supabase Config:', {
  url: envSupabaseUrl ? 'Loaded' : 'Missing',
  key: envSupabaseAnonKey ? 'Loaded' : 'Missing',
});

export const isSupabaseConfigured = Boolean(envSupabaseUrl && envSupabaseAnonKey);
export const supabaseConfigError = isSupabaseConfigured
  ? null
  : 'Supabase belum dikonfigurasi. Isi NEXT_PUBLIC_SUPABASE_URL dan NEXT_PUBLIC_SUPABASE_ANON_KEY di environment.';

if (!isSupabaseConfigured) {
  console.warn(
    'Supabase URL or Anon Key is missing. Please check your environment variables.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// Realtime client
export const realtime = supabase.channel('main-channel');
