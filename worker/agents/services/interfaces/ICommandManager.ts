/**
 * Interface for command execution operations  
 * Handles simple setup command execution and history tracking
 * Note: Complex AI retry logic remains in agent
 */
export interface ICommandManager {
    /**
     * Execute setup commands during redeployment
     */
    executeSetupCommands(sandboxInstanceId: string, timeoutMs?: number): Promise<void>;

    /**
     * Get command history
     */
    getCommandHistory(): string[];

    /**
     * Add commands to history
     */
    addToHistory(commands: string[]): void;

    /**
     * Clear command history
     */
    clearHistory(): void;
}
