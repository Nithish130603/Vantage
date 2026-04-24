import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const supabaseEnabled = !!(url && key);

// Returns null when Supabase is not configured — callers must guard with supabaseEnabled
export const supabase: SupabaseClient = supabaseEnabled
  ? createClient(url, key)
  : (null as unknown as SupabaseClient);

export type Analysis = {
  id: string;
  user_id: string;
  name: string;
  category: string;
  region: string;
  fingerprint_result: Record<string, unknown>;
  saved_suburbs: string[];
  created_at: string;
};
