import { ToolDefinition, ErrorResult } from '../types';
import { StructuredLogger } from '../../../logger';
import { CodingAgentInterface } from 'worker/agents/services/implementations/CodingAgent';

export type RegenerateFileArgs = {
	path: string;
	issues: string[];
};

export type RegenerateFileResult =
	| { path: string; updatedPreview: string }
	| ErrorResult;

export function createRegenerateFileTool(
	agent: CodingAgentInterface,
	logger: StructuredLogger,
): ToolDefinition<RegenerateFileArgs, RegenerateFileResult> {
	return {
		type: 'function' as const,
		function: {
			name: 'regenerate_file',
			description:
				'Apply a surgical fix to a file (search/replace style) using internal regeneration operation, then persist changes.',
			parameters: {
				type: 'object',
				properties: {
					path: { type: 'string' },
					issues: { type: 'array', items: { type: 'string' } },
				},
				required: ['path', 'issues'],
			},
		},
		implementation: async ({ path, issues }) => {
			try {
				logger.info('Regenerating file', {
					path,
					issuesCount: issues.length,
				});
				return await agent.regenerateFile(path, issues);
			} catch (error) {
				return {
					error:
						error instanceof Error
							? `Failed to regenerate file: ${error.message}`
							: 'Unknown error occurred while regenerating file',
				};
			}
		},
	};
}
