import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

import { EXIT, commandResult, diag, ioError, usage, type CommandResult } from '../types.js';
import {
	atomicWrite,
	canonicalizeFromFile,
	computeDigest,
	isRecord,
	jcs,
	readArtifact,
	readJson,
	validateArtifact,
	validateJsonAgainst,
} from '../mda.js';
import {
	DIGEST_PATTERN,
	GITHUB_ACTIONS_ISSUER,
	GITHUB_REF,
	GITHUB_REPOSITORY,
	INTEGRITY_PAYLOAD_TYPE,
	LLMIX_REGISTRY_ROOT_PAYLOAD_TYPE,
	LLMIX_MODULE_NAME,
	LLMIX_PRESET_NAME,
	LLMIX_SNIPPET_FORMATS,
	SIGSTORE_REKOR_URL,
} from './constants.js';
import { runIntegrity } from './core-commands.js';
import {
	didWebDomainFromDid,
	runVerify,
	trustPolicyMinSignatures,
	verifySignatureEntries,
	type TrustedSignerIdentity,
} from './security-commands.js';
import { artifact, externalNextAction, nextAction, oneOption, parseOptions, unknownOptions } from './shared.js';

type TrustManifestEvidence = {
	expectedRootDigest: string;
	sourceSetDigest: string;
	releasePlanDigest: string;
	registryRootTrustPolicy: unknown;
	rekorPolicy: unknown;
	minimumRevision: string | null;
	minimumPublishedAt: string | null;
	highWatermark: string | null;
	registryRootSignerIdentity: unknown;
	registryRoot: {
		path: string;
		revision: string;
		publishedAt: string;
		highWatermark: string;
	};
	releasePlan: {
		path: string;
		sourceCount: number;
	};
};

const LLMIX_REGISTRY_TARGET = 'llmix-registry';
const LLMIX_NATIVE_ROOT_SCHEMA = 'llmix.config-registry.root-envelope';
const LLMIX_NATIVE_ROOT_PAYLOAD_SCHEMA = 'llmix.config-registry.root';
const SHA256_HEX = /^[a-f0-9]{64}$/;

export function runLlmix(args: string[]) {
	return migratedCommand('llmix', llmixMigrationReplacement(args));
}

export function runRelease(args: string[]) {
	if (args[0] === 'trust' && args[1] === 'policy') return runLlmixTrustPolicy(args.slice(2), 'release trust policy');
	if (args[0] === 'prepare') return runLlmixReleasePlan(args.slice(1), 'release prepare');
	if (args[0] === 'finalize') {
		if (args.includes('--manifest') || args.includes('--snippet-format') || args.includes('--snippet-out')) {
			return runLlmixTrustSnippets(args.slice(1), 'release finalize');
		}
		return runLlmixTrustManifest(args.slice(1), 'release finalize');
	}
	return usage(
		'release',
		'Expected subcommand: release trust policy --target llmix-registry | release prepare --target llmix-registry | release finalize --target llmix-registry',
	);
}

function runLlmixTrustPolicy(args: string[], command = 'release trust policy') {
	const parsed = parseOptions(args);
	const err = unknownOptions(parsed, ['--target', '--profile', '--domain', '--min-signatures', '--out', '--repo', '--workflow', '--ref']);
	if (err) return usage(command, err);
	const targetErr = releaseTargetError(command, parsed);
	if (targetErr) return targetErr;
	if (parsed.positional.length !== 0) return usage(command, `${command} takes no positional arguments`);
	const profile = oneOption(parsed.options, '--profile');
	if (!profile) return usage(command, '--profile <profile> is required');
	if (profile === 'did-web') return runDidWebTrustPolicy(parsed.options, command);
	if (profile === 'github-actions') return runGithubActionsTrustPolicy(parsed.options, command);
	return commandResult(
		false,
		command,
		EXIT.failure,
		[diag('trust_policy.unsupported_profile', `Unsupported trust policy profile: ${profile}`)],
		{
			summary: 'Trust policy profile is not supported',
			nextActions: [
				nextAction(
					'use-did-web-policy-profile',
					'Use did:web for local deterministic signing',
					'mda release trust policy --target llmix-registry --profile did-web --domain example.com --out release-trust-policy.json',
				),
				nextAction(
					'use-github-actions-policy-profile',
					'Use GitHub Actions Sigstore/Rekor for CI release signing',
					'mda release trust policy --target llmix-registry --profile github-actions --repo owner/repo --workflow release.yml --ref refs/heads/main --out release-trust-policy.json',
				),
			],
		},
	);
}

function runLlmixReleasePlan(args: string[], command = 'release prepare') {
	const parsed = parseOptions(args);
	const err = unknownOptions(parsed, [
		'--target',
		'--source',
		'--registry-dir',
		'--policy',
		'--out',
		'--did-document',
		'--offline-sigstore-fixture',
	]);
	if (err) return usage(command, err);
	const targetErr = releaseTargetError(command, parsed);
	if (targetErr) return targetErr;
	if (parsed.positional.length !== 0) return usage(command, `${command} takes no positional arguments`);

	const sourceDir = oneOption(parsed.options, '--source');
	const registryDir = oneOption(parsed.options, '--registry-dir');
	const policyPath = oneOption(parsed.options, '--policy');
	const out = oneOption(parsed.options, '--out');
	if (!sourceDir) return usage(command, '--source <dir> is required');
	if (!registryDir) return usage(command, '--registry-dir <dir> is required');
	if (!policyPath) return usage(command, '--policy <path> is required');
	if (!out) return usage(command, '--out <file> is required');
	if (existsSync(out))
		return ioError(command, `Refusing to overwrite existing file: ${out}`, { sourceDir, registryDir, policy: policyPath });

	const policy = readJson(policyPath);
	if (!policy.ok) return ioError(command, policy.message, { sourceDir, registryDir, policy: policyPath });
	const policyValidation = validateJsonAgainst(policy.value, 'trustPolicy');
	if (!policyValidation.ok)
		return commandResult(false, command, EXIT.failure, policyValidation.diagnostics, {
			sourceDir,
			registryDir,
			policy: policyPath,
		});

	const sourceRoot = resolve(sourceDir);
	const scanned = scanMdaSources(sourceRoot);
	if (!scanned.ok) return ioError(command, scanned.message, { sourceDir, registryDir, policy: policyPath });
	if (scanned.files.length === 0) {
		return commandResult(false, command, EXIT.failure, [diag('llmix.no_sources', 'No .mda sources found under --source')], {
			summary: 'Release prepare blocked',
			nextActions: [
				nextAction(
					'add-llmix-source',
					'Add signed LLMix .mda preset sources and retry',
					`mda release prepare --target llmix-registry --source ${sourceDir} --registry-dir ${registryDir} --policy ${policyPath} --out ${out}`,
				),
			],
			sourceDir,
			registryDir,
			policy: policyPath,
			written: false,
		});
	}

	const diagnostics: ReturnType<typeof diag>[] = [];
	const sources: Record<string, unknown>[] = [];
	const plannedRegistryEntries = new Map<string, string>();
	const didDocument = oneOption(parsed.options, '--did-document');
	const sigstoreFixture = oneOption(parsed.options, '--offline-sigstore-fixture');
	for (const file of scanned.files) {
		const sourceRelativePath = relativePath(sourceRoot, file);
		const validation = validateArtifact(file, 'source');
		if (!validation.ok) {
			diagnostics.push(...validation.diagnostics.map((d) => ({ ...d, path: file })));
			continue;
		}
		const integrity = runIntegrity(['verify', file, '--target', 'source']);
		if (!integrity.ok) {
			diagnostics.push(...integrity.diagnostics.map((d) => ({ ...d, path: file })));
			continue;
		}
		const verifyArgs = [file, '--target', 'source', '--policy', policyPath];
		if (didDocument) verifyArgs.push('--did-document', didDocument);
		if (sigstoreFixture) verifyArgs.push('--offline-sigstore-fixture', sigstoreFixture);
		const verified = runVerify(verifyArgs);
		if (!verified.ok) {
			diagnostics.push(...verified.diagnostics.map((d) => ({ ...d, path: file })));
			continue;
		}
		const artifactRead = readArtifact(file);
		if (!artifactRead.ok || artifactRead.extract.kind !== 'ok' || !isRecord(artifactRead.extract.frontmatter)) {
			diagnostics.push(diag('llmix.source_unreadable', 'Source frontmatter could not be read after verification', { path: file }));
			continue;
		}
		const identity = llmixPresetIdentity(artifactRead.extract.frontmatter);
		if (!identity) {
			diagnostics.push(
				diag('llmix.release_identity_missing', 'Source is missing a valid metadata.snoai-llmix module and preset', { path: file }),
			);
			continue;
		}
		const canonical = canonicalizeFromFile(file, 'source', null);
		if (!canonical.ok) {
			diagnostics.push(...canonical.diagnostics.map((d) => ({ ...d, path: file })));
			continue;
		}
		const signerIdentity = firstTrustedSignerIdentity(verified.trustedSignerIdentities);
		if (!signerIdentity) {
			diagnostics.push(
				diag('trust_policy.no_trusted_signature', 'Verified source did not return a trusted signer identity', { path: file }),
			);
			continue;
		}
		const expectedRegistryEntryIdentity = `${identity.module}/${identity.preset}`;
		const existingSourcePath = plannedRegistryEntries.get(expectedRegistryEntryIdentity);
		if (existingSourcePath) {
			diagnostics.push(
				diag(
					'llmix.duplicate_registry_entry',
					`Multiple sources target registry entry ${expectedRegistryEntryIdentity}; first source is ${existingSourcePath}`,
					{ path: file },
				),
			);
			continue;
		}
		plannedRegistryEntries.set(expectedRegistryEntryIdentity, sourceRelativePath);
		sources.push({
			module: identity.module,
			preset: identity.preset,
			sourcePath: sourceRelativePath,
			rawSourceDigest: computeDigest(readFileSync(file), 'sha256'),
			canonicalSourceDigest: computeDigest(canonical.bytes, 'sha256'),
			signaturePayloadDigest: signerIdentity.payloadDigest,
			signerIdentity,
			expectedRegistryEntryIdentity,
			expectedRegistryEntryPath: `${identity.module}/${identity.preset}.json`,
		});
	}

	if (diagnostics.length > 0) {
		return commandResult(false, command, EXIT.failure, diagnostics, {
			summary: 'Release prepare blocked',
			nextActions: [
				nextAction(
					'fix-source-validation',
					'Fix validation, integrity, and signature diagnostics before release planning',
					`mda validate <source.mda> --target source`,
				),
				nextAction(
					'verify-source-signature',
					'Verify each signed preset with the selected trust policy',
					`mda verify <signed.mda> --target source --policy ${policyPath}`,
				),
			],
			sourceDir,
			registryDir,
			policy: policyPath,
			sourceCount: scanned.files.length,
			written: false,
		});
	}

	sources.sort(
		(left, right) =>
			String(left.expectedRegistryEntryIdentity).localeCompare(String(right.expectedRegistryEntryIdentity)) ||
			String(left.sourcePath).localeCompare(String(right.sourcePath)),
	);
	const sourceSetDigest = computeDigest(Buffer.from(jcs({ sources }), 'utf8'), 'sha256');
	const releasePlan = {
		version: 1,
		kind: 'llmix-release-plan',
		sourceDir,
		registryDir,
		policy: policyPath,
		sourceSetDigest,
		sources,
		checklist: [
			{ id: 'source-validation', ok: true, count: sources.length },
			{ id: 'integrity-verification', ok: true, count: sources.length },
			{ id: 'signature-verification', ok: true, count: sources.length },
			{
				id: 'registry-publish',
				ok: false,
				external: true,
				reason: 'Publish with LLMix trustedRuntime=true using this verified source set.',
			},
		],
		publish: {
			external: true,
			trustedRuntime: true,
			next: 'Run the LLMix registry publisher with this verified source set, then sign the registry root before generating the trust manifest.',
		},
	};

	try {
		atomicWrite(out, `${JSON.stringify(releasePlan, null, 2)}\n`);
	} catch (error) {
		return ioError(command, error instanceof Error ? error.message : String(error), {
			sourceDir,
			registryDir,
			policy: policyPath,
			out,
			written: false,
		});
	}

	return commandResult(true, command, EXIT.ok, [], {
		summary: `Prepared LLMix registry release plan for ${sources.length} source(s)`,
		artifacts: [artifact('llmix-release-plan', out, undefined, sourceSetDigest)],
		nextActions: [
			externalNextAction(
				'publish-llmix-registry',
				'Publish the verified source set with LLMix trustedRuntime=true',
				'use the LLMix registry publisher, then sign the registry root',
			),
			externalNextAction(
				'prepare-trust-manifest-inputs',
				'After registry publication, collect the signed registry root and root trust policy for trust manifest generation',
				'wait for the signed registry root evidence before running the trust manifest step',
				false,
			),
		],
		message: `wrote ${out}`,
		sourceDir,
		registryDir,
		policy: policyPath,
		out,
		sourceSetDigest,
		sourceCount: sources.length,
		releasePlan,
		written: true,
	});
}

