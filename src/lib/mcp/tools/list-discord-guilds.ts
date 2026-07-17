import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

export default defineTool({
  name: "list_discord_guilds",
  title: "List Discord guilds",
  description: "List the guilds (servers) the given Discord token has access to.",
  inputSchema: {
    token: z.string().min(10).describe("Discord token (bot or user)."),
    is_bot: z.boolean().describe("True for bot token, false for user token."),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async ({ token, is_bot }) => {
    const res = await fetch("https://discord.com/api/v10/users/@me/guilds", {
      headers: { Authorization: is_bot ? `Bot ${token}` : token },
    });
    const text = await res.text();
    if (!res.ok) {
      return {
        content: [{ type: "text", text: `Discord error ${res.status}: ${text.slice(0, 400)}` }],
        isError: true,
      };
    }
    const guilds = JSON.parse(text) as Array<{ id: string; name: string }>;
    const rows = guilds.map((g) => ({ id: g.id, name: g.name }));
    return {
      content: [
        { type: "text", text: rows.map((r) => `${r.id}  ${r.name}`).join("\n") || "No guilds." },
      ],
      structuredContent: { guilds: rows },
    };
  },
});