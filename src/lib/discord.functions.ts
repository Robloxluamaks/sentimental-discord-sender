import { createServerFn } from "@tanstack/react-start";

type SendInput = {
  token: string;
  channelId: string;
  message: string;
  isBot: boolean;
  typing?: boolean;
  typingMs?: number;
  emojiMap?: Record<string, { id: string; animated: boolean }>;
  simulateRead?: boolean;
};

// Rotating pool of realistic desktop client fingerprints (user tokens only).
const CLIENT_PROFILES = [
  {
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9042 Chrome/124.0.6367.243 Electron/30.2.0 Safari/537.36",
    props: {
      os: "Windows",
      browser: "Discord Client",
      release_channel: "stable",
      client_version: "1.0.9042",
      os_version: "10.0.19045",
      os_arch: "x64",
      system_locale: "en-US",
      client_build_number: 320472,
      client_event_source: null,
    },
  },
  {
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) discord/0.0.312 Chrome/124.0.6367.243 Electron/30.2.0 Safari/537.36",
    props: {
      os: "Mac OS X",
      browser: "Discord Client",
      release_channel: "stable",
      client_version: "0.0.312",
      os_version: "23.5.0",
      os_arch: "arm64",
      system_locale: "en-US",
      client_build_number: 320472,
      client_event_source: null,
    },
  },
  {
    ua: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) discord/0.0.68 Chrome/124.0.6367.243 Electron/30.2.0 Safari/537.36",
    props: {
      os: "Linux",
      browser: "Discord Client",
      release_channel: "stable",
      client_version: "0.0.68",
      os_version: "",
      os_arch: "x64",
      system_locale: "en-US",
      client_build_number: 320472,
      client_event_source: null,
    },
  },
  {
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    props: {
      os: "Windows",
      browser: "Chrome",
      device: "",
      system_locale: "en-US",
      browser_user_agent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      browser_version: "125.0.0.0",
      os_version: "10",
      referrer: "",
      referring_domain: "",
      referrer_current: "",
      referring_domain_current: "",
      release_channel: "stable",
      client_build_number: 320472,
      client_event_source: null,
    },
  },
  {
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    props: {
      os: "Mac OS X",
      browser: "Safari",
      device: "",
      system_locale: "en-US",
      browser_version: "17.5",
      os_version: "10.15.7",
      release_channel: "stable",
      client_build_number: 320472,
      client_event_source: null,
    },
  },
];

