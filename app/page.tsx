"use client";

import { useState, useRef, useEffect } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  Sparkles,
  Brain,
  ChevronRight,
  Eraser,
  Boxes,
  Plus,
  Pencil,
  Trash2,
  Recycle,
  ListTree,
  ShieldAlert,
  Network,
  DollarSign,
  AlertOctagon,
  Eye,
} from "lucide-react";

type Severity = "critical" | "high" | "medium" | "low";
type Category =
  | "destructive"
  | "state"
  | "security"
  | "networking"
  | "cost"
  | "scope"
  | "unverified";
type BlastRadius = "minor" | "moderate" | "severe" | "critical";
type Verdict = "safe_to_apply" | "review_required" | "do_not_apply";

type Risk = {
  severity: Severity;
  category: Category;
  resource: string;
  title: string;
  description: string;
  mitigation: string;
};

type Analysis = {
  summary: string;
  blast_radius: BlastRadius;
  score: number;
  verdict: Verdict;
  stats: {
    to_add: number;
    to_change: number;
    to_destroy: number;
    to_replace: number;
  };
  risks: Risk[];
  noteworthy: string[];
  checklist: string[];
};

const SAMPLE_PLAN = `Terraform will perform the following actions:

  # aws_db_instance.primary will be destroyed
  - resource "aws_db_instance" "primary" {
      - allocated_storage = 100
      - db_name           = "appdb"
      - engine            = "postgres"
      - engine_version    = "14.7"
      - identifier        = "prod-primary-db"
      - instance_class    = "db.r6g.xlarge"
      - multi_az          = true
      - skip_final_snapshot = false
    }

  # aws_security_group.web will be updated in-place
  ~ resource "aws_security_group" "web" {
        id          = "sg-08abc1234ef567890"
        name        = "web-sg"
      ~ ingress     = [
          + {
              + cidr_blocks = ["0.0.0.0/0"]
              + from_port   = 22
              + to_port     = 22
              + protocol    = "tcp"
            },
        ]
    }

  # aws_iam_role.lambda_exec must be replaced
-/+ resource "aws_iam_role" "lambda_exec" {
        ~ id                = "lambda-exec" -> (known after apply)
        ~ assume_role_policy = jsonencode({...}) -> jsonencode({...})
    }

  # aws_s3_bucket.public_assets will be created
  + resource "aws_s3_bucket" "public_assets" {
      + bucket = "myco-public-assets"
      + acl    = "public-read"
    }

Plan: 1 to add, 1 to change, 1 to destroy, 1 to replace.`;

