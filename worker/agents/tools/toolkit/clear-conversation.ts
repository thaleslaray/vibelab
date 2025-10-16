import { ToolDefinition } from '../types';
import { StructuredLogger } from '../../../logger';
import { CodingAgentInterface } from 'worker/agents/services/implementations/CodingAgent';

export function createClearConversationTool(
    agent: CodingAgentInterface,
    logger: StructuredLogger
): ToolDefinition<Record<string, never>, null> {
    return {
        type: 'function' as const,
        function: {
            name: 'clear_conversation',
            description: 'Clear the current conversation history for this session.',
            parameters: {
                type: 'object',
                properties: {},
                additionalProperties: false,
                required: [],
            },
        },
        implementation: async () => {
            logger.info('Clearing conversation history');
            agent.clearConversation();
            return null;
        },
    };
}
