import { ToolDefinition, ErrorResult } from '../types';
import { StructuredLogger } from '../../../logger';
import { CodingAgentInterface } from 'worker/agents/services/implementations/CodingAgent';
import { ExecuteCommandsResponse } from 'worker/services/sandbox/sandboxTypes';

export type ExecCommandsArgs = {
	commands: string[];
	shouldSave: boolean;
	timeout?: number;
};

export type ExecCommandsResult = ExecuteCommandsResponse | ErrorResult;

export function createExecCommandsTool(
	agent: CodingAgentInterface,
	logger: StructuredLogger,
): ToolDefinition<ExecCommandsArgs, ExecCommandsResult> {
	return {
		type: 'function' as const,
		function: {
			name: 'exec_commands',
			description:
				'Execute shell commands in the sandbox (e.g., install dependencies). set shouldSave to true if you want the command to be saved in the history so that is executed again in the future. Otherwise, the changes would only persist in the current sandbox session. Always set shouldSave to true for install commands (and always use bun)',
			parameters: {
				type: 'object',
				properties: {
					commands: { type: 'array', items: { type: 'string' } },
					shouldSave: { type: 'boolean', default: true },
					timeout: { type: 'number' },
				},
				required: ['commands'],
			},
		},
		implementation: async ({ commands, shouldSave = true, timeout }) => {
			try {
				logger.info('Executing commands', {
					count: commands.length,
					timeout,
				});
				return await agent.execCommands(commands, shouldSave, timeout);
			} catch (error) {
				return {
					error:
						error instanceof Error
							? `Failed to execute commands: ${error.message}`
							: 'Unknown error occurred while executing commands',
				};
			}
		},
	};
}
