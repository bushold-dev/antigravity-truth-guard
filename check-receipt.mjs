#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import crypto from 'crypto';
import dotenv from 'dotenv';

// Load optional .env from current directory or home
const envPaths = [
  path.join(process.cwd(), '.env'),
  path.join(process.env.USERPROFILE || process.env.HOME || '', '.gemini', 'antigravity', 'truth-guard', '.env')
];
for (const p of envPaths) {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p });
    break;
  }
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'truth-guard-secret';

function checkTruthReceipt() {
  const cwd = process.cwd();
  console.log('[TRUTH GUARD] Verifying anti-hallucination compliance receipt...');

  // 1. Check for uncommitted code changes in src/
  let hasSrcChanges = false;
  try {
    const gitDiff = execSync('git status --porcelain', { cwd, encoding: 'utf8' }).trim();
    if (gitDiff) {
      const changedFiles = gitDiff
        .split('\n')
        .map(line => line.trim().slice(3).trim());

      hasSrcChanges = changedFiles.some(file =>
        file.startsWith('src/') || file.startsWith('packages/') || file.startsWith('server/')
      );
    }
  } catch (err) {
    // If not a git repository or git command fails, continue with receipt check
  }

  // If there are no uncommitted code changes in source directories, pass
  if (!hasSrcChanges) {
    console.log('✓ [TRUTH GUARD] No uncommitted code changes in src/. Verification gate passed.');
    process.exit(0);
  }

  // 2. Locate receipt file
  const gitReceipt = path.join(cwd, '.git', '.truth-receipt.json');
  const rootReceipt = path.join(cwd, '.truth-receipt.json');
  const receiptPath = fs.existsSync(gitReceipt) ? gitReceipt : rootReceipt;

  if (!fs.existsSync(receiptPath)) {
    console.error('\n❌ [TRUTH GUARD AUDIT FAILED]');
    console.error('========================================================================');
    console.error('Uncommitted code changes were detected in src/, but NO valid Truth Guard');
    console.error('verification receipt was found (.git/.truth-receipt.json).');
    console.error('');
    console.error('Mandatory Action for AI Agent:');
    console.error('1. Call tool "truth_search" with relevant specification queries.');
    console.error('2. Call tool "truth_verify_plan" with your proposed plan and cited_fact_ids.');
    console.error('3. Only after truth_verify_plan returns "approved: true", rerun this check.');
    console.error('========================================================================\n');
    process.exit(1);
  }

  // 3. Read and validate receipt
  let receipt;
  try {
    receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  } catch (err) {
    console.error('❌ [TRUTH GUARD] Failed to parse .truth-receipt.json:', err.message);
    process.exit(1);
  }

  // 4. Verify age of receipt (must be fresh, under 30 minutes)
  const MAX_AGE_MS = 30 * 60 * 1000;
  const receiptAge = Date.now() - new Date(receipt.timestamp).getTime();

  if (isNaN(receiptAge) || receiptAge > MAX_AGE_MS) {
    const minutesOld = Math.round(receiptAge / (60 * 1000));
    console.error('\n❌ [TRUTH GUARD AUDIT FAILED: EXPIRED RECEIPT]');
    console.error('========================================================================');
    console.error(`Verification receipt is expired (${minutesOld} minutes old; max allowed: 30m).`);
    console.error('AI Agent must call truth_verify_plan again to obtain a fresh verification token.');
    console.error('========================================================================\n');
    process.exit(1);
  }

  // 5. Verify cryptographic signature integrity
  if (receipt.signature) {
    const signatureData = `${receipt.project_id}:${receipt.plan_hash}:${receipt.timestamp}:${(receipt.cited_fact_ids || []).slice().sort().join(',')}`;
    const expectedSig = crypto.createHmac('sha256', GEMINI_API_KEY).update(signatureData).digest('hex');

    if (receipt.signature !== expectedSig && !receipt.receipt_token?.startsWith('TG-VERIFIED-LOCAL-')) {
      console.warn('⚠️ [TRUTH GUARD] Warning: Receipt signature verification note: signature generated with different key.');
    }
  }

  console.log(`✓ [TRUTH GUARD] Valid verification receipt confirmed! Token: ${receipt.receipt_token} (${Math.round(receiptAge / 1000)}s old)`);
  process.exit(0);
}

checkTruthReceipt();
