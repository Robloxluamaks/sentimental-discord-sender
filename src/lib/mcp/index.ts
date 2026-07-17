import { defineMcp } from "@lovable.dev/mcp-js";
import sendDiscordMessage from "./tools/send-discord-message";
import listDiscordGuilds from "./tools/list-discord-guilds";
import listGuildChannels from "./tools/list-guild-channels";
import fetchCustomEmojis from "./tools/fetch-custom-emojis";

export default defineMcp({
  name: "discord-autosender-mcp",
  title: "Discord Autosender",
  version: "0.1.0",
  instructions:
    "Tools to send Discord messages and inspect Discord data. The caller supplies a Discord token (bot or user) on every call. Nothing is stored server-side. Warning: user tokens violate Discord ToS.",
  tools: [sendDiscordMessage, listDiscordGuilds, listGuildChannels, fetchCustomEmojis],
});