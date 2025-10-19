import { ICommandManager } from '../interfaces/ICommandManager';
import { BaseAgentService } from './BaseAgentService';
import { ServiceOptions } from '../interfaces/IServiceOptions';

/**
 * Manages simple command execution on sandbox instances
 * For setup commands during redeployment
 */
export class CommandManager extends BaseAgentService implements ICommandManager {
    constructor(
        options: ServiceOptions,
        private maxCommandsHistory: number
    ) {
        super(options);
    }

    /**
     * Execute setup commands (used during redeployment)
     */
    async executeSetupCommands(sandboxInstanceId: string, timeoutMs: number = 60000): Promise<void> {
        const { commandsHistory } = this.getState();
        const logger = this.getLog();
        const client = this.getClient();
        
        if (!commandsHistory || commandsHistory.length === 0) {
            return;
        }

        let cmds = commandsHistory;
        if (cmds.length > this.maxCommandsHistory) {
            // Deduplicate
            cmds = Array.from(new Set(commandsHistory));
        }

        logger.info(`Executing ${cmds.length} setup commands on instance ${sandboxInstanceId}`);

        await this.withTimeout(
            client.executeCommands(sandboxInstanceId, cmds),
            timeoutMs,
            'Command execution timed out'
        );
        
        logger.info('Setup commands executed successfully');
    }

    /**
     * Get command history
     */
    getCommandHistory(): string[] {
        const { commandsHistory } = this.getState();
        return commandsHistory || [];
    }

    /**
     * Add commands to history
     */
    addToHistory(commands: string[]): void {
        const state = this.getState();
        const logger = this.getLog();
        const currentHistory = state.commandsHistory || [];
        
        let combined = [...currentHistory, ...commands];
        
        if (combined.length > this.maxCommandsHistory) {
            // Deduplicate
            combined = Array.from(new Set(combined));
        }

        this.setState({
            ...state,
            commandsHistory: combined
        });

        logger.info(`Added ${commands.length} commands to history`, {
            newHistorySize: combined.length,
            maxSize: this.maxCommandsHistory
        });
    }

    /**
     * Clear command history
     */
    clearHistory(): void {
        const state = this.getState();
        const logger = this.getLog();
        
        this.setState({
            ...state,
            commandsHistory: []
        });

        logger.info('Cleared command history');
    }
}