function runLlmixTrustManifest(args: string[], command = 'release finalize') {
	const parsed = parseOptions(args);
	const err = unknownOptions(parsed, [
		'--target',
		'--registry-dir',
		'--registry-root',
		'--release-plan',
		'--policy',
		'--expected-root-digest',
		'--derive-root-digest',
		'--minimum-revision',
		'--minimum-published-at',
		'--high-watermark',
		'--out',
		'--did-document',
		'--offline-sigstore-fixture',
	]);
	if (err) return usage(command, err);
	const targetErr = releaseTargetError(command, parsed);
	if (targetErr) return targetErr;
	if (parsed.positional.length !== 0) return usage(command, `${command} takes no positional arguments`);

	const registryDir = oneOption(parsed.options, '--registry-dir');
	const registryRootPath = oneOption(parsed.options, '--registry-root');
	const releasePlanPath = oneOption(parsed.options, '--release-plan');
	const policyPath = oneOption(parsed.options, '--policy');
	const out = oneOption(parsed.options, '--out');
	const expectedRootDigestOption = oneOption(parsed.options, '--expected-root-digest');
	const deriveRootDigest = parsed.flags.has('--derive-root-digest');
	if (!registryDir) return usage(command, '--registry-dir <dir> is required');
	if (!registryRootPath) return usage(command, '--registry-root <file> is required');
	if (!releasePlanPath) return usage(command, '--release-plan <file> is required');
	if (!policyPath) return usage(command, '--policy <path> is required');
	if (!out) return usage(command, '--out <file> is required');
	if (Boolean(expectedRootDigestOption) === deriveRootDigest)
		return usage(command, 'Choose exactly one: --expected-root-digest <digest> or --derive-root-digest');
	if (expectedRootDigestOption && !DIGEST_PATTERN.test(expectedRootDigestOption))
		return usage(command, '--expected-root-digest must be a sha256/sha384/sha512 digest');
	if (existsSync(out))
		return ioError(command, `Refusing to overwrite existing file: ${out}`, {
			registryDir,
			registryRoot: registryRootPath,
			out,
		});
	if (pathResolvesInsideDir(out, registryDir)) {
		return commandResult(
			false,
			command,
			EXIT.failure,
			[diag('release.trust_artifact_inside_registry', '--out must resolve outside --registry-dir')],
			{
				summary: 'Release trust artifact output must be outside the registry directory',
				nextActions: [
					nextAction(
						'write-external-manifest',
						'Write the deployment trust manifest outside config/llm or the selected registry directory',
						`mda release finalize --target llmix-registry --registry-dir ${registryDir} --registry-root ${registryRootPath} --release-plan ${releasePlanPath} --policy ${policyPath} --derive-root-digest --out release/llmix-trust.json`,
					),
				],
				registryDir,
				out,
				written: false,
			},
		);
	}
	if (!pathResolvesInsideDir(registryRootPath, registryDir)) {
		return commandResult(
			false,
			command,
			EXIT.failure,
			[diag('release.registry_root_outside_registry', '--registry-root must resolve inside --registry-dir')],
			{
				summary: 'Registry-root evidence must belong to the selected registry directory',
				nextActions: [
					nextAction(
						'use-registry-root-from-registry',
						'Pass the signed registry-root evidence from the selected registry directory',
						`mda release finalize --target llmix-registry --registry-dir ${registryDir} --registry-root ${registryDir}/compiled/<revision>/registry-root.json --release-plan ${releasePlanPath} --policy ${policyPath} --derive-root-digest --out ${out}`,
					),
				],
				registryDir,
				registryRoot: registryRootPath,
				out,
				written: false,
			},
		);
	}

	const policy = readJson(policyPath);
	if (!policy.ok) return ioError(command, policy.message, { registryDir, registryRoot: registryRootPath, policy: policyPath });
	const policyValidation = validateJsonAgainst(policy.value, 'trustPolicy');
	if (!policyValidation.ok)
		return commandResult(false, command, EXIT.failure, policyValidation.diagnostics, {
			registryDir,
			registryRoot: registryRootPath,
			policy: policyPath,
			written: false,
		});
	const releasePlan = readJson(releasePlanPath);
	if (!releasePlan.ok) return ioError(command, releasePlan.message, { releasePlan: releasePlanPath, written: false });
	const registryRoot = readJson(registryRootPath);
	if (!registryRoot.ok) return ioError(command, registryRoot.message, { registryRoot: registryRootPath, written: false });

	const diagnostics: ReturnType<typeof diag>[] = [];
	const rootEvidence = validateRegistryRootEvidence(registryRoot.value, registryRootPath);
	diagnostics.push(...rootEvidence.diagnostics);
	const releasePlanEvidence = validateReleasePlanEvidence(releasePlan.value);
	diagnostics.push(...releasePlanEvidence.diagnostics);
	if (rootEvidence.ok && releasePlanEvidence.ok) {
		const expectedRootDigest = expectedRootDigestOption ?? rootEvidence.rootDigest;
		if (expectedRootDigest !== rootEvidence.rootDigest) {
			diagnostics.push(diag('llmix.root_digest_mismatch', 'Expected root digest does not match signed registry-root evidence'));
		}
		diagnostics.push(
			...freshnessDiagnostics(rootEvidence.root, {
				minimumRevision: oneOption(parsed.options, '--minimum-revision'),
				minimumPublishedAt: oneOption(parsed.options, '--minimum-published-at'),
				highWatermark: oneOption(parsed.options, '--high-watermark'),
			}),
		);
		diagnostics.push(...sourceSetDiagnostics(rootEvidence.root, releasePlanEvidence.releasePlan, registryDir));
		const signatureVerification = verifySignatureEntries(
			rootEvidence.root.signatures,
			rootEvidence.root.integrity,
			policy.value,
			oneOption(parsed.options, '--did-document'),
			oneOption(parsed.options, '--offline-sigstore-fixture'),
			{ payloadType: rootEvidence.root.signaturePayloadType, payloadBytes: rootEvidence.root.signaturePayloadBytes },
		);
		if (signatureVerification.malformed) {
			diagnostics.push(diag('signature.invalid_entry', 'Registry-root signature entry is malformed'));
		} else if (signatureVerification.trusted.size === 0) {
			diagnostics.push(
				...(signatureVerification.rejectedTrusted.length > 0
					? signatureVerification.rejectedTrusted
					: [diag('trust_policy.no_trusted_signature', 'No registry-root signature matched the trust policy')]),
			);
		} else {
			const minSignatures = trustPolicyMinSignatures(policy.value);
			if (signatureVerification.trusted.size < minSignatures) {
				diagnostics.push(
					diag(
						'trust_policy.insufficient_trusted_signatures',
						`${signatureVerification.trusted.size} trusted signer identities < ${minSignatures}`,
					),
				);
			}
		}
		if (diagnostics.length === 0) {
			const trustedSignerIdentity = firstTrustedSignerIdentity(signatureVerification.trustedSignerIdentities);
			const sourceSetDigest = sourceSetDigestForManifest(rootEvidence.root, releasePlanEvidence.releasePlan);
			const manifest = {
				version: 1,
				kind: 'llmix-trust-manifest',
				expectedRootDigest,
				sourceSetDigest,
				releasePlanDigest: computeDigest(Buffer.from(jcs(releasePlan.value), 'utf8'), 'sha256'),
				registryRootTrustPolicy: policy.value,
				rekorPolicy: isRecord(policy.value) && isRecord(policy.value.rekor) ? policy.value.rekor : null,
				minimumRevision: oneOption(parsed.options, '--minimum-revision') ?? null,
				minimumPublishedAt: oneOption(parsed.options, '--minimum-published-at') ?? null,
				highWatermark: oneOption(parsed.options, '--high-watermark') ?? rootEvidence.root.highWatermark,
				registryRootSignerIdentity: trustedSignerIdentity,
				registryRoot: {
					path: registryRootPath,
					revision: rootEvidence.root.revision,
					publishedAt: rootEvidence.root.publishedAt,
					highWatermark: rootEvidence.root.highWatermark,
				},
				releasePlan: { path: releasePlanPath, sourceCount: releasePlanEvidence.releasePlan.sources.length },
			};
			try {
				atomicWrite(out, `${JSON.stringify(manifest, null, 2)}\n`);
			} catch (error) {
				return ioError(command, error instanceof Error ? error.message : String(error), { out, written: false });
			}
			return commandResult(true, command, EXIT.ok, [], {
				summary: 'Finalized external LLMix deployment trust manifest',
				artifacts: [artifact('llmix-trust-manifest', out, undefined, expectedRootDigest)],
				nextActions: [
					externalNextAction(
						'install-external-trust-manifest',
						'Install this external trust manifest in the deployment configuration outside config/llm',
						`copy ${out} into the deployment config path consumed by secure LLMix startup`,
						false,
					),
					externalNextAction(
						'deploy-signed-registry',
						'Deploy only the signed registry files covered by this manifest and release plan',
						`publish ${registryDir} with registry root ${registryRootPath} and release plan ${releasePlanPath}`,
						false,
					),
				],
				message: `wrote ${out}`,
				registryDir,
				registryRoot: registryRootPath,
				releasePlan: releasePlanPath,
				out,
				expectedRootDigest,
				sourceSetDigest,
				written: true,
			});
		}
	}

	return commandResult(false, command, EXIT.failure, diagnostics, {
		summary: 'Release finalize blocked',
		nextActions: [
			nextAction(
				'fix-registry-root',
				'Fix registry-root evidence, signature, freshness, or source-set mismatches before writing deployment anchors',
				`mda release finalize --target llmix-registry --registry-dir ${registryDir} --registry-root ${registryRootPath} --release-plan ${releasePlanPath} --policy ${policyPath} --derive-root-digest --out ${out}`,
			),
		],
		registryDir,
		registryRoot: registryRootPath,
		releasePlan: releasePlanPath,
		out,
		written: false,
	});
}

