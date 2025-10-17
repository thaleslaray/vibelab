import { ErrorResult, ToolDefinition } from '../types';
import { StructuredLogger } from '../../../logger';
import { CodingAgentInterface } from 'worker/agents/services/implementations/CodingAgent';

type GetLogsArgs = {
	reset?: boolean;
	durationSeconds?: number;
};

type GetLogsResult = { logs: string } | ErrorResult;

export function createGetLogsTool(
	agent: CodingAgentInterface,
	logger: StructuredLogger
): ToolDefinition<GetLogsArgs, GetLogsResult> {
	return {
		type: 'function' as const,
		function: {
			name: 'get_logs',
			description:
				`Get the current application/server logs from the sandbox environment. Useful for debugging runtime issues, checking console output, or investigating errors. Clears logs every time when called. App\'s browser console warn/error messages are also piped here.
All unread logs would be streamed, so you need to match timestamps on your own to understand things.

IMPORTANT: Logs are USER-DRIVEN - they only appear when the user interacts with the app (clicks buttons, navigates pages, etc.). 

CRITICAL PATTERN:
- After deploy_preview: DO NOT immediately call get_logs
- Instead, if logs are needed: Call wait(20-30 seconds, "Waiting for user to interact with app")
- Then: Call get_logs to check results
- If logs are empty, it means user hasn't interacted yet - ask them to interact and wait longer

If logs are not needed, don't call this.

If you can't wait for user interaction, use static analysis (run_analysis) instead.`,
			parameters: {
				type: 'object',
				properties: {
					durationSeconds: {
						type: 'number',
						description: 'Optional: Filter logs to only show entries from the last N seconds. If not specified, returns all logs till date. Useful to reduce noise when you only need recent activity.',
					},
				},
				required: [],
			},
		},
		implementation: async (args?) => {
			try {
				logger.info('Fetching application logs', { durationSeconds: args?.durationSeconds });
				const logs = await agent.getLogs(false, args?.durationSeconds);
				return { logs };
			} catch (error) {
				return {
					error:
						error instanceof Error
							? `Failed to get logs: ${error.message}`
							: 'Unknown error occurred while fetching logs',
				};
			}
		},
	};
}
