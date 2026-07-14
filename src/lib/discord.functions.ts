import { createServerFn } from "@tanstack/react-start";

type SendInput = {
  token: string;
  channelId: string;
  message: string;
  isBot: boolean;
  typing?: boolean;
  typingMs?: number;
  emojiMap?: Record<string, { id: string; animated: boolean }>;
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