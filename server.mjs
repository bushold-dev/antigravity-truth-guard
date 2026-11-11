#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Firestore, FieldValue } from '@google-cloud/firestore';
import { z } from 'zod';
import chokidar from 'chokidar';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Priority of .env resolution: current repo -> user home
const localEnv = path.join(__dirname, '.env');
const homeEnv = path.join(os.homedir(), '.gemini', 'antigravity', 'truth-guard', '.env');

if (fs.existsSync(localEnv)) {
  dotenv.config({ path: localEnv });
} else if (fs.existsSync(homeEnv)) {
  dotenv.config({ path: homeEnv });
} else {
  dotenv.config();
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GCP_PROJECT = process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || '';
const FIRESTORE_DATABASE = process.env.FIRESTORE_DATABASE || '(default)';

// Initialize Firestore if project is configured
let db = null;
if (GCP_PROJECT) {
  try {
    db = new Firestore({
      projectId: GCP_PROJECT,
      databaseId: FIRESTORE_DATABASE
    });
  } catch (err) {
    console.error('[truth-guard] Note: Firestore client initialization deferred:', err.message);
  }
}

const GUARD_HOME = fs.existsSync(homeEnv)
  ? path.dirname(homeEnv)
  : __dirname;

const HASHES_FILE = path.join(GUARD_HOME, '.truth-hashes.json');
const QUOTA_FILE = path.join(GUARD_HOME, 'quota-tracker.json');
const MIRROR_FILE = path.join(GUARD_HOME, 'local-mirror.json');
const ACTIVITY_LOG_FILE = path.join(GUARD_HOME, 'activity.log');
const GLOBAL_RULES_FILE = path.join(__dirname, 'global-rules.md');
const GLOBAL_RULES_DIR = path.join(GUARD_HOME, 'global-rules');

if (!fs.existsSync(GLOBAL_RULES_DIR)) {
  fs.mkdirSync(GLOBAL_RULES_DIR, { recursive: true });
}

// Limits
const FREE_TIER_DAILY_LIMIT = Number(process.env.FREE_TIER_DAILY_LIMIT) || 1400; // Free Tier quota buffer (out of 1500)
const CIRCUIT_BREAKER_HARD_CAP = Number(process.env.CIRCUIT_BREAKER_HARD_CAP) || 5000; // Emergency hard cap against runaway billing

// Global In-Memory RAM Mirror
let ramMirror = []; // Array of cached chunk objects

// Activity Logger
export function logActivity(action, details = {}) {
  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] [${action}] ${JSON.stringify(details)}\n`;
  try {
    fs.appendFileSync(ACTIVITY_LOG_FILE, entry, 'utf8');
  } catch {}
}

export function getRecentActivities(maxLines = 10) {
  if (!fs.existsSync(ACTIVITY_LOG_FILE)) return [];
  try {
    const lines = fs.readFileSync(ACTIVITY_LOG_FILE, 'utf8').trim().split('\n');
    return lines.slice(-maxLines);
  } catch {
    return [];
  }
}

// Quota & Tier Manager
export function getQuotaTracker() {
  const today = new Date().toISOString().slice(0, 10);
  let data = {
    date: today,
    free_tier_used: 0,
    payg_tier_used: 0,
    total_used: 0,
    circuit_breaker_tripped: false
  };

  if (fs.existsSync(QUOTA_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(QUOTA_FILE, 'utf8'));
      if (parsed.date === today) {
        data = {
          date: today,
          free_tier_used: parsed.free_tier_used ?? parsed.used ?? 0,
          payg_tier_used: parsed.payg_tier_used ?? 0,
          total_used: parsed.total_used ?? parsed.used ?? 0,
          circuit_breaker_tripped: Boolean(parsed.circuit_breaker_tripped)
        };
      }
    } catch {}
  }

  const getTier = () => {
    if (data.circuit_breaker_tripped || data.total_used >= CIRCUIT_BREAKER_HARD_CAP) {
      return 'LOCAL_FALLBACK';
    }
    if (data.total_used >= FREE_TIER_DAILY_LIMIT) {
      return 'CLOUD_PAYG';
    }
    return 'CLOUD_FREE';
  };

  const save = () => {
    try {
      fs.writeFileSync(QUOTA_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch {}
  };

  return {
    getTier,
    getTotalUsed: () => data.total_used,
    getFreeUsed: () => data.free_tier_used,
    getPaygUsed: () => data.payg_tier_used,
    isCircuitBreakerTripped: () => data.circuit_breaker_tripped || data.total_used >= CIRCUIT_BREAKER_HARD_CAP,
    recordUsage: (count = 1) => {
      data.total_used += count;
      if (data.total_used <= FREE_TIER_DAILY_LIMIT) {
        data.free_tier_used += count;
      } else {
        data.payg_tier_used += count;
      }

      if (data.total_used >= CIRCUIT_BREAKER_HARD_CAP && !data.circuit_breaker_tripped) {
        data.circuit_breaker_tripped = true;
        logActivity('CIRCUIT_BREAKER_TRIPPED', {
          total_used: data.total_used,
          reason: `Exceeded hard cap of ${CIRCUIT_BREAKER_HARD_CAP} calls/day. Forced LOCAL_FALLBACK_MODE.`
        });
        console.error(`[truth-guard] CRITICAL: Hard cap of ${CIRCUIT_BREAKER_HARD_CAP} calls reached! Tripping circuit breaker.`);
      }
      save();
    },
    refundUsage: (count = 1) => {
      data.total_used = Math.max(0, data.total_used - count);
      if (data.payg_tier_used > 0) {
        const refundPayg = Math.min(data.payg_tier_used, count);
        data.payg_tier_used -= refundPayg;
        count -= refundPayg;
      }
      if (count > 0 && data.free_tier_used > 0) {
        data.free_tier_used = Math.max(0, data.free_tier_used - count);
      }
      if (data.total_used < CIRCUIT_BREAKER_HARD_CAP && data.circuit_breaker_tripped) {
        data.circuit_breaker_tripped = false;
      }
      save();
    },
    tripCircuitBreaker: (reason) => {
      data.circuit_breaker_tripped = true;
      logActivity('CIRCUIT_BREAKER_TRIPPED', { reason });
      save();
    }
  };
}

export function loadHashes() {
  if (fs.existsSync(HASHES_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(HASHES_FILE, 'utf8'));
    } catch {}
  }
  return {};
}

export function saveHashes(hashes) {
  try {
    fs.writeFileSync(HASHES_FILE, JSON.stringify(hashes, null, 2), 'utf8');
  } catch (err) {
    console.error('[truth-guard] Failed to save hashes:', err.message);
  }
}

export function detectProjectId(cwd = process.cwd()) {
  const baseName = path.basename(cwd).replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
  if (baseName && baseName !== 'antigravity' && baseName !== 'src' && baseName !== 'workspace' && baseName !== 'system32') {
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

  try {
    const projDir = path.join(os.homedir(), '.gemini', 'config', 'projects');
    if (fs.existsSync(projDir)) {
      const files = fs.readdirSync(projDir);
      for (const f of files) {
        if (f.endsWith('.json')) {
          const pData = JSON.parse(fs.readFileSync(path.join(projDir, f), 'utf8'));
          if (pData.name && pData.name.toLowerCase() !== 'swarm/swarm_board') {
            return pData.name.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
          }
        }
      }
    }
  } catch {}

  return baseName || 'default-project';
}

export function getProjectDirByProjectId(targetProject) {
  if (!targetProject) return null;
  try {
    const projDir = path.join(os.homedir(), '.gemini', 'config', 'projects');
    if (fs.existsSync(projDir)) {
      const files = fs.readdirSync(projDir).filter(f => f.endsWith('.json'));
      for (const f of files) {
        const pData = JSON.parse(fs.readFileSync(path.join(projDir, f), 'utf8'));
        if (pData.name && pData.name.toLowerCase() === targetProject.toLowerCase()) {
          const res = pData.projectResources?.resources || [];
          for (const r of res) {
            const uri = r.gitFolder?.folderUri || r.folderUri;
            if (uri) {
              const decoded = decodeURIComponent(uri.replace(/^file:\/\/\/?/, ''));
              return decoded.replace(/\//g, path.sep);
            }
          }
        }
      }
    }
  } catch {}
  return null;
}

export function getAuthorizedProjectDirs() {
  const authorized = new Set();
  try {
    authorized.add(fs.realpathSync(process.cwd()));
  } catch {
    authorized.add(path.resolve(process.cwd()));
  }

  try {
    const projDir = path.join(os.homedir(), '.gemini', 'config', 'projects');
    if (fs.existsSync(projDir)) {
      const files = fs.readdirSync(projDir).filter(f => f.endsWith('.json'));
      for (const f of files) {
        try {
          const pData = JSON.parse(fs.readFileSync(path.join(projDir, f), 'utf8'));
          const res = pData.projectResources?.resources || [];
          for (const r of res) {
            const uri = r.gitFolder?.folderUri || r.folderUri;
            if (uri) {
              const decoded = decodeURIComponent(uri.replace(/^file:\/\/\/?/, ''));
              const fsPath = decoded.replace(/\//g, path.sep);
              if (fs.existsSync(fsPath)) {
                authorized.add(fs.realpathSync(fsPath));
              }
            }
          }
        } catch {}
      }
    }
  } catch {}

  return Array.from(authorized);
}

export function validateAndResolveProjectDir(projectDir, projectId) {
  const authorizedDirs = getAuthorizedProjectDirs();
  const defaultDir = (projectId && getProjectDirByProjectId(projectId)) || process.cwd();
  let defaultReal;
  try {
    defaultReal = fs.realpathSync(defaultDir);
  } catch {
    defaultReal = path.resolve(defaultDir);
  }

  if (!projectDir) {
    return defaultReal;
  }

  try {
    const resolved = path.resolve(projectDir);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      console.warn(`[truth-guard] Warning: Supplied project_dir does not exist or is not a directory: ${projectDir}. Using default.`);
      return defaultReal;
    }

    const realCandidate = fs.realpathSync(resolved);
    const isAuthorized = authorizedDirs.some(authDir => {
      const rel = path.relative(authDir, realCandidate);
      return !rel.startsWith('..') && !path.isAbsolute(rel);
    });

    if (!isAuthorized) {
      console.warn(`[truth-guard] Security Alert: Supplied project_dir (${projectDir}) is outside authorized project workspaces. Falling back to verified default (${defaultReal}).`);
      return defaultReal;
    }

    return realCandidate;
  } catch (err) {
    console.warn(`[truth-guard] Error validating project_dir: ${err.message}. Using default.`);
    return defaultReal;
  }
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 50) || 'section';
}

export function computeFactId(projectId, relPath, sectionTitle) {
  const normPath = relPath.replace(/\\/g, '/');
  return `${projectId}:${normPath}#${slugify(sectionTitle)}`;
}

