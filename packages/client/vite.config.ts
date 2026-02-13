import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron";
import electronRenderer from "vite-plugin-electron-renderer";
import { resolve } from "node:path";
import { copyFileSync, mkdirSync } from "node:fs";

function copyPreload() {
  return {
    name: "copy-preload-cjs",
    writeBundle() {
      mkdirSync("dist-electron", { recursive: true });
      copyFileSync("electron/preload.cjs", "dist-electron/preload.cjs");
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: "electron/main.ts",
        vite: {
          build: {
            outDir: "dist-electron",
            rollupOptions: {
              external: ["electron"],
            },
          },
          plugins: [copyPreload()],
        },
      },
    ]),
    electronRenderer(),
  ],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "@raddir/shared": resolve(__dirname, "../shared/src/index.ts"),
    },
  },
  base: "./",
  build: {
    outDir: "dist",
  },
});
