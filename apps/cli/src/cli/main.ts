import { EXIT, commandResult, diag, usage, type CommandResult, type Globals } from '../types.js';
import { HELP } from './help.js';
import { runCanonicalize, runCompile, runDemo, runInit, runIntegrity, runValidate } from './core-commands.js';
import { runConformance } from './conformance-command.js';
import { runDoctor, runLlmix, runRelease } from './llmix-commands.js';
import { runSign, runVerify } from './security-commands.js';
import { splitGlobals, writeResult } from './shared.js';
import { getCliVersion } from './version.js';

export async function main(): Promise<void> {
	const { globals, args } = splitGlobals(process.argv.slice(2));
	try {
		if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
			process.stdout.write(HELP);
			process.exit(EXIT.ok);
		}
		if (args.length === 1 && (args[0] === '--version' || args[0] === '-v')) {
			const version = getCliVersion();
			writeResult(
				commandResult(true, 'version', EXIT.ok, [], {
					summary: `@markdown-ai/cli ${version}`,
					message: version,
					version,
				}),
				globals,
			);
			process.exit(EXIT.ok);
		}

		const command = args[0];
		const rest = args.slice(1);
		const result = await runCommand(command, rest, globals);
		writeResult(result, globals);
		process.exit(result.exitCode);
	} catch (error) {
		const result = commandResult(false, 'internal', EXIT.internal, [
			diag('internal-error', error instanceof Error ? error.message : String(error)),
		]);
		writeResult(result, globals);
		process.exit(result.exitCode);
	}
}

async function runCommand(command: string, args: string[], globals: Globals): Promise<CommandResult> {
	if (command === 'init') return runInit(args, globals);
	if (command === 'demo') return runDemo(args);
	if (command === 'validate') return runValidate(args);
	if (command === 'compile') return runCompile(args);
	if (command === 'canonicalize') return runCanonicalize(args, globals);
	if (command === 'integrity') return runIntegrity(args);
	if (command === 'verify') return runVerify(args);
	if (command === 'sign') return runSign(args);
	if (command === 'release') return runRelease(args);
	if (command === 'llmix') return runLlmix(args);
	if (command === 'doctor') return runDoctor(args);
	if (command === 'conformance') return runConformance(args);
	return usage('root', `Unknown command: ${command}`);
}