export function computeDocId(factId) {
  return crypto.createHash('sha256').update(factId).digest('hex').slice(0, 32);
}

// RAM Mirror Sync & Persistence
export async function syncRamMirrorFromFirestore(projectId) {
  console.error(`[truth-guard] Preloading RAM mirror for [${projectId}, 'global']...`);

  if (db) {
    try {
      const snap = await db.collection('truth_chunks')
        .where('project_id', 'in', [projectId, 'global'])
        .get();

      const loaded = [];
      snap.forEach(doc => {
        const d = doc.data();
        const vec = d.embedding?._values || d.embedding?.values || null;
        loaded.push({
          fact_id: d.fact_id,
          project_id: d.project_id,
          file_path: d.file_path,
          section_title: d.section_title,
          content: d.content,
          sha256: d.sha256,
          embedding: vec
        });
      });

      ramMirror = loaded;
      try {
        fs.writeFileSync(MIRROR_FILE, JSON.stringify(ramMirror, null, 2), 'utf8');
      } catch {}

      logActivity('SYNC_MIRROR', {
        project_id: projectId,
        chunks_loaded: ramMirror.length,
        source: 'firestore'
      });
      console.error(`[truth-guard] RAM mirror loaded: ${ramMirror.length} chunks ready in memory (0 Firestore reads during conversations).`);
      return ramMirror.length;
    } catch (err) {
      console.error('[truth-guard] Firestore preload notice:', err.message);
    }
  }

  // Local mirror file fallback
  if (fs.existsSync(MIRROR_FILE)) {
    try {
      ramMirror = JSON.parse(fs.readFileSync(MIRROR_FILE, 'utf8'));
      logActivity('SYNC_MIRROR', {
        project_id: projectId,
        chunks_loaded: ramMirror.length,
        source: 'local-mirror-file'
      });
      console.error(`[truth-guard] Loaded ${ramMirror.length} chunks from ${MIRROR_FILE}`);
      return ramMirror.length;
    } catch {}
  }
  return 0;
}

