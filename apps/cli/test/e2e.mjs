import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { load as loadYaml } from 'js-yaml';

const app = resolve(import.meta.dirname, '..');
const repo = resolve(app, '../..');
const cli = process.env.MDA_CLI ? resolve(process.env.MDA_CLI) : resolve(app, 'dist/cli.js');
const defaultCwd = process.env.MDA_TEST_CWD ? resolve(process.env.MDA_TEST_CWD) : repo;
const tmp = mkdtempSync(join(tmpdir(), 'mda-e2e-'));
const expectedCliVersion = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8')).version;

function run(args, options = {}) {
	return spawnSync(process.execPath, [cli, ...args], {
		cwd: options.cwd ?? defaultCwd,
		encoding: 'utf8',
	});
}

function json(args, expectedStatus = 0) {
	const result = run([...args, '--json']);
	assert.equal(result.status, expectedStatus, `${args.join(' ')}\nstdout=${result.stdout}\nstderr=${result.stderr}`);
	assert.equal(result.stderr, '');
	return JSON.parse(result.stdout);
}

function assertCommandOk(result, label) {
	assert.equal(result.status, 0, `${label}\nstdout=${result.stdout}\nstderr=${result.stderr}`);
}

function snippetOutputPath(format) {
	const extensions = {
		json: 'json',
		env: 'env',
		kubernetes: 'yaml',
		'github-actions': 'yaml',
		terraform: 'tf',
		typescript: 'ts',
		python: 'py',
		rust: 'rs',
	};
	if (format === 'json') return join(tmp, 'release', 'llmix-trust-snippet.json');
	return join(tmp, 'release', `llmix-trust-snippet.${format}.${extensions[format]}`);
}

function snippetGoldenPath(format) {
	return join(repo, 'apps/cli/test/fixtures/llmix-secure-release/golden/snippets', `llmix-trust-snippet.${format}.golden`);
}

function normalizeSnippetGolden(content, paths) {
	let normalized = content;
	for (const [placeholder, path] of Object.entries(paths)) normalized = normalized.replaceAll(path, placeholder);
	return normalized.replace(/sha256:[a-f0-9]{64}/g, 'sha256:<digest>');
}

const INTEGRITY_PAYLOAD_TYPE = 'application/vnd.mda.integrity+json';
const LLMIX_REGISTRY_ROOT_PAYLOAD_TYPE = 'application/vnd.snoai.llmix.registry-root+json';

function dssePae(payloadType, payload) {
	return Buffer.concat([
		Buffer.from(`DSSEv1 ${Buffer.byteLength(payloadType, 'utf8')} ${payloadType} ${payload.length} `, 'utf8'),
		payload,
	]);
}

function signatureForPayloadType(privateKey, payloadType, digest) {
	const payload = Buffer.from(JSON.stringify({ integrity: { algorithm: 'sha256', digest } }), 'utf8');
	return cryptoSign(null, dssePae(payloadType, payload), privateKey).toString('base64');
}

function signatureForPayloadBytes(privateKey, payloadType, payloadBytes) {
	return cryptoSign(null, dssePae(payloadType, Buffer.from(payloadBytes)), privateKey).toString('base64');
}

function stableJson(value) {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
			.join(',')}}`;
	}
	return JSON.stringify(value);
}

function digestJson(value) {
	return `sha256:${createHash('sha256').update(stableJson(value)).digest('hex')}`;
}

function digestBytes(bytes) {
	return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function sha256Hex(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function fileDigests(paths) {
	return Object.fromEntries(paths.map((path) => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]));
}

function rewriteSignaturePayloadType(sourcePath, destinationPath, privateKey, digest) {
	const payloadType = 'application/vnd.example.other+json';
	writeFileSync(
		destinationPath,
		readFileSync(sourcePath, 'utf8')
			.replace(`payload-type: ${INTEGRITY_PAYLOAD_TYPE}`, `payload-type: ${payloadType}`)
			.replace(/signature: [A-Za-z0-9+/=]+/, `signature: ${signatureForPayloadType(privateKey, payloadType, digest)}`),
	);
}

const help = run([]);
assert.equal(help.status, 0);
assert.match(help.stdout, /mda compile <file\.mda>/);
assert.match(help.stdout, /--json/);
assert.match(help.stdout, /--version/);
assert.match(help.stdout, /Exit codes:/);

const version = run(['--version']);
assert.equal(version.status, 0);
assert.equal(version.stdout, `${expectedCliVersion}\n`);
assert.equal(version.stderr, '');

const shortVersion = run(['-v']);
assert.equal(shortVersion.status, 0);
assert.equal(shortVersion.stdout, `${expectedCliVersion}\n`);
assert.equal(shortVersion.stderr, '');

const jsonVersion = json(['--version']);
assert.equal(jsonVersion.ok, true);
assert.equal(jsonVersion.command, 'version');
assert.equal(jsonVersion.version, expectedCliVersion);

const source = join(tmp, 'hello.mda');
const init = json(['init', 'hello-skill', '--out', source]);
assert.equal(init.ok, true);
assert.equal(init.summary, `Created MDA source at ${source}`);
assert.deepEqual(init.artifacts, [{ kind: 'mda-source', path: source, target: 'source' }]);
assert.equal(init.nextActions[0].id, 'validate-source');
assert.equal(init.written, true);
assert.equal(readFileSync(source, 'utf8'), init.scaffold);

const initStdout = run(['init', 'hello-skill']);
assert.equal(initStdout.status, 0);
assert.match(initStdout.stdout, /^---\nname: "hello-skill"/);

const demoOutDir = join(tmp, 'demo-out');
const demoResult = json(['demo', '--out-dir', demoOutDir]);
assert.equal(demoResult.ok, true);
assert.equal(demoResult.summary, `Generated MDA demo at ${demoOutDir}`);
assert.equal(demoResult.outDir, demoOutDir);
assert.equal(demoResult.written.length, 5);
assert.equal(demoResult.written[0], join(demoOutDir, 'hello.mda'));
assert.deepEqual(
	demoResult.artifacts.map((a) => a.path),
	[
		join(demoOutDir, 'hello.mda'),
		join(demoOutDir, 'out', 'SKILL.md'),
		join(demoOutDir, 'out', 'AGENTS.md'),
		join(demoOutDir, 'out', 'MCP-SERVER.md'),
		join(demoOutDir, 'out', 'mcp-server.json'),
	],
);
assert.equal(demoResult.nextActions[0].id, 'inspect-demo-output');
for (const filePath of demoResult.written) assert.ok(existsSync(filePath), `demo wrote ${filePath}`);
assert.match(readFileSync(join(demoOutDir, 'out', 'SKILL.md'), 'utf8'), /integrity:\n  algorithm: sha256\n  digest: sha256:[a-f0-9]{64}/);

const demoRefuse = json(['demo', '--out-dir', demoOutDir], 3);
assert.equal(demoRefuse.diagnostics[0].code, 'filesystem.io');

const demoCwd = mkdtempSync(join(tmpdir(), 'mda-e2e-demo-cwd-'));
const demoDefaultRun = run(['demo', '--json'], { cwd: demoCwd });
assert.equal(demoDefaultRun.status, 0);
const demoDefault = JSON.parse(demoDefaultRun.stdout);
assert.equal(demoDefault.ok, true);
assert.equal(demoDefault.outDir, 'mda-demo');
assert.ok(existsSync(join(demoCwd, 'mda-demo', 'hello.mda')));
assert.ok(existsSync(join(demoCwd, 'mda-demo', 'out', 'SKILL.md')));

const demoHuman = run(['demo', '--out-dir', join(tmp, 'demo-human')]);
assert.equal(demoHuman.status, 0);
assert.match(demoHuman.stdout, /wrote 5 file\(s\) under /);
assert.match(demoHuman.stdout, /Next:/);

const demoUnknownPositional = json(['demo', 'extra'], 2);
assert.equal(demoUnknownPositional.diagnostics[0].code, 'input.usage');

const llmixDir = join(tmp, 'config', 'llm', 'source', 'search_summary');
const llmixSource = join(llmixDir, 'openai_fast.mda');
const llmixInit = json([
	'init',
	'--template',
	'llmix-preset',
	'--module',
	'search_summary',
	'--preset',
	'openai_fast',
	'--provider',
	'openai',
	'--model',
	'gpt-5-mini',
	'--out',
	llmixSource,
]);
assert.equal(llmixInit.ok, true);
assert.equal(llmixInit.template, 'llmix-preset');
assert.equal(llmixInit.artifacts[0].path, llmixSource);
assert.equal(llmixInit.nextActions[0].id, 'validate-llmix-source');
assert.ok(llmixInit.nextActions[0].command.includes(llmixSource));
assert.match(readFileSync(llmixSource, 'utf8'), /snoai-llmix:/);
assert.match(readFileSync(llmixSource, 'utf8'), /name: llmix-search-summary-openai-fast/);
assert.match(readFileSync(llmixSource, 'utf8'), /module: search_summary/);
assert.match(readFileSync(llmixSource, 'utf8'), /preset: openai_fast/);
assert.match(readFileSync(llmixSource, 'utf8'), /provider: openai/);
const llmixPristineContent = readFileSync(llmixSource, 'utf8');

const llmixValid = json(['validate', llmixSource, '--target', 'source']);
assert.equal(llmixValid.ok, true);

const invalidLlmixName = json(
	[
		'init',
		'--template',
		'llmix-preset',
		'--module',
		'bad-name',
		'--preset',
		'openai_fast',
		'--provider',
		'openai',
		'--model',
		'gpt-5-mini',
	],
	2,
);
assert.equal(invalidLlmixName.diagnostics[0].code, 'llmix.invalid_identifier');

const invalidLlmixProvider = json(
	[
		'init',
		'--template',
		'llmix-preset',
		'--module',
		'search_summary',
		'--preset',
		'openai_fast',
		'--provider',
		'bad-provider',
		'--model',
		'gpt-5-mini',
	],
	2,
);
assert.equal(invalidLlmixProvider.diagnostics[0].code, 'llmix.invalid_provider');

const invalidLlmixModel = json(
	['init', '--template', 'llmix-preset', '--module', 'search_summary', '--preset', 'openai_fast', '--provider', 'openai', '--model', ' '],
	2,
);
assert.equal(invalidLlmixModel.diagnostics[0].code, 'llmix.invalid_model');

const existingLlmixTarget = join(tmp, 'existing-llmix.mda');
writeFileSync(existingLlmixTarget, 'keep');
const existingLlmixInit = json(
	[
		'init',
		'--template',
		'llmix-preset',
		'--module',
		'search_summary',
		'--preset',
		'openai_fast',
		'--provider',
		'openai',
		'--model',
		'gpt-5-mini',
		'--out',
		existingLlmixTarget,
	],
	3,
);
assert.equal(existingLlmixInit.diagnostics[0].code, 'filesystem.io');
assert.equal(readFileSync(existingLlmixTarget, 'utf8'), 'keep');

const invalidLlmixNamespace = join(tmp, 'invalid-llmix-namespace.mda');
writeFileSync(
	invalidLlmixNamespace,
	`---
name: invalid-llmix
description: Invalid LLMix namespace fixture.
metadata:
  snoai-llmix:
    common:
      provider: openai
      model: gpt-5-mini
    unknown: true
---
# Invalid LLMix
`,
);
const invalidLlmixNamespaceResult = json(['validate', invalidLlmixNamespace, '--target', 'source'], 1);
assert.equal(invalidLlmixNamespaceResult.diagnostics[0].code, 'llmix.unknown_namespace_key');

const invalidLlmixCaching = join(tmp, 'invalid-llmix-caching.mda');
writeFileSync(
	invalidLlmixCaching,
	`---
name: invalid-caching
description: Invalid LLMix caching fixture.
metadata:
  snoai-llmix:
    common:
      provider: openai
      model: gpt-5-mini
    caching:
      strategy: sideways
---
# Invalid caching
`,
);
const invalidLlmixCachingResult = json(['validate', invalidLlmixCaching, '--target', 'source'], 1);
assert.equal(invalidLlmixCachingResult.diagnostics[0].code, 'llmix.invalid_caching');

const invalidLlmixProviderOptions = join(tmp, 'invalid-llmix-provider-options.mda');
writeFileSync(
	invalidLlmixProviderOptions,
	`---
name: invalid-provider-options
description: Invalid LLMix provider options fixture.
metadata:
  snoai-llmix:
    common:
      provider: openai
      model: gpt-5-mini
    providerOptions:
      unknown-provider:
        effort: high
