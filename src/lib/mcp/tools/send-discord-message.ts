import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

export default defineTool({
  name: "send_discord_message",
  title: "Send Discord message",
  description:
    "Send a message to a Discord channel using an official Discord bot token. Server does not store the token.",
  inputSchema: {
    token: z.string().min(10).describe("Discord bot token."),
    channel_id: z.string().regex(/^\d{5,25}$/).describe("Discord channel ID (numeric)."),
    message: z.string().min(1).max(2000).describe("Message content, max 2000 chars."),
  },
  annotations: { readOnlyHint: false, openWorldHint: true },
  handler: async ({ token, channel_id, message }) => {
    const headers: Record<string, string> = {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "DiscordBot (https://lovable.dev, 1.0)",
    };
    try {
      const res = await fetch(
        `https://discord.com/api/v10/channels/${channel_id}/messages`,
        { method: "POST", headers, body: JSON.stringify({ content: message, tts: false }) },
      );
      const text = await res.text();
      if (!res.ok) {
        return {
          content: [{ type: "text", text: `Discord error ${res.status}: ${text.slice(0, 400)}` }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: `Sent to channel ${channel_id}.` }],
        structuredContent: { ok: true, status: res.status },
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
        isError: true,
      };
    }
  },
});