export function updateRamMirrorChunk(chunkData) {
  const idx = ramMirror.findIndex(c => c.fact_id === chunkData.fact_id);
  if (idx >= 0) {
    ramMirror[idx] = chunkData;
  } else {
    ramMirror.push(chunkData);
  }
  try {
    fs.writeFileSync(MIRROR_FILE, JSON.stringify(ramMirror, null, 2), 'utf8');
  } catch {}
}

// Embedding Generation with Fallback
export async function generateEmbedding(text, retries = 2) {
  const tracker = getQuotaTracker();
  if (tracker.isCircuitBreakerTripped() || !GEMINI_API_KEY) {
    return null; // Local fallback mode
  }

  const models = [
    'models/gemini-embedding-001',
    'models/gemini-embedding-2-preview'
  ];

  for (let attempt = 0; attempt < retries; attempt++) {
    for (const model of models) {
      if (tracker.isCircuitBreakerTripped()) {
        return null;
      }

      // Pre-reserve quota slot atomically
      tracker.recordUsage(1);
      let consumed = false;

      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/${model}:embedContent?key=${GEMINI_API_KEY}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            content: { parts: [{ text: text.slice(0, 8000) }] },
            outputDimensionality: 768
          })
        });

        if (res.status === 429) {
          console.error(`[truth-guard] 429 Rate limit on ${model}, backing off...`);
          tracker.refundUsage(1);
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }

        if (!res.ok) {
          tracker.refundUsage(1);
          continue;
        }

        const data = await res.json();
        if (data.embedding?.values) {
          consumed = true;
          let vals = data.embedding.values;
          if (vals.length > 768) vals = vals.slice(0, 768);
          while (vals.length < 768) vals.push(0);
          return vals;
        } else {
          tracker.refundUsage(1);
        }
      } catch (err) {
        console.error(`[truth-guard] Network error on ${model}:`, err.message);
        if (!consumed) {
          tracker.refundUsage(1);
        }
      }
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  return null;
}

export function splitMarkdown(content) {
  const normalized = content.replace(/\r/g, '');
  const lines = normalized.split('\n');
  const sections = [];
  let currentTitle = 'Overview';
  let currentLines = [];

  for (const line of lines) {
    const match = line.match(/^(#{1,4})\s+(.+)$/);
    if (match) {
      if (currentLines.length > 0 && currentLines.join('\n').trim().length > 10) {
        sections.push({
          title: currentTitle,
          content: currentLines.join('\n').trim()
        });
      }
      currentTitle = match[2].trim();
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length > 0 && currentLines.join('\n').trim().length > 10) {
    sections.push({
      title: currentTitle,
      content: currentLines.join('\n').trim()
    });
  }

  return sections;
}

export function splitSchema(filePath, content) {
  const sections = [];
  const exportRegex = /export\s+(?:const|type|interface|enum)\s+([A-Za-z0-9_]+)[\s:=]/g;
  let match;
  const indices = [];

  while ((match = exportRegex.exec(content)) !== null) {
    indices.push({ name: match[1], index: match.index });
  }

  if (indices.length === 0) {
    if (content.trim().length > 10) {
      sections.push({
        title: path.basename(filePath, path.extname(filePath)),
        content: content.trim()
      });
    }
    return sections;
  }

  for (let i = 0; i < indices.length; i++) {
    const cur = indices[i];
    const nextIdx = (i + 1 < indices.length) ? indices[i + 1].index : content.length;
    const chunk = content.slice(cur.index, nextIdx).trim();
    if (chunk.length > 10) {
      sections.push({
        title: cur.name,
        content: chunk
      });
    }
  }

  return sections;
}

export async function indexFile(filePath, rootDir, projectId, hashes) {
  try {
    if (!fs.existsSync(filePath)) return 0;
    const content = fs.readFileSync(filePath, 'utf8');
    const relPath = path.relative(rootDir, filePath).replace(/\\/g, '/');

    let sections = [];
    if (filePath.endsWith('.md')) {
      sections = splitMarkdown(content);
    } else if (filePath.endsWith('.ts')) {
      sections = splitSchema(filePath, content);
    }

    let indexedCount = 0;
    for (const sec of sections) {
      const sha256 = crypto.createHash('sha256').update(sec.content).digest('hex');
      const factId = computeFactId(projectId, relPath, sec.title);

      if (hashes[factId]?.sha256 === sha256) {
        continue;
      }

      console.error(`[truth-guard] Indexing chunk: ${factId}`);
      const embedding = await generateEmbedding(sec.content);
      const docId = computeDocId(factId);

      const chunkDoc = {
        fact_id: factId,
        project_id: projectId,
        file_path: relPath,
        section_title: sec.title,
        content: sec.content,
        sha256,
        embedding: embedding,
        updated_at: new Date().toISOString()
      };

      // 1. Update In-Memory Mirror
      updateRamMirrorChunk(chunkDoc);

      // 2. Persist to Firestore if available
      if (db) {
        try {
          await db.collection('truth_chunks').doc(docId).set({
            fact_id: factId,
            project_id: projectId,
            file_path: relPath,
            section_title: sec.title,
            content: sec.content,
            sha256,
            embedding: embedding ? FieldValue.vector(embedding) : null,
            updated_at: FieldValue.serverTimestamp()
          }, { merge: true });
        } catch (dbErr) {
          console.error(`[truth-guard] Firestore write notice for ${factId}:`, dbErr.message);
        }
      }

      hashes[factId] = { sha256, updated_at: Date.now() };
      indexedCount++;
      await new Promise(r => setTimeout(r, 100));
    }

    if (indexedCount > 0) {
      saveHashes(hashes);
    }
    return indexedCount;
  } catch (err) {
    console.error(`[truth-guard] Error indexing file ${filePath}:`, err.message);
    return 0;
  }
}

export async function indexProjectDirectory(rootDir, projectId) {
  console.error(`[truth-guard] Scanning directory for ${projectId}: ${rootDir}`);
  const hashes = loadHashes();
  let totalIndexed = 0;
  const files = [];

  function scanDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (['node_modules', '.git', 'dist', '.next', 'build', '.agent', '.aistudio', '.gemini', '.idx', '.tmp', 'brain', 'src', 'packages', 'server'].includes(ent.name)) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        scanDir(full);
      } else if (ent.isFile()) {
        if (ent.name.endsWith('.md')) {
          files.push(full);
        }
      }
    }
  }

  try {
    scanDir(rootDir);
  } catch (e) {
    console.error('[truth-guard] Scan error:', e.message);
  }

  for (const f of files) {
    totalIndexed += await indexFile(f, rootDir, projectId, hashes);
  }

  console.error(`[truth-guard] Directory scan complete. Total new/changed chunks indexed: ${totalIndexed}`);
  return totalIndexed;
}

