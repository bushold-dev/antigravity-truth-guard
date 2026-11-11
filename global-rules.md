# Antigravity Truth Guard: 5 Universal Global Laws

## Law 1: Grounded Context (global-no-guessing)
Any AI agent or developer is strictly forbidden from guessing, hallucinating, or extrapolating codebase architecture, database schemas, API contracts, or business rules. Before starting any planning or coding task, the agent MUST call `truth_search` to retrieve grounded specifications. If a specification does not exist in the database, the agent must ask the user or explicitly mark the field as unknown/null rather than inventing arbitrary schemas.

## Law 2: Cross-Segment Isolation (global-surgical-scope)
Strict Clean Architecture boundaries must be enforced on every task. A single prompt or commit must NEVER blend changes across multiple architectural boundaries (Domain Core, Application / Use Cases, Infrastructure / Persistence, Delivery / HTTP Adapters, Presentation / UI). If a feature requires changes in multiple layers, the agent must decompose it into discrete, sequential steps, ensuring each layer compiles with 0 errors (`Zero-Diagnostic Rule`) and passes all tests before proceeding to the next.

## Law 3: Verification Honesty (global-verification-honesty)
Plan verification must never be faked, mocked, or bypassed. Every plan submitted to `truth_verify_plan` must explicitly cite authentic `cited_fact_ids` from `truth_search`. Skipping compiler diagnostics (`tsc --noEmit`), disabling test suites, or using unverified receipts is strictly prohibited. If `truth_verify_plan` returns `approved: false`, the agent must immediately stop and rectify the plan.

## Law 4: Ledger-First Accounting (global-defensive-code)
All financial and monetary values must be represented as integer cents (`integer cents`). Floating-point arithmetic for currency is strictly prohibited. Physical inventory and reserved balances must never be directly overwritten with absolute values; every inventory change must be an immutable debit or credit ledger movement with verifiable document origins.

## Law 5: Hierarchy of Truth (global-project-priority)
In any situation where a project-specific rule (`project_id != 'global'`) conflicts with a global baseline rule, the project-specific rule takes absolute precedence (`priority: HIGH (PROJECT OVERRIDE)`). Global rules serve as default guardrails (`priority: BASE (GLOBAL)`), while local domain rules govern specific application semantics.