function runLlmixTrustSnippets(args: string[], command = 'release finalize') {
	const parsed = parseOptions(args);
	const err = unknownOptions(parsed, ['--target', '--registry-dir', '--manifest', '--snippet-format', '--snippet-out']);
	if (err) return usage(command, err);
	const targetErr = releaseTargetError(command, parsed);
	if (targetErr) return targetErr;
	if (parsed.positional.length !== 0) return usage(command, `${command} takes no positional arguments`);

	const registryDir = oneOption(parsed.options, '--registry-dir');
	const manifestPath = oneOption(parsed.options, '--manifest');
	const format = oneOption(parsed.options, '--snippet-format');
	const out = oneOption(parsed.options, '--snippet-out');
	if (!registryDir) {
		return commandResult(
			false,
			command,
			EXIT.failure,
			[diag('release.registry_dir_required', '--registry-dir <dir> is required for snippet output')],
			{
				summary: 'Release snippet generation blocked',
				nextActions: [
					nextAction(
						'add-registry-dir',
						'Pass the registry directory so MDA can prove trust artifacts remain outside it',
						`mda release finalize --target llmix-registry --registry-dir <registry-dir> --manifest ${manifestPath ?? '<manifest>'} --snippet-format ${format ?? 'env'} --snippet-out ${out ?? 'release/trust.env'}`,
					),
				],
				manifest: manifestPath,
				format,
				out,
				written: false,
			},
		);
	}
	if (!manifestPath) return usage(command, '--manifest <path> is required');
	if (!format) return usage(command, '--snippet-format <format> is required');
	if (!LLMIX_SNIPPET_FORMATS.has(format))
		return usage(command, '--snippet-format must be json, env, kubernetes, github-actions, terraform, typescript, python, or rust');
	if (!out) return usage(command, '--snippet-out <file> is required');
	if (existsSync(out)) {
		return ioError(command, `Refusing to overwrite existing file: ${out}`, {
			manifest: manifestPath,
			format,
			out,
			written: false,
		});
	}
	if (pathResolvesInsideDir(manifestPath, registryDir) || pathResolvesInsideDir(out, registryDir)) {
		return commandResult(
			false,
			command,
			EXIT.failure,
			[diag('release.trust_artifact_inside_registry', '--manifest and --snippet-out must resolve outside --registry-dir')],
			{
				summary: 'Release trust artifacts must be outside the registry directory',
				nextActions: [
					nextAction(
						'write-external-snippet',
						'Write deployment snippets outside config/llm or the selected registry directory',
						`mda release finalize --target llmix-registry --registry-dir ${registryDir} --manifest release/llmix-trust.json --snippet-format ${format} --snippet-out release/trust.${format}`,
					),
				],
				registryDir,
				manifest: manifestPath,
				format,
				out,
				written: false,
			},
		);
	}

	const manifestRead = readJson(manifestPath);
	if (!manifestRead.ok) return ioError(command, manifestRead.message, { manifest: manifestPath, out, written: false });
	const manifest = validateTrustManifestEvidence(manifestRead.value);
	if (!manifest.ok) {
		return commandResult(false, command, EXIT.failure, manifest.diagnostics, {
			summary: 'Release snippet generation blocked',
			nextActions: [
				nextAction(
					'regenerate-trust-manifest',
					'Regenerate a valid external trust manifest before producing deployment snippets',
					'mda release finalize --target llmix-registry --registry-dir <registry> --registry-root <registry-root.json> --release-plan <release-plan.json> --policy <policy.json> --derive-root-digest --out release/llmix-trust.json',
				),
			],
			manifest: manifestPath,
			format,
			out,
			written: false,
		});
	}

	const content = renderLlmixTrustSnippet(format, manifestPath, manifest.manifest);
	try {
		atomicWrite(out, content);
	} catch (error) {
		return ioError(command, error instanceof Error ? error.message : String(error), {
			manifest: manifestPath,
			format,
			out,
			written: false,
		});
	}

	return commandResult(true, command, EXIT.ok, [], {
		summary: `Wrote ${format} LLMix deployment trust snippet`,
		artifacts: [artifact('llmix-trust-snippet', out)],
		nextActions: [
			externalNextAction(
				'install-deployment-snippet',
				'Install this snippet in deployment configuration outside config/llm',
				`wire ${out} into the deployment environment that starts secure LLMix`,
				false,
			),
			nextAction(
				'run-release-doctor',
				'Check the source, registry, and manifest before deployment',
				`mda doctor release --target llmix-registry --source <source-dir> --registry-dir <registry-dir> --release-plan ${manifest.manifest.releasePlan.path} --manifest ${manifestPath}`,
				false,
			),
		],
		message: `wrote ${out}`,
		manifest: manifestPath,
		format,
		out,
		written: true,
	});
}

export function runDoctor(args: string[]) {
	if (args[0] === 'llmix') return migratedCommand('doctor llmix', 'mda doctor release --target llmix-registry');
	if (args[0] !== 'release') return usage('doctor', 'Expected subcommand: doctor release --target llmix-registry');
	return runDoctorRelease(args.slice(1));
}

