#!/usr/bin/env node
// Conformance suite runner.
// 1. Parses every schema in schemas/ — fails on malformed JSON Schema.
// 2. For every entry in conformance/manifest.yaml, validates the fixture
//    against the listed schemas and asserts the recorded verdict.
// 3. Applies the cross-field semantic check that JSON Schema cannot express:
//    when both `integrity` and `signatures[]` are present in the frontmatter,
//    every signature's `payload-digest` MUST equal `integrity.digest`
//    byte-for-byte (§09-2).
// 4. Applies lightweight trusted-runtime policy checks for fixtures that opt in:
//    required integrity/signature gates, policy matching, and minSignatures
//    over distinct trusted signer identities (§13).
//
// Usage: node scripts/validate-conformance.mjs

import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import yaml from 'js-yaml';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_DIR = join(REPO, 'schemas');
const MANIFEST = join(REPO, 'conformance', 'manifest.yaml');
const CLI = join(REPO, 'apps', 'cli', 'dist', 'cli.js');

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

const failures = [];
const passes = [];

function pass(msg) {
	passes.push(msg);
	console.log(`  ${GREEN}✓${RESET} ${msg}`);
}
function fail(msg, detail = '') {
	failures.push({ msg, detail });
	console.log(`  ${RED}✗${RESET} ${msg}${detail ? `\n      ${DIM}${detail}${RESET}` : ''}`);
}

// ─── 1. Build Ajv with every schema loaded ────────────────────────────────────
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats.default ? addFormats.default(ajv) : addFormats(ajv);

function walkSchemaFiles(dir) {
	const out = [];
	for (const ent of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, ent.name);
		if (ent.isDirectory()) out.push(...walkSchemaFiles(p));
		else if (ent.name.endsWith('.schema.json')) out.push(p);
	}
	return out;
}

console.log(`\n${BOLD}1. Schema validity${RESET}`);
const schemaFiles = walkSchemaFiles(SCHEMA_DIR);
for (const f of schemaFiles) {
	const rel = f.slice(REPO.length + 1);
	try {
		const json = JSON.parse(readFileSync(f, 'utf8'));
		ajv.addSchema(json, json.$id);
		pass(`${rel} parses and registers`);
	} catch (e) {
		fail(`${rel} failed to load`, e.message);
	}
}

// ─── 2. Frontmatter extraction (§02-1.1 normative) ────────────────────────────
// Returns:
//   { kind: "ok",            frontmatter: <parsed-yaml>|null, body: string }
//   { kind: "no-frontmatter", body: string }
//   { kind: "error",          code: "invalid-encoding" | "unterminated-frontmatter"
//                             | "frontmatter-yaml-parse-error", message: string }
function extractFrontmatterStrict(buf) {
	// Step 1+2: BOM strip + UTF-8 decode (strict).
	if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
	let bytes = buf;
	if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
		bytes = bytes.slice(3);
	}
	let decoded;
	try {
		// TextDecoder with fatal:true raises on invalid UTF-8.
		decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch (e) {
		return { kind: 'error', code: 'invalid-encoding', message: e.message };
	}

	// Step 3: line-ending normalization (CRLF → LF, lone CR → LF).
	const norm = decoded.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

	// Step 4: opening fence at offset 0.
	if (!norm.startsWith('---\n')) {
		return { kind: 'no-frontmatter', body: norm };
	}

	// Step 5: scan forward for the FIRST line equal to "---".
	let i = 4; // past "---\n"
	let closeStart = -1;
	let closeEnd = -1;
	while (i <= norm.length) {
		const nl = norm.indexOf('\n', i);
		const lineEnd = nl === -1 ? norm.length : nl;
		const line = norm.slice(i, lineEnd);
		if (line === '---') {
			closeStart = i;
			closeEnd = nl === -1 ? norm.length : nl + 1;
			break;
		}
		if (nl === -1) break;
		i = nl + 1;
	}
	if (closeStart === -1) {
		return { kind: 'error', code: 'unterminated-frontmatter', message: 'opening --- without matching closing fence' };
	}

	const fmStr = norm.slice(4, closeStart);
	const body = norm.slice(closeEnd);

	let parsed;
	try {
		parsed = yaml.load(fmStr);
	} catch (e) {
		return { kind: 'error', code: 'frontmatter-yaml-parse-error', message: e.message };
	}
	return { kind: 'ok', frontmatter: parsed ?? null, body };
}