---
# Invalid provider options
`,
);
const invalidLlmixProviderOptionsResult = json(['validate', invalidLlmixProviderOptions, '--target', 'source'], 1);
assert.equal(invalidLlmixProviderOptionsResult.diagnostics[0].code, 'llmix.invalid_provider_options');

const llmixIntegrity = json(['integrity', 'compute', llmixSource, '--target', 'source', '--write']);
assert.equal(llmixIntegrity.ok, true);
assert.equal(llmixIntegrity.written, true);
assert.equal(llmixIntegrity.artifacts[0].path, llmixSource);
assert.equal(llmixIntegrity.nextActions[0].id, 'verify-integrity');
assert.ok(llmixIntegrity.nextActions[0].command.includes(llmixSource));
assert.match(readFileSync(llmixSource, 'utf8'), /integrity:\n  algorithm: sha256\n  digest: sha256:[a-f0-9]{64}/);

const llmixIntegrityRepeat = json(['integrity', 'compute', llmixSource, '--target', 'source', '--write']);
assert.equal(llmixIntegrityRepeat.ok, true);
assert.equal(llmixIntegrityRepeat.written, false);

const llmixIntegrityVerify = json(['integrity', 'verify', llmixSource, '--target', 'source']);
assert.equal(llmixIntegrityVerify.ok, true);

const did = 'did:web:tools.example.com';
const didKeyId = `${did}#release-2026`;
const didSecondKeyId = `${did}#release-2026-secondary`;
const didDefaultKeyId = `${did}#default`;
const { privateKey: didPrivateKey, publicKey: didPublicKey } = generateKeyPairSync('ed25519');
const { privateKey: didSecondPrivateKey, publicKey: didSecondPublicKey } = generateKeyPairSync('ed25519');
const { publicKey: mismatchPublicKey } = generateKeyPairSync('ed25519');
const didKeyFile = join(tmp, 'did-web-release-key.pem');
const didSecondKeyFile = join(tmp, 'did-web-release-secondary-key.pem');
const didDocument = join(tmp, 'did-web-document.json');
const didDocumentMultiKey = join(tmp, 'did-web-document-multi-key.json');
const didDocumentRemovedKey = join(tmp, 'did-web-document-removed-key.json');
const didDocumentMismatch = join(tmp, 'did-web-document-mismatch.json');
const didDocumentWrongId = join(tmp, 'did-web-document-wrong-id.json');
const didDocumentWrongController = join(tmp, 'did-web-document-wrong-controller.json');
writeFileSync(didKeyFile, didPrivateKey.export({ format: 'pem', type: 'pkcs8' }));
writeFileSync(didSecondKeyFile, didSecondPrivateKey.export({ format: 'pem', type: 'pkcs8' }));
writeFileSync(
	didDocument,
	JSON.stringify({
		id: did,
		verificationMethod: [
			{ id: didKeyId, type: 'JsonWebKey2020', controller: did, publicKeyJwk: didPublicKey.export({ format: 'jwk' }) },
			{ id: didDefaultKeyId, type: 'JsonWebKey2020', controller: did, publicKeyJwk: didPublicKey.export({ format: 'jwk' }) },
		],
	}),
);
writeFileSync(
	didDocumentMultiKey,
	JSON.stringify({
		id: did,
		verificationMethod: [
			{ id: didKeyId, type: 'JsonWebKey2020', controller: did, publicKeyJwk: didPublicKey.export({ format: 'jwk' }) },
			{ id: didSecondKeyId, type: 'JsonWebKey2020', controller: did, publicKeyJwk: didSecondPublicKey.export({ format: 'jwk' }) },
			{ id: didDefaultKeyId, type: 'JsonWebKey2020', controller: did, publicKeyJwk: didPublicKey.export({ format: 'jwk' }) },
		],
	}),
);
writeFileSync(didDocumentRemovedKey, JSON.stringify({ id: did, verificationMethod: [] }));
writeFileSync(
	didDocumentMismatch,
	JSON.stringify({
		id: did,
		verificationMethod: [
			{ id: didKeyId, type: 'JsonWebKey2020', controller: did, publicKeyJwk: mismatchPublicKey.export({ format: 'jwk' }) },
		],
	}),
);
writeFileSync(
	didDocumentWrongId,
	JSON.stringify({
		id: 'did:web:evil.example.com',
		verificationMethod: [
			{
				id: didKeyId,
				type: 'JsonWebKey2020',
				controller: 'did:web:evil.example.com',
				publicKeyJwk: didPublicKey.export({ format: 'jwk' }),
			},
		],
	}),
);
writeFileSync(
	didDocumentWrongController,
	JSON.stringify({
		id: did,
		verificationMethod: [
			{
				id: didKeyId,
				type: 'JsonWebKey2020',
				controller: 'did:web:evil.example.com',
				publicKeyJwk: didPublicKey.export({ format: 'jwk' }),
			},
		],
	}),
);

const didPolicy = join(tmp, 'did-web-policy.json');
const didPolicyGenerated = json([
	'release',
	'trust',
	'policy',
	'--target',
	'llmix-registry',
	'--profile',
	'did-web',
	'--domain',
	'tools.example.com',
	'--min-signatures',
	'1',
	'--out',
	didPolicy,
]);
assert.equal(didPolicyGenerated.ok, true);
assert.deepEqual(didPolicyGenerated.policy, {
	version: 1,
	minSignatures: 1,
	trustedSigners: [{ type: 'did-web', domain: 'tools.example.com' }],
});
assert.equal(JSON.parse(readFileSync(didPolicy, 'utf8')).trustedSigners[0].domain, 'tools.example.com');
const existingDidPolicy = json(
	['release', 'trust', 'policy', '--target', 'llmix-registry', '--profile', 'did-web', '--domain', 'tools.example.com', '--out', didPolicy],
	3,
);
assert.equal(existingDidPolicy.diagnostics[0].code, 'filesystem.io');
const unsupportedPolicyProfile = json(
	['release', 'trust', 'policy', '--target', 'llmix-registry', '--profile', 'kms', '--domain', 'tools.example.com'],
	1,
);
assert.equal(unsupportedPolicyProfile.diagnostics[0].code, 'trust_policy.unsupported_profile');
const unsupportedReleaseTarget = json(['release', 'prepare', '--target', 'unknown-target'], 1);
assert.equal(unsupportedReleaseTarget.diagnostics[0].code, 'release.unsupported_target');
assert.deepEqual(unsupportedReleaseTarget.supportedTargets, ['llmix-registry']);
const migratedLlmixRelease = json(['llmix', 'release', 'plan'], 1);
assert.equal(migratedLlmixRelease.diagnostics[0].code, 'release.command_migrated');
assert.match(migratedLlmixRelease.nextActions[0].command, /mda release prepare --target llmix-registry/);
const migratedLlmixTrustPolicy = json(['llmix', 'trust', 'policy'], 1);
assert.equal(migratedLlmixTrustPolicy.diagnostics[0].code, 'release.command_migrated');
assert.match(migratedLlmixTrustPolicy.nextActions[0].command, /mda release trust policy --target llmix-registry/);
const migratedLlmixTrustManifest = json(['llmix', 'trust', 'manifest'], 1);
assert.equal(migratedLlmixTrustManifest.diagnostics[0].code, 'release.command_migrated');
assert.match(migratedLlmixTrustManifest.nextActions[0].command, /mda release finalize --target llmix-registry/);
const migratedLlmixTrustSnippets = json(['llmix', 'trust', 'snippets'], 1);
assert.equal(migratedLlmixTrustSnippets.diagnostics[0].code, 'release.command_migrated');
assert.match(migratedLlmixTrustSnippets.nextActions[0].command, /--snippet-format <format>/);
const migratedDoctorLlmix = json(['doctor', 'llmix'], 1);
assert.equal(migratedDoctorLlmix.diagnostics[0].code, 'release.command_migrated');
assert.match(migratedDoctorLlmix.nextActions[0].command, /mda doctor release --target llmix-registry/);

const githubActionsPolicy = join(tmp, 'github-actions-policy.json');
const githubActionsPolicyGenerated = json([
	'release',
	'trust',
	'policy',
	'--target',
	'llmix-registry',
	'--profile',
	'github-actions',
	'--repo',
	'sno-ai/llmix',
	'--workflow',
	'release.yml',
	'--ref',
	'refs/tags/v2.0.0',
	'--out',
	githubActionsPolicy,
]);
assert.equal(githubActionsPolicyGenerated.ok, true);
assert.equal(githubActionsPolicyGenerated.profile, 'github-actions');
assert.equal(githubActionsPolicyGenerated.nextActions[0].id, 'sign-github-actions-release');
assert.match(githubActionsPolicyGenerated.nextActions[0].command, /mda sign release\.mda --profile github-actions/);
assert.equal(githubActionsPolicyGenerated.nextActions[1].id, 'verify-github-actions-release');
assert.deepEqual(githubActionsPolicyGenerated.policy, {
	version: 1,
	trustedSigners: [
		{
			type: 'sigstore-oidc',
			issuer: 'https://token.actions.githubusercontent.com',
			subject: 'repo:sno-ai/llmix:ref:refs/tags/v2.0.0',
			repository: 'sno-ai/llmix',
			workflow: 'release.yml',
			ref: 'refs/tags/v2.0.0',
		},
	],
	rekor: { url: 'https://rekor.sigstore.dev' },
});
assert.deepEqual(JSON.parse(readFileSync(githubActionsPolicy, 'utf8')), githubActionsPolicyGenerated.policy);
const existingGithubActionsPolicy = json(
	[
		'release',
		'trust',
		'policy',
		'--target',
		'llmix-registry',
		'--profile',
		'github-actions',
		'--repo',
		'sno-ai/llmix',
		'--workflow',
		'release.yml',
		'--ref',
		'refs/tags/v2.0.0',
		'--out',
		githubActionsPolicy,
	],
	3,
);
assert.equal(existingGithubActionsPolicy.diagnostics[0].code, 'filesystem.io');
const missingGithubActionsWorkflow = json(
	[
		'release',
		'trust',
		'policy',
		'--target',
		'llmix-registry',
		'--profile',
		'github-actions',
		'--repo',
		'sno-ai/llmix',
		'--ref',
		'refs/tags/v2.0.0',
	],
	2,
);
assert.equal(missingGithubActionsWorkflow.diagnostics[0].code, 'input.usage');
const invalidGithubActionsRepo = json(
	[
		'release',
		'trust',
		'policy',
		'--target',
		'llmix-registry',
		'--profile',
		'github-actions',
		'--repo',
		'sno-ai',
		'--workflow',
		'release.yml',
		'--ref',
		'refs/tags/v2.0.0',
	],
	2,
);
assert.equal(invalidGithubActionsRepo.diagnostics[0].code, 'input.usage');
const underPinnedGithubActionsPolicy = join(tmp, 'github-actions-under-pinned-policy.json');
writeFileSync(
	underPinnedGithubActionsPolicy,
	JSON.stringify({
		version: 1,
		trustedSigners: [
			{
				type: 'sigstore-oidc',
				issuer: 'https://token.actions.githubusercontent.com',
				subject: 'repo:sno-ai/llmix:ref:refs/tags/v2.0.0',
			},
		],
		rekor: { url: 'https://rekor.sigstore.dev' },
	}),
);
const underPinnedGithubActionsPolicyResult = json(
	['verify', llmixSource, '--target', 'source', '--policy', underPinnedGithubActionsPolicy],
	1,
);
assert.equal(underPinnedGithubActionsPolicyResult.ok, false);
assert.ok(underPinnedGithubActionsPolicyResult.diagnostics.some((diagnostic) => diagnostic.code.startsWith('schema.')));

const { privateKey: githubActionsPrivateKey, publicKey: githubActionsPublicKey } = generateKeyPairSync('ed25519');
const githubActionsFixtureObject = {
	issuer: 'https://token.actions.githubusercontent.com',
	subject: 'repo:sno-ai/llmix:ref:refs/tags/v2.0.0',
	repository: 'sno-ai/llmix',
	workflow: 'release.yml',
	ref: 'refs/tags/v2.0.0',
	keyId: 'github-actions-release-key',
	algorithm: 'ed25519',
	publicKeyPem: githubActionsPublicKey.export({ format: 'pem', type: 'spki' }),
	privateKeyPem: githubActionsPrivateKey.export({ format: 'pem', type: 'pkcs8' }),
	expectedPayloadDigest: llmixIntegrity.digest,
	rekor: {
		url: 'https://rekor.sigstore.dev',
		logId: 'github-actions-fixture-rekor-log',
		logIndex: 12345,
		payloadDigest: llmixIntegrity.digest,
	},
};
function writeGithubActionsFixture(name, patch = {}) {
	const fixture = {
		...githubActionsFixtureObject,
		...patch,
		rekor: Object.hasOwn(patch, 'rekor') ? patch.rekor : githubActionsFixtureObject.rekor,
	};
	const fixturePath = join(tmp, name);
	writeFileSync(fixturePath, JSON.stringify(fixture));
	return fixturePath;
}
const githubActionsFixture = writeGithubActionsFixture('github-actions-sigstore-fixture.json');
const githubActionsSignedLlmix = join(tmp, 'github-actions-signed-openai-fast.mda');
const githubActionsSign = json([
	'sign',
	llmixSource,
	'--profile',
	'github-actions',
	'--repo',
	'sno-ai/llmix',
	'--workflow',
	'release.yml',
	'--ref',
	'refs/tags/v2.0.0',
	'--rekor',
	'--offline-sigstore-fixture',
	githubActionsFixture,
	'--out',
	githubActionsSignedLlmix,
]);
assert.equal(githubActionsSign.ok, true);
assert.equal(githubActionsSign.profile, 'github-actions');
assert.equal(githubActionsSign.signer, 'sigstore-oidc:https://token.actions.githubusercontent.com');
assert.equal(githubActionsSign.keyId, 'github-actions-release-key');
assert.equal(githubActionsSign.payloadDigest, llmixIntegrity.digest);
assert.equal(githubActionsSign.rekorLogId, 'github-actions-fixture-rekor-log');
assert.match(readFileSync(githubActionsSignedLlmix, 'utf8'), /rekor-log-id: github-actions-fixture-rekor-log/);

const githubActionsVerify = json([
	'verify',
	githubActionsSignedLlmix,
	'--target',
	'source',
	'--policy',
	githubActionsPolicy,
	'--offline-sigstore-fixture',
	githubActionsFixture,
]);
assert.equal(githubActionsVerify.ok, true);
assert.equal(githubActionsVerify.trustedSignatures, 1);
assert.equal(githubActionsVerify.rejectedSignatures, 0);
assert.equal(githubActionsVerify.payloadDigest, llmixIntegrity.digest);

const githubActionsWrongPayloadType = join(tmp, 'github-actions-wrong-payload-type.mda');
rewriteSignaturePayloadType(githubActionsSignedLlmix, githubActionsWrongPayloadType, githubActionsPrivateKey, llmixIntegrity.digest);
assert.equal(
	json(
		[
			'verify',
			githubActionsWrongPayloadType,
			'--target',
			'source',
			'--policy',
			githubActionsPolicy,
			'--offline-sigstore-fixture',
			githubActionsFixture,
		],
		1,
	).diagnostics[0].code,
	'signature.payload_type_mismatch',
);

const missingGithubActionsFixtureVerify = json(
	['verify', githubActionsSignedLlmix, '--target', 'source', '--policy', githubActionsPolicy],
	1,
);
assert.equal(missingGithubActionsFixtureVerify.diagnostics[0].code, 'sigstore.fixture_required');

const wrongIssuerFixture = writeGithubActionsFixture('github-actions-wrong-issuer-fixture.json', { issuer: 'https://issuer.example.com' });
assert.equal(
	json(
		[
			'verify',
			githubActionsSignedLlmix,
			'--target',
			'source',
			'--policy',
			githubActionsPolicy,
			'--offline-sigstore-fixture',
			wrongIssuerFixture,
		],
		1,
	).diagnostics[0].code,
	'sigstore.identity_mismatch',
);

for (const [name, patch] of [
	['github-actions-wrong-repo-fixture.json', { repository: 'sno-ai/other' }],
	['github-actions-wrong-workflow-fixture.json', { workflow: 'publish.yml' }],
	['github-actions-wrong-ref-fixture.json', { ref: 'refs/tags/v1.0.0' }],
]) {
	assert.equal(
		json(
			[
				'verify',
				githubActionsSignedLlmix,
				'--target',
				'source',
				'--policy',
				githubActionsPolicy,
				'--offline-sigstore-fixture',
				writeGithubActionsFixture(name, patch),
			],
			1,
		).diagnostics[0].code,
		'sigstore.identity_mismatch',
	);
}

