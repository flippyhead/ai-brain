"use client";

import { useState } from "react";

type Tab = "setup" | "prompts";

const SETUP_STEPS = [
  {
    step: 1,
    title: "Install the Open Brain Plugin",
    description:
      "The plugin connects your AI assistant to Open Brain and gives you skills for onboarding, project sync, and weekly reviews.",
    instructions: [
      {
        platform: "Claude Code",
        steps: [
          "Run: /plugin marketplace add flippyhead/claude-workflow-analyst",
          "Run: /plugin install open-brain@claude-workflow-analyst",
          "The Open Brain connector is bundled automatically.",
          "On first use, you'll be prompted to sign in to Open Brain in your browser.",
        ],
      },
      {
        platform: "Claude Desktop / Cowork",
        steps: [
          "Go to Settings \u2192 Integrations \u2192 Add More \u2192 Add custom integration",
          `Enter URL: ${typeof globalThis.window !== "undefined" ? globalThis.window.location.origin : "https://ai-brain-pi.vercel.app"}/api/mcp`,
          "A browser window will open \u2014 sign in and click Authorize.",
        ],
      },
      {
        platform: "Cursor",
        steps: [
          "Go to Settings and generate an API key.",
          "Open Cursor \u2192 Settings \u2192 MCP \u2192 Add new MCP server",
          `Enter URL: ${typeof globalThis.window !== "undefined" ? globalThis.window.location.origin : "https://ai-brain-pi.vercel.app"}/api/mcp`,
          "Set header: Authorization: Bearer YOUR_API_KEY",
        ],
      },
    ],
  },
  {
    step: 2,
    title: "Run /brain-init",
    description:
      "Automatically bootstrap your brain from your connected tools (email, calendar, ClickUp, GitHub, etc.) and Claude's memory. No manual data entry needed.",
    example:
      "/brain-init",
    skills: [
      "/brain-init \u2014 Auto-discover connectors, pull meta-knowledge, build your profile",
      "/brain-sync \u2014 Sync a project's context (README, git state, docs) into your brain",
      "/weekly-review \u2014 Weekly synthesis of thoughts, workflow insights, and goals",
    ],
  },
  {
    step: 3,
    title: "Add Workflow Insights (optional)",
    description:
      "Analyze your Claude Code and Cowork sessions for actionable insights. This is a separate plugin that enhances Open Brain with session-level analysis.",
    instructions: [
      {
        platform: "Install",
        steps: [
          "Run: /plugin install workflow-analyst@claude-workflow-analyst",
          "Then run: /workflow-analyst",
          "Or for a longer period: /workflow-analyst --days 14",
        ],
      },
    ],
    insights: [
      "Root Cause Diagnosis \u2014 Diagnoses why tools fail and tells you how to fix them",
      "Direct Automation \u2014 Detects repeated patterns and generates skills or config to automate them",
      "Decision Support \u2014 Compares your time allocation against your stated goals",
      "Knowledge Nudges \u2014 Finds topics you keep re-asking about and suggests saving them",
    ],
  },
];

