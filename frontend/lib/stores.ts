import { supabase, supabaseEnabled } from "./supabase";

export interface UserStore {
  id: string;
  user_id: string;
  category: string;
  locality: string;
  state: string;
  performance: "best" | "worst";
  created_at: string;
}

export type NewUserStore = Pick<UserStore, "category" | "locality" | "state" | "performance">;

function isMissingTable(error: { code?: string; message?: string }): boolean {
  const msg = (error.message ?? "").toLowerCase();
  return error.code === "42P01" || msg.includes("does not exist") || msg.includes("schema cache");
}

export async function listUserStores(): Promise<UserStore[]> {
  if (!supabaseEnabled) return [];
  const { data, error } = await supabase
    .from("user_stores")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return [];
  return (data ?? []) as UserStore[];
}

export async function addUserStore(store: NewUserStore): Promise<UserStore | null> {
  if (!supabaseEnabled) return null;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("user_stores")
    .insert({ ...store, user_id: user.id })
    .select()
    .single();
  if (error) return null;
  return data as UserStore;
}

export async function deleteUserStore(id: string): Promise<void> {
  if (!supabaseEnabled) return;
  await supabase.from("user_stores").delete().eq("id", id);
}