function runDoctorRelease(args: string[]) {
	const command = 'doctor release';
	const parsed = parseOptions(args);
	const err = unknownOptions(parsed, [
		'--target',
		'--source',
		'--registry-dir',
		'--release-plan',
		'--manifest',
		'--did-document',
		'--offline-sigstore-fixture',
	]);
	if (err) return usage(command, err);
	const targetErr = releaseTargetError(command, parsed);
	if (targetErr) return targetErr;
	if (parsed.positional.length !== 0) return usage(command, `${command} takes no positional arguments`);

	const sourceDir = oneOption(parsed.options, '--source');
	const registryDir = oneOption(parsed.options, '--registry-dir');
	const releasePlanPath = oneOption(parsed.options, '--release-plan');
	const manifestPath = oneOption(parsed.options, '--manifest');
	const didDocumentPath = oneOption(parsed.options, '--did-document');
	const sigstoreFixturePath = oneOption(parsed.options, '--offline-sigstore-fixture');
	if (!sourceDir) return usage(command, '--source <dir> is required');
	if (!registryDir) return usage(command, '--registry-dir <dir> is required');
	if (!releasePlanPath) return usage(command, '--release-plan <path> is required');
	if (!manifestPath) return usage(command, '--manifest <path> is required');
	if (!existsSync(releasePlanPath)) {
		return commandResult(false, command, EXIT.failure, [diag('llmix.release_plan_missing', 'Release plan is missing')], {
			summary: 'Release doctor found readiness issues',
			nextActions: [
				nextAction(
					'create-release-plan',
					'Prepare the verified release plan before final deployment checks',
					`mda release prepare --target llmix-registry --source ${sourceDir} --registry-dir ${registryDir} --policy <policy.json> --out ${releasePlanPath}`,
				),
			],
			sourceDir,
			registryDir,
			releasePlan: releasePlanPath,
			manifest: manifestPath,
			readOnly: true,
			written: false,
		});
	}
	if (!existsSync(manifestPath)) {
		return commandResult(false, command, EXIT.failure, [diag('llmix.manifest_missing', 'Trust manifest is missing')], {
			summary: 'Release doctor found readiness issues',
			nextActions: [
				nextAction(
					'create-trust-manifest',
					'Generate the external deployment trust manifest before release',
					`mda release finalize --target llmix-registry --registry-dir ${registryDir} --registry-root <registry-root.json> --release-plan ${releasePlanPath} --policy <policy.json> --derive-root-digest --out ${manifestPath}`,
				),
			],
			sourceDir,
			registryDir,
			releasePlan: releasePlanPath,
			manifest: manifestPath,
			readOnly: true,
			written: false,
		});
	}

	const manifestRead = readJson(manifestPath);
	if (!manifestRead.ok)
		return ioError(command, manifestRead.message, {
			sourceDir,
			registryDir,
			releasePlan: releasePlanPath,
			manifest: manifestPath,
			readOnly: true,
			written: false,
		});

	const diagnostics: ReturnType<typeof diag>[] = [];
	const checks: { id: string; ok: boolean }[] = [];
	if (pathResolvesInsideDir(manifestPath, registryDir)) {
		diagnostics.push(diag('release.trust_artifact_inside_registry', '--manifest must resolve outside --registry-dir'));
		checks.push({ id: 'manifest-placement', ok: false });
	} else {
		checks.push({ id: 'manifest-placement', ok: true });
	}

	const requestedReleasePlanRead = readJson(releasePlanPath);
	if (!requestedReleasePlanRead.ok) diagnostics.push(diag('filesystem.io', requestedReleasePlanRead.message, { path: releasePlanPath }));
	const requestedReleasePlanEvidence = requestedReleasePlanRead.ok ? validateReleasePlanEvidence(requestedReleasePlanRead.value) : null;
	if (requestedReleasePlanEvidence) diagnostics.push(...requestedReleasePlanEvidence.diagnostics);
	checks.push({ id: 'release-plan-input', ok: Boolean(requestedReleasePlanEvidence?.ok) });

	const manifest = validateTrustManifestEvidence(manifestRead.value);
	diagnostics.push(...manifest.diagnostics);
	checks.push({ id: 'trust-manifest-shape', ok: manifest.ok });
	if (manifest.ok) {
		const registryRootInsideRegistry = pathResolvesInsideDir(manifest.manifest.registryRoot.path, registryDir);
		if (!registryRootInsideRegistry) {
			diagnostics.push(
				diag('release.registry_root_outside_registry', 'Trust manifest registryRoot.path must resolve inside --registry-dir'),
			);
		}
		checks.push({ id: 'registry-root-placement', ok: registryRootInsideRegistry });
		const registryRootRead = registryRootInsideRegistry ? readJson(manifest.manifest.registryRoot.path) : null;
		if (registryRootRead && !registryRootRead.ok)
			diagnostics.push(diag('filesystem.io', registryRootRead.message, { path: manifest.manifest.registryRoot.path }));
		if (manifest.manifest.releasePlan.path !== releasePlanPath)
			diagnostics.push(diag('llmix.release_plan_digest_mismatch', 'Trust manifest releasePlan.path does not match --release-plan'));
		const releasePlanRead = readJson(releasePlanPath);
		if (!releasePlanRead.ok) diagnostics.push(diag('filesystem.io', releasePlanRead.message, { path: manifest.manifest.releasePlan.path }));

		const rootEvidence = registryRootRead?.ok
			? validateRegistryRootEvidence(registryRootRead.value, manifest.manifest.registryRoot.path)
			: null;
		const releasePlanEvidence = releasePlanRead.ok ? validateReleasePlanEvidence(releasePlanRead.value) : null;
		if (rootEvidence) diagnostics.push(...rootEvidence.diagnostics);
		if (releasePlanEvidence) diagnostics.push(...releasePlanEvidence.diagnostics);
		checks.push({ id: 'registry-root-evidence', ok: Boolean(rootEvidence?.ok) });
		checks.push({ id: 'release-plan-evidence', ok: Boolean(releasePlanEvidence?.ok) });

		if (rootEvidence?.ok && releasePlanEvidence?.ok) {
			if (manifest.manifest.expectedRootDigest !== rootEvidence.rootDigest)
				diagnostics.push(diag('llmix.root_digest_mismatch', 'Trust manifest expectedRootDigest does not match registry-root evidence'));
			if (manifest.manifest.sourceSetDigest !== sourceSetDigestForManifest(rootEvidence.root, releasePlanEvidence.releasePlan))
				diagnostics.push(diag('llmix.source_set_digest_mismatch', 'Trust manifest sourceSetDigest does not match registry-root evidence'));
			if (manifest.manifest.releasePlanDigest !== computeDigest(Buffer.from(jcs(releasePlanRead.value), 'utf8'), 'sha256'))
				diagnostics.push(diag('llmix.release_plan_digest_mismatch', 'Trust manifest releasePlanDigest does not match release plan'));
			diagnostics.push(...sourceSetDiagnostics(rootEvidence.root, releasePlanEvidence.releasePlan, registryDir));
			diagnostics.push(
				...freshnessDiagnostics(rootEvidence.root, {
					minimumRevision: manifest.manifest.minimumRevision,
					minimumPublishedAt: manifest.manifest.minimumPublishedAt,
					highWatermark: manifest.manifest.highWatermark,
				}),
			);
			const signatureVerification = verifySignatureEntries(
				rootEvidence.root.signatures,
				rootEvidence.root.integrity,
				manifest.manifest.registryRootTrustPolicy,
				didDocumentPath,
				sigstoreFixturePath,
				{ payloadType: rootEvidence.root.signaturePayloadType, payloadBytes: rootEvidence.root.signaturePayloadBytes },
			);
			if (signatureVerification.malformed) {
				diagnostics.push(diag('signature.invalid_entry', 'Registry-root signature entry is malformed'));
			} else if (signatureVerification.trusted.size < trustPolicyMinSignatures(manifest.manifest.registryRootTrustPolicy)) {
				diagnostics.push(
					...(signatureVerification.rejectedTrusted.length > 0
						? signatureVerification.rejectedTrusted
						: [diag('trust_policy.no_trusted_signature', 'Registry-root signatures do not match the embedded trust policy')]),
				);
			}
		}
		checks.push({
			id: 'registry-root-trust',
			ok: diagnostics.length === 0 && Boolean(rootEvidence?.ok && releasePlanEvidence?.ok),
		});
	}

	const sourceReadiness = doctorSourceReadiness(sourceDir);
	diagnostics.push(...sourceReadiness.diagnostics);
	checks.push({ id: 'source-readiness', ok: sourceReadiness.ok });

	if (diagnostics.length > 0) {
		return commandResult(false, command, EXIT.failure, diagnostics, {
			summary: 'Release doctor found readiness issues',
			nextActions: [
				nextAction(
					'fix-release-state',
					'Fix the reported source, registry, manifest, freshness, or placement issue and run doctor again',
					`mda doctor release --target llmix-registry --source ${sourceDir} --registry-dir ${registryDir} --release-plan ${releasePlanPath} --manifest ${manifestPath}`,
				),
			],
			sourceDir,
			registryDir,
			releasePlan: releasePlanPath,
			manifest: manifestPath,
			checks,
			readOnly: true,
			written: false,
		});
	}

	return commandResult(true, command, EXIT.ok, [], {
		summary: 'Release state is ready for secure LLMix deployment',
		nextActions: [
			externalNextAction(
				'deploy-secure-llmix',
				'Deploy the signed registry with the external trust manifest and generated deployment snippet',
				'use the deployment system that mounts the manifest outside config/llm',
				false,
			),
		],
		sourceDir,
		registryDir,
		releasePlan: releasePlanPath,
		manifest: manifestPath,
		checks,
		sourceCount: sourceReadiness.sourceCount,
		readOnly: true,
		written: false,
	});
}

