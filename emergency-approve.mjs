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

const INSECURE_PLACEHOLDERS = [
  'replace-with-a-long-random-secret',
  'your-hmac-secret-here',
  'default-secret-change-me',
  '12345678901234567890123456789012',
  'abcdefabcdefabcdefabcdefabcdefab'
];

function validateHmacSecret(key) {
  if (!key || typeof key !== 'string') {
    return { ok: false, reason: 'TRUTH_GUARD_HMAC_SECRET is missing.' };
  }
  const trimmed = key.trim();
  if (trimmed.length < 32) {
    return { ok: false, reason: `TRUTH_GUARD_HMAC_SECRET is too short (${trimmed.length} chars). Minimum 32 required.` };
  }
  if (INSECURE_PLACEHOLDERS.includes(trimmed.toLowerCase())) {
    return { ok: false, reason: 'TRUTH_GUARD_HMAC_SECRET contains an insecure default placeholder.' };
  }
  return { ok: true, key: trimmed };
}

// 2. Strict TTY requirement: Must be executed by a human in an interactive terminal
if (!process.stdin.isTTY) {
  console.error('\n❌ [EMERGENCY OVERRIDE REFUSED: NON-INTERACTIVE ENVIRONMENT]');
  console.error('This script MUST be executed interactively by a human operator in a real terminal.');
  console.error('Automated AI agents are strictly forbidden from self-authorizing overrides.\n');
  process.exit(1);
}

