import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { sendDiscordMessage, fetchEmojiMap, type EmojiMap } from "@/lib/discord.functions";
import { sendRobloxPM } from "@/lib/roblox.functions";
import { encryptJSON, decryptJSON, isEncryptedBlob } from "@/lib/crypto";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Ghost.Send — Multi-Platform Autosender" },
      { name: "description", content: "Discord + Roblox autosender with stealth: rotating fingerprints, human typing, encrypted vault." },
      { property: "og:title", content: "Ghost.Send — Multi-Platform Autosender" },
      { property: "og:description", content: "Multi-platform autosender with anti-detection and encrypted profiles." },
    ],
  }),
  component: Index,
});

type Tab = "discord" | "roblox" | "snapchat";

type Target = {
  id: string;
  name: string;
  channelId: string;
  message: string;
  delaySec: number;
  loop: boolean;
};

const newTarget = (): Target => ({
  id: Math.random().toString(36).slice(2, 9),
  name: "campaign",
  channelId: "",
  message: "",
  delaySec: 60,
  loop: true,
});

function jitter(base: number, jitterPct: number) {
  const delta = base * (jitterPct / 100);
  // Additive only — never below the configured delay.
  return Math.max(0, Math.round(base + Math.random() * delta));
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

type StealthLevel = "low" | "balanced" | "max";
const STEALTH: Record<
  StealthLevel,
  { label: string; blurb: string; typing: boolean; humanTyping: boolean; jitterPct: number; simulateRead: boolean; shuffle: boolean }
> = {
  low:      { label: "Fast",        blurb: "Sends quickly with minimal delay. Higher risk on user tokens.",             typing: false, humanTyping: false, jitterPct: 8,  simulateRead: false, shuffle: false },
  balanced: { label: "Balanced",    blurb: "Typing indicator + up to +12% delay + channel-read simulation.",            typing: true,  humanTyping: false, jitterPct: 12, simulateRead: true,  shuffle: true  },
  max:      { label: "Max Stealth", blurb: "Real typing time by message length + +15% delay + read sim + shuffle order.", typing: true,  humanTyping: true,  jitterPct: 15, simulateRead: true,  shuffle: true  },
};

function humanTypingMs(text: string) {
  const base = 400 + text.length * (180 + Math.random() * 120);
  const variance = base * (0.15 + Math.random() * 0.25);
  return Math.min(14000, Math.round(base + (Math.random() * 2 - 1) * variance));
}

type StoredConfig = {
  isBot: boolean;
  stealth: StealthLevel;
  targets: Target[];
  savedToken: string | null;
  roblox?: {
    cookie: string | null;
    recipientId: string;
    subject: string;
    body: string;
    delaySec: number;
    loop: boolean;
  };
};
const PROFILES_KEY = "ghost-send:profiles";
const SESSION_KEY = "ghost-send:session";

function Index() {
  const send = useServerFn(sendDiscordMessage);
  const loadEmojis = useServerFn(fetchEmojiMap);
  const sendPM = useServerFn(sendRobloxPM);

  const [tab, setTab] = useState<Tab>("discord");

  // Discord state
  const [token, setToken] = useState("");
  const [isBot, setIsBot] = useState(true);
  const [targets, setTargets] = useState<Target[]>([newTarget()]);
  const [stealth, setStealth] = useState<StealthLevel>("balanced");
  const [emojiMap, setEmojiMap] = useState<EmojiMap>({});
  const [emojisLoading, setEmojisLoading] = useState(false);

  // Roblox state
  const [rbCookie, setRbCookie] = useState("");
  const [rbRecipient, setRbRecipient] = useState("");
  const [rbSubject, setRbSubject] = useState("");
  const [rbBody, setRbBody] = useState("");
  const [rbDelay, setRbDelay] = useState(120);
  const [rbLoop, setRbLoop] = useState(true);

  // Shared execution
  const [running, setRunning] = useState(false);
  const stopRef = useRef(false);
  const waitAbortersRef = useRef<Set<() => void>>(new Set());
  const [log, setLog] = useState<string[]>([]);
  const [stats, setStats] = useState({ sent: 0, failed: 0 });

  // Config / vault
  const [profiles, setProfiles] = useState<Record<string, StoredConfig>>({});
  const [profileName, setProfileName] = useState("");
  const [selectedProfile, setSelectedProfile] = useState("");
  const [includeToken, setIncludeToken] = useState(false);
  const [vaultPass, setVaultPass] = useState("");
  const [vaultLocked, setVaultLocked] = useState(false);
  const hydratedRef = useRef(false);

  const append = (line: string) =>
    setLog((l) => [`[${new Date().toLocaleTimeString()}] ${line}`, ...l].slice(0, 200));

  // Load registry + last session on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PROFILES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (isEncryptedBlob(parsed)) {
          setVaultLocked(true);
        } else {
          setProfiles(parsed);
        }
      }
      const last = localStorage.getItem(SESSION_KEY);
      if (last) {
        const s = JSON.parse(last);
        if (!isEncryptedBlob(s)) applyConfig(s);
      }
    } catch {}
    hydratedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autosave current session (no secrets).
  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      const snap: StoredConfig = {
        isBot, stealth, targets, savedToken: null,
        roblox: { cookie: null, recipientId: rbRecipient, subject: rbSubject, body: rbBody, delaySec: rbDelay, loop: rbLoop },
      };
      localStorage.setItem(SESSION_KEY, JSON.stringify(snap));
    } catch {}
  }, [isBot, stealth, targets, rbRecipient, rbSubject, rbBody, rbDelay, rbLoop]);

  const applyConfig = (c: StoredConfig) => {
    if (typeof c.isBot === "boolean") setIsBot(c.isBot);
    if (c.stealth) setStealth(c.stealth);
    if (Array.isArray(c.targets) && c.targets.length) {
      setTargets(c.targets.map((t: Target) => ({ ...newTarget(), ...t, id: Math.random().toString(36).slice(2, 9) })));
    }
    if (typeof c.savedToken === "string" && c.savedToken) setToken(c.savedToken);
    if (c.roblox) {
      if (typeof c.roblox.cookie === "string" && c.roblox.cookie) setRbCookie(c.roblox.cookie);
      setRbRecipient(c.roblox.recipientId || "");
      setRbSubject(c.roblox.subject || "");
      setRbBody(c.roblox.body || "");
      if (c.roblox.delaySec) setRbDelay(c.roblox.delaySec);
      if (typeof c.roblox.loop === "boolean") setRbLoop(c.roblox.loop);
    }
  };

  const persistProfiles = async (next: Record<string, StoredConfig>) => {
    setProfiles(next);
    try {
      if (vaultPass) {
        const blob = await encryptJSON(next, vaultPass);
        localStorage.setItem(PROFILES_KEY, JSON.stringify(blob));
      } else {
        localStorage.setItem(PROFILES_KEY, JSON.stringify(next));
      }
    } catch (e) {
      append(`✗ save failed: ${(e as Error).message}`);
    }
  };

  const onUnlockVault = async () => {
    if (!vaultPass) { append("✗ enter vault password first"); return; }
    try {
      const raw = localStorage.getItem(PROFILES_KEY);
      if (!raw) { append("⚿ vault ready — no profiles yet"); setVaultLocked(false); return; }
      const parsed = JSON.parse(raw);
      if (isEncryptedBlob(parsed)) {
        const decoded = await decryptJSON<Record<string, StoredConfig>>(parsed, vaultPass);
        setProfiles(decoded);
        setVaultLocked(false);
        append(`⚿ vault unlocked · ${Object.keys(decoded).length} profile(s)`);
      } else {
        // Plaintext → encrypted migration.
        setProfiles(parsed);
        setVaultLocked(false);
        const blob = await encryptJSON(parsed, vaultPass);
        localStorage.setItem(PROFILES_KEY, JSON.stringify(blob));
        append(`⚿ migrated ${Object.keys(parsed).length} profile(s) to encrypted vault`);
      }
    } catch {
      append(`✗ decrypt failed — wrong password?`);
    }
  };

  const onSaveProfile = async () => {
    const name = profileName.trim();
    if (!name) { append("✗ profile name required"); return; }
    if (vaultLocked) { append("✗ unlock vault first"); return; }
    const cfg: StoredConfig = {
      isBot, stealth, targets,
      savedToken: includeToken && token ? token : null,
      roblox: {
        cookie: includeToken && rbCookie ? rbCookie : null,
        recipientId: rbRecipient, subject: rbSubject, body: rbBody,
        delaySec: rbDelay, loop: rbLoop,
      },
    };
    await persistProfiles({ ...profiles, [name]: cfg });
    setSelectedProfile(name);
    append(`✓ saved "${name}"${includeToken ? " (with secrets)" : ""}${vaultPass ? " · encrypted" : ""}`);
  };

  const onLoadProfile = () => {
    const cfg = profiles[selectedProfile];
    if (!cfg) { append("✗ no profile selected"); return; }
    applyConfig(cfg);
    append(`✓ loaded "${selectedProfile}"`);
  };

  const onDeleteProfile = async () => {
    if (!selectedProfile || !profiles[selectedProfile]) return;
    const next = { ...profiles };
    delete next[selectedProfile];
    await persistProfiles(next);
    append(`■ deleted "${selectedProfile}"`);
    setSelectedProfile("");
  };

  const onExportProfiles = () => {
    // Export raw stored form (encrypted if vault is set).
    const raw = localStorage.getItem(PROFILES_KEY) ?? JSON.stringify(profiles);
    const blob = new Blob([raw], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ghost-send-profiles-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    append(`⇡ exported profiles${vaultPass ? " (encrypted)" : ""}`);
  };

  const onImportProfiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then(async (txt) => {
      try {
        const parsed = JSON.parse(txt);
        if (isEncryptedBlob(parsed)) {
          if (!vaultPass) { append("✗ vault password required to import encrypted file"); return; }
          const decoded = await decryptJSON<Record<string, StoredConfig>>(parsed, vaultPass);
          await persistProfiles({ ...profiles, ...decoded });
          append(`⇣ imported ${Object.keys(decoded).length} encrypted profile(s)`);
        } else {
          await persistProfiles({ ...profiles, ...parsed });
          append(`⇣ imported ${Object.keys(parsed).length} profile(s)`);
        }
      } catch {
        append("✗ invalid or wrong-password config file");
      }
    });
    e.target.value = "";
  };

  const wait = async (ms: number) => {
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        waitAbortersRef.current.delete(abort);
        resolve();
      }, ms);
      const abort = () => {
        clearTimeout(t);
        waitAbortersRef.current.delete(abort);
        resolve();
      };
      waitAbortersRef.current.add(abort);
    });
  };

  const abortAll = () => {
    stopRef.current = true;
    for (const a of Array.from(waitAbortersRef.current)) a();
    append("■ ABORT REQUESTED");
  };

  const updateTarget = (id: string, patch: Partial<Target>) =>
    setTargets((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const addTarget = () => setTargets((ts) => [...ts, newTarget()]);
  const removeTarget = (id: string) =>
    setTargets((ts) => (ts.length > 1 ? ts.filter((t) => t.id !== id) : ts));

  const onLoadEmojis = async () => {
    if (!token.trim()) { append("✗ TOKEN REQUIRED to fetch emojis"); return; }
    setEmojisLoading(true);
    append("⇣ scanning guilds for custom emojis...");
    try {
      const res = await loadEmojis({ data: { token, isBot } });
      if (res.ok) {
        setEmojiMap(res.map);
        append(`✓ loaded ${res.emojiCount} emoji(s) from ${res.guildCount} guild(s)`);
      } else {
        append(`✗ emoji scan → ${res.status}: ${res.error.slice(0, 80)}`);
      }
    } catch (err) {
      append(`✗ ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setEmojisLoading(false);
    }
  };

  const runDiscordCampaign = async (t: Target) => {
    const tag = t.name.trim() || `#${t.channelId.slice(-6)}`;
    const preset = STEALTH[stealth];
    do {
      if (stopRef.current) break;
      const tMs = preset.humanTyping ? humanTypingMs(t.message) : 1500;
      if (preset.typing) append(`✎ [${tag}] typing (~${(tMs / 1000).toFixed(1)}s)`);
      try {
        const res = await send({
          data: {
            token, channelId: t.channelId, message: t.message, isBot,
            typing: preset.typing, typingMs: tMs,
            simulateRead: preset.simulateRead,
            emojiMap: Object.keys(emojiMap).length ? emojiMap : undefined,
          },
        });
        if (res.ok) {
          setStats((s) => ({ ...s, sent: s.sent + 1 }));
          append(`✓ [${tag}] sent`);
        } else {
          setStats((s) => ({ ...s, failed: s.failed + 1 }));
          append(`✗ [${tag}] ${res.status}: ${res.error.slice(0, 80)}`);
          if (res.status === 429) {
            const backoff = Math.max(30000, Math.round((res.retryAfter ?? 30) * 1000));
            append(`⏸ [${tag}] rate limit · cooling ${(backoff / 1000).toFixed(0)}s`);
            await wait(backoff);
          } else if (res.status === 401 || res.status === 403) {
            append(`■ [${tag}] token invalid/forbidden — aborting all`);
            stopRef.current = true;
            for (const a of Array.from(waitAbortersRef.current)) a();
            return;
          }
        }
      } catch (err) {
        setStats((s) => ({ ...s, failed: s.failed + 1 }));
        append(`✗ [${tag}] ${err instanceof Error ? err.message : String(err)}`);
      }
      if (!t.loop || stopRef.current) break;
      const baseMs = Math.max(1000, t.delaySec * 1000);
      const w = jitter(baseMs, preset.jitterPct);
      append(`⏱ [${tag}] next in ${(w / 1000).toFixed(1)}s`);
      await wait(w);
    } while (t.loop && !stopRef.current);
    append(`■ [${tag}] stopped`);
  };

  const onStartDiscord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (running) return;
    if (!token.trim()) { append("✗ TOKEN REQUIRED"); return; }
    let valid = targets.filter((t) => t.channelId.trim() && t.message.trim());
    if (valid.length === 0) { append("✗ ADD AT LEAST ONE CAMPAIGN"); return; }
    const preset = STEALTH[stealth];
    if (preset.shuffle) valid = shuffle(valid);
    setRunning(true);
    stopRef.current = false;
    setStats({ sent: 0, failed: 0 });
    append(`▶ launching ${valid.length} discord campaign(s) · stealth: ${preset.label}${preset.shuffle ? " · shuffled" : ""}`);
    try {
      await Promise.all(valid.map((t) => runDiscordCampaign(t)));
      append("■ all discord campaigns stopped");
    } finally {
      setRunning(false);
      stopRef.current = false;
    }
  };

  const runRoblox = async () => {
    const preset = STEALTH[stealth];
    const tag = `roblox·${rbRecipient.slice(-6)}`;
    do {
      if (stopRef.current) break;
      try {
        const res = await sendPM({
          data: { cookie: rbCookie, recipientId: rbRecipient, subject: rbSubject, body: rbBody },
        });
        if (res.ok) {
          setStats((s) => ({ ...s, sent: s.sent + 1 }));
          append(`✓ [${tag}] PM sent`);
        } else {
          setStats((s) => ({ ...s, failed: s.failed + 1 }));
          append(`✗ [${tag}] ${res.status}: ${res.error.slice(0, 100)}`);
          if (res.status === 401 || res.status === 403) {
            append(`■ [${tag}] cookie invalid — aborting`);
            stopRef.current = true;
            for (const a of Array.from(waitAbortersRef.current)) a();
            return;
          }
          if (res.status === 429) await wait(60000);
        }
      } catch (err) {
        setStats((s) => ({ ...s, failed: s.failed + 1 }));
        append(`✗ [${tag}] ${err instanceof Error ? err.message : String(err)}`);
      }
      if (!rbLoop || stopRef.current) break;
      const w = jitter(Math.max(5000, rbDelay * 1000), preset.jitterPct);
      append(`⏱ [${tag}] next in ${(w / 1000).toFixed(1)}s`);
      await wait(w);
    } while (rbLoop && !stopRef.current);
    append(`■ [${tag}] stopped`);
  };

  const onStartRoblox = async (e: React.FormEvent) => {
    e.preventDefault();
    if (running) return;
    if (!rbCookie.trim()) { append("✗ .ROBLOSECURITY REQUIRED"); return; }
    if (!/^\d{3,20}$/.test(rbRecipient)) { append("✗ recipient user id must be numeric"); return; }
    if (!rbBody.trim()) { append("✗ body required"); return; }
    setRunning(true);
    stopRef.current = false;
    setStats({ sent: 0, failed: 0 });
    append(`▶ launching roblox campaign · stealth: ${STEALTH[stealth].label}`);
    try {
      await runRoblox();
    } finally {
      setRunning(false);
      stopRef.current = false;
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0 grid-bg opacity-40" />
      <div className="relative mx-auto max-w-6xl px-6 py-10">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.3em] text-primary">
              <span className="inline-block h-2 w-2 rounded-full bg-primary animate-pulse-neon" />
              signal//outbound
            </div>
            <h1 className="mt-2 font-display text-5xl font-bold tracking-tight text-glow">
              GHOST<span className="text-primary">.</span>SEND
            </h1>
            <p className="mt-2 max-w-lg font-mono text-xs text-muted-foreground">
              multi-platform dispatcher · encrypted vault · human-behavior emulation · rotating fingerprints
            </p>
          </div>
          <div className="flex items-center gap-3 font-mono text-xs">
            <Stat label="sent" value={stats.sent} tone="neon" />
            <Stat label="fail" value={stats.failed} tone="danger" />
            <StatusPill running={running} />
          </div>
        </header>

        {/* TAB BAR */}
        <div className="mt-8 flex gap-1 border-b border-border font-mono text-xs uppercase tracking-wider">
          {(["discord", "roblox", "snapchat"] as Tab[]).map((k) => {
            const active = tab === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                className={`relative px-4 py-2.5 transition-colors ${
                  active
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {k}
                {active && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-primary shadow-[0_0_10px_var(--color-primary)]" />}
              </button>
            );
          })}
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1.2fr_1fr]">
          <div className="space-y-6">
            {/* VAULT / CONFIG (shared across tabs) */}
            <Panel
              label={`00 // vault [${Object.keys(profiles).length}]${vaultLocked ? " · LOCKED" : vaultPass ? " · encrypted" : " · plaintext"}`}
              action={
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onExportProfiles}
                    disabled={Object.keys(profiles).length === 0 && !vaultLocked}
                    className="rounded-sm border border-accent/40 bg-accent/10 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-accent transition-colors hover:bg-accent/20 disabled:opacity-40"
                  >
                    ⇡ export
                  </button>
                  <label className="cursor-pointer rounded-sm border border-accent/40 bg-accent/10 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-accent transition-colors hover:bg-accent/20">
                    ⇣ import
                    <input type="file" accept="application/json" onChange={onImportProfiles} className="hidden" />
                  </label>
                </div>
              }
            >
              <p className="mb-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
                set a vault password to encrypt saved profiles (AES-GCM · PBKDF2 210k). without a password, profiles are stored in plain text.
              </p>
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <input
                  type="password"
                  value={vaultPass}
                  onChange={(e) => setVaultPass(e.target.value)}
                  placeholder="vault password (optional but recommended)"
                  className="rounded-sm border border-border bg-input px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary"
                />
                <button
                  type="button"
                  onClick={onUnlockVault}
                  className="rounded-sm border border-primary/40 bg-primary/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-primary transition-colors hover:bg-primary/20"
                >
                  {vaultLocked ? "⚿ unlock" : "⚿ apply"}
                </button>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                <input
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  placeholder="new profile name"
                  className="rounded-sm border border-border bg-input px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary"
                />
                <label className="flex items-center gap-2 rounded-sm border border-border bg-input px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={includeToken}
                    onChange={(e) => setIncludeToken(e.target.checked)}
                    className="accent-primary"
                  />
                  incl. secrets
                </label>
                <button
                  type="button"
                  onClick={onSaveProfile}
                  disabled={vaultLocked}
                  className="rounded-sm border border-primary/40 bg-primary/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-primary transition-colors hover:bg-primary/20 disabled:opacity-40"
                >
                  ▤ save
                </button>
              </div>
              {Object.keys(profiles).length > 0 && !vaultLocked && (
                <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                  <select
                    value={selectedProfile}
                    onChange={(e) => setSelectedProfile(e.target.value)}
                    className="rounded-sm border border-border bg-input px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary"
                  >
                    <option value="">— select profile —</option>
                    {Object.keys(profiles).map((n) => (
                      <option key={n} value={n}>
                        {n}{profiles[n].savedToken || profiles[n].roblox?.cookie ? " ⚿" : ""} · {profiles[n].targets.length} target(s)
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={onLoadProfile}
                    disabled={!selectedProfile}
                    className="rounded-sm border border-primary/40 bg-primary/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-primary transition-colors hover:bg-primary/20 disabled:opacity-40"
                  >
                    ↻ load
                  </button>
                  <button
                    type="button"
                    onClick={onDeleteProfile}
                    disabled={!selectedProfile}
                    className="rounded-sm border border-destructive/40 bg-destructive/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-40"
                  >
                    ✕ delete
                  </button>
                </div>
              )}
              {vaultLocked && (
                <p className="mt-2 font-mono text-[10px] leading-relaxed text-warn">
                  ⚿ profiles are encrypted — enter password and click unlock to access.
                </p>
              )}
              {includeToken && !vaultPass && (
                <p className="mt-2 font-mono text-[10px] leading-relaxed text-warn">
                  ⚠ secrets will be stored in plaintext. set a vault password to encrypt.
                </p>
              )}
            </Panel>

            {/* STEALTH — shared */}
            <Panel label="stealth level (applies to all tabs)">
              <div className="grid gap-2 sm:grid-cols-3">
                {(Object.keys(STEALTH) as StealthLevel[]).map((k) => {
                  const p = STEALTH[k];
                  const active = stealth === k;
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setStealth(k)}
                      className={`rounded-md border p-3 text-left transition-all ${
                        active
                          ? "border-primary bg-primary/10 shadow-[0_0_20px_-8px_var(--color-primary)]"
                          : "border-border bg-input/50 hover:border-primary/40"
                      }`}
                    >
                      <div className={`font-mono text-sm font-bold ${active ? "text-primary" : "text-foreground"}`}>{p.label}</div>
                      <div className="mt-1 font-mono text-[10px] leading-snug text-muted-foreground">{p.blurb}</div>
                    </button>
                  );
                })}
              </div>
            </Panel>

            {/* DISCORD TAB */}
            {tab === "discord" && (
              <form onSubmit={onStartDiscord} className="space-y-6">
                <Panel label="01 // discord auth">
                  <div className="flex gap-2">
                    <TokenTypeButton active={isBot} onClick={() => setIsBot(true)} label="BOT" hint="recommended" />
                    <TokenTypeButton active={!isBot} onClick={() => setIsBot(false)} label="USER" hint="ToS risk" />
                  </div>
                  <label className="mt-4 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">token</label>
                  <input
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-input px-3 py-2 font-mono text-sm text-foreground outline-none transition-colors focus:border-primary focus:shadow-[0_0_0_1px_var(--color-primary)]"
                    placeholder="•••••••••••••••••••"
                  />
                </Panel>

                <Panel
                  label={`02 // discord campaigns [${targets.length}]`}
                  action={
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={onLoadEmojis}
                        disabled={emojisLoading}
                        className="rounded-sm border border-accent/40 bg-accent/10 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
                        title="Fetch custom emojis (Nitro needed for cross-server with user token)"
                      >
                        {emojisLoading ? "⇣ scanning..." : Object.keys(emojiMap).length > 0 ? `☺ ${Object.keys(emojiMap).length} emoji` : "⇣ load emoji"}
                      </button>
                      <button
                        type="button"
                        onClick={addTarget}
                        className="rounded-sm border border-primary/40 bg-primary/10 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-primary transition-colors hover:bg-primary/20"
                      >
                        + add campaign
                      </button>
                    </div>
                  }
                >
                  <p className="mb-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
                    each campaign runs independently. use <span className="text-accent">:emoji_name:</span> — resolves after loading.
                  </p>
                  <div className="space-y-3">
                    {targets.map((t, i) => (
                      <div key={t.id} className="group relative rounded-md border border-border bg-background/40 p-3 transition-colors hover:border-primary/40">
                        <div className="mb-2 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[10px] uppercase tracking-wider text-primary">#{String(i + 1).padStart(2, "0")}</span>
                            <input
                              value={t.name}
                              onChange={(e) => updateTarget(t.id, { name: e.target.value })}
                              className="rounded-sm border border-transparent bg-transparent px-1 py-0.5 font-mono text-xs text-foreground outline-none hover:border-border focus:border-primary"
                              placeholder="campaign name"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => removeTarget(t.id)}
                            disabled={targets.length === 1}
                            className="font-mono text-[10px] uppercase tracking-wider text-destructive opacity-0 transition-opacity hover:underline disabled:opacity-0 group-hover:opacity-100"
                          >
                            purge
                          </button>
                        </div>
                        <label className="block font-mono text-[9px] uppercase tracking-wider text-muted-foreground">channel id</label>
                        <input
                          value={t.channelId}
                          onChange={(e) => updateTarget(t.id, { channelId: e.target.value })}
                          className="mt-1 w-full rounded-sm border border-border bg-input px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary"
                          placeholder="e.g. 123456789012345678"
                        />
                        <label className="mt-2 block font-mono text-[9px] uppercase tracking-wider text-muted-foreground">message</label>
                        <textarea
                          value={t.message}
                          onChange={(e) => updateTarget(t.id, { message: e.target.value })}
                          rows={2}
                          className="mt-1 w-full resize-none rounded-sm border border-border bg-input px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary"
                          placeholder="what to send..."
                        />
                        <div className="mt-2 grid grid-cols-[1fr_auto] items-end gap-3">
                          <div>
                            <label className="block font-mono text-[9px] uppercase tracking-wider text-muted-foreground">delay before next send (seconds)</label>
                            <input
                              type="number"
                              min={1}
                              value={t.delaySec}
                              onChange={(e) => updateTarget(t.id, { delaySec: Math.max(1, Number(e.target.value) || 1) })}
                              className="mt-1 w-full rounded-sm border border-border bg-input px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary"
                            />
                          </div>
                          <label className="flex items-center gap-2 rounded-sm border border-border bg-input px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                            <input type="checkbox" checked={t.loop} onChange={(e) => updateTarget(t.id, { loop: e.target.checked })} className="accent-primary" />
                            loop
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                </Panel>

                <StartAbort running={running} onAbort={abortAll} label="▶ start discord campaigns" />
              </form>
            )}

            {/* ROBLOX TAB */}
            {tab === "roblox" && (
              <form onSubmit={onStartRoblox} className="space-y-6">
                <Panel label="01 // roblox auth">
                  <label className="block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">.ROBLOSECURITY cookie value</label>
                  <input
                    type="password"
                    value={rbCookie}
                    onChange={(e) => setRbCookie(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-input px-3 py-2 font-mono text-sm text-foreground outline-none focus:border-primary"
                    placeholder="_|WARNING:-DO-NOT-SHARE-THIS.--..."
                  />
                  <p className="mt-2 font-mono text-[10px] leading-relaxed text-warn">
                    ⚠ paste ONLY the value of the .ROBLOSECURITY cookie (from your browser devtools). violates Roblox ToS.
                  </p>
                </Panel>

                <Panel label="02 // roblox private message">
                  <label className="block font-mono text-[9px] uppercase tracking-wider text-muted-foreground">recipient user id (numeric)</label>
                  <input
                    value={rbRecipient}
                    onChange={(e) => setRbRecipient(e.target.value.replace(/\D/g, ""))}
                    className="mt-1 w-full rounded-sm border border-border bg-input px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary"
                    placeholder="e.g. 1234567"
                  />
                  <label className="mt-3 block font-mono text-[9px] uppercase tracking-wider text-muted-foreground">subject</label>
                  <input
                    value={rbSubject}
                    onChange={(e) => setRbSubject(e.target.value)}
                    className="mt-1 w-full rounded-sm border border-border bg-input px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary"
                    placeholder="optional subject"
                  />
                  <label className="mt-3 block font-mono text-[9px] uppercase tracking-wider text-muted-foreground">body</label>
                  <textarea
                    value={rbBody}
                    onChange={(e) => setRbBody(e.target.value)}
                    rows={3}
                    className="mt-1 w-full resize-none rounded-sm border border-border bg-input px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary"
                    placeholder="message content (goes through roblox chat filter)"
                  />
                  <div className="mt-3 grid grid-cols-[1fr_auto] items-end gap-3">
                    <div>
                      <label className="block font-mono text-[9px] uppercase tracking-wider text-muted-foreground">delay before next send (seconds)</label>
                      <input
                        type="number"
                        min={5}
                        value={rbDelay}
                        onChange={(e) => setRbDelay(Math.max(5, Number(e.target.value) || 5))}
                        className="mt-1 w-full rounded-sm border border-border bg-input px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary"
                      />
                    </div>
                    <label className="flex items-center gap-2 rounded-sm border border-border bg-input px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      <input type="checkbox" checked={rbLoop} onChange={(e) => setRbLoop(e.target.checked)} className="accent-primary" />
                      loop
                    </label>
                  </div>
                  <p className="mt-3 rounded-md border border-warn/30 bg-warn/5 p-2 font-mono text-[10px] leading-relaxed text-warn">
                    ⚠ EXPERIMENTAL — roblox private-message API is legacy and may return errors. use low volume.
                  </p>
                </Panel>

                <StartAbort running={running} onAbort={abortAll} label="▶ start roblox campaign" />
              </form>
            )}

            {/* SNAPCHAT TAB */}
            {tab === "snapchat" && (
              <Panel label="01 // snapchat">
                <div className="space-y-3 font-mono text-xs text-muted-foreground">
                  <p className="text-warn">✗ NOT SUPPORTED</p>
                  <p>
                    snapchat has <span className="text-foreground">no public API</span> for sending snaps or messages from an account. their Snap Kit only handles inbound sharing via the official app — it cannot automate outgoing messages.
                  </p>
                  <p>
                    reverse-engineered client libraries (snapchat-web etc.) are dead/blocked within days. an automated snap sender is not something this app can host.
                  </p>
                  <p className="text-muted-foreground/60">
                    alternative: use snap ads api / snap kit share for legitimate campaigns from a business account, but that requires official approval and is a different product.
                  </p>
                </div>
              </Panel>
            )}
          </div>

          {/* RIGHT COLUMN — TERMINAL */}
          <aside className="lg:sticky lg:top-6 lg:self-start">
            <div className="scanlines overflow-hidden rounded-md border border-border bg-background/80 shadow-[var(--shadow-panel)]">
              <div className="flex items-center justify-between border-b border-border bg-secondary/60 px-3 py-2">
                <div className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-destructive/70" />
                  <span className="h-2.5 w-2.5 rounded-full bg-warn/70" />
                  <span className="h-2.5 w-2.5 rounded-full bg-primary/70" />
                </div>
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">~ /ghost/session.log</span>
              </div>
              <ul className="h-[520px] overflow-auto p-4 font-mono text-[11px] leading-relaxed">
                {log.length === 0 && (
                  <li className="text-muted-foreground">
                    <span className="text-primary">$</span> awaiting command<span className="animate-blink">_</span>
                  </li>
                )}
                {log.map((line, i) => (
                  <li key={i} className={logColor(line)}>{line}</li>
                ))}
              </ul>
            </div>
            <p className="mt-4 rounded-md border border-warn/30 bg-warn/5 p-3 font-mono text-[10px] leading-relaxed text-warn">
              ⚠ DISCLAIMER: no anti-detect is 100%. platforms track IP, device fingerprint, behavioral patterns. user tokens/cookies violate their ToS.
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}

function StartAbort({ running, onAbort, label }: { running: boolean; onAbort: () => void; label: string }) {
  return (
    <div className="flex gap-2">
      <button
        type="submit"
        disabled={running}
        className="group relative flex-1 overflow-hidden rounded-md border border-primary bg-primary/10 px-6 py-3 font-mono text-sm font-bold uppercase tracking-[0.2em] text-primary transition-all hover:bg-primary hover:text-primary-foreground disabled:opacity-50"
      >
        <span className="relative z-10">{running ? "▮▮ running..." : label}</span>
        {!running && (
          <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-primary/40 to-transparent transition-transform duration-1000 group-hover:translate-x-full" />
        )}
      </button>
      {running && (
        <button
          type="button"
          onClick={onAbort}
          className="rounded-md border border-destructive bg-destructive/10 px-4 py-3 font-mono text-sm font-bold uppercase tracking-wider text-destructive hover:bg-destructive hover:text-destructive-foreground"
        >
          ■ abort
        </button>
      )}
    </div>
  );
}

function logColor(line: string) {
  if (line.includes("✓")) return "text-primary";
  if (line.includes("✗") || line.includes("ABORT")) return "text-destructive";
  if (line.includes("⏸") || line.includes("☕") || line.includes("⏱") || line.includes("⚠")) return "text-warn";
  if (line.includes("✎") || line.includes("↷") || line.includes("⚿")) return "text-accent";
  if (line.includes("──") || line.includes("▶") || line.includes("■")) return "text-primary/80";
  return "text-muted-foreground";
}

function Panel({ label, action, children }: { label: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-border bg-card/60 p-5 backdrop-blur-sm shadow-[var(--shadow-panel)]">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.25em] text-primary">{label}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function TokenTypeButton({ active, onClick, label, hint }: { active: boolean; onClick: () => void; label: string; hint: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-md border px-4 py-3 text-left transition-all ${
        active ? "border-primary bg-primary/10 shadow-[0_0_20px_-8px_var(--color-primary)]" : "border-border bg-input/50 hover:border-primary/40"
      }`}
    >
      <div className={`font-mono text-sm font-bold ${active ? "text-primary" : "text-foreground"}`}>{label}</div>
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{hint}</div>
    </button>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "neon" | "danger" }) {
  return (
    <div className={`rounded-sm border px-3 py-2 text-right ${tone === "neon" ? "border-primary/30 bg-primary/5" : "border-destructive/30 bg-destructive/5"}`}>
      <div className={`font-mono text-lg font-bold leading-none ${tone === "neon" ? "text-primary" : "text-destructive"}`}>{String(value).padStart(3, "0")}</div>
      <div className="mt-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

function StatusPill({ running }: { running: boolean }) {
  const s = running
    ? { label: "RUNNING", color: "text-primary border-primary/40 bg-primary/10" }
    : { label: "STANDBY", color: "text-muted-foreground border-border" };
  return (
    <div className={`rounded-sm border px-3 py-2 font-mono text-[10px] uppercase tracking-wider ${s.color}`}>
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-current mr-1.5 animate-pulse" />
      {s.label}
    </div>
  );
}