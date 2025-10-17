import Assistant from './assistant';
import {
	createAssistantMessage,
	createSystemMessage,
	createUserMessage,
	Message,
} from '../inferutils/common';
import { executeInference } from '../inferutils/infer';
import { InferenceContext, ModelConfig } from '../inferutils/config.types';
import { createObjectLogger } from '../../logger';
import type { ToolDefinition } from '../tools/types';
import { CodingAgentInterface } from '../services/implementations/CodingAgent';
import { AGENT_CONFIG } from '../inferutils/config';
import { buildDebugTools } from '../tools/customTools';
import { RenderToolCall } from '../operations/UserConversationProcessor';

const SYSTEM_PROMPT = `You are an autonomous code debugging assistant.
Goal: find root-cause fast and apply minimal, surgical fixes.

Use tools to:
- get_logs: fetch runtime errors
- run_analysis: lint + typecheck (optionally scoped to files)
- read_files: read file contents by RELATIVE paths (batch multiple files in one call)
- exec_commands: run shell commands from project root (no cd needed)
- regenerate_file: apply surgical fixes to specific files
- deploy_preview: redeploy when fixes are applied

Context rules (IMPORTANT):
- All file paths are RELATIVE to the project root (sandbox pwd = project directory)
- Commands execute from project root automatically (no cd needed)
- Prefer batching/parallel tool calls (e.g., read multiple files together)

Guardrails:
- Prevent React render loops (state-in-render, missing deps, unstable Zustand selectors)
- Ensure import/export integrity (named vs default)

Strategy: get_logs/run_analysis → read suspect files → apply fixes → verify → repeat until clean
Keep output concise. Act decisively. Stop when errors are cleared or stuck.`;

const USER_PROMPT = (issue: string, fileSummaries: string) => `Issue to debug:
${issue}

Project files (metadata only):
${fileSummaries}

Strategy:
1) get_logs, run_analysis (scope to suspect files when known)
2) locate suspect files; read_files only when needed (RELATIVE paths, batch reads)
3) if fix needed, call regenerate_file with precise issues (minimal diff)
4) recheck errors/analysis; repeat until clean or stuck
Reply concisely with steps taken, findings, and results.`;

export type FileIndexEntry = {
	path: string;
	purpose?: string;
	changes?: string | null;
};

export type DebugSession = {
	filesIndex: FileIndexEntry[];
	agent: CodingAgentInterface;
};

export type DebugInputs = {
	issue: string;
};

function summarizeFiles(files: FileIndexEntry[], max = 120): string {
	const compact = files
		.slice(0, max)
		.map(
			(f) =>
				`- ${f.path}${f.purpose ? ` — ${f.purpose}` : ''}${f.changes ? ` (changes: ${truncate(f.changes, 80)})` : ''}`,
		)
		.join('\n');
	const extra =
		files.length > max ? `\n...and ${files.length - max} more` : '';
	return compact + extra;
}

function truncate(s?: string | null, n: number = 120): string {
	if (!s) return '';
	return s.length > n ? s.slice(0, n) + '…' : s;
}
export class DeepCodeDebugger extends Assistant<Env> {
	logger = createObjectLogger(this, 'DeepCodeDebugger');
	modelConfigOverride?: ModelConfig;

	constructor(
		env: Env,
		inferenceContext: InferenceContext,
		modelConfigOverride?: ModelConfig,
	) {
		super(env, inferenceContext);
		this.modelConfigOverride = modelConfigOverride;
	}

	async run(
		inputs: DebugInputs,
		session: DebugSession,
		streamCb?: (chunk: string) => void,
		toolRenderer?: RenderToolCall,
	): Promise<string> {
		const fileSummaries = summarizeFiles(session.filesIndex);
		const system = createSystemMessage(SYSTEM_PROMPT);
		const user = createUserMessage(
			USER_PROMPT(inputs.issue, fileSummaries),
		);
		const messages: Message[] = this.save([system, user]);

		const logger = this.logger;
		const tools: ToolDefinition<any, any>[] = buildDebugTools(
			session,
			logger,
			toolRenderer,
		);

		const result = await executeInference({
			env: this.env,
			context: this.inferenceContext,
			agentActionName: 'deepDebugger',
			modelConfig: this.modelConfigOverride || AGENT_CONFIG.deepDebugger,
			messages,
			tools,
			stream: streamCb
				? { chunk_size: 64, onChunk: (c) => streamCb(c) }
				: undefined,
			temperature: 0.0,
			reasoning_effort: 'low',
		});

		const out = result?.string || '';
		this.save([createAssistantMessage(out)]);
		return out;
	}
}
