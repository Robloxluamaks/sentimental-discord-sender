import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { accessKeyField, checkAccessKey } from "./_auth";

const CLIENT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9042 Chrome/124.0.6367.243 Electron/30.2.0 Safari/537.36";

export default defineTool({
  name: "send_discord_message",
  title: "Send Discord message",
  description:
    "Send a message to a Discord channel. Caller supplies their own Discord token (bot or user) and channel ID. Server does not store the token.",
  inputSchema: {
    ...accessKeyField,
    token: z.string().min(10).describe("Discord token. Bot token or user token."),
    is_bot: z.boolean().describe("True if the token is a bot token, false for user token."),
    channel_id: z.string().regex(/^\d{5,25}$/).describe("Discord channel ID (numeric)."),
    message: z.string().min(1).max(2000).describe("Message content, max 2000 chars."),
  },
  annotations: { readOnlyHint: false, openWorldHint: true },
  handler: async ({ access_key, token, is_bot, channel_id, message }) => {
    const gate = checkAccessKey(access_key);
    if (gate) return gate;
    const headers: Record<string, string> = {
      Authorization: is_bot ? `Bot ${token}` : token,
      "Content-Type": "application/json",
      "User-Agent": is_bot ? "DiscordBot (https://lovable.dev, 1.0)" : CLIENT_UA,
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