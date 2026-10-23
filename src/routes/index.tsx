import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import MapApp from "@/components/MapApp";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Private Place – privát, valós idejű helymegosztás" },
      {
        name: "description",
        content:
          "Fiók és központi tárolás nélküli élő térkép: titkos szobák QR-kóddal, közvetlen telefon–telefon kapcsolat, független nyílt térkép.",
      },
      { property: "og:title", content: "Private Place – privát, valós idejű helymegosztás" },
      {
        property: "og:description",
        content: "Titkos szoba, QR-kód, és máris látjátok egymást élőben – regisztráció nélkül.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

function Home() {
  return (
    <ClientOnly fallback={<div className="map-workspace glass-shell" />}>
      <MapApp />
    </ClientOnly>
  );
}