export async function seedGlobalRules() {
  if (fs.existsSync(GLOBAL_RULES_FILE)) {
    console.error(`[truth-guard] Seeding 5 Universal Global Laws from ${GLOBAL_RULES_FILE}...`);
    const hashes = loadHashes();
    const count = await indexFile(GLOBAL_RULES_FILE, path.dirname(GLOBAL_RULES_FILE), 'global', hashes);
    console.error(`[truth-guard] Global laws seeded: ${count} updated chunks.`);
  }
}

// In-Memory Search (Cosine + BM25) with Priority Tagging (0 Firestore Reads)
export async function searchTruth({ query, include_global = true, target_project }) {
  const currentProjectId = target_project || detectProjectId();
  const allowedProjects = [currentProjectId];
  if (include_global) allowedProjects.push('global');

  // Filter chunks in memory
  const candidates = ramMirror.filter(c => allowedProjects.includes(c.project_id));

  // If RAM mirror is empty, attempt 1 sync
  if (candidates.length === 0) {
    await syncRamMirrorFromFirestore(currentProjectId);
  }

  const queryEmbedding = await generateEmbedding(query);
  const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  const scored = [];

  for (const chunk of ramMirror) {
    if (!allowedProjects.includes(chunk.project_id)) continue;

    let cosSim = 0;
    const vec = chunk.embedding;
    if (queryEmbedding && vec && Array.isArray(vec) && vec.length === queryEmbedding.length) {
      let dot = 0, normA = 0, normB = 0;
      for (let i = 0; i < vec.length; i++) {
        dot += vec[i] * queryEmbedding[i];
        normA += vec[i] * vec[i];
        normB += queryEmbedding[i] * queryEmbedding[i];
      }
      cosSim = dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-9);
    }

    let kwBonus = 0;
    const fullText = (chunk.section_title + ' ' + chunk.content).toLowerCase();
    for (const term of queryTerms) {
      if (fullText.includes(term)) kwBonus += 0.15;
    }

    // Priority Tagging: Project Override > Base Global
    const isProjectOverride = chunk.project_id === currentProjectId;
    const priorityTag = isProjectOverride ? 'HIGH (PROJECT OVERRIDE)' : 'BASE (GLOBAL)';
    const priorityWeight = isProjectOverride ? 1.05 : 1.0;

    let finalScore = (cosSim * 0.70 + kwBonus * 0.30) * priorityWeight;
    if (!queryEmbedding) {
      // In pure keyword mode (offline/fallback)
      finalScore = Math.min(1.0, kwBonus * priorityWeight);
    }
    finalScore = Number(Math.min(1.0, Math.max(0.0, finalScore)).toFixed(4));

    scored.push({
      fact_id: chunk.fact_id,
      project_id: chunk.project_id,
      priority: priorityTag,
      file_path: chunk.file_path,
      section_title: chunk.section_title,
      content: chunk.content,
      sha256: chunk.sha256,
      score: finalScore
    });
  }

  // Sort by score desc, project override wins on ties
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.project_id === currentProjectId && b.project_id !== currentProjectId) return -1;
    if (b.project_id === currentProjectId && a.project_id !== currentProjectId) return 1;
    return 0;
  });

  const topResults = scored.slice(0, 10);
  logActivity('SEARCH_QUERY', {
    query: query.slice(0, 80),
    project_id: currentProjectId,
    results_found: topResults.length
  });

  return topResults;
}

export function writeTruthReceipt({ projectId, citedFactIds, proposedPlan, targetFiles = [], projectDir = null, receiptToken }) {
  const planHash = crypto.createHash('sha256').update(proposedPlan).digest('hex');
  const timestamp = new Date().toISOString();
  const citedSorted = Array.isArray(citedFactIds) ? citedFactIds.slice().sort().join(',') : '';
  const targetSorted = Array.isArray(targetFiles) ? targetFiles.slice().sort().join(',') : '';

  const signatureData = targetSorted
    ? `${projectId}:${planHash}:${targetSorted}:${timestamp}:${citedSorted}`
    : `${projectId}:${planHash}:${timestamp}:${citedSorted}`;

  const signature = crypto.createHmac('sha256', GEMINI_API_KEY || 'truth-guard-secret').update(signatureData).digest('hex');

  const receipt = {
    timestamp,
    project_id: projectId,
    cited_fact_ids: citedFactIds,
    target_files: targetFiles,
    plan_hash: planHash,
    signature,
    receipt_token: receiptToken,
    consumed: false
  };

  // Resolve and validate target project directory against authorized workspaces
  const resolvedDir = validateAndResolveProjectDir(projectDir, projectId);

  const gitDir = path.join(resolvedDir, '.git');
  let targetPath;
  if (fs.existsSync(gitDir) && fs.statSync(gitDir).isDirectory()) {
    targetPath = path.join(gitDir, '.truth-receipt.json');
  } else {
    targetPath = path.join(resolvedDir, '.truth-receipt.json');
  }

  try {
    fs.writeFileSync(targetPath, JSON.stringify(receipt, null, 2), 'utf8');
    console.error(`[truth-guard] Wrote verification receipt to ${targetPath}`);
  } catch (err) {
    console.error(`[truth-guard] Failed to write receipt to ${targetPath}:`, err.message);
  }

  // Also write to current process cwd as fallback
  if (resolvedDir !== process.cwd()) {
    try {
      const fallbackGit = path.join(process.cwd(), '.git');
      const fallbackTarget = fs.existsSync(fallbackGit)
        ? path.join(fallbackGit, '.truth-receipt.json')
        : path.join(process.cwd(), '.truth-receipt.json');
      fs.writeFileSync(fallbackTarget, JSON.stringify(receipt, null, 2), 'utf8');
    } catch {}
  }

  return receipt;
}

