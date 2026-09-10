import { readFile } from "node:fs/promises";
import path from "node:path";

const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001";

/**
 * these docs live outside `public/` (as plain, human-editable markdown) so
 * this route can fill in the deployment's real API base URL rather than
 * shipping a hardcoded placeholder domain agents would try to call.
 */
export async function serveMarkdownDoc(filename: string): Promise<Response> {
  const raw = await readFile(path.join(process.cwd(), "src/docs-content", filename), "utf8");
  const content = raw.replaceAll("__PAYMOD_API_BASE_URL__", API_URL);
  return new Response(content, { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
}