function validateTrustManifestEvidence(value: unknown) {
	const diagnostics: ReturnType<typeof diag>[] = [];
	if (!isRecord(value)) {
		return { ok: false as const, diagnostics: [diag('llmix.trust_manifest_invalid', 'Trust manifest must be a JSON object')] };
	}
	if (value.kind !== 'llmix-trust-manifest')
		diagnostics.push(diag('llmix.trust_manifest_invalid', 'Trust manifest kind must be llmix-trust-manifest'));
	if (value.version !== 1) diagnostics.push(diag('llmix.trust_manifest_invalid', 'Trust manifest version must be 1'));
	if (typeof value.expectedRootDigest !== 'string' || !DIGEST_PATTERN.test(value.expectedRootDigest))
		diagnostics.push(diag('llmix.trust_manifest_invalid', 'Trust manifest expectedRootDigest must be a digest'));
	if (typeof value.sourceSetDigest !== 'string' || !DIGEST_PATTERN.test(value.sourceSetDigest))
		diagnostics.push(diag('llmix.trust_manifest_invalid', 'Trust manifest sourceSetDigest must be a digest'));
	if (typeof value.releasePlanDigest !== 'string' || !DIGEST_PATTERN.test(value.releasePlanDigest))
		diagnostics.push(diag('llmix.trust_manifest_invalid', 'Trust manifest releasePlanDigest must be a digest'));
	if (!isNullableString(value.minimumRevision))
		diagnostics.push(diag('llmix.trust_manifest_invalid', 'Trust manifest minimumRevision must be a string or null'));
	if (!isNullableString(value.minimumPublishedAt))
		diagnostics.push(diag('llmix.trust_manifest_invalid', 'Trust manifest minimumPublishedAt must be a string or null'));
	if (!isNullableString(value.highWatermark))
		diagnostics.push(diag('llmix.trust_manifest_invalid', 'Trust manifest highWatermark must be a string or null'));
	if (!isRecord(value.registryRoot)) {
		diagnostics.push(diag('llmix.trust_manifest_invalid', 'Trust manifest registryRoot must be an object'));
	} else {
		if (typeof value.registryRoot.path !== 'string' || value.registryRoot.path.length === 0)
			diagnostics.push(diag('llmix.trust_manifest_invalid', 'Trust manifest registryRoot.path must be a non-empty string'));
		if (typeof value.registryRoot.revision !== 'string' || value.registryRoot.revision.length === 0)
			diagnostics.push(diag('llmix.trust_manifest_invalid', 'Trust manifest registryRoot.revision must be a non-empty string'));
		if (typeof value.registryRoot.publishedAt !== 'string' || Number.isNaN(Date.parse(value.registryRoot.publishedAt)))
			diagnostics.push(diag('llmix.trust_manifest_invalid', 'Trust manifest registryRoot.publishedAt must be an ISO timestamp'));
		if (typeof value.registryRoot.highWatermark !== 'string' || value.registryRoot.highWatermark.length === 0)
			diagnostics.push(diag('llmix.trust_manifest_invalid', 'Trust manifest registryRoot.highWatermark must be a non-empty string'));
	}
	if (!isRecord(value.releasePlan)) {
		diagnostics.push(diag('llmix.trust_manifest_invalid', 'Trust manifest releasePlan must be an object'));
	} else {
		if (typeof value.releasePlan.path !== 'string' || value.releasePlan.path.length === 0)
			diagnostics.push(diag('llmix.trust_manifest_invalid', 'Trust manifest releasePlan.path must be a non-empty string'));
		const sourceCount = value.releasePlan.sourceCount;
		if (typeof sourceCount !== 'number' || !Number.isInteger(sourceCount) || sourceCount < 0)
			diagnostics.push(diag('llmix.trust_manifest_invalid', 'Trust manifest releasePlan.sourceCount must be a non-negative integer'));
	}
	if (diagnostics.length > 0) return { ok: false as const, diagnostics };
	return { ok: true as const, diagnostics, manifest: value as TrustManifestEvidence };
}

function isNullableString(value: unknown) {
	return value === null || typeof value === 'string';
}

function renderLlmixTrustSnippet(format: string, manifestPath: string, manifest: TrustManifestEvidence) {
	const vars = {
		LLMIX_TRUST_MANIFEST: manifestPath,
		LLMIX_EXPECTED_ROOT_DIGEST: manifest.expectedRootDigest,
		LLMIX_SOURCE_SET_DIGEST: manifest.sourceSetDigest,
		LLMIX_RELEASE_PLAN_DIGEST: manifest.releasePlanDigest,
		LLMIX_REGISTRY_ROOT: manifest.registryRoot.path,
		LLMIX_RELEASE_PLAN: manifest.releasePlan.path,
		LLMIX_HIGH_WATERMARK: manifest.highWatermark ?? '',
	};
	if (format === 'json') return `${JSON.stringify(vars, null, 2)}\n`;
	if (format === 'env')
		return `${Object.entries(vars)
			.map(([key, value]) => `${key}=${JSON.stringify(value)}`)
			.join('\n')}\n`;
	if (format === 'kubernetes') {
		return [
			'apiVersion: v1',
			'kind: ConfigMap',
			'metadata:',
			'  name: llmix-trust',
			'data:',
			...Object.entries(vars).map(([key, value]) => `  ${key}: ${JSON.stringify(value)}`),
			'',
		].join('\n');
	}
	if (format === 'github-actions') {
		return ['env:', ...Object.entries(vars).map(([key, value]) => `  ${key}: ${JSON.stringify(value)}`), ''].join('\n');
	}
	if (format === 'terraform') {
		return [
			'locals {',
			'  llmix_trust = {',
			...Object.entries(vars).map(([key, value]) => `    ${key} = ${JSON.stringify(value)}`),
			'  }',
			'}',
			'',
		].join('\n');
	}
	if (format === 'typescript') return `export const llmixTrust = ${JSON.stringify(vars, null, 2)} as const;\n`;
	if (format === 'python') return `LLMIX_TRUST = ${JSON.stringify(vars, null, 2)}\n`;
	return `${Object.entries(vars)
		.map(([key, value]) => `pub const ${key}: &str = ${JSON.stringify(value)};`)
		.join('\n')}\n`;
}

function doctorSourceReadiness(sourceDir: string) {
	const diagnostics: ReturnType<typeof diag>[] = [];
	const scanned = scanMdaSources(resolve(sourceDir));
	if (!scanned.ok) return { ok: false, diagnostics: [diag('filesystem.io', scanned.message)], sourceCount: 0 };
	if (scanned.files.length === 0) {
		return {
			ok: false,
			diagnostics: [diag('llmix.no_sources', 'No .mda sources found under --source')],
			sourceCount: 0,
		};
	}
	for (const file of scanned.files) {
		const validation = validateArtifact(file, 'source');
		if (!validation.ok) diagnostics.push(...validation.diagnostics.map((d) => ({ ...d, path: file })));
		const integrity = runIntegrity(['verify', file, '--target', 'source']);
		if (!integrity.ok) diagnostics.push(...integrity.diagnostics.map((d) => ({ ...d, path: file })));
	}
	return { ok: diagnostics.length === 0, diagnostics, sourceCount: scanned.files.length };
}

type RegistryRootEvidence = {
	mode: 'legacy' | 'native';
	revision: string;
	publishedAt: string;
	highWatermark: string;
	sourceSetDigest?: string;
	sources: Record<string, unknown>[];
	files: NativeRegistryRootFile[];
	integrity: { algorithm: 'sha256'; digest: string };
	signatures: unknown[];
	signaturePayloadType: string;
	signaturePayloadBytes: Buffer;
};

type NativeRegistryRootFile = {
	path: string;
	sha256: string;
	role: 'source' | 'resolved';
};

type ReleasePlanEvidence = {
	sourceSetDigest: string;
	sources: Record<string, unknown>[];
};

