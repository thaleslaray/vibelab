import { FileOutputType, Blueprint } from "worker/agents/schemas";
import { BaseSandboxService } from "worker/services/sandbox/BaseSandboxService";
import { ExecuteCommandsResponse, PreviewType, StaticAnalysisResponse, RuntimeError } from "worker/services/sandbox/sandboxTypes";
import { ProcessedImageAttachment } from "worker/types/image-attachment";
import { OperationOptions } from "worker/agents/operations/common";
import { RenderToolCall } from "worker/agents/operations/UserConversationProcessor";
import { DeepDebugResult } from "worker/agents/core/types";

export abstract class ICodingAgent {
    abstract getSandboxServiceClient(): BaseSandboxService;

    abstract deployToSandbox(files: FileOutputType[], redeploy: boolean, commitMessage?: string): Promise<PreviewType | null>;

    abstract deployToCloudflare(): Promise<{ deploymentUrl?: string; workersUrl?: string } | null>;

    abstract getLogs(reset?: boolean, durationSeconds?: number): Promise<string>;

    abstract queueUserRequest(request: string, images?: ProcessedImageAttachment[]): void;

    abstract clearConversation(): void;

    abstract updateProjectName(newName: string): Promise<boolean>;

    abstract updateBlueprint(patch: Partial<Blueprint>): Promise<Blueprint>;

    abstract getOperationOptions(): OperationOptions;

    abstract readFiles(paths: string[]): Promise<{ files: { path: string; content: string }[] }>;

    abstract runStaticAnalysisCode(files?: string[]): Promise<StaticAnalysisResponse>;

    abstract execCommands(commands: string[], timeout?: number): Promise<ExecuteCommandsResponse>;
    
    abstract regenerateFileByPath(path: string, issues: string[]): Promise<{ path: string; diff: string }>;

    abstract fetchRuntimeErrors(clear?: boolean): Promise<RuntimeError[]>;

    abstract isCodeGenerating(): boolean;

    abstract waitForGeneration(): Promise<void>;

    abstract isDeepDebugging(): boolean;

    abstract waitForDeepDebug(): Promise<void>;

    abstract executeDeepDebug(
        issue: string,
        focusPaths?: string[],
        toolRenderer?: RenderToolCall
    ): Promise<DeepDebugResult>;
}
