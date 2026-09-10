import { serveMarkdownDoc } from "@/lib/serve-markdown-doc";

export async function GET() {
  return serveMarkdownDoc("QUICKSTART.md");
}