const PROMPTS = [
  {
    title: "Second Brain Migration",
    description:
      "Import your notes from Notion, Obsidian, Apple Notes, or CSV files.",
    prompt: `You are a second brain migration assistant. You help people move their existing notes, highlights, and knowledge fragments from other tools into Open Brain.

You support migration from:
- Notion (exported as Markdown or CSV)
- Obsidian (vault files)
- Apple Notes (exported or copy-pasted)
- CSV files (any structured format)
- Plain text or markdown files

Your workflow:
1. Ask which platform they're migrating from
2. Provide platform-specific export instructions:
   - Notion: Settings \u2192 Export \u2192 Markdown & CSV
   - Obsidian: Point to vault directory
   - Apple Notes: Select all \u2192 copy, or use exporter tools
   - CSV: Explain expected columns
3. Ask them to share the exported content
4. For each note or fragment:
   - Transform it into a clear, searchable standalone statement
   - Remove formatting artifacts and metadata noise
   - Preserve the core insight, decision, or fact
   - Use the capture_thought tool to save it
5. Summarize what was migrated and suggest next steps

Important: Each migrated thought should stand alone. Transform fragments like "meeting notes 3/15" into "On March 15, we decided to switch from REST to GraphQL because..." \u2014 context that future-you can actually search for and use.`,
  },
  {
    title: "Open Brain Spark",
    description:
      "Discover how a personal knowledge system fits into your actual life.",
    prompt: `You are a workflow analyst who helps people discover how a personal knowledge system fits into their actual life. You don't pitch features \u2014 you find patterns in how they already think and work.

Start by asking these questions (one at a time, conversationally):

1. Walk me through a typical workday. What tools do you open, what meetings do you have, what kind of thinking do you do?
2. What's something you find yourself re-explaining to AI assistants over and over?
3. Think of a time recently when you forgot something that cost you \u2014 time, money, or just frustration. What was it?
4. When you have a good idea, where does it go right now? (Notes app, nowhere, a message to yourself?)
5. What recurring decisions do you make that you wish you had better context for?

After gathering answers, output 5 personalized patterns:

1. **Save This** \u2014 The type of information they should start capturing immediately (based on what they forget or re-explain)
2. **Before I Forget** \u2014 A specific workflow for their "idea capture" moments
3. **Cross-Pollinate** \u2014 How knowledge from one area of their life could inform another
4. **Build the Thread** \u2014 A topic they keep returning to that would benefit from accumulated context
5. **People Context** \u2014 The relationships and people-knowledge that would make their interactions better

For each pattern, give a concrete example using their actual answers. End with: "Pick one pattern to start with this week. Which one resonates most?"`,
  },
  {
    title: "Quick Capture Templates",
    description:
      "5 structured formats for common capture scenarios: decisions, people, insights, meetings, and AI saves.",
    prompt: `Here are 5 quick capture templates you can use with Open Brain. Copy any of these and use them as a starting point when capturing thoughts.

---

## 1. Decision Capture
Use when you've made a choice and want to remember why.

Format:
"Decided to [choice] because [reasoning]. Considered [alternatives] but [why not]. This affects [what it impacts]."

Example:
"Decided to use Postgres over MongoDB because our data is highly relational and we need strong consistency guarantees. Considered MongoDB for its flexible schema but our queries are complex joins. This affects our ORM choice \u2014 going with Prisma."

---

## 2. Person Note
Use after a meaningful interaction to build relationship context.

Format:
"[Name] \u2014 [role/relationship]. [Key thing learned]. [Preferences or working style]. [Follow-up needed]."

Example:
"Sarah Chen \u2014 new VP of Engineering. Values async communication, prefers Loom over meetings. Has background in distributed systems at Stripe. Follow up: share our architecture doc before next 1:1."

---

## 3. Insight Capture
Use when you connect two ideas or have a realization.

Format:
"Realized that [insight]. This connects to [related context]. Implication: [what to do differently]."

Example:
"Realized that our highest-converting users all discover the product through a specific blog post, not the homepage. This connects to the SEO work we deprioritized last quarter. Implication: invest in content-led growth over paid ads."

---

## 4. Meeting Debrief
Use after important meetings to capture what matters.

Format:
"Met with [who] about [topic]. Key decisions: [list]. Open questions: [list]. My action items: [list]. Their action items: [list]."

Example:
"Met with design team about the onboarding redesign. Key decisions: keeping the 3-step flow, adding progress indicator. Open questions: copy for step 2, whether to A/B test. My action items: draft step 2 copy by Friday. Their action items: Figma prototype by Wednesday."

---

## 5. The AI Save
Use when an AI conversation produces something worth keeping.

Format:
"AI helped me [what]. Key output: [the useful thing]. Context: [why I needed this]. Reuse: [when this would be useful again]."

Example:
"AI helped me write a database migration rollback strategy. Key output: step-by-step rollback procedure for the users table migration. Context: preparing for our v2 schema migration next sprint. Reuse: reference this pattern for any future breaking schema changes."`,
  },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      style={{
        padding: "6px 16px",
        background: copied ? "#16a34a" : "#111",
        color: "white",
        border: "none",
        borderRadius: 6,
        cursor: "pointer",
        fontSize: "0.9rem",
        fontWeight: 500,
      }}
    >
      {copied ? "Copied!" : "Copy Prompt"}
    </button>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "8px 20px",
        background: "none",
        color: active ? "#111" : "#999",
        border: "none",
        borderBottom: active ? "2px solid #111" : "2px solid transparent",
        cursor: "pointer",
        fontSize: "1rem",
        fontWeight: active ? 600 : 400,
      }}
    >
      {children}
    </button>
  );
}

