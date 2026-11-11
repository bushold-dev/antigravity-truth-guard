# 🎯 How Verification and Scoring Work in Antigravity Truth Guard

This document provides a comprehensive technical and conceptual breakdown of the knowledge retrieval, semantic scoring (`score`), multi-tier auditor verification, and cryptographic gatekeeping mechanics in **Antigravity Truth Guard v2.1**.

---

## 📖 Table of Contents

1. [Core Philosophy: The Work Permit Model](#1-core-philosophy-the-work-permit-model)
2. [What `0.5` Was in Search & How Relevance Scoring Works (`truth_search`)](#2-what-05-was-in-search--how-relevance-scoring-works-truth_search)
3. [End-to-End Plan Verification Lifecycle (`truth_verify_plan`)](#3-end-to-end-plan-verification-lifecycle-truth_verify_plan)
4. [Auditor Scoring Criteria and Scale (0.0 to 1.0)](#4-auditor-scoring-criteria-and-scale-00-to-10)
5. [The Triple-Lock Invariant: When a Plan Receives `approved: true`](#5-the-triple-lock-invariant-when-a-plan-receives-approved-true)
6. [Fail-Closed Safety: The Fallback Gate](#6-fail-closed-safety-the-fallback-gate)
7. [The Verification Gate: `check-receipt.mjs` and Path Boundary Safety](#7-the-verification-gate-check-receiptmjs-and-path-boundary-safety)

---

## 1. Core Philosophy: The Work Permit Model

In traditional AI coding workflows, agents generate code purely from internal model parameters. Whenever context is missing (such as exact database column names, currency representations, or business constraints), the agent **guesses** (hallucinates).

**Antigravity Truth Guard** enforces an industrial technical supervision and work permit architecture:

```
┌──────────────┐     1. truth_search     ┌──────────────────────────────────┐
│              ├────────────────────────>│  RAM Mirror (Ground Truth Cache) │
│              │<────────────────────────┤  (0 Firestore reads during chat) │
│   AI Agent   │     2. Grounded facts   └──────────────────────────────────┘
│              │
│              │     3. truth_verify_plan┌──────────────────────────────────┐
│              ├────────────────────────>│  Independent LLM Auditor        │
│              │                         │  (Zero-Tolerance Auditor)        │
│              │<────────────────────────┤                                  │
│              │     4. approved + receipt└──────────────────────────────────┘
└──────┬───────┘
       │ 5. Code changes applied ONLY to approved target_files
       ▼
┌────────────────────────────────────────────────────────┐
│  Verification Gate (`check-receipt.mjs`)               │
│  • Validates HMAC-SHA256 signature                     │
│  • Enforces strict 15-minute TTL                       │
│  • Guarantees ONLY approved target_files were touched  │
└────────────────────────────────────────────────────────┘
```

An agent cannot commit or build any code changes without a cryptographically signed verification permit (`.truth-receipt.json`).

---

## 2. What `0.5` Was in Search & How Relevance Scoring Works (`truth_search`)

When an agent invokes `truth_search`, the system queries the in-memory RAM mirror and returns facts annotated with a numeric relevance score (`score`):

### Why Did Earlier Searches Return `0.5`?
In early baseline versions, when search was operating in simplified keyword fallback mode, every chunk matched by keyword was assigned a static baseline score of **`0.5`** (50% nominal relevance). This was a placeholder value.

### How Is Search Relevance Computed Now (in v2.1.0)?
Starting in v2.1.0, search relevance is calculated dynamically via a hybrid formula: **Cosine Similarity (70%) + Keyword Bonus (30%) + Priority Multiplier**:

$$\text{FinalScore} = \min\Big(1.0, \big(\text{CosSim} \times 0.70 + \text{KeywordBonus} \times 0.30\big) \times \text{PriorityWeight}\Big)$$

1. **Semantic Similarity (Cosine Similarity, 70% weight):**  
   The user's query and each rule chunk are transformed into 768-dimensional dense vector embeddings using `models/gemini-embedding-001`. The cosine angle between query vector $\vec{A}$ and chunk vector $\vec{B}$ is computed:
   $$\text{CosSim} = \frac{\vec{A} \cdot \vec{B}}{\|\vec{A}\| \|\vec{B}\|}$$
   If an agent asks *"how should we allocate cost upon inventory shipment?"*, and the rule is titled *"FIFO Valuation & Cost Allocation"*, semantic similarity produces a high match (~0.75–0.85) despite different phrasing.
2. **Lexical Matching (Keyword Bonus, 30% weight):**  
   For every query term (>2 characters) found directly in the rule's title or body, a bonus of `+0.15` is awarded.
3. **Hierarchy of Truth (`PriorityWeight`):**  
   Per Law 5 (Hierarchy of Truth), project-specific rules take precedence over global baselines:
   * **Project Rule (`project_id === currentProject`):** Scaled by `1.05` and tagged `HIGH (PROJECT OVERRIDE)`.
   * **Global Rule (`project_id === 'global'`):** Scaled by `1.00` and tagged `BASE (GLOBAL)`.

Consequently, search results present genuine mathematical scores (`0.7457`, `0.6053`, `0.4903` instead of uniform `0.5`).

---

## 3. End-to-End Plan Verification Lifecycle (`truth_verify_plan`)

Plan verification follows 5 strict sequential stages:

1. **Step 1: Fact Discovery (`truth_search`)**  
   Mandated by Law 1 (Grounded Context), the agent must first discover grounded rules. Each retrieved chunk includes an immutable identifier (`fact_id`), e.g.:
   `sklad:docs/RULES.md#14-ledger-first--`
2. **Step 2: Submitting the Plan and Target Files**  
   The agent submits its proposed plan to `truth_verify_plan`, providing:
   * `proposed_plan`: A step-by-step description of the planned changes.
   * `cited_fact_ids`: The exact rule identifiers backing the plan.
   * `target_files`: **A mandatory, non-empty array** specifying every file intended to be created or modified.
3. **Step 3: Independent LLM Audit**  
   The request is delivered to an isolated Gemini Flash instance with a strict system instruction:
   > *"You are a strict, zero-tolerance anti-hallucination auditor. Verify whether every single step, database table, column name, status enum, rule, and assumption in PROPOSED PLAN is strictly grounded in the provided GROUND TRUTH FACTS. If the plan invents ANY unverified detail, flag it immediately as a hallucination."*
   The model receives **only two inputs**: the cited rule texts and the proposed plan.
4. **Step 4: Cryptographic Receipt Signing**  
   Upon approval, the server generates an HMAC-SHA256 signature using the secret key:
   $$\text{Signature} = \text{HMAC-SHA256}_{\text{Key}}(\text{project\_id} : \text{plan\_hash} : \text{target\_files} : \text{timestamp} : \text{cited\_facts})$$
   The signed receipt is persisted to `.git/.truth-receipt.json` (or project root) with a strict **15-minute TTL**.
5. **Step 5: Gating at Git & Build (`check-receipt.mjs`)**  
   Prior to commits or builds, `check-receipt.mjs` verifies the receipt. Missing receipts, expired tokens, signature mismatches, or file mutations outside `target_files` trigger an immediate `exit(1)`.

---

## 4. Auditor Scoring Criteria and Scale (0.0 to 1.0)

During plan verification, the LLM auditor evaluates the proposal and outputs a structured assessment:

```json
{
  "approved": true,
  "score": 1.0,
  "hallucinations_or_missing_conditions": [],
  "receipt_token": "TG-VERIFIED-a1b947c6ec80"
}
```

### Scoring Scale:

| Score (`score`) | Verdict | Meaning |
|---|---|---|
| **`1.0`** | **APPROVED** | **Flawless alignment.** Every step, model name, column, and business formula is 100% verified by cited facts. Hallucinations list is empty `[]`. |
| **`0.7` – `0.89`** | **REJECTED** | **Partial fact absence.** The plan appears logical but introduces assumptions not found in cited facts (e.g., proposing customer phone normalization while citing only a inventory pricing rule). The auditor returns `score: 0.7` and rejects the plan. |
| **`< 0.5`** | **REJECTED** | **Severe hallucination / divergence.** The plan violates architectural layer boundaries, bypasses compiler checks (`@ts-ignore`), skips tests, or cites non-existent fact IDs. |
| **`0.0`** | **HARD REJECT** | **Immediate failure.** Empty `target_files`, missing cited facts, or protocol violations. |

---

## 5. The Triple-Lock Invariant: When a Plan Receives `approved: true`

To prevent false positives and lenient approvals, Truth Guard enforces a triple-lock gate:

> [!IMPORTANT]
> A plan is marked `approved: true` **if and only if all three conditions hold simultaneously**:
> 1. $\text{score} \ge 0.9$ (90% or higher adherence).
> 2. `hallucinations_or_missing_conditions.length === 0` (zero auditor objections).
> 3. `target_files` is a non-empty, valid list of target file paths.

If the auditor lists **even a single missing condition or hallucination**, even with a score of 0.85, the verdict is forced to `approved: false`, issuing a `TG-REJECTED-xxxx` token and refusing to write an approval receipt.

---

## 6. Fail-Closed Safety: The Fallback Gate

When network access is offline, the Gemini API is rate-limited (HTTP 429), or the daily circuit breaker trips:

* **Vulnerability in Earlier Revisions:**  
  The offline fallback verified basic keyword absence (`@ts-ignore`) and issued a real `approved: true` receipt, creating an unverified bypass.
* **Fail-Closed Resolution in v2.1.0:**  
  The fallback mode operates strictly **fail-closed**:
  1. It **never issues approved receipts automatically** (`approved: false`, status: `UNVERIFIED_FALLBACK`).
  2. It returns an explicit human override challenge:
     `"STOP: Truth Guard is operating in LOCAL_FALLBACK mode... requires human authorization. override_token: 'OVERRIDE-xxxxxxxx'"`
  3. Only when a human user reviews the plan and provides explicit authorization can the agent re-call with `human_override: true` and the matching `override_token`. The receipt is explicitly stamped with `tier: LOCAL_FALLBACK_HUMAN_OVERRIDE`.

---

## 7. The Verification Gate: `check-receipt.mjs` and Path Boundary Safety

The final line of defense runs locally in the developer repository via Git pre-commit hooks or `npm run verify`:

1. **Strict Path Boundary Enforcement:**  
   Changed files from `git status` are validated using strict boundary matching:
   ```javascript
   const isMatch = normalizedTargets.some(target => {
     const boundaryTarget = target.endsWith('/') ? target : target + '/';
     return normFile === target || normFile.startsWith(boundaryTarget);
   });
   ```
   This eliminates prefix matching loopholes (e.g., an approval for `src/auth` can never authorize changes to `src/author.ts`).
2. **Single-Use Consumption:**  
   Upon successful commit, the pre-commit hook runs `check-receipt.mjs --consume`, setting `consumed: true`. Any subsequent commit requires a fresh plan verification.
3. **15-Minute Expiration (TTL):**  
   If more than 15 minutes elapse between plan verification and code commit, the receipt expires, requiring the agent to re-verify against current repository state.

---

*Documentation updated for Antigravity Truth Guard v2.1.0.*
