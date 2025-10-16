import { ToolDefinition } from '../types';
import { StructuredLogger } from '../../../logger';
import { CodingAgentInterface } from 'worker/agents/services/implementations/CodingAgent';
import {
	DeepCodeDebugger,
	type FileIndexEntry,
} from 'worker/agents/assistants/codeDebugger';
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
				'Autonomous deep debugging assistant. Investigates runtime errors and static analysis, reads targeted files (relative paths), runs commands (in project root, no cd), and applies surgical fixes via regenerate_file. Returns a concise transcript.',
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
				const operationOptions = agent.getOperationOptions();
				const filesIndex: FileIndexEntry[] =
					operationOptions.context.allFiles
						.map((f) => ({
							path: f.filePath,
							purpose: f.filePurpose,
							changes:
								f.lastDiff ||
								(Array.isArray(f.unmerged) && f.unmerged.length
									? f.unmerged.join('\n')
									: null),
						}))
						.filter(
							(f) =>
								!focus_paths?.length ||
								focus_paths.some((p) => f.path.includes(p)),
						);

				const dbg = new DeepCodeDebugger(
					operationOptions.env,
					operationOptions.inferenceContext,
				);
				const transcript = await dbg.run(
					{ issue },
					{ filesIndex, agent },
					streamCb ? (chunk) => streamCb(chunk) : undefined,
					toolRenderer,
				);
				return { transcript };
			} catch (e) {
				logger.error('Deep debugger failed', e);
				return { error: `Deep debugger failed: ${String(e)}` };
			}
		},
	};
}
