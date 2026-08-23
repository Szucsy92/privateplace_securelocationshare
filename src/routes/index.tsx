import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Élő helymegosztás – lásd másodpercre pontosan, merre jár" },
      {
        name: "description",
        content:
          "Valós idejű térkép, ahol csak azok jelennek meg, akik engedélyt adtak rá. Nyomvonal, sebesség és GPS-pontosság, másodpercenként frissülve.",
      },
      { property: "og:title", content: "Élő helymegosztás – másodpercre pontos térkép" },
      {
        property: "og:description",
        content: "Kérj engedélyt, és kövesd valós időben, merre jár, akit követsz.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

function Landing() {
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) void navigate({ to: "/terkep" });
    });
  }, [navigate]);

  return (
    <main className="relative min-h-screen overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 15%, oklch(0.82 0.19 165 / 0.22), transparent 45%), radial-gradient(circle at 85% 80%, oklch(0.8 0.15 78 / 0.18), transparent 45%)",
        }}
        aria-hidden
      />
      <div className="relative mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-20">
        <p className="mb-6 flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-muted-foreground">
          <span className="live-dot" /> valós idejű
        </p>
        <h1 className="font-display text-4xl leading-tight font-bold sm:text-6xl">
          Lásd másodpercről másodpercre, merre jár.
        </h1>
        <p className="mt-5 max-w-xl text-base text-muted-foreground sm:text-lg">
          Élő térkép azoknak, akik engedélyt adtak rá. Kör alakú profilkép a térképen, megtett
          útvonal, aktuális sebesség és GPS-pontosság – folyamatosan frissülve.
        </p>

        <div className="mt-9 flex flex-wrap gap-3">
          <Button size="lg" asChild>
            <Link to="/auth">Kezdés</Link>
          </Button>
          <Button size="lg" variant="secondary" asChild>
            <Link to="/auth">Belépés Google-fiókkal</Link>
          </Button>
        </div>

        <ul className="mt-14 grid gap-4 sm:grid-cols-3">
          {[
            ["Engedélyalapú", "Csak jóváhagyás után indul a követés, bármikor visszavonható."],
            ["Másodperces frissítés", "A pozíció folyamatosan érkezik, amíg fut a megosztás."],
            ["Nyomvonal és adatok", "Megtett út, sebesség és pontosság egy pillantásra."],
          ].map(([title, text]) => (
            <li key={title} className="panel p-4">
              <p className="text-sm font-semibold">{title}</p>
              <p className="mt-1 text-xs text-muted-foreground">{text}</p>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