// Convenience wrapper used by schema-level fixtures: returns the parsed
// frontmatter object or null. Runtime-level fixtures use extractFrontmatterStrict.
function extractFrontmatter(text) {
	const buf = Buffer.isBuffer(text) ? text : Buffer.from(text);
	const r = extractFrontmatterStrict(buf);
	if (r.kind === 'ok') return r.frontmatter;
	return null;
}

function stableJson(value) {
	if (value === null) return 'null';
	if (typeof value === 'string') return JSON.stringify(value);
	if (typeof value === 'number') return JSON.stringify(value);
	if (typeof value === 'boolean') return value ? 'true' : 'false';
	if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.keys(value)
			.sort()
			.filter((key) => value[key] !== undefined)
			.map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
			.join(',')}}`;
	}
	return 'null';
}

function normalizeBody(body) {
	if (body.length === 0) return '';
	let normalized = body
		.replace(/\r\n/g, '\n')
		.replace(/\r/g, '\n')
		.split('\n')
		.map((line) => line.replace(/[ \t]+$/g, ''))
		.join('\n')
		.replace(/\n*$/g, '');
	if (normalized.length > 0) normalized += '\n';
	return normalized;
}

function normalizeOutput(path, text) {
	if (path.endsWith('.json')) return stableJson(JSON.parse(text));
	if (path.endsWith('.md') || path.endsWith('.mda')) {
		const extracted = extractFrontmatterStrict(Buffer.from(text));
		if (extracted.kind === 'error') throw new Error(`${extracted.code}: ${extracted.message}`);
		if (extracted.kind === 'no-frontmatter') return normalizeBody(extracted.body);
		return `---\n${stableJson(extracted.frontmatter)}\n---\n${normalizeBody(extracted.body.replace(/^\n+/, ''))}`;
	}
	return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function walkFiles(root) {
	const files = [];
	function walk(dir) {
		for (const ent of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, ent.name);
			if (ent.isDirectory()) walk(path);
			else if (ent.isFile()) files.push(path);
		}
	}
	walk(root);
	return files.sort();
}

function extractFootnoteRelationships(text) {
	// matches [^id]: { ... }
	const re = /^\[\^[^\]]+\]:\s*(\{[^\n]*\})\s*$/gm;
	const out = [];
	let m;
	while ((m = re.exec(text)) !== null) {
		try {
			out.push(JSON.parse(m[1]));
		} catch (e) {
			out.push({ __parseError: e.message });
		}
	}
	return out;
}

// Cross-field semantic check (§09-2): payload-digest MUST equal integrity.digest.
// Returns an array of error strings (empty if OK or rule not applicable).
function checkSignatureDigestEquality(fm) {
	if (!fm || typeof fm !== 'object') return [];
	const sigs = fm['signatures'];
	const integ = fm['integrity'];
	if (!Array.isArray(sigs) || sigs.length === 0) return [];
	if (!integ || typeof integ.digest !== 'string') return [];
	const expected = integ.digest;
	const errs = [];
	sigs.forEach((s, i) => {
		if (s && typeof s === 'object' && s['payload-digest'] !== expected) {
			errs.push(`signatures[${i}].payload-digest != integrity.digest (rule §09-2)`);
		}
	});
	return errs;
}

function didWebDomainFromSigner(signer) {
	const prefix = 'did-web:';
	if (typeof signer !== 'string' || !signer.startsWith(prefix)) return null;
	const domain = signer.slice(prefix.length);
	if (!/^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/.test(domain)) {
		return null;
	}
	return domain;
}

function trustPolicyAllowsDidWebDomain(policy, domain) {
	return Array.isArray(policy?.trustedSigners) && policy.trustedSigners.some((s) => s?.type === 'did-web' && s.domain === domain);
}

function sigstoreIssuerFromSigner(signer) {
	const prefix = 'sigstore-oidc:';
	if (typeof signer !== 'string' || !signer.startsWith(prefix)) return null;
	const issuer = signer.slice(prefix.length);
	return issuer.length > 0 ? issuer : null;
}

function verifiedSigstoreIdentityForIndex(verifiedIdentities, index) {
	if (!Array.isArray(verifiedIdentities)) return null;
	return verifiedIdentities.find((identity) => identity?.type === 'sigstore-oidc' && identity['signature-index'] === index) ?? null;
}

function trustPolicyAllowsSigstoreIdentity(policy, identity) {
	return (
		Array.isArray(policy?.trustedSigners) &&
		policy.trustedSigners.some((s) => s?.type === 'sigstore-oidc' && s.issuer === identity?.issuer && s.subject === identity?.subject)
	);
}

// Minimal trusted-runtime semantic check (§13). This intentionally does not
// perform live crypto or network verification; it exercises policy gating and
// threshold behavior that JSON Schema cannot express.
function checkTrustedRuntimePolicy(fm, policy, verifiedIdentities) {
	if (!fm || typeof fm !== 'object' || !fm.integrity) {
		return ['missing-required-integrity: trusted-runtime requires integrity'];
	}

	const sigs = fm.signatures;
	if (!Array.isArray(sigs) || sigs.length === 0) {
		return ['missing-required-signature: trusted-runtime requires signatures[]'];
	}

	const digestErrors = checkSignatureDigestEquality(fm);
	if (digestErrors.length) {
		return digestErrors.map((e) => `signature-digest-mismatch: ${e}`);
	}

	const trustedIdentities = new Set();
	for (const [index, sig] of sigs.entries()) {
		const domain = didWebDomainFromSigner(sig?.signer);
		if (domain && trustPolicyAllowsDidWebDomain(policy, domain)) {
			trustedIdentities.add(`did-web:${domain}`);
		}

		const issuer = sigstoreIssuerFromSigner(sig?.signer);
		const identity = verifiedSigstoreIdentityForIndex(verifiedIdentities, index);
		if (issuer && identity?.issuer === issuer && trustPolicyAllowsSigstoreIdentity(policy, identity)) {
			trustedIdentities.add(`sigstore-oidc:${identity.issuer}\n${identity.subject}`);
		}
	}

	if (trustedIdentities.size === 0) {
		return ['no-trusted-signature: no signature matched the trust policy'];
	}

	const minSignatures = Number.isInteger(policy?.minSignatures) ? policy.minSignatures : 1;
	if (trustedIdentities.size < minSignatures) {
		return [`insufficient-trusted-signatures: ${trustedIdentities.size} trusted signer identities < ${minSignatures}`];
	}

	return [];
}

// ─── 3. Manifest-driven conformance run ───────────────────────────────────────
console.log(`\n${BOLD}2. Conformance fixtures${RESET}`);
const manifest = yaml.load(readFileSync(MANIFEST, 'utf8'));

function getValidator(schemaPath) {
	const abs = resolve(REPO, schemaPath);
	const json = JSON.parse(readFileSync(abs, 'utf8'));
	const compiled = ajv.getSchema(json.$id) ?? ajv.compile(json);
	return compiled;
}

function runValidator(
	fixturePath,
	schemaPaths,
	expectedVerdict,
	fixtureId,
	semanticChecks,
	extractionExpected,
	runtimePolicyPath,
	expectedError,
	verifiedIdentities,
) {
	const buf = readFileSync(fixturePath);
	const ext = extractFrontmatterStrict(buf);
	let rawJson = null;

	if (fixturePath.endsWith('.json')) {
		try {
			rawJson = JSON.parse(buf.toString('utf8'));
		} catch (e) {
			if (expectedVerdict === 'reject') {
				pass(`[${fixtureId}] reject: invalid JSON (${e.message})`);
			} else {
				fail(`[${fixtureId}] invalid JSON`, e.message);
			}
			return;
		}
	}

	// §02-1.1 extraction-time verdict (when the manifest opts in via `extraction-expected`).
	if (extractionExpected) {
		const got = ext.kind === 'error' ? ext.code : ext.kind === 'no-frontmatter' ? 'no-frontmatter' : 'ok';
		if (got === extractionExpected) {
			pass(`[${fixtureId}] extraction (§02-1.1): ${got}`);
			// For extraction-only fixtures (no schemas listed), we're done.
			if (!schemaPaths || schemaPaths.length === 0) return;
		} else {
			fail(`[${fixtureId}] extraction expected ${extractionExpected} got ${got}`, ext.kind === 'error' ? ext.message : '');
			return;
		}
	} else if (ext.kind === 'error') {
		// Default behavior: an extraction error against a fixture with schemas
		// is treated as a hard rejection.
		if (expectedVerdict === 'reject') {
			pass(`[${fixtureId}] reject: ${ext.code} (${ext.message})`);
			return;
		}
		fail(`[${fixtureId}] extraction failed: ${ext.code}`, ext.message);
		return;
	}

	const text = ext.kind === 'no-frontmatter' ? ext.body : ext.kind === 'ok' ? buf.toString('utf8') : '';
	const fm = ext.kind === 'ok' ? ext.frontmatter : null;

	let allOk = true;
	let firstErrors = [];
	let runtimePolicy = null;

	if (runtimePolicyPath) {
		try {
			runtimePolicy = JSON.parse(readFileSync(resolve(REPO, 'conformance', runtimePolicyPath), 'utf8'));
			const validatePolicy = getValidator('schemas/mda-trust-policy.schema.json');
			if (!validatePolicy(runtimePolicy)) {
				allOk = false;
				const errs = (validatePolicy.errors || [])
					.slice(0, 3)
					.map((e) => `trust-policy-violation: runtime-policy ${e.instancePath || '(root)'} ${e.message}`);
				firstErrors.push(...errs);
			}
		} catch (e) {
			allOk = false;
			firstErrors.push(`trust-policy-violation: ${runtimePolicyPath} could not be loaded (${e.message})`);
		}
	}

	for (const sp of schemaPaths) {
		let validator;
		try {
			validator = getValidator(sp);
		} catch (e) {
			fail(`[${fixtureId}] schema load: ${sp}`, e.message);
			return;
		}

		const subjectsToCheck = [];
		if (rawJson !== null) {
			subjectsToCheck.push({ label: 'json', value: rawJson });
		} else if (
			sp.endsWith('frontmatter-source.schema.json') ||
			sp.endsWith('frontmatter-skill-md.schema.json') ||
			sp.endsWith('frontmatter-agents-md.schema.json') ||
			sp.endsWith('frontmatter-mcp-server-md.schema.json')
		) {
			subjectsToCheck.push({ label: 'frontmatter', value: fm ?? {} });
		} else if (sp.endsWith('relationship-footnote.schema.json')) {
			const rels = extractFootnoteRelationships(text);
			rels.forEach((r, i) => subjectsToCheck.push({ label: `footnote[${i}]`, value: r }));
		} else if (sp.includes('/_defs/')) {
			// Sub-schema references in the manifest are documentation links,
			// not standalone document validators. Skip.
			continue;
		} else {
			subjectsToCheck.push({ label: 'raw', value: fm ?? {} });
		}

		for (const subj of subjectsToCheck) {
			const ok = validator(subj.value);
			if (!ok) {
				allOk = false;
				const errs = (validator.errors || []).slice(0, 3).map((e) => `${subj.label} ${e.instancePath || '(root)'} ${e.message}`);
				firstErrors.push(...errs);
			}
		}
	}

	// Semantic checks beyond JSON Schema.
	if (Array.isArray(semanticChecks)) {
		for (const checkName of semanticChecks) {
			if (checkName === 'signature-digest-equality') {
				const errs = checkSignatureDigestEquality(fm);
				if (errs.length) {
					allOk = false;
					firstErrors.push(...errs);
				}
			} else if (checkName === 'trusted-runtime-policy') {
				if (!runtimePolicy) {
					allOk = false;
					firstErrors.push('trust-policy-violation: trusted-runtime-policy requires runtime-policy');
					continue;
				}
				const errs = checkTrustedRuntimePolicy(fm, runtimePolicy, verifiedIdentities);
				if (errs.length) {
					allOk = false;
					firstErrors.push(...errs);
				}
			}
		}
	}

	if (expectedVerdict === 'accept') {
		if (allOk) pass(`[${fixtureId}] accept: all schemas valid`);
		else fail(`[${fixtureId}] expected accept but got reject`, firstErrors.join(' | '));
	} else if (expectedVerdict === 'reject') {
		if (!allOk && expectedError) {
			const matched = firstErrors.some((e) => e === expectedError || e.startsWith(`${expectedError}:`));
			if (matched) pass(`[${fixtureId}] reject: ${expectedError}`);
			else
				fail(`[${fixtureId}] expected reject ${expectedError} but got ${firstErrors[0] ?? 'validation failed'}`, firstErrors.join(' | '));
		} else if (!allOk) pass(`[${fixtureId}] reject: ${firstErrors[0] ?? 'validation failed'}`);
		else fail(`[${fixtureId}] expected reject but all schemas accepted`);
	} else {
		fail(`[${fixtureId}] unknown verdict: ${expectedVerdict}`);
	}
}

function runCompileFixture(entry) {
	const id = entry.id;
	if (typeof entry.input !== 'string') {
		fail(`[${id}] input missing in manifest`);
		return;
	}
	if (typeof entry.expected_dir !== 'string') {
		fail(`[${id}] expected_dir missing in manifest`);
		return;
	}
	const inputPath = resolve(REPO, 'conformance', entry.input);
	const expectedDir = resolve(REPO, 'conformance', entry.expected_dir);
	const targets = Array.isArray(entry.targets) ? entry.targets : [];

	if (!existsSync(inputPath)) {
		fail(`[${id}] input missing: ${entry.input}`);
		return;
	}
	if (!existsSync(expectedDir) || !statSync(expectedDir).isDirectory()) {
		fail(`[${id}] expected_dir missing: ${entry.expected_dir}`);
		return;
	}
	if (targets.length === 0) {
		fail(`[${id}] targets missing`);
		return;
	}
	if (!existsSync(CLI)) {
		fail(`[${id}] CLI binary missing; run pnpm -C apps/cli build first`, CLI);
		return;
	}

	const inputText = readFileSync(inputPath, 'utf8');
	const fm = extractFrontmatter(inputText);
	const sourceValidator = getValidator('schemas/frontmatter-source.schema.json');
	if (!sourceValidator(fm ?? {})) {
		fail(`[${id}] input.mda frontmatter invalid`, JSON.stringify(sourceValidator.errors?.[0]));
		return;
	}

	const outDir = mkdtempSync(join(tmpdir(), 'mda-conformance-compile-'));
	try {
		const compile = spawnSync(process.execPath, [CLI, 'compile', inputPath, '--target', ...targets, '--out-dir', outDir, '--json'], {
			cwd: REPO,
			encoding: 'utf8',
		});
		if (compile.status !== 0) {
			fail(`[${id}] compile command failed`, `stdout=${compile.stdout}\nstderr=${compile.stderr}`);
			return;
		}
		const expected = new Map();
		for (const file of walkFiles(expectedDir)) {
			const rel = relative(expectedDir, file).replace(/\\/g, '/');
			expected.set(rel, normalizeOutput(rel, readFileSync(file, 'utf8')));
		}
		const actual = new Map();
		for (const file of walkFiles(outDir)) {
			const rel = relative(outDir, file).replace(/\\/g, '/');
			actual.set(rel, normalizeOutput(rel, readFileSync(file, 'utf8')));
		}
		const missing = [...expected.keys()].filter((rel) => !actual.has(rel));
		const extra = [...actual.keys()].filter((rel) => !expected.has(rel));
		const mismatched = [...expected.keys()].filter((rel) => actual.has(rel) && actual.get(rel) !== expected.get(rel));
		if (missing.length || extra.length || mismatched.length) {
			fail(
				`[${id}] compiled tree differs from expected`,
				`missing=${missing.join(',') || 'none'} extra=${extra.join(',') || 'none'} mismatched=${mismatched.join(',') || 'none'}`,
			);
			return;
		}
	} catch (e) {
		fail(`[${id}] compile fixture comparison failed`, e.message);
		return;
	} finally {
		rmSync(outDir, { recursive: true, force: true });
	}

	pass(`[${id}] compile fixture: emitted tree matches expected`);
}

for (const entry of manifest.fixtures) {
	if (entry.verdict === 'equal') {
		runCompileFixture(entry);
	} else {
		const fixturePath = resolve(REPO, 'conformance', entry.path);
		if (!existsSync(fixturePath)) {
			fail(`[${entry.id}] fixture missing: ${entry.path}`);
			continue;
		}
		runValidator(
			fixturePath,
			entry.against || [],
			entry.verdict,
			entry.id,
			entry['semantic-checks'],
			entry['extraction-expected'],
			entry['runtime-policy'],
			entry['expected-error'],
			entry['verified-identities'],
		);
	}
}

// ─── 4. Examples sanity ───────────────────────────────────────────────────────
console.log(`\n${BOLD}3. Examples sanity${RESET}`);
const sourceValidator = getValidator('schemas/frontmatter-source.schema.json');
const skillValidator = getValidator('schemas/frontmatter-skill-md.schema.json');
const sourceExamples = [
	'examples/source-only/intro.mda',
	'examples/source-only/node-tools.mda',
	'examples/source-only/tweetclaw-social-workflow.mda',
];

for (const f of sourceExamples) {
	const fm = extractFrontmatter(readFileSync(join(REPO, f), 'utf8'));
	if (sourceValidator(fm ?? {})) pass(`${f} valid against source schema`);
	else
		fail(
			`${f} INVALID against source schema`,
			(sourceValidator.errors || [])
				.slice(0, 3)
				.map((e) => `${e.instancePath} ${e.message}`)
				.join(' | '),
		);
}

for (const f of ['examples/skill-md/intro/SKILL.md', 'examples/skill-md/node-tools/SKILL.md']) {
	const text = readFileSync(join(REPO, f), 'utf8');
	const fm = extractFrontmatter(text);
	if (skillValidator(fm ?? {})) pass(`${f} valid against SKILL.md target schema`);
	else
		fail(
			`${f} INVALID against SKILL.md target schema`,
			(skillValidator.errors || [])
				.slice(0, 3)
				.map((e) => `${e.instancePath} ${e.message}`)
				.join(' | '),
		);
}

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${BOLD}Summary${RESET}`);
console.log(`  ${GREEN}${passes.length} passed${RESET} · ${failures.length ? RED : DIM}${failures.length} failed${RESET}`);

if (failures.length) {
	console.log(`\n${BOLD}${RED}Failures:${RESET}`);
	for (const f of failures) {
		console.log(`  · ${f.msg}`);
		if (f.detail) console.log(`    ${DIM}${f.detail}${RESET}`);
	}
	process.exit(1);
}
process.exit(0);
