// Az Android-alkalmazás (APK) belépési pontja: ugyanaz a felület, szerver nélkül, statikus fájlokként.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
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
