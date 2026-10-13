import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

let client: SupabaseClient<Database> | undefined;

function getClient() {
  if (client) return client;

  const url = import.meta.env["VITE_SUPABASE_URL"];
  const publishableKey =
    import.meta.env["VITE_SUPABASE_ANON_KEY"] ??
    import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !publishableKey) {
    throw new Error(
      "Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to the project environment.",
    );
  }

  client = createClient<Database>(url, publishableKey);
  return client;
}

export const supabase = new Proxy({} as SupabaseClient<Database>, {
  get(_target, property) {
    const value = Reflect.get(getClient(), property, getClient());
    return typeof value === "function" ? value.bind(getClient()) : value;
  },
});
