# 🤖 Ready-to-Use AI Agent Prompts Library

**English** | [Українська версія (PROMPTS.uk.md)](PROMPTS.uk.md)

These prompts are designed to be copied and pasted directly into your AI coding assistant (**Google Antigravity**, **Claude Code**, **OpenAI Codex**, **Cursor**, **Gemini CLI**). The agent will autonomously carry out all the setup and enforcement steps.

---

## 📋 Prompt 1: Autonomous Setup & Deployment of Truth Guard

> **When to use:** Paste this prompt into your AI coding assistant to have it autonomously deploy the Truth Guard MCP server, provision free Google Cloud resources (Firestore + Gemini API), create the vector index, and register the MCP server in your IDE configurations.

```markdown
Your task is to autonomously deploy and configure the global multi-project anti-hallucination MCP system `antigravity-truth-guard`, operating entirely within free tier limits (Firestore Free Tier + Google AI Studio Free Tier up to 1,500 requests/day).

Execute all the following steps sequentially via the terminal and filesystem:

### Step 1. Google Cloud & API Key Preparation
1. Identify the active GCP project using `gcloud config get-value project` (if empty, ask the user or select an existing project with active billing).
2. Ensure the required APIs are enabled:
   `gcloud services enable firestore.googleapis.com generativelanguage.googleapis.com apikeys.googleapis.com`
3. Verify if the Firestore `(default)` database exists. If not, create it:
   `gcloud firestore databases create --location=eur3 --type=firestore-native` (or `nam5`).
4. Create the composite vector index for Firestore vector search:
   `gcloud firestore indexes composite create --collection-group=truth_chunks --query-scope=COLLECTION --field-config=field-path=project_id,order=ASCENDING --field-config=field-path=embedding,vector-config='{"dimension":"768","flat":{}}' --quiet || true`
5. Retrieve or create a free Gemini API key:
   - Check environment variables for `GEMINI_API_KEY` or existing keys via `gcloud services api-keys list`.
   - If missing, create one: `gcloud services api-keys create --display-name="truth-guard-free-tier"` and retrieve the value via `get-key-string`.
   - Save the key into `.env` (if the CLI does not return the key string, configure automatic fallback to `gcloud auth application-default print-access-token`).

### Step 2. Truth Guard Installation
1. Clone or copy `antigravity-truth-guard` into `~/.gemini/antigravity/truth-guard`.
2. Install dependencies:
   `npm install`
3. Configure `.env` with:
   ```env
   GEMINI_API_KEY="<your_api_key>"
   GCP_PROJECT="<your_gcp_project_id>"
   FIRESTORE_DATABASE="(default)"
   ```

### Step 3. Register MCP Server with AI Agents
Register the MCP server `antigravity-truth-guard` using command `node <path>/server.mjs`:
- In `~/.gemini/config/mcp_config.json` (or `~/.gemini/antigravity/mcp_config.json`) for Google Antigravity.
- In `~/.claude/claude.json` for Claude Code.
- In `~/.codex/config.toml` for OpenAI Codex.

### Step 4. Run Verification Self-Test
Run `node self-test.mjs` and confirm:
- RAM cache mirror syncs from Firestore.
- The 5 Universal Laws are seeded under `project_id: "global"`.
- Semantic search (`truth_search`) and plan verification (`truth_verify_plan`) pass all tests.
```

---

## 🔒 Prompt 2: Enforcing Mandatory Verification Gate in Your Project

> **When to use:** Run this prompt inside your active workspace/repository (e.g. your backend or web app) to enforce a strict verification gate. No AI agent will be able to modify code without an approved audit receipt from Truth Guard.

```markdown
Your task is to integrate the Antigravity Truth Guard verification gate into this repository, preventing any AI agent from making code edits without prior plan verification via the Truth Guard MCP server.

Execute the following steps:

### 1. Add Protocol to Agent Instructions
Create or update your agent instruction file (`AGENTS.md`, `.agent/rules/truth-guard-protocol.md`, or `CLAUDE.md`):

```markdown
# Antigravity Truth Guard Protocol (Always On)

1. Law 1 (Grounded Context): Never guess architecture, schemas, or business rules. Before starting any task, you MUST call `truth_search`.
2. Law 2 (Truth Verify Gate): Before editing any code files (`src/`), you MUST call `truth_verify_plan` with your proposed plan and cited `cited_fact_ids`. If `approved: false` is returned, immediately halt, resolve violations, and re-audit.
3. Law 3 (Spec Immutability): Never arbitrarily alter specification or rule files without explicit user instruction.
```

### 2. Add the Receipt Gate Verifier
1. Copy `check-receipt.mjs` from Truth Guard into `scripts/check-receipt.mjs`.
2. This script enforces:
   - If uncommitted changes exist in source code (`src/`), an authentic, fresh (under 30 minutes old) verification receipt `.git/.truth-receipt.json` must be present.
   - If the receipt is missing or expired, the script halts with `process.exit(1)` and directs the agent to call `truth_verify_plan`.
3. Add `node scripts/check-receipt.mjs` to the beginning of the `"verify"` or `"test"` script in `package.json`:
   ```json
   "scripts": {
     "verify": "node scripts/check-receipt.mjs && tsc --noEmit && npm test"
   }
   ```

### 3. Verify the Gate Enforcement
1. Attempt a minor change in `src/` without calling `truth_verify_plan` and run `npm run verify` — verify that the build is rejected.
2. Call `truth_verify_plan` for a faithful plan, ensure `.git/.truth-receipt.json` is generated, and rerun `npm run verify` — verify that the verification gate now passes.
```
