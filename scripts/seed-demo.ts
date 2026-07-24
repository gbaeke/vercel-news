// Inserts sample published articles for local development so the public site
// and review desk have something to render. Never run against production.
import dotenv from 'dotenv';
import { Pool } from 'pg';
import { placeholderSvgDataUrl } from '../lib/placeholder';

dotenv.config({ path: '.env.local' });

const SAMPLES = [
  {
    feed: 'openai',
    url: 'https://example.com/demo/gpt-5-codex-mini',
    title: 'OpenAI ships a smaller Codex model aimed at CI pipelines',
    slug: 'openai-ships-smaller-codex-model-ci-pipelines',
    tags: { primary: 'models', secondary: ['tooling'] },
    persona: 'pragmatic-engineer',
    summary:
      'A cut-down Codex variant trades raw capability for speed and cost, aimed squarely at automated code review and CI use. Latency drops to under a second for typical diffs.',
    seo: 'OpenAI releases a smaller, faster Codex model designed for CI pipelines and automated code review.',
    body: `<p>OpenAI has released a smaller variant of its Codex model family, positioning it for continuous-integration workloads rather than interactive coding sessions. The pitch is simple: most CI jobs don't need frontier reasoning, they need a verdict on a diff in under a second.</p>
<h2>What actually changed</h2>
<p>The new model runs roughly four times faster than its parent at a fraction of the price, according to the announcement. It keeps the same context window, which matters more than raw capability for review workloads — a large diff with surrounding file context is bulk, not difficulty.</p>
<p>For teams already running model-backed checks in CI, the economics shift meaningfully. A check that cost real money per pull request becomes cheap enough to run on every push.</p>
<h2>The practitioner's read</h2>
<p>The interesting move here is the framing: this is a model sold as infrastructure, not as an assistant. Expect the usual caveats — benchmark numbers are vendor-supplied, and "four times faster" depends heavily on the shape of your prompts.</p>`,
    daysAgo: 0,
  },
  {
    feed: 'anthropic',
    url: 'https://example.com/demo/claude-agent-teams',
    title: 'Anthropic opens agent teams to all API customers',
    slug: 'anthropic-opens-agent-teams-api',
    tags: { primary: 'product', secondary: ['tooling'] },
    persona: 'pragmatic-engineer',
    summary:
      'Multi-agent orchestration graduates from research preview to general availability, with per-team billing and a shared-memory primitive that persists across sessions.',
    seo: 'Anthropic makes multi-agent orchestration generally available with per-team billing and persistent shared memory.',
    body: `<p>Anthropic has moved its agent-teams API from research preview to general availability, making coordinated multi-agent workflows a first-class primitive for every API customer.</p>
<h2>What's in the release</h2>
<p>The headline feature is persistent shared memory: a team of agents can now read and write to a common store that survives across sessions. Billing moves to a per-team model, which should simplify cost attribution for platform teams running many workflows.</p>
<p>Rate limits are also now pooled at the team level rather than per-agent, removing a common source of orchestration failures where one busy agent starved its teammates.</p>
<h2>Why it matters</h2>
<p>Multi-agent systems have been easy to demo and hard to run in production. Pooled limits and durable memory address two of the three usual failure points. The third — cost blowups from runaway loops — still lands on the developer.</p>`,
    daysAgo: 1,
  },
  {
    feed: 'openai',
    url: 'https://example.com/demo/eu-ai-act-guidance',
    title: 'New EU guidance clarifies what "systemic risk" means for model providers',
    slug: 'eu-guidance-systemic-risk-model-providers',
    tags: { primary: 'policy', secondary: ['industry'] },
    persona: 'policy-watcher',
    summary:
      'The Commission published implementation guidance narrowing the systemic-risk designation to training-compute thresholds and downstream reach, giving mid-size labs a clearer compliance path.',
    seo: 'EU publishes implementation guidance narrowing the AI Act systemic-risk designation for model providers.',
    body: `<p>The European Commission has published long-awaited implementation guidance on the AI Act's systemic-risk tier, and the practical effect is a narrowing: designation now hinges on concrete training-compute thresholds combined with measures of downstream reach.</p>
<h2>The mechanics</h2>
<p>Providers above the compute threshold face the full obligations package — adversarial testing, incident reporting, and energy disclosure. Below it, obligations scale with deployment footprint rather than capability claims.</p>
<p>The guidance also clarifies that fine-tuned derivatives inherit the base model's designation only when the fine-tune materially changes capabilities, an exemption mid-size labs had lobbied for.</p>
<h2>Who this helps</h2>
<p>Mid-size labs get the clearest win: a predictable compliance path that doesn't treat every capable model as systemically risky. The incentive structure it creates — staying just under thresholds — is the part worth watching over the next year.</p>`,
    daysAgo: 3,
  },
];

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  for (const s of SAMPLES) {
    await pool.query(
      `INSERT INTO articles
         (source_feed, trigger_url, trigger_title, trigger_content, tags, persona, title,
          content_md, content_html, summary, seo_summary, slug, thumbnail_url, status,
          published_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'published',
               now() - ($14 || ' days')::interval,
               now() - ($14 || ' days')::interval,
               now() - ($14 || ' days')::interval)
       ON CONFLICT (trigger_url) DO NOTHING`,
      [
        s.feed,
        s.url,
        s.title,
        'Demo source text. '.repeat(30),
        JSON.stringify(s.tags),
        s.persona,
        s.title,
        s.body,
        s.body,
        s.summary,
        s.seo,
        s.slug,
        placeholderSvgDataUrl(s.title),
        String(s.daysAgo),
      ]
    );
  }
  await pool.end();
  console.log(`seeded ${SAMPLES.length} demo articles`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