const githubActionsEnvOnlyPolicy = join(tmp, 'github-actions-env-only-policy.json');
writeFileSync(
	githubActionsEnvOnlyPolicy,
	JSON.stringify({
		version: 1,
		trustedSigners: [
			{
				type: 'sigstore-oidc',
				issuer: 'https://token.actions.githubusercontent.com',
				subject: 'repo:sno-ai/llmix:environment:prod',
				environment: 'prod',
			},
		],
		rekor: { url: 'https://rekor.sigstore.dev' },
	}),
);
assert.ok(
	json(
		[
			'verify',
			githubActionsSignedLlmix,
			'--target',
			'source',
			'--policy',
			githubActionsEnvOnlyPolicy,
			'--offline-sigstore-fixture',
			githubActionsFixture,
		],
		1,
	).diagnostics.some((diagnostic) => diagnostic.code.startsWith('schema.')),
);
assert.equal(
	json(
		[
			'verify',
			githubActionsSignedLlmix,
			'--target',
			'source',
			'--policy',
			githubActionsEnvOnlyPolicy,
			'--offline-sigstore-fixture',
			githubActionsFixture,
		],
		1,
	).diagnostics[0].code,
	'trust_policy.environment_only_not_supported',
);

const githubActionsEnvWrongRefPolicy = join(tmp, 'github-actions-env-wrong-ref-policy.json');
writeFileSync(
	githubActionsEnvWrongRefPolicy,
	JSON.stringify({
		version: 1,
		trustedSigners: [
			{
				type: 'sigstore-oidc',
				issuer: 'https://token.actions.githubusercontent.com',
				subject: 'repo:sno-ai/llmix:ref:refs/tags/v2.0.0',
				repository: 'sno-ai/llmix',
				workflow: 'release.yml',
				ref: 'refs/tags/v1.0.0',
				environment: 'prod',
			},
		],
		rekor: { url: 'https://rekor.sigstore.dev' },
	}),
);
const githubActionsEnvFixture = writeGithubActionsFixture('github-actions-env-fixture.json', { environment: 'prod' });
assert.equal(
	json(
		[
			'verify',
			githubActionsSignedLlmix,
			'--target',
			'source',
			'--policy',
			githubActionsEnvWrongRefPolicy,
			'--offline-sigstore-fixture',
			githubActionsEnvFixture,
		],
		1,
	).diagnostics[0].code,
	'sigstore.identity_mismatch',
);

const missingRekorFixture = writeGithubActionsFixture('github-actions-missing-rekor-fixture.json', { rekor: undefined });
assert.equal(
	json(
		[
			'sign',
			llmixSource,
			'--profile',
			'github-actions',
			'--repo',
			'sno-ai/llmix',
			'--workflow',
			'release.yml',
			'--ref',
			'refs/tags/v2.0.0',
			'--rekor',
			'--offline-sigstore-fixture',
			missingRekorFixture,
			'--out',
			join(tmp, 'missing-rekor-signed.mda'),
		],
		1,
	).diagnostics[0].code,
	'sigstore.fixture_invalid',
);

const incompleteFixture = writeGithubActionsFixture('github-actions-incomplete-fixture.json', { publicKeyPem: undefined });
assert.equal(
	json(
		[
			'verify',
			githubActionsSignedLlmix,
			'--target',
			'source',
			'--policy',
			githubActionsPolicy,
			'--offline-sigstore-fixture',
			incompleteFixture,
		],
		1,
	).diagnostics[0].code,
	'sigstore.fixture_invalid',
);

const digestMismatchFixture = writeGithubActionsFixture('github-actions-digest-mismatch-fixture.json', {
	expectedPayloadDigest: `sha256:${'2'.repeat(64)}`,
	rekor: { ...githubActionsFixtureObject.rekor, payloadDigest: `sha256:${'2'.repeat(64)}` },
});
assert.equal(
	json(
		[
			'verify',
			githubActionsSignedLlmix,
			'--target',
			'source',
			'--policy',
			githubActionsPolicy,
			'--offline-sigstore-fixture',
			digestMismatchFixture,
		],
		1,
	).diagnostics[0].code,
	'sigstore.fixture_digest_mismatch',
);

const signedLlmix = join(tmp, 'signed-openai-fast.mda');
assert.equal(
	json(['sign', llmixSource, '--profile', 'did-web', '--did', did, '--key-id', didKeyId, '--out', join(tmp, 'missing-key.mda')], 2)
		.diagnostics[0].code,
	'did_web.key_input_missing',
);
const didSign = json([
	'sign',
	llmixSource,
	'--profile',
	'did-web',
	'--did',
	did,
	'--key-id',
	didKeyId,
	'--key-file',
	didKeyFile,
	'--out',
	signedLlmix,
]);
assert.equal(didSign.ok, true);
assert.equal(didSign.profile, 'did-web');
assert.equal(didSign.signer, 'did-web:tools.example.com');
assert.equal(didSign.keyId, didKeyId);
assert.equal(didSign.payloadDigest, llmixIntegrity.digest);
assert.match(readFileSync(signedLlmix, 'utf8'), /signatures:/);

const humanSignedLlmix = join(tmp, 'human-signed-openai-fast.mda');
const humanDidSign = run([
	'sign',
	llmixSource,
	'--profile',
	'did-web',
	'--did',
	did,
	'--key-id',
	didKeyId,
	'--key-file',
	didKeyFile,
	'--out',
	humanSignedLlmix,
]);
assert.equal(humanDidSign.status, 0);
assert.match(humanDidSign.stdout, /Next:/);
const humanDidVerify = run(['verify', humanSignedLlmix, '--target', 'source', '--policy', didPolicy, '--did-document', didDocument]);
assert.equal(humanDidVerify.status, 0);
assert.match(humanDidVerify.stdout, /Next:/);

const didVerify = json(['verify', signedLlmix, '--target', 'source', '--policy', didPolicy, '--did-document', didDocument]);
assert.equal(didVerify.ok, true);
assert.equal(didVerify.trustedSignatures, 1);
assert.equal(didVerify.rejectedSignatures, 0);
assert.equal(didVerify.payloadDigest, llmixIntegrity.digest);
assert.equal(didVerify.trustedSignerIdentities[0].signer, 'did-web:tools.example.com');
assert.equal(didVerify.trustedSignerIdentities[0].keyId, didKeyId);

const humanFlowSource = join(tmp, 'human-flow', 'search_summary', 'openai_fast.mda');
const humanFlowSigned = join(tmp, 'human-flow', 'search_summary', 'openai_fast.signed.mda');
for (const step of [
	run([
		'init',
		'--template',
		'llmix-preset',
		'--module',
		'search_summary',
		'--preset',
		'openai_fast',
		'--provider',
		'openai',
		'--model',
		'gpt-5-mini',
		'--out',
		humanFlowSource,
	]),
	run(['validate', humanFlowSource, '--target', 'source']),
	run(['integrity', 'compute', humanFlowSource, '--target', 'source', '--write']),
	run(['integrity', 'verify', humanFlowSource, '--target', 'source']),
	run([
		'sign',
		humanFlowSource,
		'--profile',
		'did-web',
		'--did',
		did,
		'--key-id',
		didKeyId,
		'--key-file',
		didKeyFile,
		'--out',
		humanFlowSigned,
	]),
	run(['verify', humanFlowSigned, '--target', 'source', '--policy', didPolicy, '--did-document', didDocument]),
]) {
	assert.equal(step.status, 0);
	assert.match(step.stdout, /Next:/);
}

const sha384LlmixSource = join(tmp, 'sha384-openai-fast.mda');
writeFileSync(sha384LlmixSource, llmixPristineContent);
const sha384Integrity = json(['integrity', 'compute', sha384LlmixSource, '--target', 'source', '--algorithm', 'sha384', '--write']);
assert.equal(sha384Integrity.ok, true);
assert.match(sha384Integrity.digest, /^sha384:[a-f0-9]{96}$/);
const sha384SignedLlmix = join(tmp, 'sha384-signed-openai-fast.mda');
const sha384Sign = json([
	'sign',
	sha384LlmixSource,
	'--profile',
	'did-web',
	'--did',
	did,
	'--key-id',
	didKeyId,
	'--key-file',
	didKeyFile,
	'--out',
	sha384SignedLlmix,
]);
assert.equal(sha384Sign.ok, true);
assert.equal(sha384Sign.payloadDigest, sha384Integrity.digest);
const sha384Verify = json(['verify', sha384SignedLlmix, '--target', 'source', '--policy', didPolicy, '--did-document', didDocument]);
assert.equal(sha384Verify.ok, true);
assert.equal(sha384Verify.payloadDigest, sha384Integrity.digest);

const releaseSourceDir = join(tmp, 'release-source-set');
const releaseSourceFile = join(releaseSourceDir, 'search_summary', 'openai_fast.mda');
mkdirSync(join(releaseSourceDir, 'search_summary'), { recursive: true });
writeFileSync(releaseSourceFile, readFileSync(signedLlmix, 'utf8'));
const releaseSourceBefore = readFileSync(releaseSourceFile, 'utf8');
const registryDir = join(tmp, 'registry');
mkdirSync(registryDir, { recursive: true });
const registrySentinel = join(registryDir, 'sentinel.txt');
writeFileSync(registrySentinel, 'registry stays untouched\n');
const releasePlanOut = join(tmp, 'release', 'plan.json');
const releasePlanResult = json([
	'release',
	'prepare',
	'--target',
	'llmix-registry',
	'--source',
	releaseSourceDir,
	'--registry-dir',
	registryDir,
	'--policy',
	didPolicy,
	'--did-document',
	didDocument,
	'--out',
	releasePlanOut,
]);
assert.equal(releasePlanResult.ok, true);
assert.equal(releasePlanResult.sourceCount, 1);
assert.match(releasePlanResult.sourceSetDigest, /^sha256:[a-f0-9]{64}$/);
assert.equal(releasePlanResult.nextActions[0].id, 'publish-llmix-registry');
assert.equal(releasePlanResult.nextActions[0].external, 'use the LLMix registry publisher, then sign the registry root');
assert.equal(readFileSync(releaseSourceFile, 'utf8'), releaseSourceBefore);
assert.equal(readFileSync(registrySentinel, 'utf8'), 'registry stays untouched\n');
const releasePlan = JSON.parse(readFileSync(releasePlanOut, 'utf8'));
assert.equal(releasePlan.kind, 'llmix-release-plan');
assert.equal(releasePlan.sources[0].module, 'search_summary');
assert.equal(releasePlan.sources[0].preset, 'openai_fast');
assert.equal(releasePlan.sources[0].sourcePath, 'search_summary/openai_fast.mda');
assert.equal(releasePlan.sources[0].rawSourceDigest, digestBytes(readFileSync(releaseSourceFile)));
assert.equal(releasePlan.sources[0].canonicalSourceDigest, llmixIntegrity.digest);
assert.equal(releasePlan.sources[0].signaturePayloadDigest, llmixIntegrity.digest);
assert.equal(releasePlan.sources[0].signerIdentity.signer, 'did-web:tools.example.com');
assert.equal(releasePlan.sources[0].expectedRegistryEntryIdentity, 'search_summary/openai_fast');
assert.equal(releasePlan.checklist.find((item) => item.id === 'registry-publish').external, true);

const releasePlanOut2 = join(tmp, 'release', 'plan-repeat.json');
const releasePlanRepeat = json([
	'release',
	'prepare',
	'--target',
	'llmix-registry',
	'--source',
	releaseSourceDir,
	'--registry-dir',
	registryDir,
	'--policy',
	didPolicy,
	'--did-document',
	didDocument,
	'--out',
	releasePlanOut2,
]);
assert.equal(releasePlanRepeat.sourceSetDigest, releasePlanResult.sourceSetDigest);
assert.deepEqual(JSON.parse(readFileSync(releasePlanOut2, 'utf8')).sources, releasePlan.sources);

const duplicateReleaseDir = join(tmp, 'release-duplicate');
mkdirSync(join(duplicateReleaseDir, 'first'), { recursive: true });
mkdirSync(join(duplicateReleaseDir, 'second'), { recursive: true });
writeFileSync(join(duplicateReleaseDir, 'first', 'openai_fast.mda'), readFileSync(signedLlmix, 'utf8'));
writeFileSync(join(duplicateReleaseDir, 'second', 'openai_fast.mda'), readFileSync(signedLlmix, 'utf8'));
const duplicateReleaseOut = join(tmp, 'release', 'duplicate-plan.json');
const duplicateReleasePlan = json(
	[
		'release',
		'prepare',
		'--target',
		'llmix-registry',
		'--source',
		duplicateReleaseDir,
		'--registry-dir',
		registryDir,
		'--policy',
		didPolicy,
		'--did-document',
		didDocument,
		'--out',
		duplicateReleaseOut,
	],
	1,
);
assert.ok(duplicateReleasePlan.diagnostics.some((diagnostic) => diagnostic.code === 'llmix.duplicate_registry_entry'));
assert.equal(existsSync(duplicateReleaseOut), false);

const registryRootDir = join(registryDir, 'compiled', '2026-05-09T120000Z');
mkdirSync(registryRootDir, { recursive: true });
const registryRootPath = join(registryRootDir, 'registry-root.json');
const registryRootBody = {
	version: 1,
	kind: 'llmix-registry-root',
	revision: '2026-05-09T120000Z',
	publishedAt: '2026-05-09T12:00:00Z',
	highWatermark: '2026-05-09T120000Z',
	sourceSetDigest: releasePlan.sourceSetDigest,
	sources: releasePlan.sources.map((sourceEntry) => ({
		registryEntryIdentity: sourceEntry.expectedRegistryEntryIdentity,
		registryEntryPath: sourceEntry.expectedRegistryEntryPath,
		canonicalSourceDigest: sourceEntry.canonicalSourceDigest,
		signaturePayloadDigest: sourceEntry.signaturePayloadDigest,
	})),
};
const registryRootDigest = digestJson(registryRootBody);
const registryRoot = {
	...registryRootBody,
	integrity: { algorithm: 'sha256', digest: registryRootDigest },
	signatures: [
		{
			signer: 'did-web:tools.example.com',
			'key-id': didKeyId,
			algorithm: 'ed25519',
			'payload-type': INTEGRITY_PAYLOAD_TYPE,
			'payload-digest': registryRootDigest,
			signature: signatureForPayloadType(didPrivateKey, INTEGRITY_PAYLOAD_TYPE, registryRootDigest),
		},
	],
};
writeFileSync(registryRootPath, JSON.stringify(registryRoot, null, 2));
const otherRegistryDir = join(tmp, 'other-registry');
const otherRegistryRootDir = join(otherRegistryDir, 'compiled', '2026-05-09T120000Z');
mkdirSync(otherRegistryRootDir, { recursive: true });
const otherRegistryRootPath = join(otherRegistryRootDir, 'registry-root.json');
writeFileSync(otherRegistryRootPath, JSON.stringify(registryRoot, null, 2));

