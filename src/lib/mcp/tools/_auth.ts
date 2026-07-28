import { z } from "zod";

// Shared access-key gate for the MCP endpoint.
// If MCP_ACCESS_KEY is not set in the environment, the check is skipped
// (dev / backwards compat). When set, every tool call must include a matching
// `access_key` field. Uses constant-time comparison.
export const accessKeyField = {
  access_key: z
    .string()
    .min(8)
    .describe("Shared MCP access key configured by the app owner."),
};

function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export function checkAccessKey(provided: string | undefined) {
  const expected = process.env.MCP_ACCESS_KEY;
  if (!expected) return null; // gate disabled
  if (!provided || !timingSafeEq(provided, expected)) {
    return {
      content: [{ type: "text" as const, text: "Unauthorized: invalid or missing access_key." }],
      isError: true as const,
    };
  }
  return null;
}