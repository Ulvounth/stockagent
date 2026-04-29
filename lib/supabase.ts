import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error(
    "Supabase-miljøvariabler mangler. Sjekk NEXT_PUBLIC_SUPABASE_URL og SUPABASE_SERVICE_ROLE_KEY i .env.local",
  );
}

/**
 * Server-side Supabase-klient med service_role-nøkkel.
 * Brukes kun i API-ruter og server-komponenter – aldri i nettleseren.
 */
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
