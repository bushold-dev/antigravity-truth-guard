#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import crypto from 'crypto';
import dotenv from 'dotenv';

// 1. Resolve environment & HMAC secret
const envPaths = [
  path.join(process.env.USERPROFILE || process.env.HOME || '', '.gemini', 'antigravity', 'truth-guard', '.env'),
  path.join(process.cwd(), '.env')
];
for (const p of envPaths) {
  if (fs.existsSync(p)) dotenv.config({ path: p, override: false });
}

const HMAC_KEY = process.env.TRUTH_GUARD_HMAC_SECRET;
const PLACEHOLDERS = ['replace-with-a-long-random-secret', 'your-256-bit-hex-secret-here', 'truth-guard-secret', 'default-secret', 'changeme'];

function validateHmacSecret(key) {
  if (!key || typeof key !== 'string' || key.length < 32 || PLACEHOLDERS.includes(key.trim().toLowerCase())) {
    console.error('\n❌ [TRUTH GUARD AUDIT FAILED: MISSING OR INSECURE HMAC SECRET]');
    console.error('TRUTH_GUARD_HMAC_SECRET must be >= 32 chars and not a placeholder in ~/.gemini/antigravity/truth-guard/.env\n');
    process.exit(1);
  }
}

export function getBaseCommit(cwd) {
  try {
    return execSync('git rev-parse HEAD', { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
  } catch {
    return '0000000000000000000000000000000000000000';
  }
}

export function computeCanonicalDiffHash(cwd, baseCommit, targetFiles = []) {
  let diffText = '';
  try {
    const filesArg = (targetFiles && targetFiles.length > 0) ? targetFiles.map(f => `"${f.replace(/\\/g, '/')}"`).join(' ') : '';
    const base = baseCommit || 'HEAD';
    const cmd = filesArg ? `git diff --no-color --ignore-space-at-eol ${base} -- ${filesArg}` : `git diff --no-color --ignore-space-at-eol ${base}`;
    diffText = execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }) || '';
  } catch {}

  let untrackedContent = '';
  if (Array.isArray(targetFiles)) {
    for (const f of targetFiles.slice().sort()) {
      const fullPath = path.resolve(cwd, f);
      if (fs.existsSync(fullPath)) {
        try {
          execSync(`git ls-files --error-unmatch "${f.replace(/\\/g, '/')}"`, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
        } catch {
          const content = fs.readFileSync(fullPath, 'utf8').replace(/\r\n/g, '\n').trim();
          untrackedContent += `\nUNTRACKED:${f.replace(/\\/g, '/')}\n${content}\n`;
        }
      }
    }
  }
  return crypto.createHash('sha256').update((diffText.replace(/\r\n/g, '\n').trim() + untrackedContent).trim()).digest('hex');
}

export function getCanonicalSignaturePayload(receipt) {
  return JSON.stringify({
    receipt_token: receipt.receipt_token,
    project_id: receipt.project_id,
    base_commit: receipt.base_commit || '',
    diff_hash: receipt.diff_hash || '',
    plan_hash: receipt.plan_hash,
    target_files: Array.isArray(receipt.target_files) ? receipt.target_files.slice().sort() : [],
    timestamp: receipt.timestamp,
    cited_fact_ids: Array.isArray(receipt.cited_fact_ids) ? receipt.cited_fact_ids.slice().sort() : []
  });
}

function detectCurrentProjectId(cwd) {
  const baseName = path.basename(cwd).replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
  try {
    const pkgPath = path.join(cwd, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.name && !['react-example', 'my-app', 'template'].includes(pkg.name)) {
        return pkg.name.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
      }
    }
  } catch {}
  return baseName || 'default-project';
}

