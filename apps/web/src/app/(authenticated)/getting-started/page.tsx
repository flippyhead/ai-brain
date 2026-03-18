"use client";

import { useState } from "react";

type Tab = "setup" | "prompts";

const SETUP_STEPS = [
  {
    step: 1,
    title: "Connect Open Brain",
    description:
      "Add the Open Brain connector so your AI assistant can save and search your knowledge.",
    instructions: [
      {
        platform: "Claude Code",
        steps: [
          "Run: /plugin marketplace add flippyhead/claude-workflow-analyst",
          "Run: /plugin install workflow-analyst@claude-workflow-analyst",
          "The plugin bundles the Open Brain connector automatically.",
          "On first use, you'll be prompted to sign in to Open Brain in your browser.",
        ],
      },
      {
        platform: "Claude Desktop / Cowork",
        steps: [
          'Go to Settings \u2192 Connectors \u2192 Add Custom Connector',
          "Enter URL: https://ai-brain-pi.vercel.app/api/mcp",
          "Sign in when prompted to authorize the connection.",
        ],
      },
    ],
  },
  {
    step: 2,
    title: "Start Capturing",
    description:
      "Your AI assistant can now save thoughts to Open Brain. Try it by telling your assistant something worth remembering.",
    example:
      '"Save this to my brain: We decided to use Postgres over MongoDB because our data is highly relational."',
  },
  {
    step: 3,
    title: "Enable Workflow Insights",
    description:
      "Automatically analyze your Claude Code and Cowork sessions for actionable insights. Requires the plugin from Step 1.",
    instructions: [
      {
        platform: "Claude Code",
        steps: [
          "Run: /workflow-analyst",
          "Or for a longer period: /workflow-analyst --days 14",
          "Insights are published to your /insights page with feedback controls.",
        ],
      },
      {
        platform: "Standalone (without Claude Code)",
        steps: [
          "Run: npx @flippyhead/workflow-analyzer run --since 7 --llm claude-api",
          "Requires ANTHROPIC_API_KEY environment variable.",
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
    title: "Memory Migration",
    description:
      "Extract everything your AI already knows about you and save it to Open Brain.",
    prompt: `You are a memory migration assistant. Your job is to extract everything you know about the user from your memory and conversation history, organize it into clean knowledge chunks, and save each one to their Open Brain using the capture_thought MCP tool.

Work through these categories systematically:

1. People \u2014 names, roles, relationships, preferences you've learned
2. Projects \u2014 active and past projects, goals, status, key decisions
3. Preferences \u2014 communication style, tools, workflows, opinions
4. Decisions \u2014 choices the user has made and the reasoning behind them
5. Recurring topics \u2014 themes that come up repeatedly in conversations
6. Professional context \u2014 job, company, industry, skills, career goals
7. Personal context \u2014 hobbies, interests, values, life circumstances

For each piece of knowledge:
- Write it as a standalone statement that would make sense to someone with no context
- Include relevant details and nuance, not just surface-level facts
- Use the capture_thought tool to save it immediately

Start by telling the user what categories you'll cover, then work through each one. Ask clarifying questions if needed.`,
  },
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
  {
    title: "Weekly Review",
    description:
      "Review your captured thoughts from the past week and surface patterns.",
    prompt: `You are a personal knowledge analyst who reviews a week's worth of captured thoughts and surfaces patterns, gaps, and connections.

Start by using the search_thoughts MCP tool to find all thoughts from the past 7 days. Then produce this report:

## Week at a Glance
A 2-3 sentence summary of what the user's week looked like based on their captured thoughts.

## Themes
The 3-5 dominant topics or areas of focus. For each, note how many thoughts touched it and whether it's a new theme or recurring.

## Open Loops
Decisions mentioned but not resolved, questions asked but not answered, action items captured but likely not completed. These are things that might need attention.

## Connections
Surprising links between thoughts from different contexts. "You mentioned X in a work context and Y in a personal note \u2014 these might be related because..."

## Gaps
Areas of the user's life or work that had no captured thoughts this week. Based on past patterns, flag anything that seems like an unusual absence.

## Suggested Focus
Based on the above, recommend 1-2 things to focus on next week. Be specific and actionable.

End with: "What resonated? Anything I should dig deeper on?"`,
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
                          fontFamily: s.startsWith("Run:") || s.startsWith("Enter URL:")
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
        Copy any prompt and paste it into your AI assistant to get started.
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