function validateRegistryRootEvidence(value: unknown, registryRootPath?: string) {
	const diagnostics: ReturnType<typeof diag>[] = [];
	if (!isRecord(value)) {
		return { ok: false as const, diagnostics: [diag('llmix.registry_root_invalid', 'Registry-root evidence must be a JSON object')] };
	}
	if (value.schema === LLMIX_NATIVE_ROOT_SCHEMA) return validateNativeRegistryRootEvidence(value, registryRootPath);
	if (value.kind !== 'llmix-registry-root')
		diagnostics.push(diag('llmix.registry_root_invalid', 'Registry-root kind must be llmix-registry-root'));
	if (value.version !== 1) diagnostics.push(diag('llmix.registry_root_invalid', 'Registry-root version must be 1'));
	if (typeof value.revision !== 'string' || value.revision.length === 0)
		diagnostics.push(diag('llmix.registry_root_invalid', 'Registry-root revision must be a non-empty string'));
	if (typeof value.publishedAt !== 'string' || Number.isNaN(Date.parse(value.publishedAt)))
		diagnostics.push(diag('llmix.registry_root_invalid', 'Registry-root publishedAt must be an ISO timestamp'));
	if (typeof value.highWatermark !== 'string' || value.highWatermark.length === 0)
		diagnostics.push(diag('llmix.registry_root_invalid', 'Registry-root highWatermark must be a non-empty string'));
	if (typeof value.sourceSetDigest !== 'string' || !DIGEST_PATTERN.test(value.sourceSetDigest))
		diagnostics.push(diag('llmix.registry_root_invalid', 'Registry-root sourceSetDigest must be a digest'));
	const sources = Array.isArray(value.sources) ? value.sources : null;
	if (!sources) {
		diagnostics.push(diag('llmix.registry_root_invalid', 'Registry-root sources must be an array'));
	} else {
		for (const [index, source] of sources.entries()) {
			if (!isRecord(source)) diagnostics.push(diag('llmix.registry_root_invalid', `Registry-root sources[${index}] must be a JSON object`));
		}
	}
	if (!isRecord(value.integrity) || value.integrity.algorithm !== 'sha256' || typeof value.integrity.digest !== 'string') {
		diagnostics.push(diag('llmix.registry_root_invalid', 'Registry-root integrity must contain sha256 digest'));
	}
	if (!Array.isArray(value.signatures) || value.signatures.length === 0)
		diagnostics.push(diag('missing-required-signature', 'Registry-root evidence requires signatures[]'));
	const rootDigest = computeDigest(Buffer.from(jcs(unsignedRegistryRoot(value)), 'utf8'), 'sha256');
	if (isRecord(value.integrity) && typeof value.integrity.digest === 'string' && value.integrity.digest !== rootDigest) {
		diagnostics.push(diag('integrity.mismatch', 'Registry-root integrity digest does not match canonical evidence bytes'));
	}
	if (diagnostics.length > 0) return { ok: false as const, diagnostics };
	const root: RegistryRootEvidence = {
		mode: 'legacy',
		revision: value.revision as string,
		publishedAt: value.publishedAt as string,
		highWatermark: value.highWatermark as string,
		sourceSetDigest: value.sourceSetDigest as string,
		sources: sources as Record<string, unknown>[],
		files: [],
		integrity: value.integrity as { algorithm: 'sha256'; digest: string },
		signatures: value.signatures as unknown[],
		signaturePayloadType: INTEGRITY_PAYLOAD_TYPE,
		signaturePayloadBytes: Buffer.from(
			jcs({
				integrity: {
					algorithm: (value.integrity as Record<string, unknown>).algorithm,
					digest: (value.integrity as Record<string, unknown>).digest,
				},
			}),
			'utf8',
		),
	};
	return {
		ok: true as const,
		diagnostics,
		rootDigest,
		root,
	};
}

function unsignedRegistryRoot(root: Record<string, unknown>) {
	const unsigned: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(root)) {
		if (key !== 'integrity' && key !== 'signatures') unsigned[key] = value;
	}
	return unsigned;
}

function validateNativeRegistryRootEvidence(value: Record<string, unknown>, registryRootPath?: string) {
	const diagnostics: ReturnType<typeof diag>[] = [];
	if (value.schema_version !== 1)
		diagnostics.push(diag('llmix.registry_root_invalid', 'Native registry-root envelope schema_version must be 1'));
	const payload = isRecord(value.payload) ? value.payload : null;
	if (!payload) diagnostics.push(diag('llmix.registry_root_invalid', 'Native registry-root envelope payload must be an object'));
	if (!isRecord(value.integrity) || value.integrity.algorithm !== 'sha256' || typeof value.integrity.digest !== 'string') {
		diagnostics.push(diag('llmix.registry_root_invalid', 'Native registry-root integrity must contain sha256 digest'));
	}
	if (typeof value.payload_sha256 !== 'string' || !SHA256_HEX.test(value.payload_sha256))
		diagnostics.push(diag('llmix.registry_root_invalid', 'Native registry-root payload_sha256 must be a sha256 hex digest'));
	if (!Array.isArray(value.signatures) || value.signatures.length === 0)
		diagnostics.push(diag('missing-required-signature', 'Native registry-root envelope requires signatures[]'));
	if (!payload) return { ok: false as const, diagnostics };

	if (payload.schema !== LLMIX_NATIVE_ROOT_PAYLOAD_SCHEMA)
		diagnostics.push(diag('llmix.registry_root_invalid', 'Native registry-root payload schema is not supported'));
	if (payload.schema_version !== 1)
		diagnostics.push(diag('llmix.registry_root_invalid', 'Native registry-root payload schema_version must be 1'));
	if (typeof payload.revision !== 'string' || payload.revision.length === 0)
		diagnostics.push(diag('llmix.registry_root_invalid', 'Native registry-root payload revision must be a non-empty string'));
	if (typeof payload.published_at !== 'string' || Number.isNaN(Date.parse(payload.published_at)))
		diagnostics.push(diag('llmix.registry_root_invalid', 'Native registry-root payload published_at must be an ISO timestamp'));
	const files = parseNativeRegistryRootFiles(payload.files, diagnostics);
	const payloadBytes = Buffer.from(jcs(payload), 'utf8');
	const payloadDigest = computeDigest(payloadBytes, 'sha256');
	if (typeof value.payload_sha256 === 'string' && `sha256:${value.payload_sha256}` !== payloadDigest) {
		diagnostics.push(diag('integrity.mismatch', 'Native registry-root payload_sha256 does not match canonical payload bytes'));
	}
	if (isRecord(value.integrity) && value.integrity.digest !== payloadDigest) {
		diagnostics.push(diag('integrity.mismatch', 'Native registry-root integrity digest does not match payload_sha256'));
	}
	if (diagnostics.length > 0) return { ok: false as const, diagnostics };
	const root: RegistryRootEvidence = {
		mode: 'native',
		revision: payload.revision as string,
		publishedAt: payload.published_at as string,
		highWatermark: payload.revision as string,
		sources: [],
		files,
		integrity: value.integrity as { algorithm: 'sha256'; digest: string },
		signatures: value.signatures as unknown[],
		signaturePayloadType: LLMIX_REGISTRY_ROOT_PAYLOAD_TYPE,
		signaturePayloadBytes: payloadBytes,
	};
	return {
		ok: true as const,
		diagnostics,
		rootDigest: registryRootPath
			? computeDigest(readFileSync(registryRootPath), 'sha256')
			: computeDigest(Buffer.from(jcs(value), 'utf8'), 'sha256'),
		root,
	};
}

function parseNativeRegistryRootFiles(value: unknown, diagnostics: ReturnType<typeof diag>[]) {
	const files: NativeRegistryRootFile[] = [];
	if (!Array.isArray(value)) {
		diagnostics.push(diag('llmix.registry_root_invalid', 'Native registry-root payload files must be an array'));
		return files;
	}
	const seen = new Set<string>();
	for (const [index, file] of value.entries()) {
		if (!isRecord(file)) {
			diagnostics.push(diag('llmix.registry_root_invalid', `Native registry-root files[${index}] must be a JSON object`));
			continue;
		}
		const path = file.path;
		const sha256 = file.sha256;
		const role = file.role;
		if (typeof path !== 'string' || path.length === 0)
			diagnostics.push(diag('llmix.registry_root_invalid', `Native registry-root files[${index}].path must be a non-empty string`));
		if (typeof sha256 !== 'string' || !SHA256_HEX.test(sha256))
			diagnostics.push(diag('llmix.registry_root_invalid', `Native registry-root files[${index}].sha256 must be a sha256 hex digest`));
		if (role !== 'source' && role !== 'resolved')
			diagnostics.push(diag('llmix.registry_root_invalid', `Native registry-root files[${index}].role must be source or resolved`));
		if (typeof path !== 'string' || typeof sha256 !== 'string' || (role !== 'source' && role !== 'resolved')) continue;
		if (seen.has(path)) {
			diagnostics.push(diag('llmix.registry_root_invalid', `Native registry-root contains duplicate file path ${path}`));
			continue;
		}
		seen.add(path);
		files.push({ path, sha256, role });
	}
	return files;
}

function validateReleasePlanEvidence(value: unknown) {
	const diagnostics: ReturnType<typeof diag>[] = [];
	if (!isRecord(value)) {
		return { ok: false as const, diagnostics: [diag('llmix.release_plan_invalid', 'Release plan must be a JSON object')] };
	}
	if (value.kind !== 'llmix-release-plan')
		diagnostics.push(diag('llmix.release_plan_invalid', 'Release plan kind must be llmix-release-plan'));
	if (typeof value.sourceSetDigest !== 'string' || !DIGEST_PATTERN.test(value.sourceSetDigest))
		diagnostics.push(diag('llmix.release_plan_invalid', 'Release plan sourceSetDigest must be a digest'));
	const sources = Array.isArray(value.sources) ? value.sources : null;
	if (!sources) {
		diagnostics.push(diag('llmix.release_plan_invalid', 'Release plan sources must be an array'));
	} else {
		for (const [index, source] of sources.entries()) {
			if (!isRecord(source)) diagnostics.push(diag('llmix.release_plan_invalid', `Release plan sources[${index}] must be a JSON object`));
		}
	}
	if (diagnostics.length > 0) return { ok: false as const, diagnostics };
	const releasePlan: ReleasePlanEvidence = {
		sourceSetDigest: value.sourceSetDigest as string,
		sources: sources as Record<string, unknown>[],
	};
	return {
		ok: true as const,
		diagnostics,
		releasePlan,
	};
}

