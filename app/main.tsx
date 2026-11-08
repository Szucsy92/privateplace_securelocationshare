// Az Android-alkalmazás (APK) belépési pontja: ugyanaz a felület, szerver nélkül, statikus fájlokként.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/space-grotesk/latin-500.css";
import "@fontsource/space-grotesk/latin-700.css";
import "@fontsource/space-grotesk/latin-ext-500.css";
import "@fontsource/space-grotesk/latin-ext-700.css";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/dm-sans/latin-ext-400.css";
import "@fontsource/dm-sans/latin-ext-500.css";
import "@fontsource/dm-sans/latin-ext-600.css";
import "../src/styles.css";
import MapApp from "../src/components/MapApp";
import { Toaster } from "../src/components/ui/sonner";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <MapApp />
      <Toaster position="top-center" />
    </StrictMode>,
  );
}
