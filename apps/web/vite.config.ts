import react from "@vitejs/plugin-react";
import { copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const noticesSource = new URL("../../THIRD_PARTY_NOTICES.md", import.meta.url);

export default defineConfig({
  plugins: [
    react(),
    {
      name: "copy-third-party-notices",
      async closeBundle() {
        await copyFile(noticesSource, resolve("dist/THIRD_PARTY_NOTICES.md"));
      },
    },
  ],
  build: {
    outDir: "dist",
  },
});