const trustManifestOut = join(tmp, 'release', 'llmix-trust.json');
const trustManifestResult = json([
	'release',
	'finalize',
	'--target',
	'llmix-registry',
	'--registry-dir',
	registryDir,
	'--registry-root',
	registryRootPath,
	'--release-plan',
	releasePlanOut,
	'--policy',
	didPolicy,
	'--did-document',
	didDocument,
	'--derive-root-digest',
	'--minimum-revision',
	'2026-05-09T120000Z',
	'--minimum-published-at',
	'2026-05-09T12:00:00Z',
	'--high-watermark',
	'2026-05-09T120000Z',
	'--out',
	trustManifestOut,
]);
assert.equal(trustManifestResult.ok, true);
assert.equal(trustManifestResult.expectedRootDigest, registryRootDigest);
assert.equal(trustManifestResult.sourceSetDigest, releasePlan.sourceSetDigest);
assert.equal(trustManifestResult.nextActions[0].id, 'install-external-trust-manifest');
assert.equal(trustManifestResult.nextActions[1].id, 'deploy-signed-registry');
const trustManifest = JSON.parse(readFileSync(trustManifestOut, 'utf8'));
assert.equal(trustManifest.kind, 'llmix-trust-manifest');
assert.equal(trustManifest.expectedRootDigest, registryRootDigest);
assert.equal(trustManifest.registryRootSignerIdentity.signer, 'did-web:tools.example.com');
assert.equal(trustManifest.registryRootTrustPolicy.trustedSigners[0].domain, 'tools.example.com');
assert.equal(trustManifest.rekorPolicy, null);
assert.equal(trustManifest.minimumRevision, '2026-05-09T120000Z');
assert.equal(trustManifest.minimumPublishedAt, '2026-05-09T12:00:00Z');
assert.equal(trustManifest.highWatermark, '2026-05-09T120000Z');

const nativeRevision = '2026-05-10T120000Z';
const nativeCompiledDir = join(registryDir, 'compiled', nativeRevision);
const nativeSourcePath = join(nativeCompiledDir, 'source', 'search_summary', 'openai_fast.mda');
const nativeResolvedPath = join(nativeCompiledDir, 'resolved', 'search_summary', 'openai_fast.json');
mkdirSync(join(nativeCompiledDir, 'source', 'search_summary'), { recursive: true });
mkdirSync(join(nativeCompiledDir, 'resolved', 'search_summary'), { recursive: true });
writeFileSync(nativeSourcePath, readFileSync(releaseSourceFile));
writeFileSync(nativeResolvedPath, `${stableJson({ model: 'gpt-5-mini', provider: 'openai' })}\n`);
const nativeSourceRel = `compiled/${nativeRevision}/source/search_summary/openai_fast.mda`;
const nativeResolvedRel = `compiled/${nativeRevision}/resolved/search_summary/openai_fast.json`;
const nativeManifestRel = `compiled/${nativeRevision}/manifest.json`;
const nativeManifest = {
	revision: nativeRevision,
	published_at: '2026-05-10T12:00:00.000Z',
	schema_version: 1,
	presets: {
		'search_summary/openai_fast': {
			source_path: 'source/search_summary/openai_fast.mda',
			source_sha256: sha256Hex(readFileSync(nativeSourcePath)),
			resolved_path: 'resolved/search_summary/openai_fast.json',
			resolved_sha256: sha256Hex(readFileSync(nativeResolvedPath)),
		},
	},
};
const nativeManifestPath = join(nativeCompiledDir, 'manifest.json');
writeFileSync(nativeManifestPath, `${JSON.stringify(nativeManifest, null, 2)}\n`);
const nativeManifestSha = sha256Hex(readFileSync(nativeManifestPath));
const nativeCurrent = { revision: nativeRevision, manifest_sha256: nativeManifestSha };
const nativeCurrentPath = join(registryDir, 'current.json');
writeFileSync(nativeCurrentPath, `${JSON.stringify(nativeCurrent, null, 2)}\n`);
const nativePayload = {
	schema: 'llmix.config-registry.root',
	schema_version: 1,
	revision: nativeRevision,
	published_at: '2026-05-10T12:00:00.000Z',
	current: {
		path: 'current.json',
		revision: nativeRevision,
		manifest_sha256: nativeManifestSha,
		sha256: sha256Hex(readFileSync(nativeCurrentPath)),
	},
	manifest: {
		path: nativeManifestRel,
		sha256: nativeManifestSha,
	},
	files: [
		{ path: nativeSourceRel, sha256: sha256Hex(readFileSync(nativeSourcePath)), role: 'source' },
		{ path: nativeResolvedRel, sha256: sha256Hex(readFileSync(nativeResolvedPath)), role: 'resolved' },
	],
};
const nativePayloadBytes = Buffer.from(stableJson(nativePayload), 'utf8');
const nativePayloadSha = sha256Hex(nativePayloadBytes);
const nativeEnvelope = {
	schema: 'llmix.config-registry.root-envelope',
	schema_version: 1,
	payload: nativePayload,
	integrity: { algorithm: 'sha256', digest: `sha256:${nativePayloadSha}` },
	payload_sha256: nativePayloadSha,
	signatures: [
		{
			signer: 'did-web:tools.example.com',
			'key-id': didKeyId,
			algorithm: 'ed25519',
			'payload-type': LLMIX_REGISTRY_ROOT_PAYLOAD_TYPE,
			'payload-digest': `sha256:${nativePayloadSha}`,
			signature: signatureForPayloadBytes(didPrivateKey, LLMIX_REGISTRY_ROOT_PAYLOAD_TYPE, nativePayloadBytes),
		},
	],
};
const nativeRegistryRootPath = join(nativeCompiledDir, 'registry-root.json');
writeFileSync(nativeRegistryRootPath, `${JSON.stringify(nativeEnvelope, null, 2)}\n`);
const nativeRegistryRootDigest = digestBytes(readFileSync(nativeRegistryRootPath));
const nativeTrustManifestOut = join(tmp, 'release', 'llmix-native-trust.json');
const nativeTrustManifestResult = json([
	'release',
	'finalize',
	'--target',
	'llmix-registry',
	'--registry-dir',
	registryDir,
	'--registry-root',
	nativeRegistryRootPath,
	'--release-plan',
	releasePlanOut,
	'--policy',
	didPolicy,
	'--did-document',
	didDocument,
	'--derive-root-digest',
	'--out',
	nativeTrustManifestOut,
]);
assert.equal(nativeTrustManifestResult.ok, true);
assert.equal(nativeTrustManifestResult.expectedRootDigest, nativeRegistryRootDigest);
assert.equal(nativeTrustManifestResult.sourceSetDigest, releasePlan.sourceSetDigest);
const nativeTrustManifest = JSON.parse(readFileSync(nativeTrustManifestOut, 'utf8'));
assert.equal(nativeTrustManifest.expectedRootDigest, nativeRegistryRootDigest);
assert.equal(nativeTrustManifest.registryRoot.revision, nativeRevision);

const tamperedNativePayloadDigestPath = join(nativeCompiledDir, 'registry-root-bad-payload-digest.json');
writeFileSync(tamperedNativePayloadDigestPath, `${JSON.stringify({ ...nativeEnvelope, payload_sha256: '0'.repeat(64) }, null, 2)}\n`);
const tamperedNativePayloadDigest = json(
	[
		'release',
		'finalize',
		'--target',
		'llmix-registry',
		'--registry-dir',
		registryDir,
		'--registry-root',
		tamperedNativePayloadDigestPath,
		'--release-plan',
		releasePlanOut,
		'--policy',
		didPolicy,
		'--did-document',
		didDocument,
		'--derive-root-digest',
		'--out',
		join(tmp, 'release', 'native-bad-payload-digest.json'),
	],
	1,
);
assert.ok(tamperedNativePayloadDigest.diagnostics.some((diagnostic) => diagnostic.code === 'integrity.mismatch'));

const badPayloadTypePath = join(nativeCompiledDir, 'registry-root-bad-payload-type.json');
writeFileSync(
	badPayloadTypePath,
	`${JSON.stringify(
		{
			...nativeEnvelope,
			signatures: [
				{
					...nativeEnvelope.signatures[0],
					'payload-type': INTEGRITY_PAYLOAD_TYPE,
					signature: signatureForPayloadBytes(didPrivateKey, INTEGRITY_PAYLOAD_TYPE, nativePayloadBytes),
				},
			],
		},
		null,
		2,
	)}\n`,
);
const badPayloadType = json(
	[
		'release',
		'finalize',
		'--target',
		'llmix-registry',
		'--registry-dir',
		registryDir,
		'--registry-root',
		badPayloadTypePath,
		'--release-plan',
		releasePlanOut,
		'--policy',
		didPolicy,
		'--did-document',
		didDocument,
		'--derive-root-digest',
		'--out',
		join(tmp, 'release', 'native-bad-payload-type.json'),
	],
	1,
);
assert.ok(badPayloadType.diagnostics.some((diagnostic) => diagnostic.code === 'signature.payload_type_mismatch'));

const badFileDigestPath = join(nativeCompiledDir, 'registry-root-bad-file-digest.json');
const badFileDigestPayload = {
	...nativePayload,
	files: [nativePayload.files[0], { ...nativePayload.files[1], sha256: '1'.repeat(64) }],
};
const badFileDigestPayloadBytes = Buffer.from(stableJson(badFileDigestPayload), 'utf8');
const badFileDigestPayloadSha = sha256Hex(badFileDigestPayloadBytes);
writeFileSync(
	badFileDigestPath,
	`${JSON.stringify(
		{
			...nativeEnvelope,
			payload: badFileDigestPayload,
			integrity: { algorithm: 'sha256', digest: `sha256:${badFileDigestPayloadSha}` },
			payload_sha256: badFileDigestPayloadSha,
			signatures: [
				{
					...nativeEnvelope.signatures[0],
					'payload-digest': `sha256:${badFileDigestPayloadSha}`,
					signature: signatureForPayloadBytes(didPrivateKey, LLMIX_REGISTRY_ROOT_PAYLOAD_TYPE, badFileDigestPayloadBytes),
				},
			],
		},
		null,
		2,
	)}\n`,
);
const badFileDigest = json(
	[
		'release',
		'finalize',
		'--target',
		'llmix-registry',
		'--registry-dir',
		registryDir,
		'--registry-root',
		badFileDigestPath,
		'--release-plan',
		releasePlanOut,
		'--policy',
		didPolicy,
		'--did-document',
		didDocument,
		'--derive-root-digest',
		'--out',
		join(tmp, 'release', 'native-bad-file-digest.json'),
	],
	1,
);
assert.ok(badFileDigest.diagnostics.some((diagnostic) => diagnostic.code === 'llmix.registry_root_file_digest_mismatch'));

const badRawReleasePlanPath = join(tmp, 'release', 'plan-bad-raw-source.json');
writeFileSync(
	badRawReleasePlanPath,
	`${JSON.stringify(
		{
			...releasePlan,
			sources: releasePlan.sources.map((sourceEntry) => ({ ...sourceEntry, rawSourceDigest: `sha256:${'2'.repeat(64)}` })),
		},
		null,
		2,
	)}\n`,
);
const badRawSource = json(
	[
		'release',
		'finalize',
		'--target',
		'llmix-registry',
		'--registry-dir',
		registryDir,
		'--registry-root',
		nativeRegistryRootPath,
		'--release-plan',
		badRawReleasePlanPath,
		'--policy',
		didPolicy,
		'--did-document',
		didDocument,
		'--derive-root-digest',
		'--out',
		join(tmp, 'release', 'native-bad-raw-source.json'),
	],
	1,
);
assert.ok(badRawSource.diagnostics.some((diagnostic) => diagnostic.code === 'llmix.registry_root_stale_digest'));
const releaseTemp = join(tmp, 'release', '.mda-tmp');
writeFileSync(releaseTemp, 'user-owned-release-temp\n');
const failedTrustManifestExistingOut = json(
	[
		'release',
		'finalize',
		'--target',
		'llmix-registry',
		'--registry-dir',
		registryDir,
		'--registry-root',
		registryRootPath,
		'--release-plan',
		releasePlanOut,
		'--policy',
		didPolicy,
		'--did-document',
		didDocument,
		'--derive-root-digest',
		'--out',
		trustManifestOut,
	],
	3,
);
assert.equal(failedTrustManifestExistingOut.ok, false);
assert.equal(readFileSync(releaseTemp, 'utf8'), 'user-owned-release-temp\n');
const expectedSnippetVars = {
	LLMIX_TRUST_MANIFEST: trustManifestOut,
	LLMIX_EXPECTED_ROOT_DIGEST: trustManifest.expectedRootDigest,
	LLMIX_SOURCE_SET_DIGEST: trustManifest.sourceSetDigest,
	LLMIX_RELEASE_PLAN_DIGEST: trustManifest.releasePlanDigest,
	LLMIX_REGISTRY_ROOT: trustManifest.registryRoot.path,
	LLMIX_RELEASE_PLAN: trustManifest.releasePlan.path,
	LLMIX_HIGH_WATERMARK: trustManifest.highWatermark,
};
const expectedSnippetEntries = Object.entries(expectedSnippetVars);
const expectedSnippets = {
	json: `${JSON.stringify(expectedSnippetVars, null, 2)}\n`,
	env: `${expectedSnippetEntries.map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n')}\n`,
	kubernetes: [
		'apiVersion: v1',
		'kind: ConfigMap',
		'metadata:',
		'  name: llmix-trust',
		'data:',
		...expectedSnippetEntries.map(([key, value]) => `  ${key}: ${JSON.stringify(value)}`),
		'',
	].join('\n'),
	'github-actions': ['env:', ...expectedSnippetEntries.map(([key, value]) => `  ${key}: ${JSON.stringify(value)}`), ''].join('\n'),
	terraform: [
		'locals {',
		'  llmix_trust = {',
		...expectedSnippetEntries.map(([key, value]) => `    ${key} = ${JSON.stringify(value)}`),
		'  }',
		'}',
		'',
	].join('\n'),
	typescript: `export const llmixTrust = ${JSON.stringify(expectedSnippetVars, null, 2)} as const;\n`,
	python: `LLMIX_TRUST = ${JSON.stringify(expectedSnippetVars, null, 2)}\n`,
	rust: `${expectedSnippetEntries.map(([key, value]) => `pub const ${key}: &str = ${JSON.stringify(value)};`).join('\n')}\n`,
};

