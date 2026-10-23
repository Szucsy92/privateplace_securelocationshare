import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "hu.privateplace.app",
  appName: "Private Place",
  webDir: "dist-app",
  android: {
    backgroundColor: "#121a2b",
    // A háttér-helymeghatározás ne álljon le 5 perc után lezárt képernyőnél.
    useLegacyBridge: true,
  },
};

export default config;
