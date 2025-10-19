import { IStateManager } from '../interfaces/IStateManager';
import { IFileManager } from '../interfaces/IFileManager';
import { BaseSandboxService } from '../../../services/sandbox/BaseSandboxService';
import { StructuredLogger } from '../../../logger';
import { ServiceOptions } from '../interfaces/IServiceOptions';

/**
 * Base class for all agent services
 * Provides common dependencies and DO-compatible access patterns
 */
export abstract class BaseAgentService {
    protected readonly stateManager: IStateManager;
    protected readonly fileManager: IFileManager;
    protected readonly getSandboxClient: () => BaseSandboxService;
    protected readonly getLogger: () => StructuredLogger;

    constructor(options: ServiceOptions) {
        this.stateManager = options.stateManager;
        this.fileManager = options.fileManager;
        this.getSandboxClient = options.getSandboxClient;
        this.getLogger = options.getLogger;
    }

    /**
     * Get current agent state
     */
    protected getState() {
        return this.stateManager.getState();
    }

    /**
     * Update agent state
     */
    protected setState(newState: ReturnType<IStateManager['getState']>) {
        this.stateManager.setState(newState);
    }

    /**
     * Get fresh sandbox client instance (DO-compatible)
     */
    protected getClient(): BaseSandboxService {
        return this.getSandboxClient();
    }

    /**
     * Get fresh logger instance (DO-compatible)
     */
    protected getLog(): StructuredLogger {
        return this.getLogger();
    }

    /**
     * Execute an operation with a timeout
     */
    protected async withTimeout<T>(
        operation: Promise<T>,
        timeoutMs: number,
        errorMsg: string,
        onTimeout?: () => void
    ): Promise<T> {
        return Promise.race([
            operation,
            new Promise<never>((_, reject) =>
                setTimeout(() => {
                    onTimeout?.();
                    reject(new Error(errorMsg));
                }, timeoutMs)
            )
        ]);
    }
}
