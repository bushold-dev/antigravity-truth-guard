#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import readline from 'readline';
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

const PLACEHOLDERS = ['replace-with-a-long-random-secret', 'your-256-bit-hex-secret-here', 'truth-guard-secret', 'default-secret', 'changeme'];

function validateHmacSecret(key) {
  if (!key || typeof key !== 'string' || key.length < 32 || PLACEHOLDERS.includes(key.trim().toLowerCase())) {
    return { ok: false, reason: 'TRUTH_GUARD_HMAC_SECRET missing or insecure in ~/.gemini/antigravity/truth-guard/.env' };
  }
  return { ok: true, key: key.trim() };
}

if (!process.stdin.isTTY) {
  console.error('\n❌ [EMERGENCY OVERRIDE REFUSED: NON-INTERACTIVE ENVIRONMENT]');
  console.error('This script MUST be executed interactively by a human operator in a real terminal.\n');
  process.exit(1);
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

const cwd = process.cwd();
const projectId = detectCurrentProjectId(cwd);
const gitDir = path.join(cwd, '.git');
const hasGitDir = fs.existsSync(gitDir) && fs.statSync(gitDir).isDirectory();

// 3. Handle --apply-rule flag
if (process.argv.includes('--apply-rule')) {
  const pendingFile = hasGitDir ? path.join(gitDir, '.truth-pending-rule.json') : path.join(cwd, '.truth-pending-rule.json');
  if (!fs.existsSync(pendingFile)) {
    console.log('\n[TRUTH GUARD] No pending rule proposal found at:', pendingFile);
    process.exit(0);
  }

  let proposal;
  try { proposal = JSON.parse(fs.readFileSync(pendingFile, 'utf8')); } catch (e) {
    console.error('Failed to parse proposal:', e.message); process.exit(1);
  }

  console.log('\n╔════════════════════════════════════════════════════════════════════════╗');
  console.log('║           TRUTH GUARD: SPEC MUTATION HUMAN APPROVAL GATE               ║');
  console.log('╚════════════════════════════════════════════════════════════════════════╝');
  console.log(`Target File:   ${proposal.file_path}`);
  console.log(`Section Title: ${proposal.section_title}\n`);
  console.log(proposal.content ? proposal.content.slice(0, 500) : '(empty)');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('\nApply this rule modification to ground truth specifications? [y/N]: ', ans => {
    rl.close();
    if (ans.trim().toLowerCase() !== 'y') {
      console.log('\n❌ Spec mutation rejected by human operator.\n'); process.exit(0);
    }
    const rel = path.relative(cwd, path.resolve(cwd, proposal.file_path));
    if (rel.startsWith('..') || path.isAbsolute(proposal.file_path)) {
      console.error('\n❌ Path traversal rejected.'); process.exit(1);
    }
    const targetFile = path.resolve(cwd, proposal.file_path);
    let content = fs.existsSync(targetFile) ? fs.readFileSync(targetFile, 'utf8') : '';
    content += `\n\n## ${proposal.section_title}\n\n${proposal.content}\n`;
    fs.writeFileSync(targetFile, content.trim() + '\n', 'utf8');
    try { fs.unlinkSync(pendingFile); } catch {}
    console.log(`\n✅ Specification updated successfully: ${proposal.file_path}#${proposal.section_title}\n`);
    process.exit(0);
  });
} else {
  // 4. Emergency receipt issuance with base_commit and diff_hash
  const hmacCheck = validateHmacSecret(process.env.TRUTH_GUARD_HMAC_SECRET);
  if (!hmacCheck.ok) {
    console.error('\n❌ [EMERGENCY OVERRIDE FAILED]', hmacCheck.reason); process.exit(1);
  }

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
  } catch (e) {
    console.error('Failed to inspect git status:', e.message); process.exit(1);
  }

  const SAFE_PATHS = ['docs/', '.agent/', '.git/', '.truth-receipt.json', 'HANDOVER.md', 'PITFALLS.md', 'README.md', 'README.uk.md', 'PROMPTS.md', 'PROMPTS.uk.md', 'global-rules.md', 'global-rules.uk.md'];
  const codeChangedFiles = changedFiles.filter(f => !SAFE_PATHS.some(s => f === s || f.startsWith(s)));
  if (codeChangedFiles.length === 0) {
    console.log('\n✓ [TRUTH GUARD] No uncommitted code changes. Working tree clean.\n'); process.exit(0);
  }

  console.log('\n╔════════════════════════════════════════════════════════════════════════╗');
  console.log('║           TRUTH GUARD: MANUAL EMERGENCY HUMAN APPROVAL GATE            ║');
  console.log('╚════════════════════════════════════════════════════════════════════════╝');
  console.log(`Active Project: ${projectId}`);
  console.log('\nUncommitted code files awaiting human authorization:');
  codeChangedFiles.forEach(f => console.log(`  [+] ${f}`));

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('\nAre you SURE you want to authorize these changes? [y/N]: ', answer => {
    rl.close();
    if (answer.trim().toLowerCase() !== 'y') {
      console.log('\n❌ Emergency approval cancelled by operator.\n'); process.exit(0);
    }

    const timestamp = new Date().toISOString();
    const receiptToken = `TG-EMERGENCY-HUMAN-${crypto.randomBytes(6).toString('hex')}`;
    const planHash = crypto.createHash('sha256').update('MANUAL_HUMAN_EMERGENCY_OVERRIDE').digest('hex');
    const baseCommit = getBaseCommit(cwd);
    const diffHash = computeCanonicalDiffHash(cwd, baseCommit, codeChangedFiles);

    const receipt = {
      timestamp,
      project_id: projectId,
      base_commit: baseCommit,
      diff_hash: diffHash,
      tier: 'MANUAL_HUMAN_OVERRIDE',
      status: 'APPROVED_BY_HUMAN_OPERATOR',
      cited_fact_ids: ['manual:emergency-human-override'],
      target_files: codeChangedFiles.slice().sort(),
      plan_hash: planHash,
      receipt_token: receiptToken,
      consumed: false
    };

    const payload = getCanonicalSignaturePayload(receipt);
    receipt.signature = crypto.createHmac('sha256', hmacCheck.key).update(payload).digest('hex');

    const receiptPath = hasGitDir ? path.join(gitDir, '.truth-receipt.json') : path.join(cwd, '.truth-receipt.json');
    try {
      fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), 'utf8');
      console.log(`\n✅ EMERGENCY RECEIPT ISSUED! Token: ${receiptToken} (diff_hash: ${diffHash.slice(0, 12)}...)\n`);
      process.exit(0);
    } catch (err) {
      console.error('\n❌ Failed to write receipt:', err.message); process.exit(1);
    }
  });
}
