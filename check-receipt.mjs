#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import crypto from 'crypto';
import dotenv from 'dotenv';

// 1. Priority of .env resolution: global truth-guard home -> project .env
const envPaths = [
  path.join(process.env.USERPROFILE || process.env.HOME || '', '.gemini', 'antigravity', 'truth-guard', '.env'),
  path.join(process.cwd(), '.env')
];
for (const p of envPaths) {
  if (fs.existsSync(p)) dotenv.config({ path: p, override: false });
}

const HMAC_KEY = process.env.TRUTH_GUARD_HMAC_SECRET;

function detectCurrentProjectId(cwd) {
  const baseName = path.basename(cwd).replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
  if (baseName && baseName !== 'antigravity' && baseName !== 'src' && baseName !== 'workspace') {
    try {
      const pkgPath = path.join(cwd, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.name && pkg.name !== 'react-example' && pkg.name !== 'my-app' && pkg.name !== 'template') {
          return pkg.name.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
        }
      }
    } catch {}
    return baseName;
  }
  return baseName || 'default-project';
}

function checkTruthReceipt() {
  const cwd = process.cwd();
  console.log('[TRUTH GUARD] Verifying anti-hallucination compliance receipt...');

  // Fail closed if dedicated HMAC secret is missing
  if (!HMAC_KEY) {
    console.error('\n❌ [TRUTH GUARD AUDIT FAILED: MISSING HMAC SECRET]');
    console.error('TRUTH_GUARD_HMAC_SECRET is strictly required for cryptographic receipt verification.');
    console.error('Receipt verification requires a dedicated secret, not GEMINI_API_KEY.\n');
    process.exit(1);
  }

  // 1. Detect uncommitted file changes using strict Git porcelain parsing
  let changedFiles = [];
  try {
    const rawGitStatus = execSync('git status --porcelain', { cwd, encoding: 'utf8' });
    if (rawGitStatus) {
      changedFiles = rawGitStatus
        .split(/\r?\n/)
        .filter(line => line.length > 3)
        .map(line => {
          const filePathPart = line.slice(3).trim();
          const actualPath = filePathPart.includes(' -> ') ? filePathPart.split(' -> ')[1].trim() : filePathPart;
          return actualPath.replace(/^"|"$/g, '').replace(/\\/g, '/');
        })
        .filter(Boolean);
    }
  } catch {}

  // 2. Safe path filter: documentation, git metadata, and truth logs do not require plan verification
  const SAFE_PATHS = [
    'docs/', '.agent/', '.git/', '.truth-receipt.json', 'HANDOVER.md',
    'PITFALLS.md', 'README.md', 'README.uk.md', 'PROMPTS.md', 'PROMPTS.uk.md',
    'global-rules.md', 'global-rules.uk.md'
  ];

  const codeChangedFiles = changedFiles.filter(file =>
    !SAFE_PATHS.some(safe => file === safe || file.startsWith(safe))
  );

  // If there are no uncommitted code changes in project files, pass immediately
  if (codeChangedFiles.length === 0) {
    console.log('✓ [TRUTH GUARD] No uncommitted code changes in project. Verification gate passed.');
    process.exit(0);
  }

  // 3. Locate verification receipt file
  const gitDir = path.join(cwd, '.git');
  const gitReceipt = path.join(cwd, '.git', '.truth-receipt.json');
  const rootReceipt = path.join(cwd, '.truth-receipt.json');
  const receiptPath = fs.existsSync(gitReceipt) ? gitReceipt : rootReceipt;

  if (!fs.existsSync(receiptPath)) {
    console.error('\n❌ [TRUTH GUARD AUDIT FAILED: RECEIPT MISSING]');
    console.error('Uncommitted code changes detected, but NO valid Truth Guard receipt found.');
    codeChangedFiles.forEach(f => console.error(`  - ${f}`));
    console.error('Mandatory Action: Call truth_search & truth_verify_plan, or run node scripts/emergency-approve.mjs.\n');
    process.exit(1);
  }

  // 4. Read and parse receipt
  let receipt;
  try {
    receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  } catch (err) {
    console.error('❌ [TRUTH GUARD] Failed to parse receipt file:', err.message);
    process.exit(1);
  }

  // 5. Verify Project ID binding
  const currentProjectId = detectCurrentProjectId(cwd);
  if (receipt.project_id && receipt.project_id !== currentProjectId) {
    console.error('\n❌ [TRUTH GUARD AUDIT FAILED: PROJECT ID MISMATCH]');
    console.error(`Receipt project_id (${receipt.project_id}) does not match current repository (${currentProjectId}).\n`);
    process.exit(1);
  }

  // 6. Verify receipt age (TTL = 15 minutes max)
  const MAX_AGE_MS = 15 * 60 * 1000;
  const receiptAge = Date.now() - new Date(receipt.timestamp).getTime();
  if (isNaN(receiptAge) || receiptAge > MAX_AGE_MS) {
    console.error(`\n❌ [TRUTH GUARD AUDIT FAILED: EXPIRED RECEIPT (${Math.round(receiptAge / 60000)}m old; max 15m)]\n`);
    process.exit(1);
  }

  // 7. Check Anti-Replay Ledger & Consumed Status
  const ledgerPath = fs.existsSync(gitDir) && fs.statSync(gitDir).isDirectory()
    ? path.join(gitDir, '.truth-consumed-tokens')
    : path.join(cwd, '.truth-consumed-tokens');

  if (fs.existsSync(ledgerPath)) {
    const consumedTokens = fs.readFileSync(ledgerPath, 'utf8').split(/\r?\n/).filter(Boolean);
    if (consumedTokens.includes(receipt.receipt_token) || receipt.consumed === true) {
      console.error('\n❌ [TRUTH GUARD AUDIT FAILED: RECEIPT ALREADY CONSUMED]');
      console.error(`Token ${receipt.receipt_token} has already been consumed. Replay is rejected.\n`);
      process.exit(1);
    }
  }

  // 8. Verify Plan-Code Binding: strict target_files matching
  if (!Array.isArray(receipt.target_files) || receipt.target_files.length === 0) {
    console.error('\n❌ [TRUTH GUARD AUDIT FAILED: MISSING TARGET_FILES in receipt]\n');
    process.exit(1);
  }

  const normalizedTargets = receipt.target_files.map(t =>
    t.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '').trim()
  );

  const unauthorizedFiles = codeChangedFiles.filter(file => {
    const normFile = file.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '').trim();
    return !normalizedTargets.some(target => {
      const boundaryTarget = target.endsWith('/') ? target : target + '/';
      return normFile === target || normFile.startsWith(boundaryTarget);
    });
  });

  if (unauthorizedFiles.length > 0) {
    console.error('\n❌ [TRUTH GUARD AUDIT FAILED: UNAUTHORIZED FILE MUTATION]');
    unauthorizedFiles.forEach(f => console.error(`  - ${f}`));
    console.error('Approved targets in receipt:');
    normalizedTargets.forEach(f => console.error(`  + ${f}`));
    process.exit(1);
  }

  // 9. Strict Cryptographic Signature Verification (HMAC SHA-256)
  if (!receipt.signature || !receipt.receipt_token) {
    console.error('\n❌ [TRUTH GUARD AUDIT FAILED: MISSING SIGNATURE OR TOKEN]\n');
    process.exit(1);
  }

  const citedSorted = Array.isArray(receipt.cited_fact_ids) ? receipt.cited_fact_ids.slice().sort().join(',') : '';
  const targetSorted = Array.isArray(receipt.target_files) ? receipt.target_files.slice().sort().join(',') : '';

  const signatureData = targetSorted
    ? `${receipt.receipt_token}:${receipt.project_id}:${receipt.plan_hash}:${targetSorted}:${receipt.timestamp}:${citedSorted}`
    : `${receipt.receipt_token}:${receipt.project_id}:${receipt.plan_hash}:${receipt.timestamp}:${citedSorted}`;

  const expectedSig = crypto.createHmac('sha256', HMAC_KEY).update(signatureData).digest('hex');

  let isValidSig = false;
  try {
    const sigBuf = Buffer.from(receipt.signature, 'hex');
    const expBuf = Buffer.from(expectedSig, 'hex');
    if (sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf)) {
      isValidSig = true;
    }
  } catch {}

  if (!isValidSig) {
    console.error('\n❌ [TRUTH GUARD AUDIT FAILED: INVALID SIGNATURE]');
    console.error('Cryptographic signature verification failed. Untrusted secret or tampered payload.\n');
    process.exit(1);
  }

  // 10. Consume receipt if invoked with --consume flag
  if (process.argv.includes('--consume')) {
    try {
      fs.appendFileSync(ledgerPath, `${receipt.receipt_token}\n`, 'utf8');
      console.log('✓ [TRUTH GUARD] Receipt token recorded in consumed anti-replay ledger.');
    } catch (e) {
      console.error('⚠️ [TRUTH GUARD] Failed to record in ledger:', e.message);
    }
    try {
      fs.unlinkSync(receiptPath);
      console.log('✓ [TRUTH GUARD] Receipt file consumed and deleted.');
    } catch (e) {
      console.error('⚠️ [TRUTH GUARD] Failed to delete consumed receipt:', e.message);
    }
  }

  console.log(`✓ [TRUTH GUARD] Valid verification receipt confirmed! Token: ${receipt.receipt_token} (${Math.round(receiptAge / 1000)}s old)`);
  process.exit(0);
}

checkTruthReceipt();