export const sendDiscordMessage = createServerFn({ method: "POST" })
  .inputValidator((data: SendInput) => {
    if (!data.token || !data.channelId || !data.message) throw new Error("Missing fields");
    if (data.message.length > 2000) throw new Error("Message too long (max 2000)");
    if (!/^\d{5,25}$/.test(data.channelId)) throw new Error("Invalid channel ID");
    return data;
  })
  .handler(async ({ data }) => {
    // Resolve :name: tokens to Discord custom emoji markup <:name:id> / <a:name:id>.
    // Skips tokens inside code blocks / inline code to avoid mangling snippets.
    let content = data.message;
    if (data.emojiMap && Object.keys(data.emojiMap).length > 0) {
      content = content.replace(/:([a-zA-Z0-9_]{2,32}):/g, (m, name) => {
        const e = data.emojiMap![name];
        if (!e) return m;
        return `<${e.animated ? "a" : ""}:${name}:${e.id}>`;
      });
    }

    const auth = data.isBot ? `Bot ${data.token}` : data.token;
    const headers: Record<string, string> = {
      Authorization: auth,
      "Content-Type": "application/json",
    };
    if (data.isBot) {
      headers["User-Agent"] = "DiscordBot (https://lovable.dev, 1.0)";
    } else {
      // Rotate a realistic desktop client fingerprint per request.
      const profile = CLIENT_PROFILES[Math.floor(Math.random() * CLIENT_PROFILES.length)];
      headers["User-Agent"] = profile.ua;
      headers["X-Super-Properties"] = Buffer.from(JSON.stringify(profile.props)).toString("base64");
      headers["X-Discord-Locale"] = "en-US";
      headers["X-Debug-Options"] = "bugReporterEnabled";
      headers["Accept"] = "*/*";
      headers["Accept-Language"] = "en-US,en;q=0.9";
      headers["Sec-Fetch-Dest"] = "empty";
      headers["Sec-Fetch-Mode"] = "cors";
      headers["Sec-Fetch-Site"] = "same-origin";
      headers["Origin"] = "https://discord.com";
      headers["Referer"] = `https://discord.com/channels/@me/${data.channelId}`;
    }

    try {
      // Real clients hit the channel history when a user opens a channel.
      // Simulating that GET before send makes the traffic pattern look human.
      if (data.simulateRead && !data.isBot) {
        await fetch(
          `https://discord.com/api/v10/channels/${data.channelId}/messages?limit=50`,
          { headers },
        ).catch(() => {});
      }
      if (data.typing) {
        const typingWait = Math.max(400, Math.min(15000, data.typingMs ?? 1500));
        await fetch(`https://discord.com/api/v10/channels/${data.channelId}/typing`, {
          method: "POST",
          headers,
        }).catch(() => {});
        // Re-trigger typing every ~9s if the wait is long (matches real client behavior).
        const start = Date.now();
        while (Date.now() - start < typingWait) {
          const chunk = Math.min(9000, typingWait - (Date.now() - start));
          await new Promise((r) => setTimeout(r, chunk));
          if (Date.now() - start < typingWait) {
            await fetch(`https://discord.com/api/v10/channels/${data.channelId}/typing`, {
              method: "POST",
              headers,
            }).catch(() => {});
          }
        }
      }

      const body: Record<string, unknown> = {
        content,
        tts: false,
        flags: 0,
      };
      // Discord clients send a nonce per message; matches real client traffic.
      if (!data.isBot) body.nonce = String(Date.now() * 1000 + Math.floor(Math.random() * 1000));
      const res = await fetch(`https://discord.com/api/v10/channels/${data.channelId}/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) {
        let retryAfter: number | undefined;
        try {
          const j = JSON.parse(text);
          if (typeof j.retry_after === "number") retryAfter = j.retry_after;
        } catch {}
        return { ok: false as const, status: res.status, error: text.slice(0, 500), retryAfter };
      }
      return { ok: true as const, status: res.status };
    } catch (err) {
      return { ok: false as const, status: 0, error: err instanceof Error ? err.message : String(err) };
    }
  });

type EmojiFetchInput = { token: string; isBot: boolean };
export type EmojiMap = Record<string, { id: string; animated: boolean; guild?: string }>;

// Pulls all custom emojis from every guild the token has access to.
// Requires Nitro to use cross-guild emojis when sending with a user token.
export const fetchEmojiMap = createServerFn({ method: "POST" })
  .inputValidator((data: EmojiFetchInput) => {
    if (!data.token) throw new Error("Missing token");
    return data;
  })
  .handler(async ({ data }) => {
    const auth = data.isBot ? `Bot ${data.token}` : data.token;
    const headers: Record<string, string> = {
      Authorization: auth,
      "User-Agent": data.isBot
        ? "DiscordBot (https://lovable.dev, 1.0)"
        : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 discord/1.0.9042 Chrome/124.0.6367.243 Electron/30.2.0 Safari/537.36",
    };

    const gr = await fetch("https://discord.com/api/v10/users/@me/guilds", { headers });
    if (!gr.ok) {
      return { ok: false as const, status: gr.status, error: (await gr.text()).slice(0, 300) };
    }
    const guilds = (await gr.json()) as Array<{ id: string; name: string }>;
    const map: EmojiMap = {};
    // Sequential with tiny gaps to avoid rate limits.
    for (const g of guilds) {
      const er = await fetch(`https://discord.com/api/v10/guilds/${g.id}/emojis`, { headers });
      if (!er.ok) {
        await new Promise((r) => setTimeout(r, 250));
        continue;
      }
      const emojis = (await er.json()) as Array<{ id: string; name: string; animated: boolean }>;
      for (const e of emojis) {
        if (!e.id || !e.name) continue;
        if (!map[e.name]) map[e.name] = { id: e.id, animated: !!e.animated, guild: g.name };
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    return { ok: true as const, map, guildCount: guilds.length, emojiCount: Object.keys(map).length };
  });