const RADIUS_STYLE: Record<BlastRadius, { label: string; color: string; bg: string }> = {
  minor: { label: "MINOR", color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/30" },
  moderate: { label: "MODERATE", color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/30" },
  severe: { label: "SEVERE", color: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/30" },
  critical: { label: "CRITICAL", color: "text-rose-400", bg: "bg-rose-500/10 border-rose-500/30" },
};

const VERDICT_LABEL: Record<Verdict, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  safe_to_apply: { label: "Safe to apply", color: "text-emerald-400", icon: CheckCircle2 },
  review_required: { label: "Review required", color: "text-amber-400", icon: AlertTriangle },
  do_not_apply: { label: "Do not apply", color: "text-rose-400", icon: XCircle },
};

const SEVERITY_DOT: Record<Severity, string> = {
  critical: "bg-rose-500",
  high: "bg-orange-500",
  medium: "bg-amber-500",
  low: "bg-sky-500",
};

const CATEGORY_ICON: Record<Category, typeof Activity> = {
  destructive: Trash2,
  state: Boxes,
  security: ShieldAlert,
  networking: Network,
  cost: DollarSign,
  scope: ListTree,
  unverified: Eye,
};

export default function Home() {
  const [plan, setPlan] = useState(SAMPLE_PLAN);
  const [env, setEnv] = useState("production");
  const [reasoning, setReasoning] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reasoningRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reasoningRef.current) {
      reasoningRef.current.scrollTop = reasoningRef.current.scrollHeight;
    }
  }, [reasoning]);

  async function analyze() {
    if (!plan.trim() || loading) return;
    setLoading(true);
    setError(null);
    setReasoning("");
    setAnalysis(null);

    try {
      const res = await fetch("/api/mimo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan, env }),
      });

      if (!res.ok || !res.body) {
        const txt = await res.text();
        throw new Error(txt || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let acc = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const events = buf.split("\n\n");
        buf = events.pop() ?? "";

        for (const ev of events) {
          const lines = ev.split("\n");
          let evType = "message";
          let dataLines: string[] = [];
          for (const l of lines) {
            if (l.startsWith("event:")) evType = l.slice(6).trim();
            else if (l.startsWith("data:")) dataLines.push(l.slice(5).trim());
          }
          const data = dataLines.join("");
          if (!data || data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            if (evType === "reasoning") setReasoning((p) => p + parsed);
            else if (evType === "content") acc += parsed;
          } catch {}
        }
      }

      const cleaned = acc.replace(/^```json\n?|\n?```$/g, "").trim();
      const start = cleaned.indexOf("{");
      const end = cleaned.lastIndexOf("}");
      if (start >= 0 && end > start) {
        try {
          setAnalysis(JSON.parse(cleaned.slice(start, end + 1)));
        } catch {
          setError("MiMo returned non-JSON. Try again.");
        }
      } else {
        setError("No JSON in response.");
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "request failed");
    } finally {
      setLoading(false);
    }
  }

  const radius = analysis ? RADIUS_STYLE[analysis.blast_radius] : null;
  const verdict = analysis ? VERDICT_LABEL[analysis.verdict] : null;
  const VerdictIcon = verdict?.icon ?? CheckCircle2;

  return (
    <div className="min-h-screen text-zinc-100">
      <header className="border-b border-violet-900/30 bg-[#0c0a14]/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-gradient-to-br from-violet-600 to-fuchsia-600 flex items-center justify-center">
              <Boxes className="w-4 h-4 text-white" strokeWidth={2.5} />
            </div>
            <span className="font-semibold tracking-tight">TFSage</span>
            <span className="hidden sm:inline ml-3 text-xs text-violet-300/60">
              terraform plan blast-radius analyzer
            </span>
          </div>
          <span className="hidden sm:inline text-xs text-violet-300/40">MiMo v2.5 Pro</span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10">
        <section className="mb-8">
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight mb-3">
            Read the plan before you apply.
          </h1>
          <p className="text-sm text-violet-200/60 max-w-2xl">
            Paste a `terraform plan` output, choose the target environment, get a blast-radius
            score, destructive-change detection, security findings, and a pre-apply checklist.
          </p>
        </section>

        <section className="mb-6 rounded-xl border border-violet-900/40 bg-[#150f24]/60 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-violet-900/40 text-xs">
            <div className="flex items-center gap-3">
              <span className="text-violet-300/60">ENV</span>
              <select
                value={env}
                onChange={(e) => setEnv(e.target.value)}
                className="bg-[#0c0a14] border border-violet-900/40 rounded px-2 py-1 text-violet-100 focus:outline-none focus:border-violet-500"
              >
                <option value="production">production</option>
                <option value="staging">staging</option>
                <option value="dev">dev</option>
                <option value="test">test</option>
              </select>
            </div>
            <div className="flex items-center gap-3 text-violet-300/40">
              <span>{plan.length} chars</span>
              <button
                onClick={() => setPlan("")}
                className="flex items-center gap-1 text-violet-300/60 hover:text-violet-200"
              >
                <Eraser className="w-3 h-3" /> clear
              </button>
            </div>
          </div>
          <textarea
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
            spellCheck={false}
            placeholder="Paste your terraform plan output here..."
            className="w-full min-h-[340px] bg-[#0a0814] px-4 py-3 font-mono text-[12.5px] leading-relaxed text-violet-100 placeholder:text-violet-700 focus:outline-none resize-y"
          />
          <div className="px-4 py-3 border-t border-violet-900/40 flex items-center justify-between">
            <div className="text-xs text-violet-300/40">
              Tip: <code className="text-violet-200">terraform plan -no-color | tee plan.txt</code>
            </div>
            <button
              onClick={analyze}
              disabled={loading || !plan.trim()}
              className="text-sm px-4 py-1.5 rounded-md bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 disabled:from-zinc-800 disabled:to-zinc-800 disabled:text-zinc-500 transition flex items-center gap-2 font-medium text-white"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Analyzing
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" /> Sage it
                </>
              )}
            </button>
          </div>
        </section>

        {loading && (
          <section className="mb-4 rounded-xl border border-violet-900/40 bg-[#150f24]/60 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-violet-900/40 flex items-center gap-2 text-sm">
              <Brain className="w-4 h-4 text-violet-400" />
              <span>MiMo is reasoning</span>
              <span className="text-xs text-violet-300/40 ml-auto">
                {reasoning.length} chars streamed
              </span>
            </div>
            <div
              ref={reasoningRef}
              className="max-h-72 overflow-y-auto px-4 py-3 font-mono text-[12px] text-violet-200/70 leading-relaxed whitespace-pre-wrap"
            >
              {reasoning || (
                <span className="text-violet-700 italic">Waiting for first token...</span>
              )}
            </div>
          </section>
        )}

        {error && (
          <section className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-sm text-rose-300 flex items-start gap-2">
            <XCircle className="w-4 h-4 mt-0.5" /> {error}
          </section>
        )}

        {analysis && radius && verdict && (
          <section className="space-y-4">
            <div className={`rounded-xl border ${radius.bg} px-5 py-5`}>
              <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                  <span
                    className={`text-xs font-bold tracking-widest px-2 py-1 rounded border ${radius.bg} ${radius.color}`}
                  >
                    BLAST {radius.label}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <VerdictIcon className={`w-4 h-4 ${verdict.color}`} />
                    <span className={`text-sm font-medium ${verdict.color}`}>
                      {verdict.label}
                    </span>
                  </div>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-semibold tracking-tight">{analysis.score}</span>
                  <span className="text-xs text-violet-300/40">/100</span>
                </div>
              </div>
              <p className="text-sm text-violet-100 leading-relaxed">{analysis.summary}</p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard
                icon={Plus}
                label="To add"
                value={analysis.stats.to_add}
                color="text-emerald-400"
              />
              <StatCard
                icon={Pencil}
                label="To change"
                value={analysis.stats.to_change}
                color="text-amber-400"
              />
              <StatCard
                icon={Trash2}
                label="To destroy"
                value={analysis.stats.to_destroy}
                color="text-rose-400"
              />
              <StatCard
                icon={Recycle}
                label="To replace"
                value={analysis.stats.to_replace}
                color="text-fuchsia-400"
              />
            </div>

            <div>
              <p className="text-xs uppercase tracking-wide text-violet-300/40 mb-2 flex items-center gap-1">
                <ShieldAlert className="w-3 h-3" /> Risks
              </p>
              <div className="space-y-2.5">
                {analysis.risks.map((r, i) => {
                  const Icon = CATEGORY_ICON[r.category] ?? AlertOctagon;
                  return (
                    <div
                      key={i}
                      className="rounded-lg border border-violet-900/40 bg-[#150f24]/60 px-4 py-3"
                    >
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${SEVERITY_DOT[r.severity]} flex-shrink-0`}
                          />
                          <Icon className="w-3.5 h-3.5 text-violet-300/60 flex-shrink-0" />
                          <span className="text-xs uppercase tracking-wide text-violet-300/60">
                            {r.severity}
                          </span>
                          <span className="text-xs text-violet-300/40">·</span>
                          <span className="text-xs text-violet-300/40">{r.category}</span>
                        </div>
                      </div>
                      <code className="text-[11px] text-violet-300/70 font-mono break-all block mb-1.5">
                        {r.resource}
                      </code>
                      <p className="text-sm text-violet-100 font-medium mb-1">{r.title}</p>
                      <p className="text-xs text-violet-200/60 leading-relaxed mb-2">
                        {r.description}
                      </p>
                      <div className="border-t border-violet-900/40 pt-2 mt-2">
                        <p className="text-[10px] uppercase tracking-wide text-violet-300/40 mb-1 flex items-center gap-1">
                          <ChevronRight className="w-3 h-3" /> Mitigation
                        </p>
                        <pre className="text-xs text-violet-100 font-mono whitespace-pre-wrap leading-relaxed">
                          {r.mitigation}
                        </pre>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {analysis.noteworthy.length > 0 && (
              <div className="rounded-xl border border-violet-900/40 bg-[#150f24]/60 px-5 py-4">
                <p className="text-xs uppercase tracking-wide text-violet-300/40 mb-2 flex items-center gap-1">
                  <Eye className="w-3 h-3" /> Noteworthy
                </p>
                <ul className="space-y-1.5">
                  {analysis.noteworthy.map((n, i) => (
                    <li key={i} className="text-sm text-violet-200/80">
                      {n}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {analysis.checklist.length > 0 && (
              <div className="rounded-xl border border-violet-900/40 bg-[#150f24]/60 px-5 py-4">
                <p className="text-xs uppercase tracking-wide text-violet-300/40 mb-3 flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> Pre-apply checklist
                </p>
                <ol className="space-y-2">
                  {analysis.checklist.map((c, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-violet-100">
                      <span className="text-violet-400 font-mono text-xs mt-0.5">{i + 1}.</span>
                      <span>{c}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </section>
        )}

        <section id="about" className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-6 border-t border-violet-900/40 pt-10">
          <div className="md:col-span-2">
            <h2 className="text-lg font-semibold mb-2">About TFSage</h2>
            <p className="text-sm text-violet-200/60 leading-relaxed mb-3">
              Terraform plans look harmless until they aren&apos;t. A line buried 800 rows down
              that says <code className="text-violet-100 bg-[#150f24] px-1 rounded">aws_db_instance.primary will be destroyed</code> takes a database offline.
              A security group <code className="text-violet-100 bg-[#150f24] px-1 rounded">~ ingress</code> change can open SSH to the world. The
              real risk in infrastructure-as-code isn&apos;t writing it; it&apos;s applying it
              without reading it carefully.
            </p>
            <p className="text-sm text-violet-200/60 leading-relaxed mb-3">
              TFSage is a second pair of eyes. Paste a plan and target environment, and MiMo
              v2.5 Pro reads every diff, ranks risks by severity, flags state-mutating
              changes, security regressions, networking shifts, cost spikes, and unverified
              fields. The reasoning chain is visible while it works, so you understand the
              <em className="px-1">why</em> next to each finding.
            </p>
            <p className="text-sm text-violet-200/60 leading-relaxed">
              Best for: pre-apply review on production plans, code-review on infra PRs,
              sanity-checking imported state, and learning what &quot;known after apply&quot;
              actually means.
            </p>
          </div>
          <div className="rounded-xl border border-violet-900/40 bg-[#150f24]/60 px-5 py-4">
            <p className="text-xs uppercase tracking-wide text-violet-300/40 mb-3">Stack</p>
            <ul className="space-y-2 text-sm text-violet-100">
              <li>MiMo v2.5 Pro reasoning</li>
              <li>SSE streaming (reasoning + content)</li>
              <li>Next.js 16 App Router</li>
              <li>Tailwind v4, lucide-react</li>
              <li>No data persistence</li>
            </ul>
          </div>
        </section>

        <section id="faq" className="mt-16 border-t border-violet-900/40 pt-10">
          <h2 className="text-lg font-semibold mb-4">Frequently asked</h2>
          <div className="space-y-3">
            <FaqItem
              q="What plan format do you support?"
              a="Plain `terraform plan` output works. Run with `-no-color` to strip ANSI codes. Up to 60,000 characters per request — about a 500-resource plan with full diff."
            />
            <FaqItem
              q="Is the plan stored anywhere?"
              a="No. The plan is forwarded once to the reasoning model and discarded with the request. There is no database, no cache, no telemetry."
            />
            <FaqItem
              q="What's a 'blast radius'?"
              a="The set of resources, services, or production behaviors this apply could disturb if something goes wrong. Minor = isolated, recoverable. Critical = wide-impact, hard to recover. TFSage scores it from the destructive ops, state mutations, security changes, and stateful resource churn."
            />
            <FaqItem
              q="Can I use it for OpenTofu plans too?"
              a="Yes. The plan format is functionally identical. Same parser, same auditor."
            />
            <FaqItem
              q="Does it understand modules?"
              a="It reads the module address from the resource path (e.g. `module.networking.aws_route.public`) and treats nested resources accordingly. It won't see the module source, but it doesn't need to — the diff is the source of truth at apply time."
            />
            <FaqItem
              q="What about secrets in the plan?"
              a="If your plan output contains secrets (provider tokens, environment values), redact them before pasting. TFSage flags lines that look secret-shaped, but you should never depend on a tool to clean up after a leaky output."
            />
          </div>
        </section>

        <footer className="mt-20 mb-6 border-t border-violet-900/40 pt-6 text-center text-xs text-violet-300/40">
          <p>TFSage — read the plan before you apply.</p>
        </footer>
      </main>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: typeof Activity;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-violet-900/40 bg-[#150f24]/60 px-4 py-3">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon className={`w-3.5 h-3.5 ${color}`} />
        <span className="text-[10px] uppercase tracking-wide text-violet-300/40">{label}</span>
      </div>
      <div className={`text-2xl font-semibold tracking-tight ${color}`}>{value}</div>
    </div>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-violet-900/40 bg-[#150f24]/60">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-violet-900/20 transition"
      >
        <span className="text-sm font-medium text-violet-100">{q}</span>
        <ChevronRight
          className={`w-4 h-4 text-violet-300/40 transition-transform ${open ? "rotate-90" : ""}`}
        />
      </button>
      {open && <div className="px-4 pb-4 text-sm text-violet-200/60 leading-relaxed">{a}</div>}
    </div>
  );
}
