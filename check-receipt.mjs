#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import crypto from 'crypto';
import dotenv from 'dotenv';

// Priority of .env resolution: global truth-guard home -> project .env
const envPaths = [
  path.join(process.env.USERPROFILE || process.env.HOME || '', '.gemini', 'antigravity', 'truth-guard', '.env'),
  path.join(process.cwd(), '.env')
];
for (const p of envPaths) {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p, override: false });
  }
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'truth-guard-secret';

function checkTruthReceipt() {
  const cwd = process.cwd();
  console.log('[TRUTH GUARD] Verifying anti-hallucination compliance receipt...');

  // 1. Detect uncommitted file changes using strict Git porcelain parsing
  let changedFiles = [];
  try {
    const rawGitStatus = execSync('git status --porcelain', { cwd, encoding: 'utf8' });
    if (rawGitStatus) {
      changedFiles = rawGitStatus
        .split(/\r?\n/)
        .filter(line => line.length > 3)
        .map(line => {
          // git status --porcelain format: "XY PATH" or "XY ORIG -> NEW"
          const filePathPart = line.slice(3).trim();
          const actualPath = filePathPart.includes(' -> ')
            ? filePathPart.split(' -> ')[1].trim()
            : filePathPart;
          return actualPath.replace(/^"|"$/g, '').replace(/\\/g, '/');
        })
        .filter(Boolean);
    }
  } catch (err) {
    // If not a git repository or git command fails, continue with receipt check if receipt exists
  }

  // 2. Safe path filter: documentation, git metadata, and truth logs do not require plan verification
  const SAFE_PATHS = [
    'docs/',
    '.agent/',
    '.git/',
    '.truth-receipt.json',
    'HANDOVER.md',
    'PITFALLS.md',
    'README.md',
    'README.uk.md',
    'PROMPTS.md',
    'PROMPTS.uk.md',
    'global-rules.md',
    'global-rules.uk.md'
  ];

  const codeChangedFiles = changedFiles.filter(file =>
    !SAFE_PATHS.some(safe => file === safe || file.startsWith(safe))
  );

  const hasCodeChanges = codeChangedFiles.length > 0;

  // If there are no uncommitted code changes in project files, pass immediately
  if (!hasCodeChanges) {
    console.log('✓ [TRUTH GUARD] No uncommitted code changes in project. Verification gate passed.');
    process.exit(0);
  }

  // 3. Locate verification receipt file
  const gitReceipt = path.join(cwd, '.git', '.truth-receipt.json');
  const rootReceipt = path.join(cwd, '.truth-receipt.json');
  const receiptPath = fs.existsSync(gitReceipt) ? gitReceipt : rootReceipt;

  if (!fs.existsSync(receiptPath)) {
    console.error('\n❌ [TRUTH GUARD AUDIT FAILED: RECEIPT MISSING]');
    console.error('========================================================================');
    console.error('Uncommitted code changes were detected in project files, but NO valid');
    console.error('Truth Guard verification receipt was found (.git/.truth-receipt.json).');
    console.error('');
    console.error('Detected modified files:');
    codeChangedFiles.forEach(f => console.error(`  - ${f}`));
    console.error('');
    console.error('Mandatory Action for AI Agent:');
    console.error('1. Call tool "truth_search" with relevant specification queries.');
    console.error('2. Call tool "truth_verify_plan" with:');
    console.error('   - proposed_plan: detailed technical plan');
    console.error('   - cited_fact_ids: authentic fact IDs from truth_search');
    console.error('   - target_files: exact list of files to be modified');
    console.error('3. Only after truth_verify_plan returns "approved: true", rerun verification.');
    console.error('========================================================================\n');
    process.exit(1);
  }

  // 4. Read and parse receipt
  let receipt;
  try {
    receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  } catch (err) {
    console.error('❌ [TRUTH GUARD] Failed to parse .truth-receipt.json:', err.message);
    process.exit(1);
  }

  // 5. Verify receipt age (TTL = 15 minutes max)
  const MAX_AGE_MS = 15 * 60 * 1000;
  const receiptAge = Date.now() - new Date(receipt.timestamp).getTime();

  if (isNaN(receiptAge) || receiptAge > MAX_AGE_MS) {
    const minutesOld = Math.round(receiptAge / (60 * 1000));
    console.error('\n❌ [TRUTH GUARD AUDIT FAILED: EXPIRED RECEIPT]');
    console.error('========================================================================');
    console.error(`Verification receipt is expired (${minutesOld} minutes old; max allowed: 15m).`);
    console.error('AI Agent must call truth_verify_plan again to obtain a fresh verification token.');
    console.error('========================================================================\n');
    process.exit(1);
  }

  // 6. Check single-use / consumed status
  if (receipt.consumed) {
    console.error('\n❌ [TRUTH GUARD AUDIT FAILED: RECEIPT ALREADY CONSUMED]');
    console.error('========================================================================');
    console.error('This verification receipt has already been consumed by a prior commit.');
    console.error('AI Agent must call truth_verify_plan again to verify subsequent changes.');
    console.error('========================================================================\n');
    process.exit(1);
  }

  // 7. Verify Plan-Code Binding: strict target_files matching & boundary safety
  if (!Array.isArray(receipt.target_files) || receipt.target_files.length === 0) {
    console.error('\n❌ [TRUTH GUARD AUDIT FAILED: MISSING TARGET_FILES]');
    console.error('========================================================================');
    console.error('Verification receipt does not contain a valid target_files list.');
    console.error('Law 3 mandates that every receipt must bind explicitly to non-empty target_files.');
    console.error('AI Agent must call truth_verify_plan with target_files specified.');
    console.error('========================================================================\n');
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
    console.error('========================================================================');
    console.error('Changed code files do not match the approved target_files list in the receipt:');
    unauthorizedFiles.forEach(f => console.error(`  - ${f}`));
    console.error('');
    console.error('Approved target_files:');
    normalizedTargets.forEach(f => console.error(`  + ${f}`));
    console.error('');
    console.error('AI Agent must call truth_verify_plan with the updated target_files list.');
    console.error('========================================================================\n');
    process.exit(1);
  }

  // 8. Strict Cryptographic Signature Verification (HMAC SHA-256)
  if (!receipt.signature || typeof receipt.signature !== 'string') {
    console.error('\n❌ [TRUTH GUARD AUDIT FAILED: MISSING CRYPTOGRAPHIC SIGNATURE]');
    console.error('========================================================================');
    console.error('Verification receipt does not contain a mandatory cryptographic signature.');
    console.error('========================================================================\n');
    process.exit(1);
  }

  const citedSorted = Array.isArray(receipt.cited_fact_ids)
    ? receipt.cited_fact_ids.slice().sort().join(',')
    : '';
  const targetSorted = Array.isArray(receipt.target_files)
    ? receipt.target_files.slice().sort().join(',')
    : '';

  const signatureData = targetSorted
    ? `${receipt.project_id}:${receipt.plan_hash}:${targetSorted}:${receipt.timestamp}:${citedSorted}`
    : `${receipt.project_id}:${receipt.plan_hash}:${receipt.timestamp}:${citedSorted}`;

  const expectedSig = crypto.createHmac('sha256', GEMINI_API_KEY).update(signatureData).digest('hex');

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
    console.error('========================================================================');
    console.error('Cryptographic signature verification failed. The receipt has been tampered with');
    console.error('or signed with an untrusted secret.');
    console.error('========================================================================\n');
    process.exit(1);
  }

  // 9. Consume receipt if invoked with --consume flag (e.g. from git pre-commit hook)
  if (process.argv.includes('--consume')) {
    receipt.consumed = true;
    try {
      fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), 'utf8');
      console.log('✓ [TRUTH GUARD] Receipt marked as consumed for this commit.');
    } catch (e) {
      console.error('⚠️ [TRUTH GUARD] Warning: Failed to mark receipt as consumed:', e.message);
    }
  }

  console.log(`✓ [TRUTH GUARD] Valid verification receipt confirmed! Token: ${receipt.receipt_token} (${Math.round(receiptAge / 1000)}s old)`);
  process.exit(0);
}

checkTruthReceipt();