function freshnessDiagnostics(
	root: RegistryRootEvidence,
	requirements: { minimumRevision: string | null; minimumPublishedAt: string | null; highWatermark: string | null },
) {
	const diagnostics: ReturnType<typeof diag>[] = [];
	if (requirements.minimumRevision) {
		const comparison = compareMonotonicRequirement(root.revision, requirements.minimumRevision, 'revision');
		if (!comparison.ok) diagnostics.push(...comparison.diagnostics);
		else if (comparison.value < 0)
			diagnostics.push(diag('llmix.freshness_revision_rollback', 'Registry-root revision is below minimumRevision'));
	}
	if (requirements.minimumPublishedAt) {
		const publishedAt = Date.parse(root.publishedAt);
		const minimumPublishedAt = Date.parse(requirements.minimumPublishedAt);
		if (Number.isNaN(minimumPublishedAt))
			diagnostics.push(diag('llmix.freshness_invalid', '--minimum-published-at must be an ISO timestamp'));
		else if (publishedAt < minimumPublishedAt)
			diagnostics.push(diag('llmix.freshness_published_at_rollback', 'Registry-root publishedAt is below minimumPublishedAt'));
	}
	if (requirements.highWatermark) {
		const comparison = compareMonotonicRequirement(root.highWatermark, requirements.highWatermark, 'highWatermark');
		if (!comparison.ok) diagnostics.push(...comparison.diagnostics);
		else if (comparison.value < 0)
			diagnostics.push(diag('llmix.high_watermark_rollback', 'Registry-root highWatermark is below the required high-watermark'));
	}
	return diagnostics;
}

type MonotonicValue = { kind: 'integer'; value: string } | { kind: 'timestamp'; value: number };

function compareMonotonicRequirement(actual: string, requirement: string, label: string) {
	const actualValue = parseMonotonicValue(actual, `registry-root ${label}`);
	const requiredValue = parseMonotonicValue(requirement, `required ${label}`);
	const diagnostics = [...actualValue.diagnostics, ...requiredValue.diagnostics];
	if (!actualValue.ok || !requiredValue.ok) return { ok: false as const, diagnostics };
	if (actualValue.value.kind !== requiredValue.value.kind) {
		return {
			ok: false as const,
			diagnostics: [diag('llmix.freshness_invalid', `${label} and required ${label} must use the same monotonic format`)],
		};
	}
	return { ok: true as const, value: compareMonotonicValues(actualValue.value, requiredValue.value) };
}

function parseMonotonicValue(value: string, label: string) {
	if (/^(0|[1-9][0-9]*)$/.test(value)) {
		return { ok: true as const, diagnostics: [], value: { kind: 'integer', value } as MonotonicValue };
	}
	const compactUtc = value.match(/^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2})([0-9]{2})([0-9]{2})Z$/);
	const millis = compactUtc
		? Date.UTC(
				Number(compactUtc[1]),
				Number(compactUtc[2]) - 1,
				Number(compactUtc[3]),
				Number(compactUtc[4]),
				Number(compactUtc[5]),
				Number(compactUtc[6]),
			)
		: Date.parse(value);
	if (!Number.isNaN(millis)) {
		return { ok: true as const, diagnostics: [], value: { kind: 'timestamp', value: millis } as MonotonicValue };
	}
	return {
		ok: false as const,
		diagnostics: [
			diag(
				'llmix.freshness_invalid',
				`${label} must be a decimal integer, ISO timestamp, or compact UTC timestamp like 2026-05-09T120000Z`,
			),
		],
	};
}

function compareMonotonicValues(actual: MonotonicValue, requirement: MonotonicValue) {
	if (actual.kind === 'timestamp' && requirement.kind === 'timestamp') return actual.value - requirement.value;
	if (actual.kind === 'integer' && requirement.kind === 'integer') {
		if (actual.value.length !== requirement.value.length) return actual.value.length - requirement.value.length;
		return actual.value.localeCompare(requirement.value);
	}
	return 0;
}

function sourceSetDigestForManifest(root: RegistryRootEvidence, releasePlan: ReleasePlanEvidence) {
	return root.mode === 'native' ? releasePlan.sourceSetDigest : (root.sourceSetDigest as string);
}

function sourceSetDiagnostics(root: RegistryRootEvidence, releasePlan: ReleasePlanEvidence, registryDir?: string) {
	if (root.mode === 'native') return nativeSourceSetDiagnostics(root, releasePlan, registryDir);
	return legacySourceSetDiagnostics(root, releasePlan);
}

function legacySourceSetDiagnostics(root: RegistryRootEvidence, releasePlan: ReleasePlanEvidence) {
	const diagnostics: ReturnType<typeof diag>[] = [];
	if (root.sourceSetDigest !== releasePlan.sourceSetDigest) {
		diagnostics.push(diag('llmix.source_set_digest_mismatch', 'Registry-root sourceSetDigest does not match the release plan'));
	}
	const rootSources = new Map<string, Record<string, unknown>>();
	for (const source of root.sources) {
		const identity = registryEntryIdentity(source);
		if (!identity) {
			diagnostics.push(diag('llmix.registry_root_identity_mismatch', 'Registry-root source is missing registry entry identity'));
			continue;
		}
		if (rootSources.has(identity)) {
			diagnostics.push(diag('llmix.registry_root_duplicate_preset', `Registry-root has duplicate preset ${identity}`));
			continue;
		}
		rootSources.set(identity, source);
	}
	const releaseIdentities = new Set<string>();
	for (const source of releasePlan.sources) {
		const identity = registryEntryIdentity(source);
		if (!identity) {
			diagnostics.push(diag('llmix.release_plan_invalid', 'Release plan source is missing registry entry identity'));
			continue;
		}
		if (releaseIdentities.has(identity)) {
			diagnostics.push(diag('llmix.release_plan_duplicate_preset', `Release plan has duplicate preset ${identity}`));
			continue;
		}
		releaseIdentities.add(identity);
		const rootSource = rootSources.get(identity);
		if (!rootSource) {
			diagnostics.push(diag('llmix.registry_root_missing_preset', `Registry-root is missing preset ${identity}`));
			continue;
		}
		if (rootSource.canonicalSourceDigest !== source.canonicalSourceDigest) {
			diagnostics.push(diag('llmix.registry_root_stale_digest', `Registry-root digest for ${identity} does not match the release plan`));
		}
		if (rootSource.registryEntryPath !== source.expectedRegistryEntryPath) {
			diagnostics.push(diag('llmix.registry_root_identity_mismatch', `Registry-root path for ${identity} does not match the release plan`));
		}
	}
	for (const identity of rootSources.keys()) {
		if (!releaseIdentities.has(identity))
			diagnostics.push(diag('llmix.registry_root_extra_preset', `Registry-root has extra preset ${identity}`));
	}
	return diagnostics;
}

function nativeSourceSetDiagnostics(root: RegistryRootEvidence, releasePlan: ReleasePlanEvidence, registryDir?: string) {
	const diagnostics: ReturnType<typeof diag>[] = [];
	if (!registryDir) {
		return [diag('release.registry_dir_required', '--registry-dir <dir> is required to verify native registry-root file coverage')];
	}
	const sourcePaths = new Map<string, string>();
	const resolvedPaths = new Set<string>();
	for (const file of root.files) {
		const candidate = resolve(registryDir, file.path);
		if (!pathResolvesInsideDir(candidate, registryDir)) {
			diagnostics.push(diag('llmix.registry_root_file_outside_registry', `Native registry-root file path escapes registry: ${file.path}`));
			continue;
		}
		try {
			const actualDigest = computeDigest(readFileSync(candidate), 'sha256');
			const expectedDigest = `sha256:${file.sha256}`;
			if (actualDigest !== expectedDigest) {
				diagnostics.push(
					diag('llmix.registry_root_file_digest_mismatch', `Native registry-root file digest does not match bytes for ${file.path}`),
				);
			}
		} catch (error) {
			diagnostics.push(diag('filesystem.io', error instanceof Error ? error.message : String(error), { path: candidate }));
			continue;
		}
		if (file.role === 'source') {
			const digest = `sha256:${file.sha256}`;
			sourcePaths.set(file.path, digest);
		} else {
			resolvedPaths.add(file.path);
		}
	}
	for (const source of releasePlan.sources) {
		const identity = registryEntryIdentity(source);
		if (!identity) {
			diagnostics.push(diag('llmix.release_plan_invalid', 'Release plan source is missing registry entry identity'));
			continue;
		}
		const sourceRawDigest =
			typeof source.rawSourceDigest === 'string' && DIGEST_PATTERN.test(source.rawSourceDigest) ? source.rawSourceDigest : null;
		if (!sourceRawDigest) {
			diagnostics.push(diag('llmix.release_plan_invalid', `Release plan source ${identity} is missing rawSourceDigest`));
		}
		if (typeof source.module !== 'string' || typeof source.preset !== 'string') {
			diagnostics.push(diag('llmix.release_plan_invalid', `Release plan source ${identity} is missing module or preset`));
			continue;
		}
		const nativeSourcePath = `compiled/${root.revision}/source/${source.module}/${source.preset}.mda`;
		const nativeSourceDigest = sourcePaths.get(nativeSourcePath);
		if (!nativeSourceDigest) {
			diagnostics.push(diag('llmix.registry_root_missing_preset', `Native registry-root is missing source preset for ${identity}`));
		} else if (sourceRawDigest && nativeSourceDigest !== sourceRawDigest) {
			diagnostics.push(
				diag('llmix.registry_root_stale_digest', `Native registry-root source digest for ${identity} does not match the release plan`),
			);
		}
		const nativeResolvedPath = `compiled/${root.revision}/resolved/${source.module}/${source.preset}.json`;
		if (!resolvedPaths.has(nativeResolvedPath)) {
			diagnostics.push(diag('llmix.registry_root_missing_preset', `Native registry-root is missing resolved config for ${identity}`));
		}
	}
	return diagnostics;
}

function registryEntryIdentity(source: Record<string, unknown>) {
	const identity = source.registryEntryIdentity ?? source.expectedRegistryEntryIdentity;
	return typeof identity === 'string' && identity.length > 0 ? identity : null;
}