// Robust Multi-Tier LLM Execution Engine
async function executeLLMVerification({ systemInstruction, userPrompt }) {
  const tracker = getQuotaTracker();
  const currentTier = tracker.getTier();

  // Tier 3: Emergency Circuit Breaker (Local Fallback)
  if (currentTier === 'LOCAL_FALLBACK' || !GEMINI_API_KEY) {
    console.error('[truth-guard] LOCAL_FALLBACK_MODE active: Circuit breaker triggered or offline.');
    return {
      tierUsed: 'LOCAL_FALLBACK',
      rawText: null
    };
  }

  // Tier 1: Free Tier (Google AI Studio)
  if (currentTier === 'CLOUD_FREE') {
    const models = [
      'models/gemini-2.5-flash',
      'models/gemini-3.8-flash',
      'models/gemini-flash-latest'
    ];

    for (const model of models) {
      if (tracker.isCircuitBreakerTripped()) break;

      // Pre-reserve quota slot atomically
      tracker.recordUsage(1);
      let consumed = false;

      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${GEMINI_API_KEY}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
            systemInstruction: { parts: [{ text: systemInstruction }] },
            generationConfig: { temperature: 0, responseMimeType: 'application/json' }
          })
        });

        if (res.status === 429) {
          console.error(`[truth-guard] 429 Rate limit on ${model}, escalating to Tier 2 (PAYG)...`);
          tracker.refundUsage(1);
          break; // Escalate to Tier 2
        }

        if (!res.ok) {
          tracker.refundUsage(1);
          continue;
        }

        const data = await res.json();
        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (rawText) {
          consumed = true;
          return { tierUsed: 'CLOUD_FREE', rawText };
        } else {
          tracker.refundUsage(1);
        }
      } catch (err) {
        console.error(`[truth-guard] Error on ${model}:`, err.message);
        if (!consumed) {
          tracker.refundUsage(1);
        }
      }
    }
  }

  // Tier 2: Paid Backup / PAYG (calls 1400-5000 or on 429)
  console.error('[truth-guard] Tier 2 PAYG backup activated...');
  logActivity('TIER_ESCALATION', { reason: 'Free tier limit reached or 429, using PAYG tier' });

  const paygModels = ['models/gemini-2.5-flash', 'models/gemini-1.5-flash'];
  for (const model of paygModels) {
    if (tracker.isCircuitBreakerTripped()) break;

    tracker.recordUsage(1);
    let consumed = false;

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${GEMINI_API_KEY}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          systemInstruction: { parts: [{ text: systemInstruction }] },
          generationConfig: { temperature: 0, responseMimeType: 'application/json' }
        })
      });

      if (!res.ok) {
        tracker.refundUsage(1);
        continue;
      }

      const data = await res.json();
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (rawText) {
        consumed = true;
        return { tierUsed: 'CLOUD_PAYG', rawText };
      } else {
        tracker.refundUsage(1);
      }
    } catch (e) {
      console.error(`[truth-guard] PAYG attempt failed for ${model}:`, e.message);
      if (!consumed) {
        tracker.refundUsage(1);
      }
    }
  }

  return { tierUsed: 'LOCAL_FALLBACK', rawText: null };
}

