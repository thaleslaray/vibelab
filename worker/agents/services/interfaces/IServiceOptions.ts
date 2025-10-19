import { IStateManager } from './IStateManager';
import { IFileManager } from './IFileManager';
import { BaseSandboxService } from '../../../services/sandbox/BaseSandboxService';
import { StructuredLogger } from '../../../logger';

/**
 * Common options for all agent services
 */
export interface ServiceOptions {
    stateManager: IStateManager;
    fileManager: IFileManager;
    getSandboxClient: () => BaseSandboxService;
    getLogger: () => StructuredLogger;
}
