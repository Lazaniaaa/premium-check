// Minimal OpenAI Responses API client with strict JSON-schema output.
// The LLM never produces numbers the app shows as data: it either turns a question
// into parameters (parseQuery) or writes prose from numbered facts that a validator
// checks (lib/report.ts).

export const MODELS = {
  fast: process.env.OPENAI_MODEL_FAST ?? "gpt-6-luna",
  writer: process.env.OPENAI_MODEL_WRITER ?? "gpt-6.1-terra",
} as const;

export class LlmError extends Error {}

export async function structured<T>(args: {
  model: string;
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
  timeoutMs?: number;
  maxOutputTokens?: number;
}): Promise<{ data: T; usage: { input: number; output: number }; model: string }> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new LlmError("OPENAI_API_KEY is not set");
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: args.model,
      input: [
        { role: "system", content: args.system },
        { role: "user", content: args.user },
      ],
      text: { format: { type: "json_schema", name: args.schemaName, schema: args.schema, strict: true } },
      max_output_tokens: args.maxOutputTokens ?? 2000,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(args.timeoutMs ?? 45_000),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) throw new LlmError(`OpenAI ${res.status}: ${body?.error?.message ?? res.statusText}`);
  const text = (body.output ?? [])
    .flatMap((o: any) => o.content ?? [])
    .filter((c: any) => c.type === "output_text")
    .map((c: any) => c.text)
    .join("");
  try {
    return {
      data: JSON.parse(text) as T,
      usage: { input: body.usage?.input_tokens ?? 0, output: body.usage?.output_tokens ?? 0 },
      model: body.model ?? args.model,
    };
  } catch {
    throw new LlmError("OpenAI returned non-JSON output");
  }
}