// Plan Verification Gate
export async function verifyPlan({
  proposed_plan,
  cited_fact_ids,
  target_files = [],
  project_dir = null,
  human_override = false,
  override_token = null
}) {
  const currentProjectId = detectProjectId();

  // Strict target_files validation (Law 3 Binding)
  if (!Array.isArray(target_files) || target_files.length === 0) {
    const rejectToken = `TG-REJECTED-${crypto.randomBytes(6).toString('hex')}`;
    return {
      approved: false,
      score: 0.0,
      hallucinations_or_missing_conditions: [
        'Law 3 Violation: target_files is strictly mandatory and must contain at least one target file path to bind the verification receipt to code changes.'
      ],
      receipt_token: rejectToken
    };
  }

  // Find cited facts from RAM mirror (0 Firestore reads)
  const citedFacts = [];
  const missingFactIds = [];

  for (const factId of cited_fact_ids) {
    const found = ramMirror.find(c => c.fact_id === factId);
    if (found) {
      citedFacts.push(found);
    } else {
      missingFactIds.push(factId);
    }
  }

  const systemInstruction = `You are a strict, zero-tolerance anti-hallucination auditor.
Verify whether every single step, database table, column name, status enum, rule, and assumption in PROPOSED PLAN is strictly grounded in the provided GROUND TRUTH FACTS.

Strict verification rules:
1. If the plan invents ANY unverified database table, database column, status enum, business calculation formula, or contradicts domain rules, flag it immediately as a hallucination.
2. If no ground truth facts were cited or found, and the plan specifies detailed architectural/database assertions, reject it for lack of grounding.
3. Implementation details (such as creating tests, refactoring scripts, or project tooling) that directly serve or verify the cited rules without violating architectural boundaries are allowed.
4. Output valid JSON strictly conforming to this schema:
{
  "approved": boolean,
  "score": number, // between 0.0 and 1.0 (1.0 = completely faithful, <0.9 = contains hallucinations or ungrounded assumptions)
  "hallucinations_or_missing_conditions": string[], // detailed list of issues or hallucinations found
  "receipt_token": string // e.g. "TG-VERIFIED-<hash>" if approved, "TG-REJECTED-<uuid>" if rejected
}`;

  const factsText = citedFacts.length > 0
    ? citedFacts.map((f, i) => `=== Fact ${i + 1} (${f.fact_id}) [${f.project_id === currentProjectId ? 'HIGH PRIORITY' : 'BASE GLOBAL'}] ===\nFile: ${f.file_path}\nTitle: ${f.section_title}\nContent:\n${f.content}\n`).join('\n')
    : 'NO GROUND TRUTH FACTS FOUND OR PROVIDED.';

  const userPrompt = `GROUND TRUTH FACTS:\n${factsText}\n\nPROPOSED PLAN TO VERIFY:\n${proposed_plan}\n\nVerify every single detail against the ground truth facts above. Return JSON.`;

  const { tierUsed, rawText } = await executeLLMVerification({ systemInstruction, userPrompt });

  // If LLM produced a result
  if (rawText) {
    try {
      const parsed = JSON.parse(rawText);
      const hallucinations = Array.isArray(parsed.hallucinations_or_missing_conditions)
        ? parsed.hallucinations_or_missing_conditions
        : [];

      if (missingFactIds.length > 0) {
        hallucinations.push(`Cited fact_ids not found in Truth Guard database: ${missingFactIds.join(', ')}`);
      }

      const score = typeof parsed.score === 'number' ? parsed.score : (parsed.approved ? 1.0 : 0.0);
      const approved = Boolean(parsed.approved) && score >= 0.9 && hallucinations.length === 0;

      let receiptToken = parsed.receipt_token || (approved
        ? `TG-VERIFIED-${crypto.createHash('sha256').update(proposed_plan).digest('hex').slice(0, 12)}`
        : `TG-REJECTED-${crypto.randomBytes(6).toString('hex')}`);

      if (!approved && !receiptToken.startsWith('TG-REJECTED')) {
        receiptToken = `TG-REJECTED-${receiptToken.replace(/^TG-VERIFIED-/, '')}`;
      }

      if (approved) {
        writeTruthReceipt({
          projectId: currentProjectId,
          citedFactIds: cited_fact_ids,
          proposedPlan: proposed_plan,
          targetFiles: target_files,
          projectDir: project_dir,
          receiptToken
        });
      }

      logActivity('PLAN_VERIFIED', {
        approved,
        score,
        tier: tierUsed,
        receipt: receiptToken,
        hallucinations_count: hallucinations.length
      });

      return {
        approved,
        score,
        tier: tierUsed,
        hallucinations_or_missing_conditions: hallucinations,
        receipt_token: receiptToken
      };
    } catch (parseErr) {
      console.error('[truth-guard] JSON parse error from LLM:', parseErr.message);
    }
  }

  // Deterministic Local Fallback Verification Mode (Fail-Closed by default)
  console.error('[truth-guard] Fallback Mode active (LLM offline or unavailable)...');
  const localIssues = [];
  if (cited_fact_ids.length === 0) {
    localIssues.push('No cited_fact_ids provided for verification.');
  }
  if (missingFactIds.length > 0) {
    localIssues.push(`Cited fact_ids missing from truth mirror: ${missingFactIds.join(', ')}`);
  }

  // Check forbidden keywords
  const forbiddenPatterns = [
    { pattern: /\/\/\s*@ts-ignore/i, desc: 'TypeScript diagnostic bypass (@ts-ignore) detected.' },
    { pattern: /any\s+type/i, desc: 'Unchecked any type assertion detected.' },
    { pattern: /skip\s+test/i, desc: 'Skipping test suites detected.' }
  ];

  for (const { pattern, desc } of forbiddenPatterns) {
    if (pattern.test(proposed_plan)) {
      localIssues.push(desc);
    }
  }

  // Fail-Closed Gate: Local offline mode cannot perform semantic fact verification
  const expectedOverrideToken = 'OVERRIDE-' + crypto.createHash('sha256').update(`${currentProjectId}:${proposed_plan}`).digest('hex').slice(0, 8);
  const isHumanAuthorized = human_override === true && override_token === expectedOverrideToken;

  if (!isHumanAuthorized) {
    const unverifiedToken = `TG-UNVERIFIED-FALLBACK-${crypto.randomBytes(6).toString('hex')}`;
    logActivity('PLAN_VERIFIED_FALLBACK_BLOCKED', {
      approved: false,
      score: 0.0,
      tier: 'LOCAL_FALLBACK',
      receipt: unverifiedToken,
      issues: localIssues
    });

    return {
      approved: false,
      score: 0.0,
      tier: 'LOCAL_FALLBACK',
      status: 'UNVERIFIED_FALLBACK',
      requires_human_override: true,
      message: 'STOP: Truth Guard is operating in LOCAL_FALLBACK mode (LLM offline or circuit breaker active). Local fallback mode is fail-closed and cannot cryptographically verify plan grounding without human authorization. Present this plan to the human user in chat. Once confirmed, re-run truth_verify_plan with human_override: true and override_token: "' + expectedOverrideToken + '".',
      override_token: expectedOverrideToken,
      hallucinations_or_missing_conditions: [
        'Fail-Closed Fallback: Local offline mode cannot perform semantic fact verification.',
        ...localIssues
      ],
      receipt_token: unverifiedToken
    };
  }

  // If human override was explicitly provided and valid:
  const approved = localIssues.length === 0 && cited_fact_ids.length > 0;
  const score = approved ? 1.0 : 0.0;
  const planHash = crypto.createHash('sha256').update(proposed_plan).digest('hex').slice(0, 12);
  const receiptToken = approved ? `TG-VERIFIED-OVERRIDE-${planHash}` : `TG-REJECTED-OVERRIDE-${crypto.randomBytes(6).toString('hex')}`;

  if (approved) {
    writeTruthReceipt({
      projectId: currentProjectId,
      citedFactIds: cited_fact_ids,
      proposedPlan: proposed_plan,
      targetFiles: target_files,
      projectDir: project_dir,
      receiptToken
    });
  }

  logActivity('PLAN_VERIFIED_LOCAL_OVERRIDE', {
    approved,
    score,
    tier: 'LOCAL_FALLBACK_HUMAN_OVERRIDE',
    receipt: receiptToken,
    issues: localIssues
  });

  return {
    approved,
    score,
    tier: 'LOCAL_FALLBACK_HUMAN_OVERRIDE',
    status: approved ? 'APPROVED_BY_HUMAN_OVERRIDE' : 'REJECTED',
    hallucinations_or_missing_conditions: localIssues,
    receipt_token: receiptToken
  };
}

