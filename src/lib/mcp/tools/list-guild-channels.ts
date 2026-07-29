import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

export default defineTool({
  name: "list_guild_channels",
  title: "List guild channels",
  description: "List text channels in a Discord guild.",
  inputSchema: {
    token: z.string().min(10).describe("Discord bot token."),
    guild_id: z.string().regex(/^\d{5,25}$/),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async ({ token, guild_id }) => {
    const res = await fetch(`https://discord.com/api/v10/guilds/${guild_id}/channels`, {
      headers: { Authorization: `Bot ${token}` },
    });
    const text = await res.text();
    if (!res.ok) {
      return {
        content: [{ type: "text", text: `Discord error ${res.status}: ${text.slice(0, 400)}` }],
        isError: true,
      };
    }
    const channels = (JSON.parse(text) as Array<{ id: string; name: string; type: number }>)
      .filter((c) => c.type === 0 || c.type === 5)
      .map((c) => ({ id: c.id, name: c.name }));
    return {
      content: [
        { type: "text", text: channels.map((c) => `${c.id}  #${c.name}`).join("\n") || "No text channels." },
      ],
      structuredContent: { channels },
    };
  },
});