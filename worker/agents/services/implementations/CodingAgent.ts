import { ProcessedImageAttachment } from "worker/types/image-attachment";
import { Blueprint } from "worker/agents/schemas";
import { ExecuteCommandsResponse, StaticAnalysisResponse } from "worker/services/sandbox/sandboxTypes";
import { ICodingAgent } from "../interfaces/ICodingAgent";
import { OperationOptions } from "worker/agents/operations/common";

/*
* CodingAgentInterface - stub for passing to tool calls
*/
export class CodingAgentInterface {
    agentStub: ICodingAgent;
    constructor (agentStub: ICodingAgent) {
        this.agentStub = agentStub;
    }

    getLogs(reset?: boolean): Promise<string> {
        return this.agentStub.getLogs(reset);
    }

    async deployPreview(): Promise<string> {
        const response = await this.agentStub.deployToSandbox([], false);
        if (response && response.previewURL) {
            return `Deployment successful: ${response.previewURL}`;
        } else {
            return `Failed to deploy: ${response?.tunnelURL}`;
        }
    }

    async deployToCloudflare(): Promise<string> {
        const response = await this.agentStub.deployToCloudflare();
        if (response && response.deploymentUrl) {
            return `Deployment successful: ${response.deploymentUrl}`;
        } else {
            return `Failed to deploy: ${response?.workersUrl}`;
        }
    }

    queueRequest(request: string, images?: ProcessedImageAttachment[]): void {
        this.agentStub.queueUserRequest(request, images);
    }

    clearConversation(): void {
        this.agentStub.clearConversation();
    }

    getOperationOptions(): OperationOptions {
        return this.agentStub.getOperationOptions();
    }

    updateProjectName(newName: string): Promise<boolean> {
        return this.agentStub.updateProjectName(newName);
    }

    updateBlueprint(patch: Partial<Blueprint>): Promise<Blueprint> {
        return this.agentStub.updateBlueprint(patch);
    }

    // Generic debugging helpers — delegate to underlying agent
    readFiles(paths: string[]): Promise<{ files: { path: string; content: string }[] }> {
        return this.agentStub.readFiles(paths);
    }

    runStaticAnalysisCode(files?: string[]): Promise<StaticAnalysisResponse> {
        return this.agentStub.runStaticAnalysisCode(files);
    }

    execCommands(commands: string[], timeout?: number): Promise<ExecuteCommandsResponse> {
        return this.agentStub.execCommands(commands, timeout);
    }

    // Exposes a simplified regenerate API for tools
    regenerateFile(path: string, issues: string[]): Promise<{ path: string; updatedPreview: string }> {
        return this.agentStub.regenerateFileByPath(path, issues);
    }
}
