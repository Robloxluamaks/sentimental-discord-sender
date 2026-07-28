import { createServerFn } from "@tanstack/react-start";

type SendPMInput = {
  cookie: string;          // .ROBLOSECURITY value (no name= prefix)
  recipientId: string;     // numeric user id
  subject: string;
  body: string;
};

const UAS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0",
];

function baseHeaders(cookie: string) {
  const ua = UAS[Math.floor(Math.random() * UAS.length)];
  return {
    Cookie: `.ROBLOSECURITY=${cookie}`,
    "User-Agent": ua,
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    Origin: "https://www.roblox.com",
    Referer: "https://www.roblox.com/",
  } as Record<string, string>;
}

async function fetchCsrf(cookie: string): Promise<string | null> {
  // Roblox returns 403 + `x-csrf-token` header on POSTs without a token.
  const r = await fetch("https://auth.roblox.com/v2/logout", {
    method: "POST",
    headers: baseHeaders(cookie),
  });
  return r.headers.get("x-csrf-token");
}

export const sendRobloxPM = createServerFn({ method: "POST" })
  .inputValidator((data: SendPMInput) => {
    if (!data.cookie) throw new Error("Missing .ROBLOSECURITY cookie");
    if (!/^\d{3,20}$/.test(data.recipientId)) throw new Error("Invalid recipient user id");
    if (!data.body?.trim()) throw new Error("Body required");
    if (data.body.length > 3000) throw new Error("Body too long (max 3000)");
    return data;
  })
  .handler(async ({ data }) => {
    try {
      const csrf = await fetchCsrf(data.cookie);
      if (!csrf) return { ok: false as const, status: 0, error: "Could not obtain X-CSRF-TOKEN. Cookie likely invalid." };

      const headers = {
        ...baseHeaders(data.cookie),
        "Content-Type": "application/json",
        "X-CSRF-TOKEN": csrf,
      };

      const res = await fetch("https://privatemessages.roblox.com/v1/messages/send", {
        method: "POST",
        headers,
        body: JSON.stringify({
          subject: data.subject || "",
          body: data.body,
          recipientId: Number(data.recipientId),
          includePreviousMessage: false,
          replyMessageId: 0,
        }),
      });
      const text = await res.text();
      if (!res.ok) {
        return { ok: false as const, status: res.status, error: text.slice(0, 500) };
      }
      // Roblox returns { shortMessage, message, success } — surface it.
      try {
        const j = JSON.parse(text);
        if (j && j.success === false) {
          return { ok: false as const, status: res.status, error: j.shortMessage || j.message || "denied" };
        }
      } catch {}
      return { ok: true as const, status: res.status };
    } catch (err) {
      return { ok: false as const, status: 0, error: err instanceof Error ? err.message : String(err) };
    }
  });