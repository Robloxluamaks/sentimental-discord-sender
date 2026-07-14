import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { sendDiscordMessage } from "@/lib/discord.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Discord Auto Sender" },
      { name: "description", content: "Send messages to a Discord channel using a token, channel ID and message." },
      { property: "og:title", content: "Discord Auto Sender" },
      { property: "og:description", content: "Send messages to a Discord channel using a token, channel ID and message." },
    ],
  }),
  component: Index,
});

function Index() {
  const send = useServerFn(sendDiscordMessage);
  const [token, setToken] = useState("");
  const [channelId, setChannelId] = useState("");
  const [message, setMessage] = useState("");
  const [isBot, setIsBot] = useState(true);
  const [count, setCount] = useState(1);
  const [delayMs, setDelayMs] = useState(1000);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const append = (line: string) =>
    setLog((l) => [`[${new Date().toLocaleTimeString()}] ${line}`, ...l].slice(0, 200));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (running) return;
    setRunning(true);
    try {
      for (let i = 0; i < count; i++) {
        try {
          const res = await send({ data: { token, channelId, message, isBot } });
          append(res.ok ? `✓ Sent (${i + 1}/${count})` : `✗ ${res.status}: ${res.error}`);
          if (!res.ok) break;
        } catch (err) {
          append(`✗ ${err instanceof Error ? err.message : String(err)}`);
          break;
        }
        if (i < count - 1) await new Promise((r) => setTimeout(r, delayMs));
      }
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-3xl font-bold tracking-tight">Discord Auto Sender</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Enter a bot token (recommended) or user token, a channel ID and a message.
        </p>

        <form onSubmit={onSubmit} className="mt-8 space-y-4 rounded-lg border border-border bg-card p-6">
          <div className="flex items-center gap-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" checked={isBot} onChange={() => setIsBot(true)} />
              Bot token
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={!isBot} onChange={() => setIsBot(false)} />
              User token
            </label>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Token</label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="Your Discord token"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Channel ID</label>
            <input
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="123456789012345678"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Message</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="Hello world"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Count</label>
              <input
                type="number"
                min={1}
                max={100}
                value={count}
                onChange={(e) => setCount(Math.max(1, Number(e.target.value)))}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Delay (ms)</label>
              <input
                type="number"
                min={0}
                value={delayMs}
                onChange={(e) => setDelayMs(Math.max(0, Number(e.target.value)))}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={running}
            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {running ? "Sending..." : "Send"}
          </button>
        </form>

        {log.length > 0 && (
          <div className="mt-6 rounded-lg border border-border bg-card p-4">
            <h2 className="mb-2 text-sm font-semibold">Log</h2>
            <ul className="space-y-1 text-xs font-mono text-muted-foreground max-h-64 overflow-auto">
              {log.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </div>
        )}

        <p className="mt-6 text-xs text-muted-foreground">
          Note: Using user (self) tokens violates Discord's Terms of Service and can get your account banned. Prefer bot tokens.
        </p>
      </div>
    </div>
  );
}
