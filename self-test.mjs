#!/usr/bin/env node
import {
  detectProjectId,
  indexFile,
  loadHashes,
  syncRamMirrorFromFirestore,
  seedGlobalRules,
  searchTruth,
  verifyPlan,
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
  console.log('\n[4/5] Testing truth_verify_plan (Grounded plan)...');
  const groundedPlan = `
Implementation Plan:
1. Follow Grounded Context: Retrieve specifications with truth_search before writing code.
2. Follow Clean Architecture Cross-Segment Isolation: Separate Domain Core changes from Infrastructure and Delivery as specified in project rules.
3. Follow Verification Honesty: Run compiler checks and unit tests honestly without bypassing errors.
  `.trim();

  const verifyPass = await verifyPlan({
    proposed_plan: groundedPlan,
    cited_fact_ids: topFactIds
  });

  console.log('Verification result:', JSON.stringify(verifyPass, null, 2));
  if (!verifyPass.approved) {
    throw new Error(`FAILED: Grounded plan was rejected: ${JSON.stringify(verifyPass.hallucinations_or_missing_conditions)}`);
  } else {
    console.log(`✓ PASS: Plan verified successfully! Receipt: ${verifyPass.receipt_token} (Tier: ${verifyPass.tier})`);
  }

  // Step 4: Emergency Safety Circuit Breaker Test
  console.log('\n[5/5] Testing Emergency Safety Circuit Breaker & LOCAL_FALLBACK_MODE...');
  const tracker = getQuotaTracker();
  tracker.tripCircuitBreaker('Simulation test for circuit breaker activation');

  const fallbackTest = await verifyPlan({
    proposed_plan: groundedPlan,
    cited_fact_ids: topFactIds
  });

  if (fallbackTest.tier !== 'LOCAL_FALLBACK') {
    throw new Error(`Expected tier to be LOCAL_FALLBACK, got ${fallbackTest.tier}`);
  }
  console.log(`✓ PASS: Emergency Safety Circuit Breaker correctly enforced LOCAL_FALLBACK!`);

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
