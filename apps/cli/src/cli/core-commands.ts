import { existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { EXIT, commandResult, diag, ioError, usage, type Diagnostic, type Globals, type Target } from '../types.js';
import {
	atomicReplace,
	atomicWrite,
	canonicalizeFromFile,
	compileTargets,
	computeDigest,
	isRecord,
	makeLlmixPresetScaffold,
	makeScaffold,
	normalizeCompileTarget,
	parseTarget,
	readArtifact,
	renderArtifact,
	resolveTarget,
	validateArtifact,
} from '../mda.js';
import { DIGEST_ALGORITHMS, LLMIX_MODULE_NAME, LLMIX_PRESET_NAME, LLMIX_PROVIDERS } from './constants.js';
import {
	artifact,
	externalNextAction,
	nextAction,
	nextAfterCompile,
	nextAfterValidate,
	oneOption,
	parseOptions,
	targetForPath,
	unknownOptions,
} from './shared.js';
import { getCliVersion } from './version.js';

export function runInit(args: string[], globals: Globals) {
	const parsed = parseOptions(args);
	const err = unknownOptions(parsed, ['--out', '--template', '--module', '--preset', '--provider', '--model']);
	if (err) return usage('init', err);

	const template = oneOption(parsed.options, '--template');
	if (template && template !== 'llmix-preset') return usage('init', `Unsupported template: ${template}`);
	if (template === 'llmix-preset') return runInitLlmixPreset(parsed, globals);

	if (parsed.positional.length !== 1) return usage('init', 'Expected exactly one name: mda init <name>');

	const name = parsed.positional[0];
	const scaffold = makeScaffold(name);
	const out = oneOption(parsed.options, '--out');

	if (out) {
		if (existsSync(out)) {
			return ioError('init', `Refusing to overwrite existing file: ${out}`, {
				name,
				scaffold: globals.json ? scaffold : undefined,
				out,
				written: false,
			});
		}
		try {
			atomicWrite(out, scaffold);
		} catch (error) {
			return ioError('init', error instanceof Error ? error.message : String(error), { name, out, written: false });
		}
	}

	if (globals.json) {
		return commandResult(true, 'init', EXIT.ok, [], {
			summary: out ? `Created MDA source at ${out}` : 'Generated MDA source scaffold',
			artifacts: out ? [artifact('mda-source', out, 'source')] : [],
			nextActions: out
				? [nextAction('validate-source', 'Validate the source file', `mda validate ${out} --target source`)]
				: [externalNextAction('save-source', 'Save this scaffold to a .mda file', 'write the scaffold bytes to disk')],
			name,
			scaffold,
			out,
			written: Boolean(out),
		});
	}
	return commandResult(true, 'init', EXIT.ok, [], {
		summary: out ? `Created MDA source at ${out}` : 'Generated MDA source scaffold',
		artifacts: out ? [artifact('mda-source', out, 'source')] : [],
		nextActions: out ? [nextAction('validate-source', 'Validate the source file', `mda validate ${out} --target source`)] : [],
		message: out ? `wrote ${out}` : scaffold,
		name,
		out,
		written: Boolean(out),
	});
}

export function runDemo(args: string[]) {
	const parsed = parseOptions(args);
	const err = unknownOptions(parsed, ['--out-dir']);
	if (err) return usage('demo', err);
	if (parsed.positional.length !== 0) return usage('demo', 'mda demo takes no positional arguments');

	const outDir = oneOption(parsed.options, '--out-dir') ?? 'mda-demo';
	const sourcePath = join(outDir, 'hello.mda');
	const compileDir = join(outDir, 'out');
	const skillPath = join(compileDir, 'SKILL.md');
	const agentsPath = join(compileDir, 'AGENTS.md');
	const mcpServerPath = join(compileDir, 'MCP-SERVER.md');
	const mcpSidecarPath = join(compileDir, 'mcp-server.json');
	const allPaths = [sourcePath, skillPath, agentsPath, mcpServerPath, mcpSidecarPath];

	for (const path of allPaths) {
		if (existsSync(path)) {
			return ioError('demo', `Refusing to overwrite existing file: ${path}`, {
				outDir,
				planned: allPaths,
				written: [],
			});
		}
	}

	const scaffold = makeScaffold('hello-skill');
	try {
		atomicWrite(sourcePath, scaffold);
	} catch (error) {
		return ioError('demo', error instanceof Error ? error.message : String(error), {
			outDir,
			planned: allPaths,
			written: [],
		});
	}

	const sourceRead = readArtifact(sourcePath);
	if (!sourceRead.ok || sourceRead.extract.kind !== 'ok' || !isRecord(sourceRead.extract.frontmatter)) {
		rmSync(sourcePath, { force: true });
		return commandResult(false, 'demo', EXIT.internal, [diag('demo.scaffold_invalid', 'Generated demo scaffold failed to parse')], {
			summary: 'Demo aborted: scaffold did not round-trip',
			outDir,
			written: [],
		});
	}

	const targets: Target[] = ['SKILL.md', 'AGENTS.md', 'MCP-SERVER.md'];
	const staged = compileTargets(sourceRead.extract.frontmatter, sourceRead.extract.body, targets, compileDir, true);
	if (!staged.ok) {
		rmSync(sourcePath, { force: true });
		return commandResult(false, 'demo', EXIT.failure, staged.diagnostics, {
			summary: 'Demo aborted: compile planning failed',
			outDir,
			planned: allPaths,
			written: [],
		});
	}

	const written: string[] = [sourcePath];
	try {
		for (const output of staged.outputs) {
			atomicWrite(output.path, output.bytes);
			written.push(output.path);
		}
	} catch (error) {
		const rolledBack: string[] = [];
		const rollbackDiagnostics: Diagnostic[] = [];
		for (const path of written) {
			try {
				rmSync(path, { force: true });
				rolledBack.push(path);
			} catch (rollbackError) {
				rollbackDiagnostics.push(
					diag('rollback-error', rollbackError instanceof Error ? rollbackError.message : String(rollbackError), { path }),
				);
			}
		}
		return commandResult(
			false,
			'demo',
			EXIT.io,
			[diag('io-error', error instanceof Error ? error.message : String(error)), ...rollbackDiagnostics],
			{
				summary: 'Demo failed while writing outputs',
				outDir,
				planned: allPaths,
				written: [],
				rolledBack,
			},
		);
	}

	return commandResult(true, 'demo', EXIT.ok, [], {
		summary: `Generated MDA demo at ${outDir}`,
		artifacts: [
			artifact('mda-source', sourcePath, 'source'),
			...staged.outputs.map((o) => artifact('compiled-output', o.path, targetForPath(o.path))),
		],
		nextActions: [
			nextAction('inspect-demo-output', 'Read the compiled SKILL.md to see the emitted format', `cat ${skillPath}`),
			nextAction(
				'recompile-demo-source',
				'Edit the source and recompile to refresh the outputs',
				`mda compile ${sourcePath} --target SKILL.md AGENTS.md MCP-SERVER.md --out-dir ${compileDir} --integrity`,
				false,
			),
			nextAction(
				'verify-demo-integrity',
				'Verify the integrity digest on a compiled output',
				`mda integrity verify ${skillPath} --target SKILL.md`,
				false,
			),
		],
		message: `wrote ${written.length} file(s) under ${outDir}`,
		outDir,
		sourcePath,
		compileDir,
		written,
	});
}

function runInitLlmixPreset(parsed: ReturnType<typeof parseOptions>, globals: Globals) {
	if (parsed.positional.length !== 0) return usage('init', 'LLMix preset init does not take a positional name');
	const moduleName = oneOption(parsed.options, '--module');
	const presetName = oneOption(parsed.options, '--preset');
	const provider = oneOption(parsed.options, '--provider');
	const model = oneOption(parsed.options, '--model');
	const out = oneOption(parsed.options, '--out');

	const diagnostics = [];
	if (!moduleName || !LLMIX_MODULE_NAME.test(moduleName))
		diagnostics.push(diag('llmix.invalid_identifier', '--module must be _default or a lowercase snake_case identifier'));
	if (!presetName || !LLMIX_PRESET_NAME.test(presetName))
		diagnostics.push(diag('llmix.invalid_identifier', '--preset must be _base* or a lowercase snake_case identifier'));
	if (!provider || !LLMIX_PROVIDERS.has(provider))
		diagnostics.push(diag('llmix.invalid_provider', '--provider must be a supported LLMix provider'));
	if (!model || model.trim().length === 0)
		diagnostics.push(diag('llmix.invalid_model', '--model must be a non-empty provider model identifier'));
	if (diagnostics.length > 0) {
		return commandResult(false, 'init', EXIT.usage, diagnostics, {
			summary: 'LLMix preset scaffold options are invalid',
			nextActions: [
				nextAction(
					'fix-llmix-init',
					'Fix the LLMix preset options and retry',
					'mda init --template llmix-preset --module search_summary --preset openai_fast --provider openai --model gpt-5-mini --out search_summary/openai_fast.mda',
				),
			],
		});
	}

	const scaffold = makeLlmixPresetScaffold(moduleName!, presetName!, provider!, model!);
	if (out) {
		if (existsSync(out)) {
			return ioError('init', `Refusing to overwrite existing file: ${out}`, {
				module: moduleName,
				preset: presetName,
				scaffold: globals.json ? scaffold : undefined,
				out,
				written: false,
			});
		}
		try {
			atomicWrite(out, scaffold);
		} catch (error) {
			return ioError('init', error instanceof Error ? error.message : String(error), {
				module: moduleName,
				preset: presetName,
				out,
				written: false,
			});
		}
	}

	const nextActions = out
		? [
				nextAction('validate-llmix-source', 'Validate the LLMix source file', `mda validate ${out} --target source`),
				nextAction('write-integrity', 'Record integrity before release', `mda integrity compute ${out} --target source --write`, false),
			]
		: [
				externalNextAction(
					'save-llmix-source',
					'Save this scaffold to a .mda file under the module directory',
					'write the scaffold bytes to disk',
				),
			];
	if (globals.json) {
		return commandResult(true, 'init', EXIT.ok, [], {
			summary: out ? `Created LLMix preset source at ${out}` : 'Generated LLMix preset scaffold',
			artifacts: out ? [artifact('mda-source', out, 'source')] : [],
			nextActions,
			template: 'llmix-preset',
			module: moduleName,
			preset: presetName,
			provider,
			model,
			scaffold,
			out,
			written: Boolean(out),
		});
	}
	return commandResult(true, 'init', EXIT.ok, [], {
		summary: out ? `Created LLMix preset source at ${out}` : 'Generated LLMix preset scaffold',
		artifacts: out ? [artifact('mda-source', out, 'source')] : [],
		nextActions: out ? nextActions : [],
		message: out ? `wrote ${out}` : scaffold,
		template: 'llmix-preset',
		module: moduleName,
		preset: presetName,
		provider,
		model,
		out,
		written: Boolean(out),
	});
}

export function runValidate(args: string[]) {
	const parsed = parseOptions(args);
	const err = unknownOptions(parsed, ['--target']);
	if (err) return usage('validate', err);
	if (parsed.positional.length !== 1) return usage('validate', 'Expected one file: mda validate <file>');

	const file = parsed.positional[0];
	const requestedTarget = parseTarget(oneOption(parsed.options, '--target') ?? 'auto');
	if (!requestedTarget) return usage('validate', '--target must be source, SKILL.md, AGENTS.md, MCP-SERVER.md, or auto');
	const targetResult = resolveTarget(file, requestedTarget);
	if (!targetResult.ok) return targetResult.result('validate', file);
	const validation = validateArtifact(file, targetResult.target);
	return commandResult(validation.ok, 'validate', validation.ok ? EXIT.ok : EXIT.failure, validation.diagnostics, {
		summary: validation.ok ? `${targetResult.target} validation passed` : `${targetResult.target} validation failed`,
		artifacts: [artifact('validated-artifact', file, targetResult.target)],
		nextActions: validation.ok
			? nextAfterValidate(file, targetResult.target)
			: [
					nextAction(
						'fix-validation',
						'Fix the reported diagnostics and re-run validation',
						`mda validate ${file} --target ${targetResult.target}`,
					),
				],
		file,
		target: targetResult.target,
	});
}

export function runCanonicalize(args: string[], globals: Globals) {
	const parsed = parseOptions(args);
	const err = unknownOptions(parsed, ['--target', '--sidecar']);
	if (err) return usage('canonicalize', err);
	if (parsed.positional.length !== 1) return usage('canonicalize', 'Expected one file: mda canonicalize <file>');

	const file = parsed.positional[0];
	const requestedTarget = parseTarget(oneOption(parsed.options, '--target') ?? 'auto');
	if (!requestedTarget) return usage('canonicalize', '--target must be source, SKILL.md, AGENTS.md, MCP-SERVER.md, or auto');
	const targetResult = resolveTarget(file, requestedTarget);
	if (!targetResult.ok) return targetResult.result('canonicalize', file);
	const sidecar = oneOption(parsed.options, '--sidecar');
	const can = canonicalizeFromFile(file, targetResult.target, sidecar);
	if (!can.ok) {
		return commandResult(false, 'canonicalize', can.exitCode, can.diagnostics, {
			summary: 'Canonicalization failed',
			nextActions: [
				nextAction(
					'fix-canonicalization',
					'Fix the reported diagnostics and retry',
					`mda canonicalize ${file} --target ${targetResult.target}`,
				),
			],
			file,
			target: targetResult.target,
			files: can.files,
		});
	}

	if (!globals.json) {
		process.stdout.write(can.bytes);
		return commandResult(true, 'canonicalize', EXIT.ok, [], { suppressOutput: true });
	}
	return commandResult(true, 'canonicalize', EXIT.ok, [], {
		summary: 'Canonical bytes generated',
		artifacts: [artifact('canonical-bytes', file, targetResult.target)],
		nextActions: [
			nextAction(
				'compute-integrity',
				'Compute an integrity digest for these bytes',
				`mda integrity compute ${file} --target ${targetResult.target}`,
				false,
			),
		],
		file,
		target: targetResult.target,
		files: can.files,
		byteLength: can.bytes.length,
		canonicalBytesBase64: can.bytes.toString('base64'),
	});
}

export function runIntegrity(args: string[]) {
	const sub = args[0];
	if (sub !== 'compute' && sub !== 'verify') return usage('integrity', 'Expected subcommand: integrity compute|verify');
	const parsed = parseOptions(args.slice(1));
	const err = unknownOptions(parsed, ['--target', '--sidecar', '--algorithm', '--write']);
	if (err) return usage(`integrity ${sub}`, err);
	if (parsed.positional.length !== 1) return usage(`integrity ${sub}`, `Expected one file: mda integrity ${sub} <file>`);

	const file = parsed.positional[0];
	const requestedTarget = parseTarget(oneOption(parsed.options, '--target') ?? 'auto');
	if (!requestedTarget) return usage(`integrity ${sub}`, '--target must be source, SKILL.md, AGENTS.md, MCP-SERVER.md, or auto');
	const targetResult = resolveTarget(file, requestedTarget);
	if (!targetResult.ok) return targetResult.result(`integrity ${sub}`, file);
	const sidecar = oneOption(parsed.options, '--sidecar');
	const can = canonicalizeFromFile(file, targetResult.target, sidecar);
	if (!can.ok)
		return commandResult(false, `integrity ${sub}`, can.exitCode, can.diagnostics, {
			summary: `integrity ${sub} failed`,
			nextActions: [
				nextAction(
					'fix-integrity-input',
					'Fix the reported diagnostics and retry',
					`mda integrity ${sub} ${file} --target ${targetResult.target}`,
				),
			],
			file,
			target: targetResult.target,
			files: can.files,
		});

	if (sub === 'compute') {
		if (parsed.flags.has('--write') && parsed.options.has('--sidecar') && targetResult.target !== 'MCP-SERVER.md') {
			return usage('integrity compute', '--sidecar is only valid with MCP-SERVER.md');
		}
		const algorithm = oneOption(parsed.options, '--algorithm') ?? 'sha256';
		if (!DIGEST_ALGORITHMS.has(algorithm)) return usage('integrity compute', `Unsupported algorithm: ${algorithm}`);
		const digest = computeDigest(can.bytes, algorithm);
		if (parsed.flags.has('--write')) {
			const ext = readArtifact(file);
			if (!ext.ok || ext.extract.kind !== 'ok' || !isRecord(ext.extract.frontmatter)) {
				return commandResult(
					false,
					'integrity compute',
					EXIT.failure,
					[diag('missing-required-frontmatter', 'Integrity write requires frontmatter')],
					{
						summary: 'Integrity write failed',
						nextActions: [
							nextAction(
								'fix-frontmatter',
								'Add frontmatter and retry integrity write',
								`mda validate ${file} --target ${targetResult.target}`,
							),
						],
						file,
						target: targetResult.target,
						files: can.files,
					},
				);
			}
			const existing = ext.extract.frontmatter.integrity;
			if (isRecord(existing) && (existing.algorithm !== algorithm || existing.digest !== digest)) {
				return commandResult(
					false,
					'integrity compute',
					EXIT.failure,
					[
						diag(
							'integrity.existing_mismatch',
							'Existing integrity differs from the computed digest; remove it intentionally before rewriting',
						),
					],
					{
						summary: 'Existing integrity does not match computed digest',
						nextActions: [
							nextAction(
								'inspect-integrity',
								'Inspect or remove the stale integrity field before retrying',
								`mda integrity verify ${file} --target ${targetResult.target}`,
							),
						],
						file,
						target: targetResult.target,
						files: can.files,
						algorithm,
						digest,
						written: false,
					},
				);
			}
			let written = false;
			if (!isRecord(existing)) {
				const frontmatter = { ...ext.extract.frontmatter, integrity: { algorithm, digest } };
				try {
					atomicReplace(file, renderArtifact(frontmatter, ext.extract.body));
					written = true;
				} catch (error) {
					return ioError('integrity compute', error instanceof Error ? error.message : String(error), {
						file,
						target: targetResult.target,
						algorithm,
						digest,
						written: false,
					});
				}
			}
			return commandResult(true, 'integrity compute', EXIT.ok, [], {
				summary: written ? `Wrote ${algorithm} integrity` : 'Integrity already matches',
				artifacts: [artifact('integrity-updated', file, targetResult.target, digest)],
				nextActions: [
					nextAction(
						'verify-integrity',
						'Verify the recorded integrity before release',
						`mda integrity verify ${file} --target ${targetResult.target}`,
					),
				],
				message: written ? `wrote integrity to ${file}` : 'integrity already matches',
				file,
				target: targetResult.target,
				files: can.files,
				algorithm,
				digest,
				written,
			});
		}
		return commandResult(true, 'integrity compute', EXIT.ok, [], {
			summary: `Computed ${algorithm} digest`,
			artifacts: [artifact('canonical-digest', file, targetResult.target, digest)],
			nextActions: [
				externalNextAction(
					'record-integrity',
					'Record this digest in the artifact integrity field',
					'update frontmatter.integrity before publishing',
				),
			],
			message: digest,
			file,
			target: targetResult.target,
			files: can.files,
			algorithm,
			digest,
		});
	}

	const ext = readArtifact(file);
	if (!ext.ok || ext.extract.kind !== 'ok' || !isRecord(ext.extract.frontmatter)) {
		return commandResult(
			false,
			'integrity verify',
			EXIT.failure,
			[diag('missing-required-frontmatter', 'Integrity verification requires frontmatter')],
			{
				file,
				target: targetResult.target,
				files: can.files,
			},
		);
	}
	const integrity = ext.extract.frontmatter.integrity;
	if (!isRecord(integrity) || typeof integrity.algorithm !== 'string' || typeof integrity.digest !== 'string') {
		return commandResult(
			false,
			'integrity verify',
			EXIT.failure,
			[diag('missing-required-integrity', 'Artifact has no declared integrity')],
			{
				file,
				target: targetResult.target,
				files: can.files,
			},
		);
	}
	if (!DIGEST_ALGORITHMS.has(integrity.algorithm)) {
		return commandResult(
			false,
			'integrity verify',
			EXIT.failure,
			[diag('unsupported-integrity-algorithm', `Unsupported integrity algorithm: ${integrity.algorithm}`)],
			{
				file,
				target: targetResult.target,
				files: can.files,
				algorithm: integrity.algorithm,
			},
		);
	}
	const expected = computeDigest(can.bytes, integrity.algorithm);
	const ok = expected === integrity.digest;
	return commandResult(
		ok,
		'integrity verify',
		ok ? EXIT.ok : EXIT.failure,
		ok ? [] : [diag('integrity-mismatch', `Declared digest ${integrity.digest} does not match recomputed ${expected}`)],
		{
			summary: ok ? 'Integrity verification passed' : 'Integrity verification failed',
			artifacts: [artifact('verified-artifact', file, targetResult.target, expected)],
			nextActions: ok
				? [
						nextAction(
							'validate-artifact',
							'Validate the artifact before use',
							`mda validate ${file} --target ${targetResult.target}`,
							false,
						),
					]
				: [
						nextAction(
							'recompute-integrity',
							'Recompute the digest after fixing the file',
							`mda integrity compute ${file} --target ${targetResult.target}`,
						),
					],
			file,
			target: targetResult.target,
			files: can.files,
			algorithm: integrity.algorithm,
			expected,
			declared: integrity.digest,
		},
	);
}

export function runCompile(args: string[]) {
	const parsed = parseOptions(args);
	const signingOptions = [
		'--method',
		'--key',
		'--identity',
		'--profile',
		'--did',
		'--key-id',
		'--key-file',
		'--repo',
		'--workflow',
		'--ref',
		'--rekor',
		'--offline-sigstore-fixture',
		'--out',
		'--in-place',
	];
	const err = unknownOptions(parsed, ['--target', '--out-dir', '--integrity', '--manifest', '--strict-compat', ...signingOptions]);
	if (err) return usage('compile', err);
	if (signingOptions.some((option) => parsed.options.has(option) || parsed.flags.has(option))) {
		return usage('compile', 'Compile does not sign artifacts. Run mda sign as a separate explicit step.');
	}
	if (parsed.positional.length !== 1) return usage('compile', 'Expected one source file: mda compile <file.mda> --target <target...>');
	const targets = (parsed.options.get('--target') ?? []).map(normalizeCompileTarget);
	if (targets.length === 0) return usage('compile', '--target <target...> is required');
	if (targets.some((t) => t === null)) return usage('compile', 'Compile targets must be SKILL.md, AGENTS.md, or MCP-SERVER.md');

	const file = parsed.positional[0];
	const sourceValidation = validateArtifact(file, 'source');
	if (!sourceValidation.ok) {
		return commandResult(false, 'compile', EXIT.failure, sourceValidation.diagnostics, {
			summary: 'Source validation failed before compile',
			nextActions: [
				nextAction('validate-source', 'Fix source validation errors and re-run validation', `mda validate ${file} --target source`),
			],
			file,
			target: 'source',
		});
	}
	const read = readArtifact(file);
	if (!read.ok || read.extract.kind !== 'ok' || !isRecord(read.extract.frontmatter)) {
		return commandResult(false, 'compile', EXIT.failure, [diag('missing-required-frontmatter', 'Source must contain frontmatter')], {
			summary: 'Source frontmatter is required before compile',
			nextActions: [
				nextAction('fix-source-frontmatter', 'Add source frontmatter and re-run validation', `mda validate ${file} --target source`),
			],
			file,
			target: 'source',
		});
	}

	const outDir = oneOption(parsed.options, '--out-dir') ?? process.cwd();
	const manifestPath = oneOption(parsed.options, '--manifest');
	const strictCompat = parsed.flags.has('--strict-compat');
	const includeIntegrity = parsed.flags.has('--integrity') || isRecord(read.extract.frontmatter.integrity);
	const staged = compileTargets(read.extract.frontmatter, read.extract.body, targets as Target[], outDir, includeIntegrity);
	if (!staged.ok)
		return commandResult(false, 'compile', EXIT.failure, staged.diagnostics, {
			summary: 'Compile planning failed',
			nextActions: [
				nextAction(
					'fix-compile-input',
					'Fix the reported diagnostics and retry compile',
					`mda compile ${file} --target ${targets.join(' ')} --out-dir ${outDir}`,
				),
			],
			file,
			outDir,
			planned: manifestPath ? [...staged.planned, manifestPath] : staged.planned,
		});

	const compatibilityWarnings = compileCompatibilityWarnings(read.extract.frontmatter, targets as Target[]);
	if (strictCompat && compatibilityWarnings.length > 0) {
		return commandResult(
			false,
			'compile',
			EXIT.failure,
			compatibilityWarnings.map((warning) => ({ ...warning, severity: 'error' })),
			{
				summary: 'Compile compatibility checks failed',
				nextActions: [
					nextAction(
						'fix-compile-compatibility',
						'Resolve compatibility diagnostics or rerun without --strict-compat',
						`mda compile ${file} --target ${targets.join(' ')} --out-dir ${outDir}`,
					),
				],
				file,
				outDir,
				planned: manifestPath ? [...staged.outputs.map((o) => o.path), manifestPath] : staged.outputs.map((o) => o.path),
				written: [],
			},
		);
	}

	const existing = staged.outputs.find((o) => existsSync(o.path));
	if (existing)
		return ioError('compile', `Refusing to overwrite existing file: ${existing.path}`, {
			file,
			outDir,
			planned: staged.outputs.map((o) => o.path),
			written: [],
		});
	if (manifestPath && staged.outputs.some((output) => resolve(output.path) === resolve(manifestPath))) {
		return ioError('compile', `Manifest path conflicts with a compiled output: ${manifestPath}`, {
			file,
			outDir,
			planned: staged.outputs.map((o) => o.path),
			written: [],
		});
	}
	if (manifestPath && existsSync(manifestPath)) {
		return ioError('compile', `Refusing to overwrite existing file: ${manifestPath}`, {
			file,
			outDir,
			planned: [...staged.outputs.map((o) => o.path), manifestPath],
			written: [],
		});
	}

	const sourceDigest = canonicalizeFromFile(file, 'source', null);
	if (!sourceDigest.ok) {
		return commandResult(false, 'compile', sourceDigest.exitCode, sourceDigest.diagnostics, {
			summary: 'Source canonicalization failed before compile manifest generation',
			nextActions: [
				nextAction('fix-source-canonicalization', 'Fix the source and retry compile', `mda compile ${file} --target ${targets.join(' ')}`),
			],
			file,
			outDir,
			planned: staged.outputs.map((o) => o.path),
			written: [],
		});
	}
	const manifest = manifestPath
		? makeCompileManifest(file, sourceDigest.bytes, read.extract.frontmatter, targets as Target[], staged.outputs, compatibilityWarnings)
		: null;

	const written: string[] = [];
	try {
		for (const output of staged.outputs) {
			atomicWrite(output.path, output.bytes);
			written.push(output.path);
		}
		if (manifestPath && manifest) {
			atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
			written.push(manifestPath);
		}
	} catch (error) {
		const rolledBack: string[] = [];
		const rollbackDiagnostics = [];
		for (const path of written) {
			try {
				rmSync(path, { force: true });
				rolledBack.push(path);
			} catch (rollbackError) {
				rollbackDiagnostics.push(
					diag('rollback-error', rollbackError instanceof Error ? rollbackError.message : String(rollbackError), { path }),
				);
			}
		}
		return commandResult(
			false,
			'compile',
			EXIT.io,
			[diag('io-error', error instanceof Error ? error.message : String(error)), ...rollbackDiagnostics],
			{
				summary: 'Compile failed while writing outputs',
				nextActions: [
					nextAction(
						'retry-compile',
						'Fix the filesystem error and retry compile',
						`mda compile ${file} --target ${targets.join(' ')} --out-dir ${outDir}`,
					),
				],
				file,
				outDir,
				planned: manifestPath ? [...staged.outputs.map((o) => o.path), manifestPath] : staged.outputs.map((o) => o.path),
				written,
				rolledBack,
			},
		);
	}

	return commandResult(true, 'compile', EXIT.ok, compatibilityWarnings, {
		summary: `Compiled ${staged.outputs.length} file(s)`,
		artifacts: [
			...staged.outputs.map((o) => artifact('compiled-output', o.path, targetForPath(o.path))),
			...(manifestPath ? [artifact('compile-manifest', manifestPath)] : []),
		],
		nextActions: nextAfterCompile(staged.outputs.map((o) => o.path)),
		message: `wrote ${staged.outputs.length} file(s)`,
		file,
		target: 'source',
		outDir,
		planned: manifestPath ? [...staged.outputs.map((o) => o.path), manifestPath] : staged.outputs.map((o) => o.path),
		written,
	});
}

function makeCompileManifest(
	file: string,
	sourceCanonicalBytes: Buffer,
	frontmatter: Record<string, unknown>,
	targets: Target[],
	outputs: Array<{ path: string; bytes: string }>,
	warnings: Diagnostic[],
) {
	const outputEntries = outputs.map((output) => ({
		path: output.path,
		target: targetForPath(output.path) ?? 'mcp-server-sidecar',
		digest: computeDigest(Buffer.from(output.bytes), 'sha256'),
		byteLength: Buffer.byteLength(output.bytes),
	}));
	return {
		kind: 'mda-compile-manifest',
		version: 1,
		compiler: {
			name: '@markdown-ai/cli',
			version: getCliVersion(),
		},
		source: {
			path: file,
			target: 'source',
			digest: computeDigest(sourceCanonicalBytes, 'sha256'),
		},
		targetProfile: targets,
		outputs: outputEntries,
		outputDigests: Object.fromEntries(outputEntries.map((output) => [output.path, output.digest])),
		emittedScripts: emittedScripts(frontmatter),
		emittedResources: outputEntries,
		capabilitySummary: capabilitySummary(frontmatter),
		signerIdentity: firstSignerIdentity(frontmatter),
		warnings: warnings.map(({ code, message, severity }) => ({ code, message, severity })),
	};
}

function compileCompatibilityWarnings(frontmatter: Record<string, unknown>, targets: Target[]): Diagnostic[] {
	const warnings: Diagnostic[] = [];
	const capabilities = capabilitySummary(frontmatter);
	const warn = (code: string, message: string) => warnings.push({ ...diag(code, message), severity: 'warning' });
	if (frontmatter['allowed-tools'] !== undefined && targets.some((target) => target !== 'SKILL.md')) {
		warn('compat.target_feature_loss', 'allowed-tools is native only for SKILL.md and is moved to a vendor namespace for other targets');
		warn('compat.script_permission_mismatch', 'Compiled non-SKILL targets cannot enforce SKILL.md allowed-tools permissions directly');
	}
	if (capabilities.requires.network !== undefined)
		warn('compat.network_degradation', 'Markdown targets cannot enforce declared network capability requirements');
	if (capabilities.requires.filesystem !== undefined)
		warn('compat.filesystem_degradation', 'Markdown targets cannot enforce declared filesystem capability requirements');
	if (capabilities.requires.shell !== undefined || capabilities.tools.some((tool) => /bash|shell/i.test(tool))) {
		warn('compat.shell_degradation', 'Markdown targets cannot enforce declared shell capability requirements');
	}
	if (capabilities.llmix) {
		warn(
			'compat.unsupported_runtime_policy',
			'LLMix runtime policy must be enforced by LLMix deployment checks, not compiled Markdown alone',
		);
		warn('compat.llmix_namespace_not_consumed', 'General Markdown runtimes do not consume metadata.snoai-llmix directly');
	}
	return warnings;
}

function capabilitySummary(frontmatter: Record<string, unknown>) {
	const metadata = isRecord(frontmatter.metadata) ? frontmatter.metadata : {};
	const mda = isRecord(metadata.mda) ? metadata.mda : {};
	const requires = firstRecord(frontmatter.requires, mda.requires);
	const dependsOn = Array.isArray(frontmatter['depends-on'])
		? frontmatter['depends-on']
		: Array.isArray(mda['depends-on'])
			? mda['depends-on']
			: [];
	const tools = [
		typeof frontmatter['allowed-tools'] === 'string' ? frontmatter['allowed-tools'] : null,
		...stringArray(requires.tools),
	].filter((tool): tool is string => typeof tool === 'string');
	return {
		requires,
		dependsOnCount: dependsOn.length,
		tools,
		llmix: isRecord(metadata['snoai-llmix']),
	};
}

function emittedScripts(frontmatter: Record<string, unknown>) {
	const capabilities = capabilitySummary(frontmatter);
	return capabilities.tools.filter((tool) => /bash|shell|python|node|tsx|ts-node/i.test(tool));
}

function firstSignerIdentity(frontmatter: Record<string, unknown>) {
	if (!Array.isArray(frontmatter.signatures)) return null;
	for (const signature of frontmatter.signatures) {
		if (!isRecord(signature) || typeof signature.signer !== 'string') continue;
		return {
			signer: signature.signer,
			keyId: typeof signature.keyId === 'string' ? signature.keyId : null,
			payloadDigest: typeof signature['payload-digest'] === 'string' ? signature['payload-digest'] : null,
		};
	}
	return null;
}

function firstRecord(...values: unknown[]) {
	for (const value of values) {
		if (isRecord(value)) return value;
	}
	return {};
}

function stringArray(value: unknown) {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
