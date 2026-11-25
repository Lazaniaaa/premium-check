// Opt-in: LIVE_LLM=1 npx vitest run tests/live-note.test.ts
// Calls the real writer model once on recorded data and checks the note passes the
// validator (no digits typed by the model). Skipped in normal test runs.
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { buildFacts, validate, writeNote } from "@/lib/report";
import { takeSnapshot } from "@/lib/snapshot";

const live = process.env.LIVE_LLM === "1";

describe.skipIf(!live)("live writer model", () => {
  it("writes a note with {variables} only, and code fills the numbers", async () => {
    const env = fs.readFileSync(".env", "utf8").replace(/^﻿/, "");
    process.env.OPENAI_API_KEY = /^\s*OPENAI_API_KEY\s*=\s*["']?([^\s"']+)/m.exec(env)?.[1];
    process.env.DATA_SOURCE = "fixture";
    const facts = buildFacts(await takeSnapshot("test"), null);
    const { note, author } = await writeNote(facts);
    console.log(JSON.stringify({ author, headline: note.headline, points: note.points.map((p) => [p.template, p.text]) }, null, 1));
    expect(author.kind).toBe("llm");
    expect(validate(note, facts)).toEqual([]);
  }, 90_000);
});
