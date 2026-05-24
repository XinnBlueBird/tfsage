import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIMO_ENDPOINT = "https://token-plan-sgp.xiaomimimo.com/v1/chat/completions";

export async function POST(req: NextRequest) {
  const apiKey = process.env.MIMO_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "MIMO_API_KEY not configured" }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }

  const body = await req.json();
  const plan: string = body?.plan ?? "";
  const env: string = body?.env ?? "production";

  if (!plan || plan.length > 60000) {
    return new Response(
      JSON.stringify({ error: "plan missing or too large (>60k chars)" }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  const systemPrompt = `You are a senior platform engineer reviewing a "terraform plan" output before apply. The user is targeting environment: ${env}.

Analyze the plan and produce a blast-radius assessment. Focus on:

1. DESTRUCTIVE CHANGES — resources being destroyed, replaced, or recreated
2. STATE-RISK — drops or rebuilds of stateful resources (databases, volumes, queues, buckets)
3. SECURITY — IAM policy changes, security group rules opening ports, public-access toggles, secret exposure
4. NETWORKING — DNS changes, route table edits, NAT/VPC peering, load-balancer swaps
5. COST — large instance changes, GPU additions, NAT gateway / data-transfer adds
6. SCOPE DRIFT — unexpected resources outside the change's apparent goal
7. UNVERIFIED — placeholders, "(known after apply)" on critical fields

Return STRICT JSON, no markdown:
{
  "summary": "2-3 sentence verdict",
  "blast_radius": "minor" | "moderate" | "severe" | "critical",
  "score": 0-100,
  "verdict": "safe_to_apply" | "review_required" | "do_not_apply",
  "stats": {
    "to_add": <n>,
    "to_change": <n>,
    "to_destroy": <n>,
    "to_replace": <n>
  },
  "risks": [
    {
      "severity": "critical" | "high" | "medium" | "low",
      "category": "destructive" | "state" | "security" | "networking" | "cost" | "scope" | "unverified",
      "resource": "<resource address>",
      "title": "short title",
      "description": "what is happening and why it matters",
      "mitigation": "concrete steps to mitigate, including code/cmds where possible"
    }
  ],
  "noteworthy": ["lines worth eyeballing manually"],
  "checklist": ["pre-apply actions, in priority order"]
}`;

  const userPrompt = `Environment: ${env}\n\nterraform plan output:\n\`\`\`\n${plan}\n\`\`\`\n\nReturn the JSON now.`;

  const upstream = await fetch(MIMO_ENDPOINT, {
    method: "POST",
    headers: { "api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({
      model: "mimo-v2.5-pro",
      stream: true,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const txt = await upstream.text().catch(() => "");
    return new Response(
      JSON.stringify({ error: `mimo upstream ${upstream.status}: ${txt.slice(0, 300)}` }),
      { status: 502, headers: { "content-type": "application/json" } }
    );
  }

  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstream.body!.getReader();
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      let buf = "";

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";

          for (const raw of lines) {
            const line = raw.trim();
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (payload === "[DONE]") {
              controller.enqueue(encoder.encode("event: done\ndata: [DONE]\n\n"));
              continue;
            }
            try {
              const json = JSON.parse(payload);
              const delta = json?.choices?.[0]?.delta ?? {};
              const reasoning = delta?.reasoning_content ?? "";
              const content = delta?.content ?? "";
              if (reasoning) {
                controller.enqueue(
                  encoder.encode(`event: reasoning\ndata: ${JSON.stringify(reasoning)}\n\n`)
                );
              }
              if (content) {
                controller.enqueue(
                  encoder.encode(`event: content\ndata: ${JSON.stringify(content)}\n\n`)
                );
              }
            } catch {}
          }
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "connection": "keep-alive",
    },
  });
}