const snippetFormats = ['json', 'env', 'kubernetes', 'github-actions', 'terraform', 'typescript', 'python', 'rust'];
for (const format of snippetFormats) {
	const snippetOut = snippetOutputPath(format);
	const snippet = json([
		'release',
		'finalize',
		'--target',
		'llmix-registry',
		'--registry-dir',
		registryDir,
		'--manifest',
		trustManifestOut,
		'--snippet-format',
		format,
		'--snippet-out',
		snippetOut,
	]);
	assert.equal(snippet.ok, true);
	assert.equal(snippet.format, format);
	assert.equal(snippet.nextActions[0].id, 'install-deployment-snippet');
	assert.equal(snippet.nextActions[1].id, 'run-release-doctor');
	const snippetContent = readFileSync(snippetOut, 'utf8');
	assert.equal(snippetContent, expectedSnippets[format]);
	assert.equal(
		normalizeSnippetGolden(snippetContent, {
			'<TRUST_MANIFEST>': trustManifestOut,
			'<REGISTRY_ROOT>': registryRootPath,
			'<RELEASE_PLAN>': releasePlanOut,
		}),
		readFileSync(snippetGoldenPath(format), 'utf8'),
			`${format} snippet golden output`,
	);
	assert.match(snippetContent, /LLMIX_TRUST_MANIFEST/);
	assert.match(snippetContent, /sha256:/);
	assert.doesNotMatch(snippetContent, /config\/llm/);
	if (format === 'json') assert.equal(JSON.parse(snippetContent).LLMIX_EXPECTED_ROOT_DIGEST, registryRootDigest);
	if (format === 'env') assert.match(snippetContent, /^LLMIX_TRUST_MANIFEST="/);
	if (format === 'kubernetes') {
		const parsed = loadYaml(snippetContent);
		assert.equal(parsed.kind, 'ConfigMap');
		assert.equal(parsed.data.LLMIX_EXPECTED_ROOT_DIGEST, registryRootDigest);
	}
	if (format === 'github-actions') {
		const parsed = loadYaml(snippetContent);
		assert.equal(parsed.env.LLMIX_EXPECTED_ROOT_DIGEST, registryRootDigest);
	}
	if (format === 'terraform') assert.match(snippetContent, /^locals \{\n/);
	if (format === 'typescript') {
		assert.match(snippetContent, /^export const llmixTrust = /);
		assertCommandOk(
			spawnSync(
				'pnpm',
				['exec', 'tsc', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--noEmit', snippetOut],
				{
					cwd: repo,
					encoding: 'utf8',
				},
			),
			'typescript snippet syntax check',
		);
	}
	if (format === 'python') {
		assert.match(snippetContent, /^LLMIX_TRUST = \{/);
		assertCommandOk(spawnSync('python3', ['-m', 'py_compile', snippetOut], { cwd: repo, encoding: 'utf8' }), 'python snippet syntax check');
	}
	if (format === 'rust') {
		const constants = Object.fromEntries(
			snippetContent
				.trim()
				.split('\n')
				.map((line) => {
					const match = line.match(/^pub const ([A-Z0-9_]+): &str = (.+);$/);
					assert.ok(match, `invalid Rust const line: ${line}`);
					return [match[1], JSON.parse(match[2])];
				}),
		);
		assert.equal(constants.LLMIX_EXPECTED_ROOT_DIGEST, registryRootDigest);
	}
}
const existingSnippet = json(
	[
		'release',
		'finalize',
		'--target',
		'llmix-registry',
		'--registry-dir',
		registryDir,
		'--manifest',
		trustManifestOut,
		'--snippet-format',
		'json',
		'--snippet-out',
		join(tmp, 'release', 'llmix-trust-snippet.json'),
	],
	3,
);
assert.equal(existingSnippet.diagnostics[0].code, 'filesystem.io');
assert.equal(readFileSync(releaseTemp, 'utf8'), 'user-owned-release-temp\n');

const snippetMissingRegistryDirOut = join(tmp, 'release', 'snippet-missing-registry.json');
const snippetMissingRegistryDir = json(
	[
		'release',
		'finalize',
		'--target',
		'llmix-registry',
		'--manifest',
		trustManifestOut,
		'--snippet-format',
		'json',
		'--snippet-out',
		snippetMissingRegistryDirOut,
	],
	1,
);
assert.equal(snippetMissingRegistryDir.diagnostics[0].code, 'release.registry_dir_required');
assert.equal(existsSync(snippetMissingRegistryDirOut), false);

const insideRegistrySnippetManifest = join(registryDir, 'inside-snippet-trust.json');
writeFileSync(insideRegistrySnippetManifest, readFileSync(trustManifestOut, 'utf8'));
const unsafeSnippetManifestOut = join(tmp, 'release', 'unsafe-snippet-manifest.json');
const unsafeSnippetManifest = json(
	[
		'release',
		'finalize',
		'--target',
		'llmix-registry',
		'--registry-dir',
		registryDir,
		'--manifest',
		insideRegistrySnippetManifest,
		'--snippet-format',
		'json',
		'--snippet-out',
		unsafeSnippetManifestOut,
	],
	1,
);
assert.equal(unsafeSnippetManifest.diagnostics[0].code, 'release.trust_artifact_inside_registry');
assert.equal(existsSync(unsafeSnippetManifestOut), false);

const symlinkInsideSnippetManifest = join(tmp, 'release', 'inside-snippet-trust-link.json');
symlinkSync(insideRegistrySnippetManifest, symlinkInsideSnippetManifest);
const symlinkInsideSnippetManifestOut = join(tmp, 'release', 'symlink-inside-snippet-manifest.json');
const symlinkInsideSnippetManifestResult = json(
	[
		'release',
		'finalize',
		'--target',
		'llmix-registry',
		'--registry-dir',
		registryDir,
		'--manifest',
		symlinkInsideSnippetManifest,
		'--snippet-format',
		'json',
		'--snippet-out',
		symlinkInsideSnippetManifestOut,
	],
	1,
);
assert.equal(symlinkInsideSnippetManifestResult.diagnostics[0].code, 'release.trust_artifact_inside_registry');
assert.equal(existsSync(symlinkInsideSnippetManifestOut), false);

const unsafeSnippetOut = join(registryDir, 'unsafe-snippet.json');
const unsafeSnippet = json(
	[
		'release',
		'finalize',
		'--target',
		'llmix-registry',
		'--registry-dir',
		registryDir,
		'--manifest',
		trustManifestOut,
		'--snippet-format',
		'json',
		'--snippet-out',
		unsafeSnippetOut,
	],
	1,
);
assert.equal(unsafeSnippet.diagnostics[0].code, 'release.trust_artifact_inside_registry');
assert.equal(existsSync(unsafeSnippetOut), false);

const snippetRegistrySymlink = join(tmp, 'registry-snippet-link');
symlinkSync(registryDir, snippetRegistrySymlink, 'dir');
const symlinkSnippetOut = join(snippetRegistrySymlink, 'unsafe-snippet.json');
const symlinkSnippet = json(
	[
		'release',
		'finalize',
		'--target',
		'llmix-registry',
		'--registry-dir',
		registryDir,
		'--manifest',
		trustManifestOut,
		'--snippet-format',
		'json',
		'--snippet-out',
		symlinkSnippetOut,
	],
	1,
);
assert.equal(symlinkSnippet.diagnostics[0].code, 'release.trust_artifact_inside_registry');
assert.equal(existsSync(symlinkSnippetOut), false);

const traversalSnippetOut = join(registryDir, '..', 'registry', 'traversal-snippet.json');
const traversalSnippet = json(
	[
		'release',
		'finalize',
		'--target',
		'llmix-registry',
		'--registry-dir',
		registryDir,
		'--manifest',
		trustManifestOut,
		'--snippet-format',
		'json',
		'--snippet-out',
		traversalSnippetOut,
	],
	1,
);
assert.equal(traversalSnippet.diagnostics[0].code, 'release.trust_artifact_inside_registry');
assert.equal(existsSync(traversalSnippetOut), false);

const doctorReadOnlyFiles = [releaseSourceFile, registrySentinel, registryRootPath, releasePlanOut, trustManifestOut, releaseTemp];
const doctorReadOnlyBefore = fileDigests(doctorReadOnlyFiles);

const doctorMissingDidDocument = json(
	[
		'doctor',
		'release',
		'--target',
		'llmix-registry',
		'--source',
		releaseSourceDir,
		'--registry-dir',
		registryDir,
		'--release-plan',
		releasePlanOut,
		'--manifest',
		trustManifestOut,
	],
	1,
);
assert.ok(doctorMissingDidDocument.diagnostics.some((diagnostic) => diagnostic.code === 'did_web.document_unavailable'));
assert.equal(doctorMissingDidDocument.nextActions[0].id, 'fix-release-state');
assert.equal(readFileSync(releaseTemp, 'utf8'), 'user-owned-release-temp\n');

const doctor = json([
	'doctor',
	'release',
	'--target',
	'llmix-registry',
	'--source',
	releaseSourceDir,
	'--registry-dir',
	registryDir,
	'--release-plan',
	releasePlanOut,
	'--manifest',
	trustManifestOut,
	'--did-document',
	didDocument,
]);
assert.equal(doctor.ok, true);
assert.equal(doctor.readOnly, true);
assert.equal(doctor.written, false);
assert.equal(doctor.nextActions[0].id, 'deploy-secure-llmix');
assert.deepEqual(
	doctor.checks.map((check) => check.ok),
	doctor.checks.map(() => true),
);
assert.deepEqual(fileDigests(doctorReadOnlyFiles), doctorReadOnlyBefore);

const tamperedSignatureRegistryRoot = join(registryRootDir, 'registry-root-tampered-signature.json');
writeFileSync(
	tamperedSignatureRegistryRoot,
	JSON.stringify(
		{
			...registryRoot,
			signatures: [
				{
					...registryRoot.signatures[0],
					signature: signatureForPayloadType(didSecondPrivateKey, INTEGRITY_PAYLOAD_TYPE, registryRootDigest),
				},
			],
		},
		null,
		2,
	),
);
const tamperedSignatureDoctorManifest = join(tmp, 'release', 'tampered-signature-doctor-trust.json');
writeFileSync(
	tamperedSignatureDoctorManifest,
	JSON.stringify({ ...trustManifest, registryRoot: { ...trustManifest.registryRoot, path: tamperedSignatureRegistryRoot } }, null, 2),
);
const tamperedSignatureDoctor = json(
	[
		'doctor',
		'release',
		'--target',
		'llmix-registry',
		'--source',
		releaseSourceDir,
		'--registry-dir',
		registryDir,
		'--release-plan',
		releasePlanOut,
		'--manifest',
		tamperedSignatureDoctorManifest,
		'--did-document',
		didDocument,
	],
	1,
);
assert.ok(tamperedSignatureDoctor.diagnostics.some((diagnostic) => diagnostic.code === 'signature.verification_failed'));
assert.equal(tamperedSignatureDoctor.readOnly, true);

const missingReleasePlanDoctor = json(
	[
		'doctor',
		'release',
		'--target',
		'llmix-registry',
		'--source',
		releaseSourceDir,
		'--registry-dir',
		registryDir,
		'--release-plan',
		join(tmp, 'release', 'missing-plan.json'),
		'--manifest',
		trustManifestOut,
	],
	1,
);
assert.equal(missingReleasePlanDoctor.diagnostics[0].code, 'llmix.release_plan_missing');
assert.equal(missingReleasePlanDoctor.nextActions[0].id, 'create-release-plan');
assert.equal(missingReleasePlanDoctor.readOnly, true);

const missingManifestDoctor = json(
	[
		'doctor',
		'release',
		'--target',
		'llmix-registry',
		'--source',
		releaseSourceDir,
		'--registry-dir',
		registryDir,
		'--release-plan',
		releasePlanOut,
		'--manifest',
		join(tmp, 'release', 'missing-trust.json'),
	],
	1,
);
assert.equal(missingManifestDoctor.diagnostics[0].code, 'llmix.manifest_missing');
assert.equal(missingManifestDoctor.nextActions[0].id, 'create-trust-manifest');

const insideRegistryManifest = join(registryDir, 'inside-trust.json');
writeFileSync(insideRegistryManifest, readFileSync(trustManifestOut, 'utf8'));
const insideRegistryDoctor = json(
	[
		'doctor',
		'release',
		'--target',
		'llmix-registry',
		'--source',
		releaseSourceDir,
		'--registry-dir',
		registryDir,
		'--release-plan',
		releasePlanOut,
		'--manifest',
		insideRegistryManifest,
		'--did-document',
		didDocument,
	],
	1,
);
assert.ok(insideRegistryDoctor.diagnostics.some((diagnostic) => diagnostic.code === 'release.trust_artifact_inside_registry'));
assert.equal(insideRegistryDoctor.readOnly, true);

const symlinkInsideDoctorManifest = join(tmp, 'release', 'inside-doctor-trust-link.json');
symlinkSync(insideRegistryManifest, symlinkInsideDoctorManifest);
const symlinkInsideDoctor = json(
	[
		'doctor',
		'release',
		'--target',
		'llmix-registry',
		'--source',
		releaseSourceDir,
		'--registry-dir',
		registryDir,
		'--release-plan',
		releasePlanOut,
		'--manifest',
		symlinkInsideDoctorManifest,
		'--did-document',
		didDocument,
	],
	1,
);
assert.ok(symlinkInsideDoctor.diagnostics.some((diagnostic) => diagnostic.code === 'release.trust_artifact_inside_registry'));
assert.ok(symlinkInsideDoctor.checks.some((check) => check.id === 'manifest-placement' && check.ok === false));
assert.equal(symlinkInsideDoctor.readOnly, true);

const crossRegistryDoctorManifest = join(tmp, 'release', 'cross-registry-doctor-trust.json');
writeFileSync(
	crossRegistryDoctorManifest,
	JSON.stringify({ ...trustManifest, registryRoot: { ...trustManifest.registryRoot, path: otherRegistryRootPath } }, null, 2),
);
const crossRegistryDoctor = json(
	[
		'doctor',
		'release',
		'--target',
		'llmix-registry',
		'--source',
		releaseSourceDir,
		'--registry-dir',
		registryDir,
		'--release-plan',
		releasePlanOut,
		'--manifest',
		crossRegistryDoctorManifest,
		'--did-document',
		didDocument,
	],
	1,
);
assert.ok(crossRegistryDoctor.diagnostics.some((diagnostic) => diagnostic.code === 'release.registry_root_outside_registry'));
assert.ok(crossRegistryDoctor.checks.some((check) => check.id === 'registry-root-placement' && check.ok === false));
assert.equal(crossRegistryDoctor.readOnly, true);

const rollbackDoctorManifest = join(tmp, 'release', 'rollback-doctor-trust.json');
writeFileSync(rollbackDoctorManifest, JSON.stringify({ ...trustManifest, highWatermark: '2026-05-10T120000Z' }, null, 2));
const rollbackDoctor = json(
	[
		'doctor',
		'release',
		'--target',
		'llmix-registry',
		'--source',
		releaseSourceDir,
		'--registry-dir',
		registryDir,
		'--release-plan',
		releasePlanOut,
		'--manifest',
		rollbackDoctorManifest,
		'--did-document',
		didDocument,
	],
	1,
);
assert.ok(rollbackDoctor.diagnostics.some((diagnostic) => diagnostic.code === 'llmix.high_watermark_rollback'));
assert.equal(rollbackDoctor.nextActions[0].id, 'fix-release-state');

const registryRootSigstoreFixture = writeGithubActionsFixture('registry-root-github-actions-fixture.json', {
	expectedPayloadDigest: registryRootDigest,
	rekor: {
		...githubActionsFixtureObject.rekor,
		logIndex: 23456,
		payloadDigest: registryRootDigest,
	},
});
const registryRootSigstorePath = join(registryRootDir, 'registry-root-sigstore.json');
writeFileSync(
	registryRootSigstorePath,
	JSON.stringify(
		{
			...registryRootBody,
			integrity: { algorithm: 'sha256', digest: registryRootDigest },
			signatures: [
				{
					signer: 'sigstore-oidc:https://token.actions.githubusercontent.com',
					'key-id': 'github-actions-release-key',
					algorithm: 'ed25519',
					'payload-type': INTEGRITY_PAYLOAD_TYPE,
					'payload-digest': registryRootDigest,
					'rekor-log-id': 'github-actions-fixture-rekor-log',
					'rekor-log-index': 23456,
					signature: signatureForPayloadType(githubActionsPrivateKey, INTEGRITY_PAYLOAD_TYPE, registryRootDigest),
				},
			],
		},
		null,
		2,
	),
);
const sigstoreTrustManifestOut = join(tmp, 'release', 'llmix-trust-sigstore.json');
const sigstoreTrustManifest = json([
	'release',
	'finalize',
	'--target',
	'llmix-registry',
	'--registry-dir',
	registryDir,
	'--registry-root',
	registryRootSigstorePath,
	'--release-plan',
	releasePlanOut,
	'--policy',
	githubActionsPolicy,
	'--offline-sigstore-fixture',
	registryRootSigstoreFixture,
	'--derive-root-digest',
	'--out',
	sigstoreTrustManifestOut,
]);
assert.equal(sigstoreTrustManifest.ok, true);
const sigstoreTrustManifestFile = JSON.parse(readFileSync(sigstoreTrustManifestOut, 'utf8'));
assert.equal(sigstoreTrustManifestFile.registryRootSignerIdentity.signer, 'sigstore-oidc:https://token.actions.githubusercontent.com');
assert.equal(sigstoreTrustManifestFile.rekorPolicy.url, 'https://rekor.sigstore.dev');

const expectedDigestManifestOut = join(tmp, 'release', 'llmix-trust-expected-digest.json');
assert.equal(
	json([
		'release',
		'finalize',
		'--target',
		'llmix-registry',
		'--registry-dir',
		registryDir,
		'--registry-root',
		registryRootPath,
		'--release-plan',
		releasePlanOut,
		'--policy',
		didPolicy,
		'--did-document',
		didDocument,
		'--expected-root-digest',
		registryRootDigest,
		'--out',
		expectedDigestManifestOut,
	]).ok,
	true,
);

const unsafeManifest = json(
	[
		'release',
		'finalize',
		'--target',
		'llmix-registry',
		'--registry-dir',
		registryDir,
		'--registry-root',
		registryRootPath,
		'--release-plan',
		releasePlanOut,
		'--policy',
		didPolicy,
		'--did-document',
		didDocument,
		'--derive-root-digest',
		'--out',
		join(registryDir, 'llmix-trust.json'),
	],
	1,
);
assert.equal(unsafeManifest.diagnostics[0].code, 'release.trust_artifact_inside_registry');

const traversalManifest = json(
	[
		'release',
		'finalize',
		'--target',
		'llmix-registry',
		'--registry-dir',
		registryDir,
		'--registry-root',
		registryRootPath,
		'--release-plan',
		releasePlanOut,
		'--policy',
		didPolicy,
		'--did-document',
		didDocument,
		'--derive-root-digest',
		'--out',
		join(registryDir, '..', 'registry', 'traversal-trust.json'),
	],
	1,
);
assert.equal(traversalManifest.diagnostics[0].code, 'release.trust_artifact_inside_registry');

const registrySymlink = join(tmp, 'registry-link');
symlinkSync(registryDir, registrySymlink, 'dir');
const symlinkManifest = json(
	[
		'release',
		'finalize',
		'--target',
		'llmix-registry',
		'--registry-dir',
		registryDir,
		'--registry-root',
		registryRootPath,
		'--release-plan',
		releasePlanOut,
		'--policy',
		didPolicy,
		'--did-document',
		didDocument,
		'--derive-root-digest',
		'--out',
		join(registrySymlink, 'symlink-trust.json'),
	],
	1,
);
assert.equal(symlinkManifest.diagnostics[0].code, 'release.trust_artifact_inside_registry');

const crossRegistryRootManifestOut = join(tmp, 'release', 'cross-registry-root-manifest.json');
const crossRegistryRootManifest = json(
	[
		'release',
		'finalize',
		'--target',
		'llmix-registry',
		'--registry-dir',
		registryDir,
		'--registry-root',
		otherRegistryRootPath,
		'--release-plan',
		releasePlanOut,
		'--policy',
		didPolicy,
		'--did-document',
		didDocument,
		'--derive-root-digest',
		'--out',
		crossRegistryRootManifestOut,
	],
	1,
);
assert.equal(crossRegistryRootManifest.diagnostics[0].code, 'release.registry_root_outside_registry');
assert.equal(existsSync(crossRegistryRootManifestOut), false);

const crossRegistryRootSymlink = join(registryRootDir, 'cross-registry-root-link.json');
symlinkSync(otherRegistryRootPath, crossRegistryRootSymlink);
const crossRegistryRootSymlinkManifestOut = join(tmp, 'release', 'cross-registry-root-link-manifest.json');
const crossRegistryRootSymlinkManifest = json(
	[
		'release',
		'finalize',
		'--target',
		'llmix-registry',
		'--registry-dir',
		registryDir,
		'--registry-root',
		crossRegistryRootSymlink,
		'--release-plan',
		releasePlanOut,
		'--policy',
		didPolicy,
		'--did-document',
		didDocument,
		'--derive-root-digest',
		'--out',
		crossRegistryRootSymlinkManifestOut,
	],
	1,
);
assert.equal(crossRegistryRootSymlinkManifest.diagnostics[0].code, 'release.registry_root_outside_registry');
assert.equal(existsSync(crossRegistryRootSymlinkManifestOut), false);

const wrongDigestManifestOut = join(tmp, 'release', 'wrong-digest-manifest.json');
const wrongDigestManifest = json(
	[
		'release',
		'finalize',
		'--target',
		'llmix-registry',
		'--registry-dir',
		registryDir,
		'--registry-root',
		registryRootPath,
		'--release-plan',
		releasePlanOut,
		'--policy',
		didPolicy,
		'--did-document',
		didDocument,
		'--expected-root-digest',
		`sha256:${'3'.repeat(64)}`,
		'--out',
		wrongDigestManifestOut,
	],
	1,
);
assert.equal(wrongDigestManifest.diagnostics[0].code, 'llmix.root_digest_mismatch');
assert.equal(existsSync(wrongDigestManifestOut), false);

function writeRegistryRootVariant(name, patch) {
	const body = {
		...registryRootBody,
		...patch,
		sources: Object.hasOwn(patch, 'sources') ? patch.sources : registryRootBody.sources,
	};
	const digest = digestJson(body);
	const root = {
		...body,
		integrity: { algorithm: 'sha256', digest },
		signatures: [
			{
				signer: 'did-web:tools.example.com',
				'key-id': didKeyId,
				algorithm: 'ed25519',
				'payload-type': INTEGRITY_PAYLOAD_TYPE,
				'payload-digest': digest,
				signature: signatureForPayloadType(didPrivateKey, INTEGRITY_PAYLOAD_TYPE, digest),
			},
		],
	};
	const path = join(registryRootDir, name);
	writeFileSync(path, JSON.stringify(root, null, 2));
	return path;
}

function trustManifestFailure(rootPath, outName, expectedCode, extra = [], releasePlanPath = releasePlanOut) {
	const outputPath = join(tmp, 'release', outName);
	const result = json(
		[
			'release',
			'finalize',
			'--target',
			'llmix-registry',
			'--registry-dir',
			registryDir,
			'--registry-root',
			rootPath,
			'--release-plan',
			releasePlanPath,
			'--policy',
			didPolicy,
			'--did-document',
			didDocument,
			'--derive-root-digest',
			'--out',
			outputPath,
			...extra,
		],
		1,
	);
	assert.ok(
		result.diagnostics.some((diagnostic) => diagnostic.code === expectedCode),
		expectedCode,
	);
	assert.equal(existsSync(outputPath), false);
	return result;
}

const unsignedRegistryRoot = join(registryRootDir, 'unsigned-registry-root.json');
writeFileSync(
	unsignedRegistryRoot,
	JSON.stringify(
		{
			...registryRootBody,
			integrity: { algorithm: 'sha256', digest: registryRootDigest },
			signatures: [],
		},
		null,
		2,
	),
);
trustManifestFailure(unsignedRegistryRoot, 'unsigned-root-manifest.json', 'signature.missing_required');

const tamperedRegistryRoot = join(registryRootDir, 'tampered-registry-root.json');
writeFileSync(tamperedRegistryRoot, JSON.stringify({ ...registryRoot, revision: '2026-05-10T120000Z' }, null, 2));
trustManifestFailure(tamperedRegistryRoot, 'tampered-root-manifest.json', 'integrity.mismatch');

const missingSourceRoot = writeRegistryRootVariant('missing-source-registry-root.json', { sources: [] });
trustManifestFailure(missingSourceRoot, 'missing-source-manifest.json', 'llmix.registry_root_missing_preset');

const extraSourceRoot = writeRegistryRootVariant('extra-source-registry-root.json', {
	sources: [
		...registryRootBody.sources,
		{
			registryEntryIdentity: 'search_summary/extra',
			registryEntryPath: 'search_summary/extra.json',
			canonicalSourceDigest: llmixIntegrity.digest,
		},
	],
});
trustManifestFailure(extraSourceRoot, 'extra-source-manifest.json', 'llmix.registry_root_extra_preset');

const duplicateSourceRoot = writeRegistryRootVariant('duplicate-source-registry-root.json', {
	sources: [registryRootBody.sources[0], { ...registryRootBody.sources[0] }],
});
trustManifestFailure(duplicateSourceRoot, 'duplicate-source-manifest.json', 'llmix.registry_root_duplicate_preset');

const malformedSourceRoot = writeRegistryRootVariant('malformed-source-registry-root.json', {
	sources: [null],
});
trustManifestFailure(malformedSourceRoot, 'malformed-source-manifest.json', 'llmix.registry_root_invalid');

const malformedReleasePlanOut = join(tmp, 'malformed-release-plan.json');
writeFileSync(malformedReleasePlanOut, JSON.stringify({ ...releasePlan, sources: [null] }, null, 2));
trustManifestFailure(registryRootPath, 'malformed-release-plan-manifest.json', 'llmix.release_plan_invalid', [], malformedReleasePlanOut);

const staleDigestRoot = writeRegistryRootVariant('stale-digest-registry-root.json', {
	sources: [{ ...registryRootBody.sources[0], canonicalSourceDigest: `sha256:${'4'.repeat(64)}` }],
});
trustManifestFailure(staleDigestRoot, 'stale-source-manifest.json', 'llmix.registry_root_stale_digest');

const wrongEntryPathRoot = writeRegistryRootVariant('wrong-entry-path-registry-root.json', {
	sources: [{ ...registryRootBody.sources[0], registryEntryPath: 'search_summary/wrong.json' }],
});
trustManifestFailure(wrongEntryPathRoot, 'wrong-entry-path-manifest.json', 'llmix.registry_root_identity_mismatch');

const wrongRegistryRootSignerPolicy = join(tmp, 'wrong-registry-root-policy.json');
writeFileSync(
	wrongRegistryRootSignerPolicy,
	JSON.stringify({ version: 1, trustedSigners: [{ type: 'did-web', domain: 'other.example.com' }] }),
);
const wrongSignerManifest = json(
	[
		'release',
		'finalize',
		'--target',
		'llmix-registry',
		'--registry-dir',
		registryDir,
		'--registry-root',
		registryRootPath,
		'--release-plan',
		releasePlanOut,
		'--policy',
		wrongRegistryRootSignerPolicy,
		'--did-document',
		didDocument,
		'--derive-root-digest',
		'--out',
		join(tmp, 'release', 'wrong-signer-manifest.json'),
	],
	1,
);
assert.equal(wrongSignerManifest.diagnostics[0].code, 'trust_policy.no_trusted_signature');

const didKeyMismatchManifest = json(
	[
		'release',
		'finalize',
		'--target',
		'llmix-registry',
		'--registry-dir',
		registryDir,
		'--registry-root',
		registryRootPath,
		'--release-plan',
		releasePlanOut,
		'--policy',
		didPolicy,
		'--did-document',
		didDocumentMismatch,
		'--derive-root-digest',
		'--out',
		join(tmp, 'release', 'did-key-mismatch-manifest.json'),
	],
	1,
);
assert.equal(didKeyMismatchManifest.diagnostics[0].code, 'signature.verification_failed');

const missingRekorRegistryRoot = join(registryRootDir, 'missing-rekor-registry-root.json');
writeFileSync(
	missingRekorRegistryRoot,
	JSON.stringify(
		{
			...registryRootBody,
			integrity: { algorithm: 'sha256', digest: registryRootDigest },
			signatures: [
				{
					signer: 'sigstore-oidc:https://token.actions.githubusercontent.com',
					'key-id': 'github-actions-release-key',
					algorithm: 'ed25519',
					'payload-type': INTEGRITY_PAYLOAD_TYPE,
					'payload-digest': registryRootDigest,
					signature: signatureForPayloadType(githubActionsPrivateKey, INTEGRITY_PAYLOAD_TYPE, registryRootDigest),
				},
			],
		},
		null,
		2,
	),
);
const missingRekorManifest = json(
	[
		'release',
		'finalize',
		'--target',
		'llmix-registry',
		'--registry-dir',
		registryDir,
		'--registry-root',
		missingRekorRegistryRoot,
		'--release-plan',
		releasePlanOut,
		'--policy',
		githubActionsPolicy,
		'--offline-sigstore-fixture',
		registryRootSigstoreFixture,
		'--derive-root-digest',
		'--out',
		join(tmp, 'release', 'missing-rekor-root-manifest.json'),
	],
	1,
);
assert.equal(missingRekorManifest.diagnostics[0].code, 'rekor.evidence_missing');

trustManifestFailure(registryRootPath, 'freshness-rollback-manifest.json', 'llmix.freshness_revision_rollback', [
	'--minimum-revision',
	'2026-05-10T120000Z',
]);
trustManifestFailure(registryRootPath, 'high-watermark-rollback-manifest.json', 'llmix.high_watermark_rollback', [
	'--high-watermark',
	'2026-05-10T120000Z',
]);

const numericRollbackRoot = writeRegistryRootVariant('numeric-rollback-registry-root.json', {
	revision: '9',
	highWatermark: '9',
});
trustManifestFailure(numericRollbackRoot, 'numeric-revision-rollback-manifest.json', 'llmix.freshness_revision_rollback', [
	'--minimum-revision',
	'10',
]);
trustManifestFailure(numericRollbackRoot, 'numeric-high-watermark-rollback-manifest.json', 'llmix.high_watermark_rollback', [
	'--high-watermark',
	'10',
]);

const unsignedReleaseDir = join(tmp, 'release-unsigned');
mkdirSync(unsignedReleaseDir, { recursive: true });
writeFileSync(join(unsignedReleaseDir, 'openai_fast.mda'), readFileSync(llmixSource, 'utf8'));
const unsignedReleasePlan = json(
	[
		'release',
		'prepare',
		'--target',
		'llmix-registry',
		'--source',
		unsignedReleaseDir,
		'--registry-dir',
		registryDir,
		'--policy',
		didPolicy,
		'--did-document',
		didDocument,
		'--out',
		join(tmp, 'release', 'unsigned-plan.json'),
	],
	1,
);
assert.equal(unsignedReleasePlan.diagnostics[0].code, 'signature.missing_required');

const missingIntegrityReleaseDir = join(tmp, 'release-missing-integrity');
mkdirSync(missingIntegrityReleaseDir, { recursive: true });
writeFileSync(join(missingIntegrityReleaseDir, 'openai_fast.mda'), llmixInit.scaffold);
const missingIntegrityReleasePlan = json(
	[
		'release',
		'prepare',
		'--target',
		'llmix-registry',
		'--source',
		missingIntegrityReleaseDir,
		'--registry-dir',
		registryDir,
		'--policy',
		didPolicy,
		'--did-document',
		didDocument,
		'--out',
		join(tmp, 'release', 'missing-integrity-plan.json'),
	],
	1,
);
assert.equal(missingIntegrityReleasePlan.diagnostics[0].code, 'integrity.missing_required');

const mismatchReleaseDir = join(tmp, 'release-integrity-mismatch');
mkdirSync(mismatchReleaseDir, { recursive: true });
writeFileSync(
	join(mismatchReleaseDir, 'openai_fast.mda'),
	readFileSync(signedLlmix, 'utf8')
		.replace(/digest: sha256:[a-f0-9]{64}/, `digest: sha256:${'0'.repeat(64)}`)
		.replace(/payload-digest: sha256:[a-f0-9]{64}/, `payload-digest: sha256:${'0'.repeat(64)}`),
);
const mismatchReleasePlan = json(
	[
		'release',
		'prepare',
		'--target',
		'llmix-registry',
		'--source',
		mismatchReleaseDir,
		'--registry-dir',
		registryDir,
		'--policy',
		didPolicy,
		'--did-document',
		didDocument,
		'--out',
		join(tmp, 'release', 'mismatch-plan.json'),
	],
	1,
);
assert.ok(mismatchReleasePlan.diagnostics.some((d) => d.code === 'integrity.mismatch'));

const wrongSignerPolicy = join(tmp, 'wrong-signer-policy.json');
writeFileSync(wrongSignerPolicy, JSON.stringify({ version: 1, trustedSigners: [{ type: 'did-web', domain: 'other.example.com' }] }));
const wrongSignerOut = join(tmp, 'release', 'wrong-signer-plan.json');
const wrongSignerReleasePlan = json(
	[
		'release',
		'prepare',
		'--target',
		'llmix-registry',
		'--source',
		releaseSourceDir,
		'--registry-dir',
		registryDir,
		'--policy',
		wrongSignerPolicy,
		'--did-document',
		didDocument,
		'--out',
		wrongSignerOut,
	],
	1,
);
assert.equal(wrongSignerReleasePlan.diagnostics[0].code, 'trust_policy.no_trusted_signature');
assert.equal(existsSync(wrongSignerOut), false);

const didWrongPayloadType = join(tmp, 'did-web-wrong-payload-type.mda');
rewriteSignaturePayloadType(signedLlmix, didWrongPayloadType, didPrivateKey, llmixIntegrity.digest);
const didWrongPayloadTypeVerify = json(
	['verify', didWrongPayloadType, '--target', 'source', '--policy', didPolicy, '--did-document', didDocument],
	1,
);
assert.equal(didWrongPayloadTypeVerify.diagnostics[0].code, 'signature.payload_type_mismatch');

const secondSignedLlmix = join(tmp, 'second-signed-openai-fast.mda');
assert.equal(
	json([
		'sign',
		signedLlmix,
		'--profile',
		'did-web',
		'--did',
		did,
		'--key-id',
		didSecondKeyId,
		'--key-file',
		didSecondKeyFile,
		'--out',
		secondSignedLlmix,
	]).ok,
	true,
);
const didPolicyMin2 = join(tmp, 'did-web-policy-min-2-valid.json');
writeFileSync(
	didPolicyMin2,
	JSON.stringify({ version: 1, minSignatures: 2, trustedSigners: [{ type: 'did-web', domain: 'tools.example.com' }] }),
);
const didVerifyMin2 = json([
	'verify',
	secondSignedLlmix,
	'--target',
	'source',
	'--policy',
	didPolicyMin2,
	'--did-document',
	didDocumentMultiKey,
]);
assert.equal(didVerifyMin2.ok, true);
assert.equal(didVerifyMin2.trustedSignatures, 2);
assert.equal(didVerifyMin2.rejectedSignatures, 0);

const aliasBypassSignedLlmix = join(tmp, 'alias-bypass-signed-openai-fast.mda');
assert.equal(
	json([
		'sign',
		signedLlmix,
		'--profile',
		'did-web',
		'--did',
		did,
		'--key-id',
		didDefaultKeyId,
		'--key-file',
		didKeyFile,
		'--out',
		aliasBypassSignedLlmix,
	]).ok,
	true,
);
const aliasBypassVerify = json(
	['verify', aliasBypassSignedLlmix, '--target', 'source', '--policy', didPolicyMin2, '--did-document', didDocument],
	1,
);
assert.equal(aliasBypassVerify.diagnostics[0].code, 'trust_policy.insufficient_trusted_signatures');
assert.equal(aliasBypassVerify.trustedSignatures, 1);

const aliasSignedLlmix = join(tmp, 'alias-signed-openai-fast.mda');
const aliasDidSign = json([
	'sign',
	llmixSource,
	'--method',
	'did-web',
	'--key',
	didKeyFile,
	'--identity',
	'tools.example.com',
	'--out',
	aliasSignedLlmix,
]);
assert.equal(aliasDidSign.ok, true);
assert.equal(aliasDidSign.keyId, didDefaultKeyId);
assert.equal(json(['verify', aliasSignedLlmix, '--target', 'source', '--policy', didPolicy, '--did-document', didDocument]).ok, true);

const missingSignOutputMode = json(['sign', llmixSource, '--method', 'did-web', '--key', didKeyFile, '--identity', 'tools.example.com'], 2);
assert.equal(missingSignOutputMode.diagnostics[0].code, 'input.usage');

const missingKeyOutput = join(tmp, 'missing-key-output.mda');
const missingSignKey = json(
	[
		'sign',
		llmixSource,
		'--profile',
		'did-web',
		'--did',
		did,
		'--key-id',
		didKeyId,
		'--key-file',
		join(tmp, 'missing-private-key.pem'),
		'--out',
		missingKeyOutput,
	],
	3,
);
assert.equal(missingSignKey.diagnostics[0].code, 'filesystem.io');
assert.equal(existsSync(missingKeyOutput), false);

const existingSignedOut = join(tmp, 'existing-signed-output.mda');
writeFileSync(existingSignedOut, 'keep');
const refusedSignedOut = json(
	['sign', llmixSource, '--profile', 'did-web', '--did', did, '--key-id', didKeyId, '--key-file', didKeyFile, '--out', existingSignedOut],
	3,
);
assert.equal(refusedSignedOut.diagnostics[0].code, 'filesystem.io');
assert.equal(readFileSync(existingSignedOut, 'utf8'), 'keep');

const wrongKeyIdSigned = join(tmp, 'wrong-key-id-signed.mda');
assert.equal(
	json([
		'sign',
		llmixSource,
		'--profile',
		'did-web',
		'--did',
		did,
		'--key-id',
		`${did}#removed`,
		'--key-file',
		didKeyFile,
		'--out',
		wrongKeyIdSigned,
	]).ok,
	true,
);
const wrongKeyIdVerify = json(['verify', wrongKeyIdSigned, '--target', 'source', '--policy', didPolicy, '--did-document', didDocument], 1);
assert.equal(wrongKeyIdVerify.diagnostics[0].code, 'did_web.key_not_found');

const staleThenValidSigned = join(tmp, 'stale-then-valid-signed.mda');
assert.equal(
	json([
		'sign',
		wrongKeyIdSigned,
		'--profile',
		'did-web',
		'--did',
		did,
		'--key-id',
		didKeyId,
		'--key-file',
		didKeyFile,
		'--out',
		staleThenValidSigned,
	]).ok,
	true,
);
const staleThenValidVerify = json([
	'verify',
	staleThenValidSigned,
	'--target',
	'source',
	'--policy',
	didPolicy,
	'--did-document',
	didDocument,
]);
assert.equal(staleThenValidVerify.ok, true);
assert.equal(staleThenValidVerify.trustedSignatures, 1);
assert.equal(staleThenValidVerify.rejectedSignatures, 1);

const multiRejectedVerify = json(
	['verify', staleThenValidSigned, '--target', 'source', '--policy', didPolicy, '--did-document', didDocumentMismatch],
	1,
);
assert.ok(multiRejectedVerify.diagnostics.some((diagnostic) => diagnostic.code === 'did_web.key_not_found'));
assert.ok(multiRejectedVerify.diagnostics.some((diagnostic) => diagnostic.code === 'signature.verification_failed'));

const removedKeyVerify = json(
	['verify', signedLlmix, '--target', 'source', '--policy', didPolicy, '--did-document', didDocumentRemovedKey],
	1,
);
assert.equal(removedKeyVerify.diagnostics[0].code, 'did_web.key_not_found');

const keyMismatchVerify = json(
	['verify', signedLlmix, '--target', 'source', '--policy', didPolicy, '--did-document', didDocumentMismatch],
	1,
);
assert.equal(keyMismatchVerify.diagnostics[0].code, 'signature.verification_failed');

const wrongDocumentIdVerify = json(
	['verify', signedLlmix, '--target', 'source', '--policy', didPolicy, '--did-document', didDocumentWrongId],
	1,
);
assert.equal(wrongDocumentIdVerify.diagnostics[0].code, 'did_web.document_invalid');

const wrongDocumentControllerVerify = json(
	['verify', signedLlmix, '--target', 'source', '--policy', didPolicy, '--did-document', didDocumentWrongController],
	1,
);
assert.equal(wrongDocumentControllerVerify.diagnostics[0].code, 'did_web.document_invalid');

const tamperedPayloadDigest = join(tmp, 'tampered-payload-digest.mda');
writeFileSync(
	tamperedPayloadDigest,
	readFileSync(signedLlmix, 'utf8').replace(/payload-digest: sha256:[a-f0-9]{64}/, `payload-digest: sha256:${'1'.repeat(64)}`),
);
const tamperedPayloadVerify = json(
	['verify', tamperedPayloadDigest, '--target', 'source', '--policy', didPolicy, '--did-document', didDocument],
	1,
);
assert.equal(tamperedPayloadVerify.diagnostics[0].code, 'signature.digest_mismatch');

const missingDidDocumentVerify = json(
	['verify', signedLlmix, '--target', 'source', '--policy', didPolicy, '--did-document', join(tmp, 'missing-did.json')],
	1,
);
assert.equal(missingDidDocumentVerify.diagnostics[0].code, 'did_web.document_unavailable');

const insufficientPolicy = join(tmp, 'did-web-policy-min-2.json');
writeFileSync(
	insufficientPolicy,
	JSON.stringify({ version: 1, minSignatures: 2, trustedSigners: [{ type: 'did-web', domain: 'tools.example.com' }] }),
);
const insufficientVerify = json(
	['verify', signedLlmix, '--target', 'source', '--policy', insufficientPolicy, '--did-document', didDocument],
	1,
);
assert.equal(insufficientVerify.diagnostics[0].code, 'trust_policy.insufficient_trusted_signatures');

const untrustedPolicy = join(tmp, 'did-web-policy-untrusted.json');
writeFileSync(untrustedPolicy, JSON.stringify({ version: 1, trustedSigners: [{ type: 'did-web', domain: 'other.example.com' }] }));
const untrustedVerify = json(['verify', signedLlmix, '--target', 'source', '--policy', untrustedPolicy, '--did-document', didDocument], 1);
assert.equal(untrustedVerify.diagnostics[0].code, 'trust_policy.no_trusted_signature');

const corruptedLlmixIntegrity = join(tmp, 'corrupted-llmix-integrity.mda');
writeFileSync(
	corruptedLlmixIntegrity,
	readFileSync(llmixSource, 'utf8').replace(/digest: sha256:[a-f0-9]{64}/, `digest: sha256:${'0'.repeat(64)}`),
);
const llmixIntegrityMismatch = json(['integrity', 'compute', corruptedLlmixIntegrity, '--target', 'source', '--write'], 1);
assert.equal(llmixIntegrityMismatch.diagnostics[0].code, 'integrity.existing_mismatch');
assert.match(readFileSync(corruptedLlmixIntegrity, 'utf8'), new RegExp(`digest: sha256:${'0'.repeat(64)}`));

const valid = json(['validate', source, '--target', 'source']);
assert.equal(valid.target, 'source');
assert.deepEqual(valid.diagnostics, []);
assert.equal(valid.nextActions[0].id, 'compile-source');

const humanValidate = run(['validate', source, '--target', 'source']);
assert.equal(humanValidate.status, 0);
assert.match(humanValidate.stdout, /Next:\n- Validate|Next:\n- Compile|compile/i);

const noNextValidate = run(['validate', source, '--target', 'source', '--no-next']);
assert.equal(noNextValidate.status, 0);
assert.doesNotMatch(noNextValidate.stdout, /Next:/);

const emptyAgents = join(tmp, 'empty-AGENTS.md');
writeFileSync(emptyAgents, ' \n\t\n');
const emptyAgentsResult = json(['validate', emptyAgents, '--target', 'AGENTS.md'], 1);
assert.equal(emptyAgentsResult.diagnostics[0].code, 'input.missing_required_body');

const ambiguous = json(['validate', join(tmp, 'note.md')], 2);
assert.equal(ambiguous.ok, false);
assert.equal(ambiguous.diagnostics[0].code, 'input.usage');

const out = join(tmp, 'out');
const compiled = json(['compile', source, '--target', 'SKILL.md', 'AGENTS.md', 'MCP-SERVER.md', '--out-dir', out, '--integrity']);
assert.equal(compiled.ok, true);
assert.equal(compiled.summary, 'Compiled 4 file(s)');
assert.equal(compiled.artifacts.length, 4);
assert.equal(compiled.nextActions[0].id, 'validate-output');
assert.equal(compiled.written.length, 4);

for (const [file, target] of [
	['SKILL.md', 'SKILL.md'],
	['AGENTS.md', 'AGENTS.md'],
	['MCP-SERVER.md', 'MCP-SERVER.md'],
]) {
	const result = json(['validate', join(out, file), '--target', target]);
	assert.equal(result.ok, true);
	assert.equal(result.target, target);
}

const compileManifestOut = join(tmp, 'compile-manifest-out');
const compileManifestPath = join(tmp, 'compile-manifest.json');
const compiledWithManifest = json([
	'compile',
	source,
	'--target',
	'SKILL.md',
	'AGENTS.md',
	'MCP-SERVER.md',
	'--out-dir',
	compileManifestOut,
	'--integrity',
	'--manifest',
	compileManifestPath,
]);
assert.equal(compiledWithManifest.ok, true);
assert.equal(compiledWithManifest.artifacts.at(-1).kind, 'compile-manifest');
assert.equal(compiledWithManifest.written.at(-1), compileManifestPath);
const compileManifest = JSON.parse(readFileSync(compileManifestPath, 'utf8'));
assert.equal(compileManifest.kind, 'mda-compile-manifest');
assert.equal(compileManifest.compiler.version, expectedCliVersion);
const sourceCanonicalForManifest = json(['canonicalize', source, '--target', 'source']);
assert.equal(
	compileManifest.source.digest,
	`sha256:${createHash('sha256').update(Buffer.from(sourceCanonicalForManifest.canonicalBytesBase64, 'base64')).digest('hex')}`,
);
for (const output of compileManifest.outputs) {
	assert.equal(output.digest, `sha256:${createHash('sha256').update(readFileSync(output.path)).digest('hex')}`);
	assert.equal(compileManifest.outputDigests[output.path], output.digest);
}

const compatSource = join(tmp, 'compat-source.mda');
writeFileSync(
	compatSource,
	`---
name: compat-source
description: Source that declares runtime capabilities which plain Markdown targets cannot enforce.
allowed-tools: "Bash(curl:*)"
requires:
  network: required
  filesystem: write
  shell: bash
metadata:
  snoai-llmix:
    module: search_summary
    preset: openai_fast
    common:
      provider: openai
      model: gpt-5-mini
---
# Compat source
`,
);
const compatOut = join(tmp, 'compat-out');
const compatManifestPath = join(tmp, 'compat-compile-manifest.json');
const compatCompile = json(['compile', compatSource, '--target', 'AGENTS.md', '--out-dir', compatOut, '--manifest', compatManifestPath]);
assert.equal(compatCompile.ok, true);
assert.ok(compatCompile.diagnostics.some((diagnostic) => diagnostic.code === 'compat.network_degradation'));
assert.ok(compatCompile.diagnostics.every((diagnostic) => diagnostic.severity === 'warning'));
const compatManifest = JSON.parse(readFileSync(compatManifestPath, 'utf8'));
assert.ok(compatManifest.warnings.some((warning) => warning.code === 'compat.llmix_namespace_not_consumed'));
assert.deepEqual(compatManifest.emittedScripts, ['Bash(curl:*)']);

const strictCompatOut = join(tmp, 'strict-compat-out');
const strictCompatManifest = join(tmp, 'strict-compat-manifest.json');
const strictCompat = json(
	['compile', compatSource, '--target', 'AGENTS.md', '--out-dir', strictCompatOut, '--manifest', strictCompatManifest, '--strict-compat'],
	1,
);
assert.equal(strictCompat.ok, false);
assert.ok(strictCompat.diagnostics.some((diagnostic) => diagnostic.code === 'compat.network_degradation'));
assert.ok(strictCompat.diagnostics.every((diagnostic) => diagnostic.severity === 'error'));
assert.equal(existsSync(join(strictCompatOut, 'AGENTS.md')), false);
assert.equal(existsSync(strictCompatManifest), false);

const compileSigningOption = json(
	['compile', source, '--target', 'SKILL.md', '--out-dir', join(tmp, 'signed-compile'), '--profile', 'did-web'],
	2,
);
assert.match(compileSigningOption.diagnostics[0].message, /mda sign/);

const canonical = json(['canonicalize', join(out, 'SKILL.md'), '--target', 'SKILL.md']);
assert.equal(canonical.ok, true);
assert.equal(canonical.files.length, 1);
assert.ok(Buffer.from(canonical.canonicalBytesBase64, 'base64').length > 0);

const digest = json(['integrity', 'compute', join(out, 'SKILL.md'), '--target', 'SKILL.md', '--algorithm', 'sha256']);
assert.match(digest.digest, /^sha256:[a-f0-9]{64}$/);

const integrity = json(['integrity', 'verify', join(out, 'SKILL.md'), '--target', 'SKILL.md']);
assert.equal(integrity.ok, true);

const weakIntegrityFile = join(tmp, 'weak-integrity.md');
const weakDigest = `md5:${createHash('md5').update(Buffer.from(canonical.canonicalBytesBase64, 'base64')).digest('hex')}`;
writeFileSync(
	weakIntegrityFile,
	readFileSync(join(out, 'SKILL.md'), 'utf8')
		.replace('algorithm: sha256', 'algorithm: md5')
		.replace(/digest: sha256:[a-f0-9]{64}/, `digest: ${weakDigest}`),
);
const weakIntegrity = json(['integrity', 'verify', weakIntegrityFile, '--target', 'SKILL.md'], 1);
assert.equal(weakIntegrity.diagnostics[0].code, 'integrity.unsupported_algorithm');

const missingSidecar = json(['integrity', 'verify', join(out, 'MCP-SERVER.md'), '--target', 'MCP-SERVER.md'], 2);
assert.equal(missingSidecar.diagnostics[0].code, 'integrity.missing_required_sidecar');

const mcpIntegrity = json([
	'integrity',
	'verify',
	join(out, 'MCP-SERVER.md'),
	'--target',
	'MCP-SERVER.md',
	'--sidecar',
	join(out, 'mcp-server.json'),
]);
assert.equal(mcpIntegrity.ok, true);
assert.equal(mcpIntegrity.files[1], join(out, 'mcp-server.json'));

const policy = join(tmp, 'policy.json');
writeFileSync(policy, JSON.stringify({ version: 1, trustedSigners: [{ type: 'did-web', domain: 'example.com' }] }));
const verify = json(['verify', join(out, 'SKILL.md'), '--target', 'SKILL.md', '--policy', policy], 1);
assert.equal(verify.diagnostics[0].code, 'signature.missing_required');

const offline = json(['verify', join(out, 'SKILL.md'), '--target', 'SKILL.md', '--policy', policy, '--offline'], 2);
assert.equal(offline.diagnostics[0].code, 'input.usage');

const existingInitTarget = join(tmp, 'existing.mda');
writeFileSync(existingInitTarget, 'keep');
const existingInit = json(['init', 'hello-skill', '--out', existingInitTarget], 3);
assert.equal(existingInit.diagnostics[0].code, 'filesystem.io');
assert.equal(readFileSync(existingInitTarget, 'utf8'), 'keep');

const strictSuite = join(tmp, 'strict-suite');
mkdirSync(join(strictSuite, 'invalid'), { recursive: true });
writeFileSync(join(strictSuite, 'invalid', 'body-only.md'), 'body only\n');
writeFileSync(
	join(strictSuite, 'invalid', 'missing-integrity.mda'),
	`---
name: trusted-runtime-missing-integrity
description: Schema-valid source that trusted-runtime must reject because integrity is absent.
---
# Missing integrity
`,
);
writeFileSync(
	join(strictSuite, 'policy.json'),
	JSON.stringify({ version: 1, trustedSigners: [{ type: 'did-web', domain: 'example.com' }] }),
);
writeFileSync(
	join(strictSuite, 'manifest.yaml'),
	`fixtures:
  - id: wrong-extraction-reason
    path: invalid/body-only.md
    extraction-expected: invalid-encoding
    verdict: reject
  - id: wrong-expected-error
    path: invalid/missing-integrity.mda
    against: [schemas/frontmatter-source.schema.json]
    semantic-checks: [trusted-runtime-policy]
    runtime-policy: policy.json
    expected-error: missing-required-signature
    verdict: reject
`,
);
const strictConformance = json(['conformance', '--suite', strictSuite], 1);
assert.equal(strictConformance.failCount, 2);
assert.ok(strictConformance.diagnostics.some((d) => d.code === 'conformance.extraction_mismatch'));
assert.ok(strictConformance.diagnostics.some((d) => d.code === 'conformance.expected_error_mismatch'));

const zeroCompileSuite = join(tmp, 'zero-compile-suite');
mkdirSync(zeroCompileSuite, { recursive: true });
writeFileSync(join(zeroCompileSuite, 'valid.mda'), readFileSync(source, 'utf8'));
writeFileSync(
	join(zeroCompileSuite, 'manifest.yaml'),
	`fixtures:
  - id: valid-source
    path: valid.mda
    against: [schemas/frontmatter-source.schema.json]
    verdict: accept
`,
);
const zeroCompileConformance = json(['conformance', '--suite', zeroCompileSuite, '--level', 'C'], 1);
assert.ok(zeroCompileConformance.diagnostics.some((d) => d.code === 'conformance.compile_fixtures_missing'));

const mismatchCompileSuite = join(tmp, 'mismatch-compile-suite');
mkdirSync(join(mismatchCompileSuite, 'compile', 'bad', 'expected'), { recursive: true });
writeFileSync(
	join(mismatchCompileSuite, 'compile', 'bad', 'input.mda'),
	`---
name: mismatch
description: Compile mismatch fixture.
---
# Mismatch
`,
);
writeFileSync(
	join(mismatchCompileSuite, 'compile', 'bad', 'expected', 'SKILL.md'),
	`---
name: mismatch
description: Wrong expected output.
---
# Mismatch
`,
);
writeFileSync(
	join(mismatchCompileSuite, 'manifest.yaml'),
	`fixtures:
  - id: compile-mismatch
    input: compile/bad/input.mda
    expected_dir: compile/bad/expected
    targets: [SKILL.md]
    verdict: equal
`,
);
const mismatchCompileConformance = json(['conformance', '--suite', mismatchCompileSuite, '--level', 'C'], 1);
assert.ok(mismatchCompileConformance.diagnostics.some((d) => d.code === 'conformance.compile_output_mismatch'));

const atomicDir = join(tmp, 'atomic');
mkdirSync(atomicDir, { recursive: true });
const existingTemp = join(atomicDir, '.mda-tmp');
writeFileSync(existingTemp, 'user-owned\n');
const existingAtomicInitTarget = join(atomicDir, 'existing-init.mda');
writeFileSync(existingAtomicInitTarget, 'keep-init');
const failedAtomicInit = json(['init', 'hello-skill', '--out', existingAtomicInitTarget], 3);
assert.equal(failedAtomicInit.ok, false);
assert.equal(readFileSync(existingTemp, 'utf8'), 'user-owned\n');

const atomicCompile = json(['compile', source, '--target', 'SKILL.md', '--out-dir', atomicDir]);
assert.equal(atomicCompile.ok, true);
assert.equal(readFileSync(existingTemp, 'utf8'), 'user-owned\n');
const failedAtomicCompile = json(['compile', source, '--target', 'SKILL.md', '--out-dir', atomicDir], 3);
assert.equal(failedAtomicCompile.ok, false);
assert.equal(readFileSync(existingTemp, 'utf8'), 'user-owned\n');

const atomicIntegritySource = join(atomicDir, 'llmix-write.mda');
writeFileSync(atomicIntegritySource, llmixInit.scaffold);
const atomicIntegrityWrite = json(['integrity', 'compute', atomicIntegritySource, '--target', 'source', '--write']);
assert.equal(atomicIntegrityWrite.ok, true);
assert.equal(readFileSync(existingTemp, 'utf8'), 'user-owned\n');
const atomicCorruptedIntegrity = join(atomicDir, 'corrupted-llmix-integrity.mda');
writeFileSync(atomicCorruptedIntegrity, readFileSync(corruptedLlmixIntegrity, 'utf8'));
const failedAtomicIntegrityWrite = json(['integrity', 'compute', atomicCorruptedIntegrity, '--target', 'source', '--write'], 1);
assert.equal(failedAtomicIntegrityWrite.ok, false);
assert.equal(readFileSync(existingTemp, 'utf8'), 'user-owned\n');

const failedAtomicSignOut = join(atomicDir, 'existing-signed.mda');
writeFileSync(failedAtomicSignOut, 'keep-signed');
const failedAtomicSign = json(
	['sign', llmixSource, '--profile', 'did-web', '--did', did, '--key-id', didKeyId, '--key-file', didKeyFile, '--out', failedAtomicSignOut],
	3,
);
assert.equal(failedAtomicSign.ok, false);
assert.equal(readFileSync(existingTemp, 'utf8'), 'user-owned\n');

let longOut = join(tmp, 'long');
mkdirSync(longOut);
const rollbackOutDirLength = 4086;
while (longOut.length < rollbackOutDirLength) {
	const room = rollbackOutDirLength - longOut.length - 1;
	if (room <= 0) break;
	const part = 'd'.repeat(Math.min(200, room));
	longOut = join(longOut, part);
	mkdirSync(longOut);
}
const rollback = json(['compile', source, '--target', 'SKILL.md', 'MCP-SERVER.md', '--out-dir', longOut], 3);
assert.equal(rollback.ok, false);
assert.deepEqual(rollback.rolledBack, rollback.written);
for (const path of rollback.written) assert.equal(existsSync(path), false);

const bundledConformanceArgs =
	process.env.MDA_EXPECT_PACKED === '1' ? ['conformance', '--level'] : ['conformance', '--suite', resolve(repo, 'conformance'), '--level'];

const conformance = json([...bundledConformanceArgs, 'V']);
assert.equal(conformance.ok, true);
assert.equal(conformance.failCount, 0);

const conformanceC = json([...bundledConformanceArgs, 'C']);
assert.equal(conformanceC.ok, true);
assert.equal(conformanceC.failCount, 0);
assert.ok(conformanceC.fixtures.some((fixture) => fixture.id === '46-compile-basic-targets' && fixture.ok));
