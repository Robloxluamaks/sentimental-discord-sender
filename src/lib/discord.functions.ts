import { createServerFn } from "@tanstack/react-start";

export const sendDiscordMessage = createServerFn({ method: "POST" })
  .inputValidator((data: { token: string; channelId: string; message: string; isBot: boolean }) => {
    if (!data.token || !data.channelId || !data.message) throw new Error("Missing fields");
    return data;
  })
  .handler(async ({ data }) => {
    const auth = data.isBot ? `Bot ${data.token}` : data.token;
    const res = await fetch(`https://discord.com/api/v10/channels/${data.channelId}/messages`, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json",
        "User-Agent": "DiscordBot (https://lovable.dev, 1.0)",
      },
      body: JSON.stringify({ content: data.message }),
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false as const, status: res.status, error: text };
    }
    return { ok: true as const, status: res.status };
  });