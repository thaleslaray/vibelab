import { ToolDefinition } from '../types';
import { StructuredLogger } from '../../../logger';
import { CodingAgentInterface } from 'worker/agents/services/implementations/CodingAgent';
import { DeepCodeDebugger } from 'worker/agents/assistants/codeDebugger';
import { RenderToolCall } from '../../operations/UserConversationProcessor';

export function createDeepDebuggerTool(
	agent: CodingAgentInterface,
	logger: StructuredLogger,
	streamCb?: (message: string) => void,
	toolRenderer?: RenderToolCall,
): ToolDefinition<
	{ issue: string; focus_paths?: string[] },
	{ transcript: string } | { error: string }
> {
	return {
		type: 'function',
		function: {
			name: 'deep_debug',
			description:
				'Autonomous debugging assistant that investigates errors, reads files, and applies fixes. CANNOT run during code generation - will return GENERATION_IN_PROGRESS error if generation is active.',
			parameters: {
				type: 'object',
				properties: {
					issue: { type: 'string' },
					focus_paths: { type: 'array', items: { type: 'string' } },
				},
				required: ['issue'],
			},
		},
		implementation: async ({ issue, focus_paths }: { issue: string; focus_paths?: string[] }) => {
			try {
				// Check if code generation is in progress
				if (agent.isCodeGenerating()) {
					logger.warn('Cannot start debugging: Code generation in progress');
					return {
						error: 'GENERATION_IN_PROGRESS: Code generation is currently running. Use wait_for_generation tool, then retry deep_debug.'
					};
				}

				const operationOptions = agent.getOperationOptions();
				const filesIndex = operationOptions.context.allFiles
					.filter((f) =>
						!focus_paths?.length ||
						focus_paths.some((p) => f.filePath.includes(p)),
					);

				const runtimeErrors = await agent.fetchRuntimeErrors(true);

				const dbg = new DeepCodeDebugger(
					operationOptions.env,
					operationOptions.inferenceContext,
				);
				const out = await dbg.run(
					{ issue },
					{ filesIndex, agent, runtimeErrors },
					streamCb ? (chunk) => streamCb(chunk) : undefined,
					toolRenderer,
				);
				return { transcript: out };
			} catch (e) {
				logger.error('Deep debugger failed', e);
				return { error: `Deep debugger failed: ${String(e)}` };
			}
		},
	};
}
