import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { syncProfile } from "@/hooks/useAuth";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Belépés – Nyomkövető élő térkép" },
      {
        name: "description",
        content:
          "Jelentkezz be Google-fiókkal vagy e-mail címmel, és kövesd valós időben azokat, akik engedélyt adtak rá.",
      },
      { property: "og:title", content: "Belépés – Nyomkövető élő térkép" },
      {
        property: "og:description",
        content: "Google- vagy e-mailes belépés az élő helymegosztáshoz.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        void syncProfile(data.session.user);
        void navigate({ to: "/terkep" });
      }
    });
  }, [navigate]);

  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { full_name: name },
          },
        });
        if (error) throw error;
        if (data.session) {
          await syncProfile(data.session.user);
          void navigate({ to: "/terkep" });
        } else {
          toast.success("Fiók létrehozva. Erősítsd meg az e-mail címed a belépéshez.");
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await syncProfile(data.user);
        void navigate({ to: "/terkep" });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Nem sikerült a belépés");
    } finally {
      setBusy(false);
    }
  };

  const handleGoogle = async () => {
    setBusy(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      setBusy(false);
      toast.error("A Google belépés nem sikerült");
      return;
    }
    if (result.redirected) return;
    const { data } = await supabase.auth.getUser();
    if (data.user) await syncProfile(data.user);
    void navigate({ to: "/terkep" });
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-12">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-8 block text-sm text-muted-foreground hover:text-foreground">
          ← Vissza
        </Link>
        <h1 className="font-display text-3xl font-bold">
          {mode === "signin" ? "Belépés" : "Regisztráció"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Élő helyzet megosztása és követése – csak kölcsönös engedéllyel.
        </p>

        <div className="panel mt-6 p-6">
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            disabled={busy}
            onClick={handleGoogle}
          >
            Folytatás Google-fiókkal
          </Button>

          <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            vagy e-mail címmel
            <span className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={handleEmail} className="space-y-4">
            {mode === "signup" && (
              <div className="space-y-2">
                <Label htmlFor="name">Neved</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Kovács Anna"
                  required
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Jelszó</Label>
              <Input
                id="password"
                type="password"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {mode === "signin" ? "Belépés" : "Fiók létrehozása"}
            </Button>
          </form>

          <button
            type="button"
            className="mt-4 w-full text-sm text-muted-foreground hover:text-foreground"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          >
            {mode === "signin"
              ? "Még nincs fiókod? Regisztrálj"
              : "Van már fiókod? Lépj be"}
          </button>
        </div>
      </div>
    </main>
  );
}
