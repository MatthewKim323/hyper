import { defineConfig } from "vite";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
function pages(dir = ".") {
  return readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
    if (
      ["node_modules", "work", "dist", ".git", "studio"].includes(item.name) ||
      item.name.startsWith(".")
    )
      return [];
    const p = resolve(dir, item.name);
    return item.isDirectory()
      ? pages(p)
      : item.name === "index.html"
        ? [p]
        : [];
  });
}
export default defineConfig({
  build: {
    target: "esnext",
    rollupOptions: { input: pages() },
    assetsInlineLimit: 0,
  },
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
});
