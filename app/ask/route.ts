import { parseQuery, toSearch } from "@/lib/query";

export const dynamic = "force-dynamic";

// GET /ask?q=... -> 303 to the comparison page with the parsed parameters.
// The LLM only fills the form; every number on the page is computed by code.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (!q) return Response.redirect(new URL("/", url), 303);
  try {
    const { understood, params } = await parseQuery(q);
    if (!understood) return Response.redirect(new URL(`/?q=${encodeURIComponent(q)}&qerr=notunderstood`, url), 303);
    return Response.redirect(new URL(`/?${toSearch(params, q)}`, url), 303);
  } catch {
    return Response.redirect(new URL(`/?q=${encodeURIComponent(q)}&qerr=unavailable`, url), 303);
  }
}
