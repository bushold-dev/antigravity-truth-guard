# 🛡️ Antigravity Truth Guard v2.0
> **Global Multi-Project Anti-Hallucination MCP Guard for Autonomous AI Coding Agents with Zero-Runaway-Cost Protection**

**English** | [Українська версія (README.uk.md)](README.uk.md)

[![MCP Protocol](https://img.shields.io/badge/MCP-Protocol%20v1.6-blue.svg)](https://modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org)
[![Google Cloud](https://img.shields.io/badge/Backend-Firestore%20%2B%20Gemini%20API-orange.svg)](https://cloud.google.com)

**Antigravity Truth Guard** is an open-source autonomous architectural governance system (MCP server) that guarantees AI coding agents (**Google Antigravity**, **Claude Code**, **OpenAI Codex**, **Cursor**, etc.) write code **strictly grounded in verified facts and architecture contracts**. It eliminates database schema hallucinations, prevents architectural layer contamination, and protects project owners from runaway API costs caused by infinite loops.

---

## 📖 Table of Contents
1. [The Problem: Why Do AI Coding Agents Hallucinate?](#-the-problem-why-do-ai-coding-agents-hallucinate)
2. [How Truth Guard Works (Plain English for Non-Programmers)](#-how-truth-guard-works-plain-english-for-non-programmers)
3. [Financial Safety Architecture: Zero-Runaway-Cost Protection](#-financial-safety-architecture-zero-runaway-cost-protection)
4. [Technical Architecture & In-Memory RAM Mirroring](#-technical-architecture--in-memory-ram-mirroring)
5. [The 5 Universal Engineering Laws](#-the-5-universal-engineering-laws)
6. [MCP Tools Reference](#-mcp-tools-reference)
7. [Quickstart & Deployment Guide](#-quickstart--deployment-guide)
8. [Connecting to Antigravity, Claude, Codex, and Cursor](#-connecting-to-antigravity-claude-codex-and-cursor)
9. [AI Agent Prompts Library](#-ai-agent-prompts-library)

---

## 🧩 The Problem: Why Do AI Coding Agents Hallucinate?

Autonomous AI coding agents operate with superhuman speed, but in commercial repositories, they exhibit three critical failure modes:

1. **Schema & Contract Hallucinations:** When an agent lacks grounded context for a database table or business rule (e.g. *“monetary values must be stored strictly as integer cents, never floating-point numbers”*), it **guesses** or extrapolates. This causes production outages, silent financial drift, and corrupted database states.
2. **Architectural Cross-Segment Contamination:** An agent often tries in a single prompt to modify calculation formulas in the domain core, add a button to the UI, and alter database schemas simultaneously. The result is tangled spaghetti code that breaks Clean Architecture.
3. **The "Financial Abyss" (Runaway Agent Loops):** If an agent encounters an unexpected error while operating autonomously (especially overnight), it can trap itself in infinite self-correction loops. It burns tens of thousands of LLM API calls, resulting in unexpected, massive billing charges.

---

## 🏛️ How Truth Guard Works (Plain English for Non-Programmers)

Imagine you are constructing a high-rise building, and the AI agent is an ultra-fast construction crew.

```
          [ User Request: "Build new inventory feature" ]
                                │
                                ▼
                  ┌───────────────────────────┐
                  │   AI Coding Agent         │
                  │   (Claude, Codex, etc.)   │
                  └─────────────┬─────────────┘
                                │ 1. Drafts technical plan
                                ▼
              ┌───────────────────────────────────┐
              │   🛡️ ANTIGRAVITY TRUTH GUARD      │
              │   (Chief Compliance Notary)       │
              └─────────────┬─────────────────────┘
                            │ 2. Audits against Ground Truth Laws
             ┌──────────────┴──────────────┐
             ▼                             ▼
       [ Plan INVENTED Facts ]       [ Plan 100% GROUNDED ]
             │                             │
             ▼                             ▼
      ❌ STAMP: REJECTED             ✅ STAMP: APPROVED
      Job site remains locked!       Receipt generated:
      Agent must fix errors.         .truth-receipt.json
                                           │
                                           ▼
                                     Construction/Code edit
                                     permitted to execute!
```

### The "Notary & Blueprint" Principle:
* **The Blueprint (Ground Truth):** Your project specifications, schema contracts, and domain rules stored in `.md` specification files (safe from self-poisoning). Truth Guard indexes them into a high-speed knowledge base.
* **Mandatory Fact-Check (`truth_search`):** The AI agent is strictly forbidden from writing code blind. It must first ask Truth Guard: *“What are the exact, verified rules for this subsystem?”*.
* **The Independent Verification Gate (`truth_verify_plan`):** Before modifying any code, the agent submits its implementation plan along with the intended `target_files`. An independent AI auditor cross-references every single table, column, enum, and arithmetic operation against the Ground Truth facts. If the agent invented anything, the plan is **instantly rejected**.
* **Cryptographic Verification Receipt (`.truth-receipt.json`):** Only when the plan is 100% faithful does Truth Guard issue a time-stamped, cryptographically signed receipt bound to `target_files` (15-minute TTL, single-use per git commit). The repository verification harness (`npm run verify` and Git pre-commit hooks) rejects any commit or test run if code changes exist without an authentic, fresh receipt!

---

## 💳 Financial Safety Architecture: Zero-Runaway-Cost Protection

Truth Guard features an automated **Emergency Safety Circuit Breaker**—just like an electrical circuit breaker in your house:

```
                          [ Daily API Call Stream ]
                                     │
      ┌──────────────────────────────┼──────────────────────────────┐
      ▼                              ▼                              ▼
  [ Calls 0 - 1,400 ]       [ Calls 1,400 - 5,000 ]       [ Calls > 5,000 (LOOP) ]
      │                              │                              │
      ▼                              ▼                              ▼
  ⭐ TIER 1: FREE TIER        ⚡ TIER 2: PAY-AS-YOU-GO       🚨 TIER 3: CIRCUIT BREAKER
  Google AI Studio            Secondary Paid Fallback        EMERGENCY SHUTDOWN!
  1,500 free calls/day.       (costs a few cents,            All paid APIs blocked.
  Cost: $0.00 / day.          prevents work stops).          Forces LOCAL_FALLBACK.
                              Cost: ~$0.05.                  Cost: $0.00 (100% Safe).
```

1. **Tier 1 (Free Tier, 0 – 1,400 calls/day):**
   Utilizes the Google AI Studio / Gemini API Free Tier (1,500 free requests per day). Operating comfortably within 1,400 calls/day, your daily operational cost is **$0.00**.
2. **Tier 2 (Paid Backup / Pay-as-you-go, 1,400 – 5,000 calls/day):**
   If the daily free quota is exhausted or temporary `429 Rate Limits` occur, the server does not crash. It automatically escalates to a linked Google Cloud Pay-as-you-go backend (Gemini / Vertex AI). Verification continues seamlessly at a cost of only a few cents per month.
3. **Tier 3 (Emergency Safety Circuit Breaker, > 5,000 calls/day):**
   If an agent goes rogue or is trapped in an infinite script loop, the circuit breaker trips:
   * **All paid external cloud API calls are immediately hard-blocked**.
   * The server switches to **`LOCAL_FALLBACK_MODE`** (in-memory keyword BM25 search + deterministic TypeScript schema & rule auditing).
   * **Your funds and credit card are 100% protected against runaway charges.**

---

## ⚙️ Technical Architecture & In-Memory RAM Mirroring

### 1. In-Memory RAM Cache Mirror (`local-mirror.json`) — $0 Database Read Costs
* At server boot, all knowledge chunks for the active project and `global` space are loaded into process memory (`ramMirror`) and cached locally in `local-mirror.json`.
* All `truth_search` requests execute **entirely in RAM** using hybrid scoring:
  * **Vector Cosine Similarity** over 768-dimensional embeddings (`gemini-embedding-001`).
  * **BM25 Keyword Matching** over section titles and body content.
* **Zero Firestore read charges during developer/agent conversations!** (Comfortably inside Firestore's 50,000 free daily reads).

### 2. Multi-Project Isolation with Priority Boosting
* Truth Guard automatically detects the active project from the git repository name or `package.json`.
* Search runs concurrently across two namespaces: `project_id == currentProjectId` and `project_id == "global"`.
* Project-specific facts receive a **`[HIGH (PROJECT OVERRIDE)]`** priority tag and rank boost over global defaults (**`[BASE (GLOBAL)]`**).

### 3. Background Smart Watcher (Zero Quota Waste)
* Powered by `chokidar`, Truth Guard continuously monitors `**/*.md`, `**/*.schema.ts`, and `**/*.types.ts`.
* Sections are tracked via SHA-256 hashes in `.truth-hashes.json`.
* Embeddings are generated **only for sections whose text has genuinely changed**.

---

## 📜 The 5 Universal Engineering Laws

Defined in [`global-rules.md`](global-rules.md) and seeded automatically into `project_id: "global"`:

1. **Grounded Context (`global-no-guessing`):**
   Agents are forbidden from guessing codebase architecture, database schemas, or API contracts. Every task starts with `truth_search`.
2. **Cross-Segment Isolation (`global-surgical-scope`):**
   Strict Clean Architecture boundaries. Never blend changes across Domain, Application, Infrastructure, and UI in a single monolithic edit.
3. **Verification Honesty (`global-verification-honesty`):**
   Never bypass compiler diagnostics (`@ts-ignore`) or mock test passes. Every plan must cite authentic `cited_fact_ids`.
4. **Ledger-First Accounting (`global-defensive-code`):**
   All currency values must use integer cents (`integer cents`). Balances must never be directly overwritten; every inventory change must be an immutable ledger delta (+ / -).
5. **Hierarchy of Truth (`global-project-priority`):**
   Project-specific rules always take absolute precedence over global defaults when conflicting.

---

## 🛠️ MCP Tools Reference

The server exposes 4 standard Model Context Protocol (MCP) tools:

| Tool | Purpose | Key Arguments |
| :--- | :--- | :--- |
| `truth_search` | In-memory semantic & BM25 search (0 database reads) | `query` (search text), `include_global` (boolean) |
| `truth_verify_plan` | Multi-tier LLM verification gate & receipt generator | `proposed_plan` (string), `cited_fact_ids` (array of strings) |
| `truth_upsert_rule` | Create or update a spec rule locally and in cloud storage | `scope` (`project`/`global`), `file_path`, `section_title`, `content` |
| `truth_status` | Comprehensive status report: active tier, RAM chunks, circuit breaker | `target_project` (optional) |

---

## 🚀 Quickstart & Deployment Guide

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/bushold-dev/antigravity-truth-guard.git
cd antigravity-truth-guard
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Fill in your configuration:
```ini
# Free Gemini API Key (Get free key at https://aistudio.google.com/app/apikey)
GEMINI_API_KEY="your-gemini-api-key-here"

# Google Cloud Project ID with Firestore Native database
GCP_PROJECT="your-google-cloud-project-id"
FIRESTORE_DATABASE="(default)"
```

### 3. Create Firestore Composite Vector Index (Run Once)
```bash
gcloud firestore indexes composite create \
  --collection-group=truth_chunks \
  --query-scope=COLLECTION \
  --field-config=field-path=project_id,order=ASCENDING \
  --field-config=field-path=embedding,vector-config='{"dimension":"768","flat":{}}'
```

### 4. Run Verification Self-Test
```bash
npm test
```
Verifies RAM mirror preloading, semantic search, plan verification, and the circuit breaker safety system.

---

## 🔌 Connecting to Antigravity, Claude, Codex, and Cursor

### For Google Antigravity
Add to `~/.gemini/config/mcp_config.json` or `~/.gemini/antigravity/mcp_config.json`:
```json
{
  "mcpServers": {
    "antigravity-truth-guard": {
      "command": "node",
      "args": ["/absolute/path/to/antigravity-truth-guard/server.mjs"]
    }
  }
}
```

### For Claude Code (`claude.json`)
```json
{
  "mcpServers": {
    "truth-guard": {
      "command": "node",
      "args": ["/absolute/path/to/antigravity-truth-guard/server.mjs"]
    }
  }
}
```

### For OpenAI Codex (`~/.codex/config.toml`)
```toml
[mcp_servers.truth_guard]
command = "node"
args = ["/absolute/path/to/antigravity-truth-guard/server.mjs"]
```

### Enforce in Your Project's CI/CD or Build Script (`package.json`)
```json
{
  "scripts": {
    "verify": "node /path/to/antigravity-truth-guard/check-receipt.mjs && npm run lint && npm test"
  }
}
```
If an AI agent modifies code in `src/` without obtaining an authentic `.truth-receipt.json` from `truth_verify_plan`, this script immediately halts the build!

---

## 🤖 AI Agent Prompts Library

We provide ready-to-use copy-paste prompts in [**`PROMPTS.md`**](PROMPTS.md) ([Українська версія](PROMPTS.uk.md)):
1. **Autonomous Setup Prompt:** Directs any AI agent to prepare Google Cloud, install Truth Guard, and connect it to your IDE.
2. **Repository Enforcement Prompt:** Directs any AI agent to enforce mandatory verification receipts and the 3 Laws of Truth inside an existing project.

---

## 📄 License
Released under the open-source [MIT License](LICENSE). Contributions, issues, and forks are welcome!
