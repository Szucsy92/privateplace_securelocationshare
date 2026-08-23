import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { session, user: session?.user ?? null, loading };
}

/** A bejelentkezett felhasználó profiljának létrehozása/frissítése (Google kép, név). */
export async function syncProfile(user: User) {
  const meta = user.user_metadata ?? {};
  await supabase.from("profiles").upsert(
    {
      id: user.id,
      email: user.email ?? "",
      display_name:
        (meta["full_name"] as string) ||
        (meta["name"] as string) ||
        (user.email ? user.email.split("@")[0] : "Névtelen"),
      avatar_url: (meta["avatar_url"] as string) || (meta["picture"] as string) || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
}
