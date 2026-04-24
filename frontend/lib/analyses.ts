import { supabase, supabaseEnabled, type Analysis } from "./supabase";
export type { Analysis } from "./supabase";

export async function saveAnalysis(
  name: string,
  category: string,
  region: string,
  fingerprintResult: Record<string, unknown>,
  savedSuburbs: string[] = []
): Promise<Analysis | null> {
  if (!supabaseEnabled) return null;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("analyses")
    .upsert({
      user_id: user.id,
      name,
      category,
      region,
      fingerprint_result: fingerprintResult,
      saved_suburbs: savedSuburbs,
    })
    .select()
    .single();

  if (error) { console.error("saveAnalysis:", error); return null; }
  return data as Analysis;
}

export async function listAnalyses(): Promise<Analysis[]> {
  if (!supabaseEnabled) return [];
  const { data, error } = await supabase
    .from("analyses")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) { console.error("listAnalyses:", error); return []; }
  return (data ?? []) as Analysis[];
}

export async function deleteAnalysis(id: string): Promise<void> {
  if (!supabaseEnabled) return;
  await supabase.from("analyses").delete().eq("id", id);
}

export async function updateSavedSuburbs(id: string, suburbs: string[]): Promise<void> {
  if (!supabaseEnabled) return;
  await supabase.from("analyses").update({ saved_suburbs: suburbs }).eq("id", id);
}
