import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `base: "./"` - the VS Code webview serves assets from a
// `vscode-webview-resource:` URI, not "/" - an absolute base would 404.
// default CSS extraction is kept so the CSP never needs `style-src
// 'unsafe-inline'`.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "../code-extension/dist/webview-ui",
    emptyOutDir: true,
  },
});
