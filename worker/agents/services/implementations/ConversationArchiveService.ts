import { ConversationMessage } from '../../inferutils/common';
import { StructuredLogger } from '../../../logger';

interface ArchivedConversation {
    agentId: string;
    archiveId: string;
    archivedAt: string;
    messageCount: number;
    turnCount: number;
    messages: ConversationMessage[];
    summary?: string;
}

export class ConversationArchiveService {
    constructor(private env: Env, private logger: StructuredLogger) {}
    
    /**
     * Archive compacted messages to R2
     * @param agentId - The agent/app ID
     * @param archiveId - The summary message's conversationId
     * @param messages - Messages to archive
     * @param summary - Optional LLM-generated summary text
     */
    async archiveMessages(
        agentId: string,
        archiveId: string,
        messages: ConversationMessage[],
        summary?: string
    ): Promise<void> {
        const key = `convo-archives/${agentId}/${archiveId}.json`;
        
        const archive: ArchivedConversation = {
            agentId,
            archiveId,
            archivedAt: new Date().toISOString(),
            messageCount: messages.length,
            turnCount: messages.filter(m => m.role === 'user').length,
            messages,
            summary
        };
        
        await this.env.TEMPLATES_BUCKET.put(
            key,
            JSON.stringify(archive),
            { 
                httpMetadata: { contentType: 'application/json' },
                customMetadata: {
                    agentId,
                    messageCount: String(messages.length),
                    archivedAt: archive.archivedAt
                }
            }
        );
        
        this.logger.info('Archived conversation segment to R2', {
            agentId,
            archiveId,
            key,
            messageCount: messages.length,
            turnCount: archive.turnCount
        });
    }
    
    /**
     * Retrieve archived messages (future use)
     */
    async retrieveArchive(
        agentId: string, 
        archiveId: string
    ): Promise<ArchivedConversation | null> {
        const key = `convo-archives/${agentId}/${archiveId}.json`;
        const obj = await this.env.TEMPLATES_BUCKET.get(key);
        
        if (!obj) {
            this.logger.warn('Archive not found', { agentId, archiveId, key });
            return null;
        }
        
        return JSON.parse(await obj.text()) as ArchivedConversation;
    }
    
    /**
     * List all archives for an agent (future: UI pagination)
     */
    async listArchives(agentId: string): Promise<string[]> {
        const prefix = `convo-archives/${agentId}/`;
        const list = await this.env.TEMPLATES_BUCKET.list({ prefix });
        return list.objects.map(obj => 
            obj.key.replace(prefix, '').replace('.json', '')
        );
    }
}