function getCanonicalSignaturePayload(receipt) {
  return JSON.stringify({
    receipt_token: receipt.receipt_token,
    project_id: receipt.project_id,
    plan_hash: receipt.plan_hash,
    target_files: receipt.target_files.slice().sort(),
    timestamp: receipt.timestamp,
    cited_fact_ids: receipt.cited_fact_ids.slice().sort()
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
  const pendingFile = hasGitDir
    ? path.join(gitDir, '.truth-pending-rule.json')
    : path.join(cwd, '.truth-pending-rule.json');

  if (!fs.existsSync(pendingFile)) {
    console.log('\n[TRUTH GUARD] No pending rule proposal found at:', pendingFile);
    console.log('No spec mutations are pending human approval.\n');
    process.exit(0);
  }

  let proposal;
  try {
    proposal = JSON.parse(fs.readFileSync(pendingFile, 'utf8'));
  } catch (err) {
    console.error('Failed to parse pending rule proposal:', err.message);
    process.exit(1);
  }

  console.log('\n╔════════════════════════════════════════════════════════════════════════╗');
  console.log('║           TRUTH GUARD: SPEC MUTATION HUMAN APPROVAL GATE               ║');
  console.log('╚════════════════════════════════════════════════════════════════════════╝');
  console.log(`Target File:   ${proposal.file_path}`);
  console.log(`Section Title: ${proposal.section_title}`);
  console.log(`Scope:         ${proposal.scope || 'project'}`);
  console.log('\n--- Proposed Content Preview ---');
  console.log(proposal.content ? proposal.content.slice(0, 1000) : '(empty)');
  console.log('--------------------------------\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('Apply this rule modification to ground truth specifications? [y/N]: ', ans => {
    rl.close();
    if (ans.trim().toLowerCase() !== 'y') {
      console.log('\n❌ Spec mutation rejected by human operator. Staged proposal kept.\n');
      process.exit(0);
    }

    const rel = path.relative(cwd, path.resolve(cwd, proposal.file_path));
    if (rel.startsWith('..') || path.isAbsolute(proposal.file_path)) {
      console.error('\n❌ Path traversal rejected: file_path must be within workspace.');
      process.exit(1);
    }
    const ext = path.extname(proposal.file_path).toLowerCase();
    if (!['.md', '.ts'].includes(ext)) {
      console.error('\n❌ Invalid extension: only .md and .ts specifications can be mutated.');
      process.exit(1);
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
  // 4. Emergency receipt issuance
  const hmacCheck = validateHmacSecret(process.env.TRUTH_GUARD_HMAC_SECRET);
  if (!hmacCheck.ok) {
    console.error('\n❌ [EMERGENCY OVERRIDE FAILED: INSECURE HMAC SECRET]');
    console.error(hmacCheck.reason);
    console.error('Please configure a valid TRUTH_GUARD_HMAC_SECRET (>= 32 chars).\n');
    process.exit(1);
  }

  let changedFiles = [];
  try {
    const raw = execSync('git status --porcelain=v1 -z', { cwd, encoding: 'utf8' });
    if (raw) {
      const entries = raw.split('\0').filter(Boolean);
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (entry.length < 3) continue;
        const statusCode = entry.slice(0, 2);
        let filePath = entry.slice(3).trim();
        if (statusCode.includes('R') || statusCode.includes('C')) {
          i++;
          if (i < entries.length && entries[i]) filePath = entries[i].trim();
        }
        if (filePath) changedFiles.push(filePath.replace(/\\/g, '/'));
      }
    }
  } catch (e) {
    console.error('Failed to inspect git repository status:', e.message);
    process.exit(1);
  }

  const SAFE_PATHS = [
    'docs/', '.agent/', '.git/', '.truth-receipt.json', 'HANDOVER.md',
    'PITFALLS.md', 'README.md', 'README.uk.md', 'PROMPTS.md', 'PROMPTS.uk.md',
    'global-rules.md', 'global-rules.uk.md'
  ];

  const codeChangedFiles = changedFiles.filter(file =>
    !SAFE_PATHS.some(safe => file === safe || file.startsWith(safe))
  );

  if (codeChangedFiles.length === 0) {
    console.log('\n✓ [TRUTH GUARD] No uncommitted code changes detected. Working tree clean.');
    console.log('No emergency verification receipt is required.\n');
    process.exit(0);
  }

  console.log('\n╔════════════════════════════════════════════════════════════════════════╗');
  console.log('║           TRUTH GUARD: MANUAL EMERGENCY HUMAN APPROVAL GATE            ║');
  console.log('╚════════════════════════════════════════════════════════════════════════╝');
  console.log(`Active Project: ${projectId}`);
  console.log(`Directory:      ${cwd}`);
  console.log('\nUncommitted code files awaiting human authorization:');
  codeChangedFiles.forEach(f => console.log(`  [+] ${f}`));
  console.log('\n⚠️  WARNING: You are about to issue a signed verification receipt manually,');
  console.log('bypassing the automated Gemini AI auditor. Use this ONLY during emergency.\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('Are you SURE you want to authorize these changes? [y/N]: ', answer => {
    rl.close();
    if (answer.trim().toLowerCase() !== 'y') {
      console.log('\n❌ Emergency approval cancelled by human operator. No receipt created.\n');
      process.exit(0);
    }

    const timestamp = new Date().toISOString();
    const receiptToken = `TG-EMERGENCY-HUMAN-${crypto.randomBytes(6).toString('hex')}`;
    const planHash = crypto.createHash('sha256').update('MANUAL_HUMAN_EMERGENCY_OVERRIDE').digest('hex');
    const citedFactIds = ['manual:emergency-human-override'];

    const receipt = {
      timestamp,
      project_id: projectId,
      tier: 'MANUAL_HUMAN_OVERRIDE',
      status: 'APPROVED_BY_HUMAN_OPERATOR',
      cited_fact_ids: citedFactIds,
      target_files: codeChangedFiles.slice().sort(),
      plan_hash: planHash,
      receipt_token: receiptToken,
      consumed: false
    };

    const payload = getCanonicalSignaturePayload(receipt);
    receipt.signature = crypto.createHmac('sha256', hmacCheck.key).update(payload).digest('hex');

    const receiptPath = hasGitDir
      ? path.join(gitDir, '.truth-receipt.json')
      : path.join(cwd, '.truth-receipt.json');

    try {
      fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), 'utf8');
      console.log('\n========================================================================');
      console.log('✅ EMERGENCY RECEIPT ISSUED SUCCESSFULLY!');
      console.log(`Token:      ${receiptToken}`);
      console.log(`Receipt:    ${receiptPath}`);
      console.log(`Authorized: ${codeChangedFiles.length} files`);
      console.log('Valid for:  15 minutes');
      console.log('========================================================================\n');
      process.exit(0);
    } catch (err) {
      console.error('\n❌ Failed to write receipt:', err.message);
      process.exit(1);
    }
  });
}
