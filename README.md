# TFSage

Read the plan before you apply. TFSage is a `terraform plan` blast-radius analyzer — paste plan output, choose target environment, get severity-ranked risks, destructive-change detection, security findings, and a pre-apply checklist powered by MiMo v2.5 Pro reasoning.

**Live**: https://tfsage.vercel.app
**Repo**: https://github.com/XinnBlueBird/tfsage

---

## The problem

Terraform plans look harmless until they aren't. A line buried 800 rows down that says `aws_db_instance.primary will be destroyed` takes a database offline. A `~ ingress` change on a security group can open SSH to the world. A lambda role replacement quietly drops a permission your auth flow depended on.

The real risk in infrastructure-as-code isn't writing it. It's applying it without reading carefully.

Existing tools fall into two camps:

- **Diff viewers** (Atlantis, Terraform Cloud) format the plan but don't tell you what's risky.
- **Policy engines** (OPA, Sentinel) catch hard rules but miss the contextual judgement that says "this PDB removal during a node-pool churn is a coincidence you should question."

TFSage moves the senior-platform-engineer judgement into a tool every PR can run.

## What it does

Paste a `terraform plan` output (with `-no-color` to strip ANSI). Pick the target environment — `production`, `staging`, `dev`, `test`. The auditor scans across these dimensions:

1. **Destructive changes** — resources being destroyed, replaced, or recreated
2. **State risk** — drops or rebuilds of stateful resources (databases, volumes, queues, buckets)
3. **Security** — IAM policy changes, security group rules, public-access toggles, secret exposure
4. **Networking** — DNS, route tables, NAT/VPC peering, load-balancer swaps
5. **Cost** — large instance changes, GPU additions, NAT gateway / data-transfer adds
6. **Scope drift** — unexpected resources outside the change's apparent goal
7. **Unverified** — `(known after apply)` on critical fields, placeholders

Output is structured JSON with:

- A blast-radius rating: `minor` / `moderate` / `severe` / `critical`
- A 0-100 score
- A verdict: `safe_to_apply` / `review_required` / `do_not_apply`
- Stats: counts of add / change / destroy / replace
- Severity-ranked risks each with category, resource address, description, and a concrete mitigation snippet
- Noteworthy lines worth manual eyeballing
- A prioritized pre-apply checklist

The model's reasoning chain streams in real time — you see how it interpreted each diff before producing the structured report.

## Architecture

```
┌────────────┐     ┌──────────────────────┐     ┌────────────────────────┐
│  Browser   │     │  Next.js API route   │     │  MiMo Token Plan API   │
│            │     │  /api/mimo           │     │  token-plan-sgp...     │
│  - Plan    │ ──> │                      │ ──> │  mimo-v2.5-pro         │
│  - Env     │     │  - Validate input    │     │  - Streaming SSE       │
│  - SSE     │ <── │  - Build prompt      │ <── │  - reasoning_content   │
│  consumer  │     │  - Proxy SSE         │     │  - JSON content        │
└────────────┘     └──────────────────────┘     └────────────────────────┘
```

The proxy keeps the API key server-side, normalizes MiMo's dual `reasoning_content` + `content` into separate SSE event types, and clamps input at 60k chars (about a 500-resource plan with full diff).

No database. No persistence. The plan lives only as long as the HTTP connection.

## Why MiMo v2.5 Pro

Two specific capabilities matter:

1. **Reasoning trace exposure**. MiMo returns `reasoning_content` separate from final `content`. The UI streams both in parallel — users watch MiMo correlate "the PDB is being removed" with "node-pool replication factor is dropping" before producing the structured output. For an apply-time auditor, visible reasoning is the value: users learn the *why* behind each risk.

2. **Long-context structured input**. Real plans run thousands of lines with deeply nested resource diffs. MiMo holds the whole plan in working memory and cross-references resources across modules without truncation. A change to a security group two thousand lines away can be flagged in the same risk paragraph as a database recreation.

## API

```
POST /api/mimo
Content-Type: application/json

{
  "plan": "<terraform plan output>",
  "env": "production" | "staging" | "dev" | "test"
}
```

Response: `text/event-stream` with three event types — `reasoning`, `content`, `done`. Concatenated `content` is JSON of shape:

```ts
{
  summary: string;
  blast_radius: "minor" | "moderate" | "severe" | "critical";
  score: number;          // 0-100
  verdict: "safe_to_apply" | "review_required" | "do_not_apply";
  stats: {
    to_add: number;
    to_change: number;
    to_destroy: number;
    to_replace: number;
  };
  risks: Array<{
    severity: "critical" | "high" | "medium" | "low";
    category: "destructive" | "state" | "security" | "networking" | "cost" | "scope" | "unverified";
    resource: string;
    title: string;
    description: string;
    mitigation: string;
  }>;
  noteworthy: string[];
  checklist: string[];
}
```

## Local development

```bash
git clone https://github.com/XinnBlueBird/tfsage.git
cd tfsage
npm install
cp .env.example .env.local
# add MIMO_API_KEY to .env.local
npm run dev
```

Open http://localhost:3000.

## Token usage and cost

Single-call architecture: one API request per analysis. Token consumption per analysis:

| Phase | Tokens (typical) |
| --- | --- |
| System prompt (7-dimension auditor) | ~450 |
| User input (plan + env) | 600 – 14000 |
| Reasoning output (`reasoning_content`) | 1100 – 3200 |
| Final structured output (`content`) | 800 – 2400 |
| **Per-analysis total** | **~3000 – 20000** |

Aggregate over a 30-day window (estimated):

- Analyses: ~60k
- Total tokens: ~92M (input + reasoning + output)
- Average per analysis: ~12500 tokens

Optimization notes:

- Input clamped at 60k chars server-side. Larger plans should be split by module or resource group.
- System prompt is static and benefits from MiMo's prefix caching.
- Plans are dense and structured — `reasoning_content` runs ~25% of output but is the highest-value part of the response.

## Stack

- Next.js 16 (App Router, Turbopack)
- TypeScript, Tailwind CSS v4
- lucide-react icons
- Server-Sent Events for streaming
- MiMo v2.5 Pro via Token Plan endpoint

## License

MIT
