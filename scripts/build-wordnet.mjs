#!/usr/bin/env node
// Build script: parse Princeton WordNet 3.1 dict files (shipped via the
// `wordnet-db` package) into a single SQLite database at
// src-tauri/resources/wordnet.sqlite. Run once before `tauri dev` / `tauri
// build`. Output is gitignored — regenerate locally as needed.

import { readFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import wndb from 'wordnet-db';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const outPath = resolve(repoRoot, 'src-tauri/resources/wordnet.sqlite');

const POS_LABEL = { n: 'noun', v: 'verb', a: 'adjective', s: 'adjective', r: 'adverb' };
const POS_FILES = [
  ['noun', 'n'],
  ['verb', 'v'],
  ['adj', 'a'],
  ['adv', 'r'],
];

function readDictFile(name) {
  const path = resolve(wndb.path, name);
  return readFileSync(path, 'utf8').split('\n');
}

// Parse a data.<pos> line. Returns { offset, ssType, gloss } or null on header lines.
function parseDataLine(line) {
  if (!line || line.startsWith('  ')) return null;
  const pipeIdx = line.indexOf('|');
  if (pipeIdx < 0) return null;
  const head = line.slice(0, pipeIdx).trim().split(/\s+/);
  const offset = head[0];
  const ssType = head[2]; // n, v, a, s, r
  const gloss = line.slice(pipeIdx + 1).trim();
  return { offset, ssType, gloss };
}

// Parse an index.<pos> line into { lemma, offsets[] }.
// Format: lemma pos synset_cnt p_cnt [ptr_symbols...] sense_cnt tagsense_cnt synset_offset...
function parseIndexLine(line) {
  if (!line || line.startsWith('  ')) return null;
  const parts = line.trim().split(/\s+/);
  if (parts.length < 6) return null;
  const lemma = parts[0];
  const synsetCnt = parseInt(parts[2], 10);
  const pCnt = parseInt(parts[3], 10);
  const offsetStart = 4 + pCnt + 2; // skip ptr symbols + sense_cnt + tagsense_cnt
  const offsets = parts.slice(offsetStart, offsetStart + synsetCnt);
  return { lemma, offsets };
}

function build() {
  console.log(`[wordnet] using dict files at ${wndb.path}`);

  // 1. Build offset -> { pos, gloss } map by parsing data.* files.
  const synsetByOffset = new Map(); // key: `${pos}:${offset}` -> { pos, gloss }
  for (const [posFile, posKey] of POS_FILES) {
    const lines = readDictFile(`data.${posFile}`);
    let count = 0;
    for (const line of lines) {
      const parsed = parseDataLine(line);
      if (!parsed) continue;
      synsetByOffset.set(`${posKey}:${parsed.offset}`, {
        pos: POS_LABEL[parsed.ssType] ?? POS_LABEL[posKey],
        gloss: parsed.gloss,
      });
      count += 1;
    }
    console.log(`[wordnet] data.${posFile}: ${count} synsets`);
  }

  // 2. Walk index.* files, join lemma -> [{pos, gloss}] entries.
  const entries = new Map(); // lemma (lowercased, _-joined) -> [{pos, gloss}]
  for (const [posFile, posKey] of POS_FILES) {
    const lines = readDictFile(`index.${posFile}`);
    let count = 0;
    for (const line of lines) {
      const parsed = parseIndexLine(line);
      if (!parsed) continue;
      const key = parsed.lemma.toLowerCase();
      let bucket = entries.get(key);
      if (!bucket) {
        bucket = [];
        entries.set(key, bucket);
      }
      for (const offset of parsed.offsets) {
        const synset = synsetByOffset.get(`${posKey}:${offset}`);
        if (synset) bucket.push(synset);
      }
      count += 1;
    }
    console.log(`[wordnet] index.${posFile}: ${count} lemmas`);
  }
  console.log(`[wordnet] total lemmas: ${entries.size}`);

  // 3. Write to SQLite.
  mkdirSync(dirname(outPath), { recursive: true });
  if (existsSync(outPath)) unlinkSync(outPath);
  const db = new Database(outPath);
  db.pragma('journal_mode = OFF');
  db.pragma('synchronous = OFF');
  db.exec(`
    CREATE TABLE entries (
      word TEXT PRIMARY KEY,
      payload TEXT NOT NULL
    );
  `);

  const insert = db.prepare('INSERT INTO entries (word, payload) VALUES (?, ?)');
  const tx = db.transaction((items) => {
    for (const [word, senses] of items) {
      insert.run(word, JSON.stringify(senses));
    }
  });
  tx(entries);

  db.exec('VACUUM;');
  db.close();

  console.log(`[wordnet] wrote ${outPath}`);
}

build();
