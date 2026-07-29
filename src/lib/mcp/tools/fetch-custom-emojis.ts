import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

export default defineTool({
  name: "fetch_custom_emojis",
  title: "Fetch custom emojis",
  description:
    "Fetch all custom emojis from every guild the bot token can see. Returns a name->markup map usable in Discord messages.",
  inputSchema: {
    token: z.string().min(10).describe("Discord bot token."),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async ({ token }) => {
    const auth = `Bot ${token}`;
    const gr = await fetch("https://discord.com/api/v10/users/@me/guilds", {
      headers: { Authorization: auth },
    });
    if (!gr.ok) {
      return {
        content: [{ type: "text", text: `Discord error ${gr.status}: ${(await gr.text()).slice(0, 300)}` }],
        isError: true,
      };
    }
    const guilds = (await gr.json()) as Array<{ id: string; name: string }>;
    const map: Record<string, { id: string; animated: boolean; markup: string; guild: string }> = {};
    for (const g of guilds) {
      const er = await fetch(`https://discord.com/api/v10/guilds/${g.id}/emojis`, {
        headers: { Authorization: auth },
      });
      if (!er.ok) {
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }
      const emojis = (await er.json()) as Array<{ id: string; name: string; animated: boolean }>;
      for (const e of emojis) {
        if (!e.id || !e.name || map[e.name]) continue;
        map[e.name] = {
          id: e.id,
          animated: !!e.animated,
          markup: `<${e.animated ? "a" : ""}:${e.name}:${e.id}>`,
          guild: g.name,
        };
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    return {
      content: [{ type: "text", text: `Found ${Object.keys(map).length} emojis across ${guilds.length} guilds.` }],
      structuredContent: { emojis: map },
    };
  },
});