function pathResolvesInsideDir(candidate: string, rootDir: string) {
	const root = realPathIfPossible(rootDir);
	const resolvedCandidate = realPathCandidate(candidate);
	return resolvedCandidate === root || resolvedCandidate.startsWith(`${root}${sep}`);
}

function realPathCandidate(candidate: string) {
	const resolved = resolve(candidate);
	try {
		return realpathSync(resolved);
	} catch {
		const parent = realPathIfPossible(dirname(resolved));
		return join(parent, basename(resolved));
	}
}

function realPathIfPossible(path: string) {
	try {
		return realpathSync(path);
	} catch {
		return resolve(path);
	}
}

function scanMdaSources(root: string) {
	const files: string[] = [];
	try {
		const visit = (dir: string) => {
			for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
				const path = join(dir, entry.name);
				if (entry.isDirectory()) visit(path);
				else if (entry.isFile() && entry.name.endsWith('.mda')) files.push(path);
			}
		};
		visit(root);
		return { ok: true as const, files };
	} catch (error) {
		return { ok: false as const, message: error instanceof Error ? error.message : String(error) };
	}
}

function relativePath(root: string, file: string) {
	return relative(root, file).split(sep).join('/');
}

function llmixPresetIdentity(frontmatter: Record<string, unknown>) {
	const metadata = isRecord(frontmatter.metadata) ? frontmatter.metadata : null;
	const namespace = metadata && isRecord(metadata['snoai-llmix']) ? metadata['snoai-llmix'] : null;
	if (!namespace || typeof namespace.module !== 'string' || typeof namespace.preset !== 'string') return null;
	if (!LLMIX_MODULE_NAME.test(namespace.module) || !LLMIX_PRESET_NAME.test(namespace.preset)) return null;
	return { module: namespace.module, preset: namespace.preset };
}

function firstTrustedSignerIdentity(value: unknown): TrustedSignerIdentity | null {
	if (!Array.isArray(value)) return null;
	for (const entry of value) {
		if (!isRecord(entry)) continue;
		if (entry.type !== 'did-web' && entry.type !== 'sigstore-oidc') continue;
		if (typeof entry.signer !== 'string' || typeof entry.keyId !== 'string' || typeof entry.payloadDigest !== 'string') continue;
		const identity: TrustedSignerIdentity = {
			type: entry.type,
			signer: entry.signer,
			keyId: entry.keyId,
			payloadDigest: entry.payloadDigest,
		};
		if (typeof entry.subject === 'string') identity.subject = entry.subject;
		if (typeof entry.rekorLogId === 'string') identity.rekorLogId = entry.rekorLogId;
		if (typeof entry.rekorLogIndex === 'number') identity.rekorLogIndex = entry.rekorLogIndex;
		return identity;
	}
	return null;
}

function releaseTargetError(command: string, parsed: ReturnType<typeof parseOptions>) {
	if ('error' in parsed && parsed.error) return usage(command, parsed.error);
	const target = oneOption(parsed.options, '--target');
	if (!target) return usage(command, '--target llmix-registry is required');
	if (target === LLMIX_REGISTRY_TARGET) return null;
	return commandResult(false, command, EXIT.failure, [diag('release.unsupported_target', `Unsupported release target: ${target}`)], {
		summary: 'Release target is not supported',
		nextActions: [
			nextAction(
				'use-llmix-registry-target',
				'Use the supported LLMix registry release target',
				`mda ${command} --target ${LLMIX_REGISTRY_TARGET}`,
			),
		],
		target,
		supportedTargets: [LLMIX_REGISTRY_TARGET],
	});
}

function migratedCommand(command: string, replacement: string) {
	return commandResult(false, command, EXIT.failure, [diag('release.command_migrated', `Use ${replacement} instead of mda ${command}`)], {
		summary: 'Command moved to the generic release workflow',
		nextActions: [nextAction('use-release-command', 'Use the generic release command surface', replacement)],
	});
}

function llmixMigrationReplacement(args: string[]) {
	if (args[0] === 'release' && args[1] === 'plan') return 'mda release prepare --target llmix-registry';
	if (args[0] === 'trust' && args[1] === 'policy') return 'mda release trust policy --target llmix-registry';
	if (args[0] === 'trust' && args[1] === 'manifest') return 'mda release finalize --target llmix-registry';
	if (args[0] === 'trust' && args[1] === 'snippets') {
		return 'mda release finalize --target llmix-registry --registry-dir <registry-dir> --manifest <manifest> --snippet-format <format> --snippet-out <path>';
	}
	return 'mda release --help';
}

function runDidWebTrustPolicy(options: Map<string, string[]>, command: string) {
	const profile = 'did-web';
	const domain = oneOption(options, '--domain');
	if (!domain || didWebDomainFromDid(`did:web:${domain}`) !== domain) return usage(command, '--domain must be a valid did:web domain');
	const minRaw = oneOption(options, '--min-signatures') ?? '1';
	const minSignatures = Number(minRaw);
	if (!Number.isInteger(minSignatures) || minSignatures < 1) return usage(command, '--min-signatures must be a positive integer');
	const policy = { version: 1, minSignatures, trustedSigners: [{ type: 'did-web', domain }] };
	const validation = validateJsonAgainst(policy, 'trustPolicy');
	if (!validation.ok) return commandResult(false, command, EXIT.failure, validation.diagnostics, { profile, domain, minSignatures });
	const out = oneOption(options, '--out');
	const write = writeTrustPolicy(command, out, policy, { profile, domain, minSignatures });
	if (!write.ok) return write;
	return commandResult(true, command, EXIT.ok, [], {
		summary: out ? `Wrote did:web trust policy to ${out}` : 'Generated did:web trust policy',
		artifacts: out ? [artifact('trust-policy', out)] : [],
		nextActions: out
			? [
					nextAction(
						'verify-signed-preset',
						'Verify a signed preset with this policy',
						`mda verify signed.mda --target source --policy ${out} --did-document did-web-document.json`,
					),
				]
			: [externalNextAction('save-trust-policy', 'Save this policy JSON before release verification', 'write the policy bytes to disk')],
		message: out ? `wrote ${out}` : JSON.stringify(policy, null, 2),
		profile,
		domain,
		minSignatures,
		policy,
		out,
		written: Boolean(out),
	});
}

function runGithubActionsTrustPolicy(options: Map<string, string[]>, command: string) {
	const profile = 'github-actions';
	const repo = oneOption(options, '--repo');
	const workflow = oneOption(options, '--workflow');
	const ref = oneOption(options, '--ref');
	if (!repo || !GITHUB_REPOSITORY.test(repo)) return usage(command, '--repo must be a GitHub repository in owner/repo form');
	if (!workflow || workflow.trim() !== workflow || workflow.length === 0)
		return usage(command, '--workflow must be a non-empty workflow file or identity');
	if (!ref || !GITHUB_REF.test(ref)) return usage(command, '--ref must be an exact Git ref such as refs/heads/main or refs/tags/v1.1.0');

	const subject = `repo:${repo}:ref:${ref}`;
	const policy = {
		version: 1,
		trustedSigners: [
			{
				type: 'sigstore-oidc',
				issuer: GITHUB_ACTIONS_ISSUER,
				subject,
				repository: repo,
				workflow,
				ref,
			},
		],
		rekor: { url: SIGSTORE_REKOR_URL },
	};
	const validation = validateJsonAgainst(policy, 'trustPolicy');
	if (!validation.ok) return commandResult(false, command, EXIT.failure, validation.diagnostics, { profile, repo, workflow, ref });
	const out = oneOption(options, '--out');
	const write = writeTrustPolicy(command, out, policy, { profile, repo, workflow, ref });
	if (!write.ok) return write;
	return commandResult(true, command, EXIT.ok, [], {
		summary: out ? `Wrote GitHub Actions trust policy to ${out}` : 'Generated GitHub Actions trust policy',
		artifacts: out ? [artifact('trust-policy', out)] : [],
		nextActions: out
			? [
					nextAction(
						'sign-github-actions-release',
						'Sign the release artifact with GitHub Actions Sigstore/Rekor evidence',
						`mda sign release.mda --profile github-actions --repo ${repo} --workflow ${workflow} --ref ${ref} --rekor --offline-sigstore-fixture sigstore-fixture.json --out signed-release.mda`,
					),
					nextAction(
						'verify-github-actions-release',
						'Verify the signed release with this pinned policy',
						`mda verify signed-release.mda --policy ${out} --offline-sigstore-fixture sigstore-fixture.json`,
					),
				]
			: [externalNextAction('save-trust-policy', 'Save this policy JSON before release verification', 'write the policy bytes to disk')],
		message: out ? `wrote ${out}` : JSON.stringify(policy, null, 2),
		profile,
		repo,
		workflow,
		ref,
		policy,
		out,
		written: Boolean(out),
	});
}

function writeTrustPolicy(
	command: string,
	out: string | null | undefined,
	policy: unknown,
	context: Record<string, unknown>,
): CommandResult {
	if (!out) {
		return commandResult(true, command, EXIT.ok, [], { written: false });
	}
	if (existsSync(out))
		return commandResult(false, command, EXIT.io, [diag('filesystem.io', `Refusing to overwrite existing file: ${out}`)], {
			...context,
			out,
			written: false,
		});
	try {
		atomicWrite(out, `${JSON.stringify(policy, null, 2)}\n`);
	} catch (error) {
		return ioError(command, error instanceof Error ? error.message : String(error), {
			...context,
			out,
			written: false,
		});
	}
	return commandResult(true, command, EXIT.ok, [], { ...context, out, written: true });
}
