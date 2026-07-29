import { auth, defineMcp } from "@lovable.dev/mcp-js";
import sendDiscordMessage from "./tools/send-discord-message";
import listDiscordGuilds from "./tools/list-discord-guilds";
import listGuildChannels from "./tools/list-guild-channels";
import fetchCustomEmojis from "./tools/fetch-custom-emojis";

export default defineMcp({
  name: "discord-autosender-mcp",
  title: "Discord Autosender",
  version: "0.1.0",
  instructions:
    "Tools to send Discord messages and inspect Discord data using official Discord bot tokens only. Nothing is stored server-side.",
  auth: auth.oauth.issuer({
    issuer: "https://ywtnkmoyyzknfuqtfkjk.supabase.co/auth/v1",
    acceptedAudiences: "authenticated",
  }),
  tools: [sendDiscordMessage, listDiscordGuilds, listGuildChannels, fetchCustomEmojis],
});