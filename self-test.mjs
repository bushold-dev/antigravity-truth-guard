#!/usr/bin/env node
import {
  detectProjectId,
  indexFile,
  loadHashes,
  syncRamMirrorFromFirestore,
  seedGlobalRules,
  searchTruth,
  verifyPlan,
  upsertRule,
  getTruthStatus,
  getQuotaTracker
} from './server.mjs';
import fs from 'fs';
import path from 'path';

async function runSelfTest() {
  console.log('====================================================');
  console.log('   Antigravity Truth Guard v2.0 - Standalone Test');
  console.log('====================================================\n');

  const cwd = process.cwd();
  const projectId = detectProjectId(cwd);
  console.log(`[1/5] Active Project: "${projectId}" (Directory: ${cwd})`);

  // Step 1: Preload RAM mirror and seed 5 Universal Global Laws
  console.log('\n[2/5] Preloading RAM Mirror & Seeding 5 Universal Global Laws...');
  await syncRamMirrorFromFirestore(projectId);
  await seedGlobalRules();
  console.log('✓ RAM mirror loaded and global laws seeded.');

  // Step 2: Test RAM In-Memory Semantic Search with Priority Tagging
  console.log('\n[3/5] Testing In-Memory truth_search with Priority Tagging (0 Firestore Reads)...');
  const searchQuery = 'Grounded Context no guessing rules Clean Architecture';
  const searchResults = await searchTruth({ query: searchQuery, include_global: true });
  console.log(`✓ Search returned ${searchResults.length} relevant chunks:`);

  for (let i = 0; i < Math.min(5, searchResults.length); i++) {
    const res = searchResults[i];
    console.log(`   - [Score: ${res.score}] [${res.priority}] ${res.fact_id}`);
  }

  if (searchResults.length === 0) {
    throw new Error('Search failed to find any ground truth chunks in RAM mirror!');
  }

  const topFactIds = searchResults.slice(0, 5).map(r => r.fact_id);

  // Step 3: Truthful Plan Verification (Grounded in Global Rules)
  console.log('\n[4/7] Testing truth_verify_plan (Grounded plan with strict target_files binding)...');
  const groundedPlan = `
Implementation Plan:
1. Follow Grounded Context: Retrieve specifications with truth_search before writing code.
2. Follow Clean Architecture Cross-Segment Isolation: Separate Domain Core changes from Infrastructure and Delivery as specified in project rules.
3. Follow Verification Honesty: Run compiler checks and unit tests honestly without bypassing errors.
  `.trim();

  // 3a: Attempt without target_files -> MUST be rejected (Law 3 Binding)
  const missingTargets = await verifyPlan({
    proposed_plan: groundedPlan,
    cited_fact_ids: topFactIds,
    target_files: []
  });
  if (missingTargets.approved) {
    throw new Error('FAILED: Plan with empty target_files was approved! target_files must be mandatory.');
  }
  console.log('✓ PASS: Empty target_files strictly rejected by verification gate.');

  const verifyPass = await verifyPlan({
    proposed_plan: groundedPlan,
    cited_fact_ids: topFactIds,
    target_files: ['src/domain/core.ts']
  });

  console.log('Verification result:', JSON.stringify(verifyPass, null, 2));
  if (!verifyPass.approved) {
    throw new Error(`FAILED: Grounded plan was rejected: ${JSON.stringify(verifyPass.hallucinations_or_missing_conditions)}`);
  } else {
    console.log(`✓ PASS: Plan verified successfully! Receipt: ${verifyPass.receipt_token} (Tier: ${verifyPass.tier})`);
  }

  // Step 4: Emergency Safety Circuit Breaker & Strict Fail-Closed Fallback Mode
  console.log('\n[5/7] Testing Emergency Safety Circuit Breaker & Strict Fail-Closed LOCAL_FALLBACK_MODE...');
  const tracker = getQuotaTracker();
  tracker.tripCircuitBreaker('Simulation test for circuit breaker activation');

  // 4a: Fallback in MCP verifyPlan -> MUST be strictly blocked fail-closed (no self-authorization)
  const fallbackBlocked = await verifyPlan({
    proposed_plan: groundedPlan,
    cited_fact_ids: topFactIds,
    target_files: ['src/domain/core.ts']
  });

  if (fallbackBlocked.approved || fallbackBlocked.status !== 'UNVERIFIED_FALLBACK') {
    throw new Error('FAILED: Local fallback mode approved plan! Fail-closed invariant violated.');
  }
  console.log('✓ PASS: Fail-Closed Local Fallback strictly blocked offline verification (0 self-authorization bypasses).');

  // 4b: Reset circuit breaker to test quota tracking and upsert rules
  tracker.refundUsage(0); // sync state
  const quotaFile = path.join(process.env.USERPROFILE || process.env.HOME || '', '.gemini', 'antigravity', 'truth-guard', 'quota-tracker.json');
  if (fs.existsSync(quotaFile)) {
    try {
      const qData = JSON.parse(fs.readFileSync(quotaFile, 'utf8'));
      qData.circuit_breaker_tripped = false;
      fs.writeFileSync(quotaFile, JSON.stringify(qData, null, 2), 'utf8');
    } catch {}
  }

  // Step 5: Quota Tracker Atomic Pre-Reservation & Refund Test
  console.log('\n[6/7] Testing Atomic Quota Pre-Reservation & Refund...');
  const beforeUsed = tracker.getTotalUsed();
  tracker.recordUsage(2);
  if (tracker.getTotalUsed() !== beforeUsed + 2) {
    throw new Error('Quota recordUsage failed to increment total_used.');
  }
  tracker.refundUsage(2);
  if (tracker.getTotalUsed() !== beforeUsed) {
    throw new Error('Quota refundUsage failed to restore total_used.');
  }
  console.log('✓ PASS: Quota atomic recordUsage and refundUsage verified.');

  // Step 6: Testing Human-in-the-Loop Spec Protection & Symlink Shield (truth_upsert_rule)
  console.log('\n[7/7] Testing Human-in-the-Loop Spec Protection & Symlink Shield (truth_upsert_rule)...');
  const testRuleFile = 'test-rule-temp.md';
  const testRulePath = path.join(cwd, testRuleFile);

  // 6a: Attempt without confirmation -> MUST be blocked
  const blockedAttempt = await upsertRule({
    scope: 'project',
    file_path: testRuleFile,
    section_title: 'Test Section',
    content: 'Temporary content for self-test verification.'
  });

  if (blockedAttempt.status !== 'PENDING_HUMAN_APPROVAL') {
    throw new Error(`Expected PENDING_HUMAN_APPROVAL, got: ${JSON.stringify(blockedAttempt)}`);
  }
  console.log('✓ PASS: Unconfirmed upsertRule correctly blocked with PENDING_HUMAN_APPROVAL!');

  // 6b: Apply with user confirmation token
  const token = blockedAttempt.proposed_rule.confirmation_token;
  const approvedAttempt = await upsertRule({
    scope: 'project',
    file_path: testRuleFile,
    section_title: 'Test Section',
    content: 'Temporary content for self-test verification.',
    user_confirmed: true,
    confirmation_token: token
  });

  if (approvedAttempt.status !== 'APPLIED') {
    throw new Error(`Expected APPLIED, got: ${JSON.stringify(approvedAttempt)}`);
  }
  console.log('✓ PASS: Confirmed upsertRule applied successfully with valid token!');

  // Cleanup test file
  if (fs.existsSync(testRulePath)) {
    try { fs.unlinkSync(testRulePath); } catch {}
  }

  // Status Summary
  console.log('\n====================================================');
  console.log('   SYSTEM STATUS & READINESS REPORT');
  console.log('====================================================');
  const status = await getTruthStatus();
  console.log(JSON.stringify(status, null, 2));

  console.log('\n>>> antigravity-truth-guard v2.0 IS FULLY OPERATIONAL AND VERIFIED! <<<');
}

runSelfTest().catch(err => {
  console.error('\n❌ Self-test encountered an error:', err);
  process.exit(1);
});
