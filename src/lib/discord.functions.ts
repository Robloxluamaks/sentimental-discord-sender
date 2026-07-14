import { createServerFn } from "@tanstack/react-start";

type SendInput = {
  token: string;
  channelId: string;
  message: string;
  isBot: boolean;
  typing?: boolean;
};

export const sendDiscordMessage = createServerFn({ method: "POST" })
  .inputValidator((data: SendInput) => {
    if (!data.token || !data.channelId || !data.message) throw new Error("Missing fields");
    if (data.message.length > 2000) throw new Error("Message too long (max 2000)");
    if (!/^\d{5,25}$/.test(data.channelId)) throw new Error("Invalid channel ID");
    return data;
  })
  .handler(async ({ data }) => {
    const auth = data.isBot ? `Bot ${data.token}` : data.token;
    const headers: Record<string, string> = {
      Authorization: auth,
      "Content-Type": "application/json",
    };
    if (data.isBot) {
      headers["User-Agent"] = "DiscordBot (https://lovable.dev, 1.0)";
    } else {
      // Mimic a real desktop client for user tokens (anti-detection).
      headers["User-Agent"] =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9042 Chrome/124.0.6367.243 Electron/30.2.0 Safari/537.36";
      headers["X-Super-Properties"] = Buffer.from(
        JSON.stringify({
          os: "Windows",
          browser: "Discord Client",
          release_channel: "stable",
          client_version: "1.0.9042",
          os_version: "10.0.19045",
          os_arch: "x64",
          system_locale: "en-US",
          client_build_number: 320472,
        }),
      ).toString("base64");
    }

    try {
      if (data.typing) {
        await fetch(`https://discord.com/api/v10/channels/${data.channelId}/typing`, {
          method: "POST",
          headers,
        }).catch(() => {});
        // Small server-side pause so typing shows briefly
        await new Promise((r) => setTimeout(r, 800 + Math.random() * 1200));
      }

      const res = await fetch(`https://discord.com/api/v10/channels/${data.channelId}/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({ content: data.message }),
      });
      const text = await res.text();
      if (!res.ok) return { ok: false as const, status: res.status, error: text.slice(0, 500) };
      return { ok: true as const, status: res.status };
    } catch (err) {
      return { ok: false as const, status: 0, error: err instanceof Error ? err.message : String(err) };
    }
  });