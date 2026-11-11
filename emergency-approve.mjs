#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import readline from 'readline';
import crypto from 'crypto';
import dotenv from 'dotenv';

// 1. Resolve environment
const envPaths = [
  path.join(process.env.USERPROFILE || process.env.HOME || '', '.gemini', 'antigravity', 'truth-guard', '.env'),
  path.join(process.cwd(), '.env')
];
for (const p of envPaths) {
  if (fs.existsSync(p)) dotenv.config({ path: p, override: false });
}

const HMAC_KEY = process.env.TRUTH_GUARD_HMAC_SECRET || process.env.GEMINI_API_KEY;

// 2. Strict TTY requirement: Must be executed by a human in an interactive terminal
if (!process.stdin.isTTY) {
  console.error('\n❌ [EMERGENCY OVERRIDE REFUSED: NON-INTERACTIVE ENVIRONMENT]');
  console.error('========================================================================');
  console.error('This emergency override script MUST be executed interactively by a human');
  console.error('operator inside a real terminal (process.stdin.isTTY required).');
  console.error('Automated AI agents are strictly forbidden from self-authorizing overrides.');
  console.error('========================================================================\n');
  process.exit(1);
}

if (!HMAC_KEY) {
  console.error('\n❌ [EMERGENCY OVERRIDE FAILED: MISSING HMAC SECRET]');
  console.error('Neither TRUTH_GUARD_HMAC_SECRET nor GEMINI_API_KEY is configured.');
  console.error('Please configure your secret in ~/.gemini/antigravity/truth-guard/.env');
  process.exit(1);
}

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

const cwd = process.cwd();
const projectId = detectCurrentProjectId(cwd);

// 3. Inspect git status for uncommitted files
let changedFiles = [];
try {
  const raw = execSync('git status --porcelain', { cwd, encoding: 'utf8' });
  if (raw) {
    changedFiles = raw
      .split(/\r?\n/)
      .filter(line => line.length > 3)
      .map(line => {
        const filePathPart = line.slice(3).trim();
        const actualPath = filePathPart.includes(' -> ') ? filePathPart.split(' -> ')[1].trim() : filePathPart;
        return actualPath.replace(/^"|"$/g, '').replace(/\\/g, '/');
      })
      .filter(Boolean);
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
  console.log('\n✓ [TRUTH GUARD] No uncommitted code changes detected. Working tree is clean.');
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
console.log('bypassing the automated Gemini AI auditor. Use this ONLY during network');
console.log('outages or when API quota is exhausted.\n');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('Are you SURE you want to authorize these changes? [y/N]: ', answer => {
  rl.close();
  if (answer.trim().toLowerCase() !== 'y') {
    console.log('\n❌ Emergency approval cancelled by human operator. No receipt was created.\n');
    process.exit(0);
  }

  const timestamp = new Date().toISOString();
  const receiptToken = `TG-EMERGENCY-HUMAN-${crypto.randomBytes(6).toString('hex')}`;
  const planHash = crypto.createHash('sha256').update('MANUAL_HUMAN_EMERGENCY_OVERRIDE').digest('hex');
  const citedFactIds = ['manual:emergency-human-override'];
  const citedSorted = citedFactIds.join(',');
  const targetSorted = codeChangedFiles.slice().sort().join(',');

  const signatureData = `${receiptToken}:${projectId}:${planHash}:${targetSorted}:${timestamp}:${citedSorted}`;
  const signature = crypto.createHmac('sha256', HMAC_KEY).update(signatureData).digest('hex');

  const receipt = {
    timestamp,
    project_id: projectId,
    tier: 'MANUAL_HUMAN_OVERRIDE',
    status: 'APPROVED_BY_HUMAN_OPERATOR',
    cited_fact_ids: citedFactIds,
    target_files: codeChangedFiles,
    plan_hash: planHash,
    signature,
    receipt_token: receiptToken,
    consumed: false
  };

  const gitDir = path.join(cwd, '.git');
  const receiptPath = fs.existsSync(gitDir) && fs.statSync(gitDir).isDirectory()
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
    console.log('You can now proceed to run your verification checks or commit your work.');
    console.log('========================================================================\n');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Failed to write receipt:', err.message);
    process.exit(1);
  }
});