function SetupSection() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {SETUP_STEPS.map((step) => (
        <div
          key={step.step}
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            padding: 24,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 12,
              marginBottom: 8,
            }}
          >
            <span
              style={{
                background: "#111",
                color: "white",
                borderRadius: "50%",
                width: 28,
                height: 28,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "0.85rem",
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              {step.step}
            </span>
            <h2 style={{ margin: 0 }}>{step.title}</h2>
          </div>
          <p style={{ color: "#666", marginTop: 4, marginBottom: 16 }}>
            {step.description}
          </p>

          {step.instructions && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {step.instructions.map((inst) => (
                <div
                  key={inst.platform}
                  style={{
                    background: "#f9fafb",
                    border: "1px solid #e5e7eb",
                    borderRadius: 6,
                    padding: 16,
                  }}
                >
                  <h3
                    style={{
                      margin: "0 0 8px 0",
                      fontSize: "0.95rem",
                      fontWeight: 600,
                    }}
                  >
                    {inst.platform}
                  </h3>
                  <ol
                    style={{
                      margin: 0,
                      paddingLeft: 20,
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    {inst.steps.map((s, i) => (
                      <li
                        key={i}
                        style={{
                          fontSize: "0.9rem",
                          lineHeight: 1.5,
                          fontFamily: s.startsWith("Run:") || s.startsWith("Enter URL:") || s.startsWith("Then run:")
                            ? "monospace"
                            : "inherit",
                        }}
                      >
                        {s}
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          )}

          {step.example && (
            <pre
              style={{
                background: "#f9fafb",
                border: "1px solid #e5e7eb",
                borderRadius: 6,
                padding: 16,
                fontSize: "0.85rem",
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                margin: 0,
              }}
            >
              {step.example}
            </pre>
          )}

          {step.skills && (
            <ul
              style={{
                marginTop: 16,
                paddingLeft: 20,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              {step.skills.map((skill, i) => (
                <li key={i} style={{ fontSize: "0.9rem", lineHeight: 1.5, fontFamily: "monospace" }}>
                  {skill}
                </li>
              ))}
            </ul>
          )}

          {step.insights && (
            <ul
              style={{
                marginTop: 16,
                paddingLeft: 20,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              {step.insights.map((insight, i) => (
                <li key={i} style={{ fontSize: "0.9rem", lineHeight: 1.5 }}>
                  {insight}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

function PromptsSection() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <p style={{ color: "#666", maxWidth: 600, margin: 0 }}>
        These prompts are for workflows that aren't available as plugin skills
        yet. Copy and paste them into your AI assistant.
      </p>
      {PROMPTS.map((p) => (
        <div
          key={p.title}
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            padding: 24,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              marginBottom: 8,
              gap: 16,
            }}
          >
            <div>
              <h2 style={{ margin: 0 }}>{p.title}</h2>
              <p style={{ color: "#666", marginTop: 4 }}>{p.description}</p>
            </div>
            <CopyButton text={p.prompt} />
          </div>
          <pre
            style={{
              background: "#f9fafb",
              border: "1px solid #e5e7eb",
              borderRadius: 6,
              padding: 16,
              fontSize: "0.85rem",
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: 300,
              overflow: "auto",
              margin: 0,
            }}
          >
            {p.prompt}
          </pre>
        </div>
      ))}
    </div>
  );
}

export default function GettingStartedPage() {
  const [tab, setTab] = useState<Tab>("setup");

  return (
    <div>
      <h1>Getting Started</h1>
      <p style={{ color: "#666", maxWidth: 600, marginBottom: 24 }}>
        Set up Open Brain with your AI assistant and start building your
        personal knowledge layer.
      </p>

      <div
        style={{
          display: "flex",
          gap: 4,
          borderBottom: "1px solid #e5e7eb",
          marginBottom: 24,
        }}
      >
        <TabButton active={tab === "setup"} onClick={() => setTab("setup")}>
          Setup Guide
        </TabButton>
        <TabButton active={tab === "prompts"} onClick={() => setTab("prompts")}>
          Companion Prompts
        </TabButton>
      </div>

      {tab === "setup" ? <SetupSection /> : <PromptsSection />}
    </div>
  );
}