export async function upsertRule({
  scope = 'project',
  file_path,
  section_title,
  content,
  user_confirmed = false,
  confirmation_token = null
}) {
  const currentProjectId = detectProjectId();
  const projectId = scope === 'global' ? 'global' : currentProjectId;
  const rootDir = scope === 'global' ? GLOBAL_RULES_DIR : process.cwd();

  // 1. Human-in-the-Loop Gate (Law 3: Spec Immutability)
  const isEnvAllowed = process.env.ALLOW_SPEC_MUTATION === 'true';
  const expectedToken = 'CONFIRM-' + crypto.createHash('sha256').update(`${file_path}:${section_title}:${content}`).digest('hex').slice(0, 8);

  if (!isEnvAllowed && (!user_confirmed || confirmation_token !== expectedToken)) {
    logActivity('RULE_MUTATION_REQUESTED', {
      file_path,
      section_title,
      scope,
      token: expectedToken
    });

    return {
      status: 'PENDING_HUMAN_APPROVAL',
      requires_user_approval: true,
      message: 'STOP: Under Law 3 (Spec Immutability), an AI agent is strictly forbidden from mutating ground truth specifications without explicit human consent. Present this proposed rule change to the human user in chat. Once the user explicitly agrees, call truth_upsert_rule again with user_confirmed: true and confirmation_token: "' + expectedToken + '".',
      proposed_rule: {
        scope,
        file_path,
        section_title,
        content_preview: content.slice(0, 500),
        confirmation_token: expectedToken
      }
    };
  }

  // 2. Path traversal & Symlink guard
  const targetFile = path.resolve(rootDir, file_path);
  const rel = path.relative(rootDir, targetFile);
  if (rel.startsWith('..') || path.isAbsolute(file_path)) {
    throw new Error('Access denied: Path traversal detected. file_path must reside within the root directory.');
  }

  // Symlink Shield: verify real physical paths
  let realRoot;
  try {
    realRoot = fs.realpathSync(rootDir);
  } catch {
    realRoot = path.resolve(rootDir);
  }

  if (fs.existsSync(targetFile)) {
    try {
      const realTarget = fs.realpathSync(targetFile);
      const relToRealRoot = path.relative(realRoot, realTarget);
      if (relToRealRoot.startsWith('..') || path.isAbsolute(relToRealRoot)) {
        throw new Error('Access denied: Symlink escape detected. Target file resolves outside workspace root.');
      }
    } catch (e) {
      if (e.message.includes('Symlink escape')) throw e;
      throw new Error(`Access denied: Cannot resolve real path for target file: ${e.message}`);
    }
  } else {
    let checkDir = path.dirname(targetFile);
    while (!fs.existsSync(checkDir) && checkDir !== path.dirname(checkDir)) {
      checkDir = path.dirname(checkDir);
    }
    if (fs.existsSync(checkDir)) {
      try {
        const realParent = fs.realpathSync(checkDir);
        const relParentToRoot = path.relative(realRoot, realParent);
        if (relParentToRoot.startsWith('..') || path.isAbsolute(relParentToRoot)) {
          throw new Error('Access denied: Symlink escape detected in parent directory hierarchy.');
        }
      } catch (e) {
        if (e.message.includes('Symlink escape')) throw e;
        throw new Error(`Access denied: Cannot verify parent directory safety: ${e.message}`);
      }
    }
  }

  let currentSegment = targetFile;
  while (currentSegment !== rootDir && currentSegment !== path.dirname(currentSegment)) {
    if (fs.existsSync(currentSegment)) {
      try {
        const stat = fs.lstatSync(currentSegment);
        if (stat.isSymbolicLink()) {
          const resolvedLink = fs.realpathSync(currentSegment);
          const relLink = path.relative(realRoot, resolvedLink);
          if (relLink.startsWith('..') || path.isAbsolute(relLink)) {
            throw new Error(`Access denied: Symbolic link segment detected pointing outside workspace: ${currentSegment}`);
          }
        }
      } catch (e) {
        if (e.message.includes('Access denied')) throw e;
      }
    }
    currentSegment = path.dirname(currentSegment);
  }

  // 3. Sensitive path & file shield
  const normalized = rel.replace(/\\/g, '/').toLowerCase();
  const forbiddenPatterns = ['.git/', '.env', 'node_modules/', '.ssh/', 'quota-tracker', 'package.json'];
  if (forbiddenPatterns.some(pattern => normalized.includes(pattern))) {
    throw new Error('Access denied: Modifying sensitive system, configuration, or environment files is strictly prohibited.');
  }

  // 4. Allowed file extensions guard (.md, .ts)
  const allowedExts = ['.md', '.ts'];
  if (!allowedExts.includes(path.extname(targetFile).toLowerCase())) {
    throw new Error('Access denied: Only Markdown (.md) or TypeScript (.ts) specification files can be modified.');
  }

  const parentDir = path.dirname(targetFile);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  let fileContent = '';
  if (fs.existsSync(targetFile)) {
    fileContent = fs.readFileSync(targetFile, 'utf8');
  }

  fileContent += `\n\n## ${section_title}\n\n${content}\n`;
  fs.writeFileSync(targetFile, fileContent.trim() + '\n', 'utf8');

  const hashes = loadHashes();
  await indexFile(targetFile, rootDir, projectId, hashes);

  const relPath = path.relative(rootDir, targetFile).replace(/\\/g, '/');
  const factId = computeFactId(projectId, relPath, section_title);
  const sha256 = crypto.createHash('sha256').update(content).digest('hex');

  logActivity('UPSERT_RULE_APPROVED', { fact_id: factId, project_id: projectId, file: relPath, token: expectedToken });

  return {
    success: true,
    status: 'APPLIED',
    fact_id: factId,
    file_path: relPath,
    sha256
  };
}