function checkTruthReceipt() {
  const cwd = process.cwd();
  console.log('[TRUTH GUARD] Verifying anti-hallucination compliance receipt...');
  validateHmacSecret(HMAC_KEY);

  // 1. Strict Git status inspection (Fail-closed on Git execution errors)
  let changedFiles = [];
  try {
    const raw = execSync('git status --porcelain=v1 -z', { cwd, encoding: 'utf8' });
    if (raw) {
      const entries = raw.split('\0').filter(Boolean);
      for (let i = 0; i < entries.length; i++) {
        if (entries[i].length < 3) continue;
        const code = entries[i].slice(0, 2);
        let fp = entries[i].slice(3).trim();
        if ((code.includes('R') || code.includes('C')) && i + 1 < entries.length) fp = entries[++i].trim();
        if (fp) changedFiles.push(fp.replace(/\\/g, '/'));
      }
    }
  } catch (err) {
    console.error('\n❌ [TRUTH GUARD AUDIT FAILED: GIT INSPECTION ERROR]', err.message);
    process.exit(1);
  }

  const SAFE_PATHS = ['docs/', '.agent/', '.git/', '.truth-receipt.json', 'HANDOVER.md', 'PITFALLS.md', 'README.md', 'README.uk.md', 'PROMPTS.md', 'PROMPTS.uk.md', 'global-rules.md', 'global-rules.uk.md'];
  const codeChangedFiles = changedFiles.filter(f => !SAFE_PATHS.some(s => f === s || f.startsWith(s)));
  if (codeChangedFiles.length === 0) {
    console.log('✓ [TRUTH GUARD] No uncommitted code changes in project. Verification gate passed.');
    process.exit(0);
  }

  // 2. Locate and parse receipt
  const gitDir = path.join(cwd, '.git');
  const receiptPath = fs.existsSync(path.join(gitDir, '.truth-receipt.json')) ? path.join(gitDir, '.truth-receipt.json') : path.join(cwd, '.truth-receipt.json');
  if (!fs.existsSync(receiptPath)) {
    console.error('\n❌ [TRUTH GUARD AUDIT FAILED: RECEIPT MISSING]');
    codeChangedFiles.forEach(f => console.error(`  - ${f}`));
    process.exit(1);
  }

  let receipt;
  try {
    receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  } catch (err) {
    console.error('❌ [TRUTH GUARD] Malformed receipt file:', err.message);
    process.exit(1);
  }

  // 3. Verify project_id, age (TTL 15m), and anti-replay ledger
  const currentProjectId = detectCurrentProjectId(cwd);
  if (receipt.project_id && receipt.project_id !== currentProjectId) {
    console.error(`\n❌ [TRUTH GUARD AUDIT FAILED: PROJECT ID MISMATCH (${receipt.project_id} vs ${currentProjectId})]\n`);
    process.exit(1);
  }

  const MAX_AGE_MS = 15 * 60 * 1000;
  const receiptAge = Date.now() - new Date(receipt.timestamp).getTime();
  if (isNaN(receiptAge) || receiptAge > MAX_AGE_MS) {
    console.error(`\n❌ [TRUTH GUARD AUDIT FAILED: EXPIRED RECEIPT (${Math.round(receiptAge / 60000)}m old; max 15m)]\n`);
    process.exit(1);
  }

  const ledgerPath = fs.existsSync(gitDir) && fs.statSync(gitDir).isDirectory() ? path.join(gitDir, '.truth-consumed-tokens') : path.join(cwd, '.truth-consumed-tokens');
  if (fs.existsSync(ledgerPath)) {
    const consumed = fs.readFileSync(ledgerPath, 'utf8').split(/\r?\n/).filter(Boolean);
    if (consumed.includes(receipt.receipt_token) || receipt.consumed === true) {
      console.error(`\n❌ [TRUTH GUARD AUDIT FAILED: REPLAY DETECTED (${receipt.receipt_token})]\n`);
      process.exit(1);
    }
  }

  // 4. Verify target_files boundary
  const normTargets = (receipt.target_files || []).map(t => t.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '').trim());
  const unauthorized = codeChangedFiles.filter(f => {
    const norm = f.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '').trim();
    return !normTargets.some(t => norm === t || norm.startsWith(t.endsWith('/') ? t : t + '/'));
  });
  if (unauthorized.length > 0) {
    console.error('\n❌ [TRUTH GUARD AUDIT FAILED: UNAUTHORIZED FILE MUTATION]');
    unauthorized.forEach(f => console.error(`  - ${f}`));
    process.exit(1);
  }

  // 5. Diff-Bound Authorization: Verify base_commit & diff_hash
  const currentHead = getBaseCommit(cwd);
  if (receipt.base_commit && receipt.base_commit !== '0000000000000000000000000000000000000000' && receipt.base_commit !== currentHead) {
    console.error('\n❌ [TRUTH GUARD AUDIT FAILED: STALE BASE COMMIT]');
    console.error(`Receipt signed against base commit: ${receipt.base_commit}, current HEAD: ${currentHead}\n`);
    process.exit(1);
  }

  const currentDiffHash = computeCanonicalDiffHash(cwd, receipt.base_commit, receipt.target_files);
  if (receipt.diff_hash && receipt.diff_hash !== currentDiffHash) {
    console.error('\n❌ [TRUTH GUARD AUDIT FAILED: DIFF INTEGRITY VIOLATION]');
    console.error(`Approved diff_hash: ${receipt.diff_hash}`);
    console.error(`Current diff_hash:  ${currentDiffHash}`);
    console.error('Code was modified after plan verification, or a previous token was reused.\n');
    process.exit(1);
  }

  // 6. Cryptographic signature check (timing-safe HMAC SHA-256)
  const signatureData = getCanonicalSignaturePayload(receipt);
  const expectedSig = crypto.createHmac('sha256', HMAC_KEY).update(signatureData).digest('hex');
  let isValidSig = false;
  try {
    const sBuf = Buffer.from(receipt.signature, 'hex');
    const eBuf = Buffer.from(expectedSig, 'hex');
    isValidSig = sBuf.length === eBuf.length && crypto.timingSafeEqual(sBuf, eBuf);
  } catch {}

  if (!isValidSig) {
    console.error('\n❌ [TRUTH GUARD AUDIT FAILED: INVALID SIGNATURE]');
    console.error('Cryptographic signature verification failed. Untrusted secret or tampered payload.\n');
    process.exit(1);
  }

  // 7. Consume receipt if --consume flag is passed (atomic & fail-closed)
  if (process.argv.includes('--consume')) {
    try {
      fs.appendFileSync(ledgerPath, `${receipt.receipt_token}\n`, 'utf8');
      fs.unlinkSync(receiptPath);
      console.log('✓ [TRUTH GUARD] Receipt token consumed in ledger and removed from disk.');
    } catch (e) {
      console.error('❌ [TRUTH GUARD AUDIT FAILED] Failed to consume receipt:', e.message);
      process.exit(1);
    }
  }

  console.log(`✓ [TRUTH GUARD] Valid verification receipt confirmed! Token: ${receipt.receipt_token}`);
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  checkTruthReceipt();
}
