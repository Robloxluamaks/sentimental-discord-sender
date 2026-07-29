import { createServerFn } from "@tanstack/react-start";

type SendInput = {
  token: string;
  channelId: string;
  message: string;
  typing?: boolean;
  typingMs?: number;
  emojiMap?: Record<string, { id: string; animated: boolean }>;
};

type DiscordError = {
  ok: false;
  status: number;
  error: string;
  retryAfter?: number;
  cloudflare?: boolean;
};

export type EmojiMap = Record<string, { id: string; animated: boolean; guild?: string }>;

const DISCORD_API = "https://discord.com/api/v10";

function botHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bot ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "DiscordBot (https://lovable.dev, 1.0)",
  };
}

function resolveCustomEmojis(message: string, emojiMap?: Record<string, { id: string; animated: boolean }>) {
  if (!emojiMap || Object.keys(emojiMap).length === 0) return message;

  return message.replace(/:([a-zA-Z0-9_]{2,32}):/g, (match, name: string) => {
    const emoji = emojiMap[name];
    if (!emoji) return match;
    return `<${emoji.animated ? "a" : ""}:${name}:${emoji.id}>`;
  });
}

async function parseDiscordFailure(res: Response, text: string): Promise<DiscordError> {
  let retryAfter: number | undefined;
  let error = text.slice(0, 500);

  try {
    const parsed = JSON.parse(text) as { message?: string; retry_after?: number; global?: boolean };
    if (typeof parsed.retry_after === "number") retryAfter = parsed.retry_after;
    if (parsed.message) error = parsed.message;
  } catch {
    const isCloudflare = /error code:\s*1015/i.test(text) || /cloudflare/i.test(text);
    if (isCloudflare) {
      const cfMatch = text.match(/error code:\s*(\d+)/i);
      return {
        ok: false,
        status: 1015,
        error: `Discord edge rate limit (${cfMatch?.[1] ?? "1015"}). Stop sending and wait before trying again.`,
        retryAfter: 900,
        cloudflare: true,
      };
    }
  }

  return {
    ok: false,
    status: res.status,
    error,
    retryAfter,
  };
}

export const sendDiscordMessage = createServerFn({ method: "POST" })
  .inputValidator((data: SendInput) => {
    if (!data.token || !data.channelId || !data.message) throw new Error("Missing fields");
    if (data.message.length > 2000) throw new Error("Message too long (max 2000)");
    if (!/^\d{5,25}$/.test(data.channelId)) throw new Error("Invalid channel ID");
    return data;
  })
  .handler(async ({ data }) => {
    const headers = botHeaders(data.token);
    const content = resolveCustomEmojis(data.message, data.emojiMap);

    try {
      if (data.typing) {
        await fetch(`${DISCORD_API}/channels/${data.channelId}/typing`, {
          method: "POST",
          headers,
        }).catch(() => undefined);

        const typingWait = Math.max(400, Math.min(8000, data.typingMs ?? 1200));
        await new Promise((resolve) => setTimeout(resolve, typingWait));
      }

      const res = await fetch(`${DISCORD_API}/channels/${data.channelId}/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({ content, tts: false }),
      });
      const text = await res.text();

      if (!res.ok) return parseDiscordFailure(res, text);
      return { ok: true as const, status: res.status };
    } catch (err) {
      return { ok: false as const, status: 0, error: err instanceof Error ? err.message : String(err) };
    }
  });

export const fetchEmojiMap = createServerFn({ method: "POST" })
  .inputValidator((data: { token: string }) => {
    if (!data.token) throw new Error("Missing token");
    return data;
  })
  .handler(async ({ data }) => {
    const headers = botHeaders(data.token);
    const guildsRes = await fetch(`${DISCORD_API}/users/@me/guilds`, { headers });
    const guildsText = await guildsRes.text();

    if (!guildsRes.ok) return parseDiscordFailure(guildsRes, guildsText);

    const guilds = JSON.parse(guildsText) as Array<{ id: string; name: string }>;
    const map: EmojiMap = {};

    for (const guild of guilds.slice(0, 50)) {
      const emojisRes = await fetch(`${DISCORD_API}/guilds/${guild.id}/emojis`, { headers });
      const emojisText = await emojisRes.text();

      if (!emojisRes.ok) {
        if (emojisRes.status === 429) {
          const failure = await parseDiscordFailure(emojisRes, emojisText);
          await new Promise((resolve) => setTimeout(resolve, Math.max(1000, (failure.retryAfter ?? 1) * 1000)));
        }
        continue;
      }

      const emojis = JSON.parse(emojisText) as Array<{ id: string; name: string; animated: boolean }>;
      for (const emoji of emojis) {
        if (!emoji.id || !emoji.name || map[emoji.name]) continue;
        map[emoji.name] = { id: emoji.id, animated: Boolean(emoji.animated), guild: guild.name };
      }

      await new Promise((resolve) => setTimeout(resolve, 750));
    }

    return { ok: true as const, map, guildCount: guilds.length, emojiCount: Object.keys(map).length };
  });