export async function getTruthStatus(target_project) {
  const currentProjectId = target_project || detectProjectId();
  const tracker = getQuotaTracker();

  const projectChunks = ramMirror.filter(c => c.project_id === currentProjectId).length;
  const globalChunks = ramMirror.filter(c => c.project_id === 'global').length;

  return {
    status: 'ONLINE',
    mode: tracker.getTier(),
    current_project_id: currentProjectId,
    ram_mirror_chunks: {
      project_chunks: projectChunks,
      global_chunks: globalChunks,
      total_in_ram: ramMirror.length
    },
    quota_and_billing: {
      date: new Date().toISOString().slice(0, 10),
      total_calls_today: tracker.getTotalUsed(),
      free_tier_used: tracker.getFreeUsed(),
      free_tier_daily_limit: FREE_TIER_DAILY_LIMIT,
      payg_tier_used: tracker.getPaygUsed(),
      circuit_breaker_hard_cap: CIRCUIT_BREAKER_HARD_CAP,
      remaining_before_circuit_breaker: Math.max(0, CIRCUIT_BREAKER_HARD_CAP - tracker.getTotalUsed())
    },
    safety_circuit_breaker: {
      armed: true,
      tripped: tracker.isCircuitBreakerTripped(),
      hard_cap: CIRCUIT_BREAKER_HARD_CAP
    },
    recent_activity: getRecentActivities(10)
  };
}

function startWatcher(rootDir, projectId) {
  console.error(`[truth-guard] Starting file watcher for ${projectId} at ${rootDir}`);
  // Only watch markdown documentation and specifications in safe directories; DO NOT watch runtime src/ code
  const watcher = chokidar.watch(['docs/**/*.md', '.agent/truth/**/*.md', 'RULES.md', 'README.md'], {
    cwd: rootDir,
    ignored: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/src/**', '**/packages/**', '**/server/**'],
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 }
  });

  const queue = new Set();
  let timer = null;

  function processQueue() {
    const hashes = loadHashes();
    for (const file of queue) {
      const full = path.resolve(rootDir, file);
      indexFile(full, rootDir, projectId, hashes);
    }
    queue.clear();
  }

  watcher.on('add', relPath => {
    queue.add(relPath);
    if (timer) clearTimeout(timer);
    timer = setTimeout(processQueue, 1000);
  });

  watcher.on('change', relPath => {
    queue.add(relPath);
    if (timer) clearTimeout(timer);
    timer = setTimeout(processQueue, 1000);
  });

  return watcher;
}

export function createTruthGuardServer() {
  const server = new McpServer({
    name: 'antigravity-truth-guard',
    version: '2.1.0'
  });

  server.tool(
    'truth_search',
    'RAM mirror semantic search for ground-truth rules, architecture specs, and schema contracts (0 Firestore reads)',
    {
      query: z.string().min(1).max(2000).describe('Search query describing the feature, rule, or schema to look up'),
      include_global: z.boolean().default(true).optional().describe('Whether to also search the global rules catalog'),
      target_project: z.string().max(100).optional().describe('Optional specific project_id to search instead of current project')
    },
    async ({ query, include_global = true, target_project }) => {
      const results = await searchTruth({ query, include_global, target_project });
      return {
        content: [{ type: 'text', text: JSON.stringify(results, null, 2) }]
      };
    }
  );

  server.tool(
    'truth_verify_plan',
    'Anti-hallucination verification gate: checks proposed plan against ground truth facts using multi-tier LLM engine',
    {
      proposed_plan: z.string().min(1).max(50000).describe('The proposed technical plan, architecture changes, or code implementation details'),
      cited_fact_ids: z.array(z.string().max(250)).max(100).describe('Array of fact_id references retrieved from truth_search'),
      target_files: z.array(z.string().min(1).max(500)).min(1).max(100).describe('List of file paths intended to be created or modified (mandatory non-empty array)'),
      project_dir: z.string().max(1000).optional().describe('Optional absolute path to project root directory (must reside in authorized workspace)'),
      human_override: z.boolean().default(false).optional().describe('Whether human user explicitly authorized fallback verification when offline'),
      override_token: z.string().optional().describe('Confirmation token provided by truth_verify_plan during fallback mode')
    },
    async ({ proposed_plan, cited_fact_ids, target_files, project_dir, human_override = false, override_token = null }) => {
      const verification = await verifyPlan({
        proposed_plan,
        cited_fact_ids,
        target_files,
        project_dir,
        human_override,
        override_token
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(verification, null, 2) }]
      };
    }
  );

  server.tool(
    'truth_upsert_rule',
    'Create or update a ground-truth rule or spec both locally on disk, in RAM mirror, and in Firestore (requires human confirmation)',
    {
      scope: z.enum(['project', 'global']).default('project').describe('Scope of the rule: project or global'),
      file_path: z.string().min(1).max(500).describe('Relative file path to markdown rule file (e.g. docs/RULES.md)'),
      section_title: z.string().min(1).max(200).describe('Title of the rule section'),
      content: z.string().min(1).max(50000).describe('Content of the rule'),
      user_confirmed: z.boolean().default(false).optional().describe('Must be set to true ONLY AFTER the user has explicitly approved this change in chat'),
      confirmation_token: z.string().max(64).optional().describe('The confirmation token received during the initial PENDING_HUMAN_APPROVAL step')
    },
    async ({ scope = 'project', file_path, section_title, content, user_confirmed = false, confirmation_token = null }) => {
      const result = await upsertRule({ scope, file_path, section_title, content, user_confirmed, confirmation_token });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      };
    }
  );

  server.tool(
    'truth_status',
    'Get operational status of antigravity-truth-guard: tier, RAM mirror count, circuit breaker, and quota usage',
    {
      target_project: z.string().max(100).optional().describe('Optional specific project_id to view status for')
    },
    async ({ target_project }) => {
      const status = await getTruthStatus(target_project);
      return {
        content: [{ type: 'text', text: JSON.stringify(status, null, 2) }]
      };
    }
  );

  return server;
}

if (process.argv[1] && process.argv[1].endsWith('server.mjs')) {
  const currentProjectId = detectProjectId();

  // Boot sequence:
  // 1. Sync RAM mirror
  // 2. Seed 5 Universal Global Laws
  // 3. Incremental index current project files
  // 4. Start file watcher
  syncRamMirrorFromFirestore(currentProjectId).then(async () => {
    await seedGlobalRules();
    await indexProjectDirectory(process.cwd(), currentProjectId);
    startWatcher(process.cwd(), currentProjectId);
  });

  const server = createTruthGuardServer();
  const transport = new StdioServerTransport();
  server.connect(transport).then(() => {
    console.error('[truth-guard] antigravity-truth-guard server started on stdio');
  }).catch(err => {
    console.error('[truth-guard] Fatal error starting server:', err);
    process.exit(1);
  });
}
