import { 
    IDeploymentManager, 
    DeploymentParams, 
    DeploymentResult,
    SandboxDeploymentCallbacks,
    CloudflareDeploymentCallbacks
} from '../interfaces/IDeploymentManager';
import { BootstrapResponse, GitHubPushRequest, StaticAnalysisResponse, RuntimeError, PreviewType } from '../../../services/sandbox/sandboxTypes';
import { GitHubExportResult } from '../../../services/github/types';
import { FileOutputType } from '../../schemas';
import { generateId } from '../../../utils/idGenerator';
import { generateAppProxyToken, generateAppProxyUrl } from '../../../services/aigateway-proxy/controller';
import { BaseAgentService } from './BaseAgentService';
import { ServiceOptions } from '../interfaces/IServiceOptions';

const MAX_DEPLOYMENT_RETRIES = 3;
const DEPLOYMENT_TIMEOUT_MS = 60000;
const HEALTH_CHECK_INTERVAL_MS = 30000;

/**
 * Manages deployment operations for sandbox instances
 * Handles instance creation, file deployment, analysis, and GitHub/Cloudflare export
 * Also manages sessionId and health check intervals
 */
export class DeploymentManager extends BaseAgentService implements IDeploymentManager {
    private healthCheckInterval: ReturnType<typeof setInterval> | null = null;
    private currentDeploymentPromise: Promise<PreviewType | null> | null = null;

    constructor(
        options: ServiceOptions,
        private env: Env,
        private projectNamePrefixMaxLength: number
    ) {
        super(options);
        
        // Ensure state has sessionId
        const state = this.getState();
        if (!state.sessionId) {
            this.setState({
                ...state,
                sessionId: this.generateNewSessionId()
            });
        }
    }

    /**
     * Get current session ID from state
     */
    getSessionId(): string {
        return this.getState().sessionId;
    }

    /**
     * Reset session ID (called on timeout or specific errors)
     */
    resetSessionId(): void {
        const logger = this.getLog();
        const state = this.getState();
        const oldSessionId = state.sessionId;
        const newSessionId = this.generateNewSessionId();
        
        logger.info(`SessionId reset: ${oldSessionId} → ${newSessionId}`);
        
        // Update state
        this.setState({
            ...state,
            sessionId: newSessionId,
            sandboxInstanceId: undefined  // Clear instance on session reset
        });
    }

    private generateNewSessionId(): string {
        return generateId();
    }

    /**
     * Wait for preview to be ready
     */
    async waitForPreview(): Promise<void> {
        const state = this.getState();
        const logger = this.getLog();
        
        logger.info("Waiting for preview");
        
        if (!state.sandboxInstanceId) {
            logger.info("No sandbox instance, will create during next deploy");
        }
        
        logger.info("Waiting for preview completed");
    }

    /**
     * Start health check interval for instance
     */
    private startHealthCheckInterval(instanceId: string): void {
        const logger = this.getLog();
        
        // Clear any existing interval
        this.clearHealthCheckInterval();
        
        logger.info(`Starting health check interval for instance ${instanceId}`);
        
        this.healthCheckInterval = setInterval(async () => {
            try {
                const client = this.getClient();
                const status = await client.getInstanceStatus(instanceId);
                
                if (!status.success || !status.isHealthy) {
                    logger.warn(`Instance ${instanceId} unhealthy, clearing interval`);
                    this.clearHealthCheckInterval();
                }
            } catch (error) {
                logger.error('Health check failed:', error);
            }
        }, HEALTH_CHECK_INTERVAL_MS);
    }

    private clearHealthCheckInterval(): void {
        if (this.healthCheckInterval !== null) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
    }

    /**
     * Run static analysis (lint + typecheck) on code
     */
    async runStaticAnalysis(files?: string[]): Promise<StaticAnalysisResponse> {
        const { sandboxInstanceId } = this.getState();

        if (!sandboxInstanceId) {
            throw new Error('No sandbox instance available for static analysis');
        }

        const logger = this.getLog();
        const client = this.getClient();

        logger.info(`Linting code in sandbox instance ${sandboxInstanceId}`);

        const targetFiles = Array.isArray(files) && files.length > 0
            ? files
            : this.fileManager.getGeneratedFilePaths();

        const analysisResponse = await client.runStaticAnalysisCode(
            sandboxInstanceId,
            targetFiles
        );

        if (!analysisResponse || analysisResponse.error) {
            const errorMsg = `Code linting failed: ${analysisResponse?.error || 'Unknown error'}`;
            logger.error(errorMsg, { fullResponse: analysisResponse });
            throw new Error(errorMsg);
        }

        const { lint, typecheck } = analysisResponse;
        const { issues: lintIssues, summary: lintSummary } = lint;
        const { issues: typeCheckIssues, summary: typeCheckSummary } = typecheck;

        logger.info(`Linting found ${lintIssues.length} issues: ` +
            `${lintSummary?.errorCount || 0} errors, ` +
            `${lintSummary?.warningCount || 0} warnings, ` +
            `${lintSummary?.infoCount || 0} info`);

        logger.info(`Type checking found ${typeCheckIssues.length} issues: ` +
            `${typeCheckSummary?.errorCount || 0} errors, ` +
            `${typeCheckSummary?.warningCount || 0} warnings, ` +
            `${typeCheckSummary?.infoCount || 0} info`);

        return analysisResponse;
    }

    /**
     * Fetch runtime errors from sandbox instance
     */
    async fetchRuntimeErrors(clear: boolean = true): Promise<RuntimeError[]> {
        const { sandboxInstanceId } = this.getState();
        const logger = this.getLog();
        const client = this.getClient();

        if (!sandboxInstanceId) {
            throw new Error('No sandbox instance available for runtime error fetching');
        }

        const resp = await client.getInstanceErrors(sandboxInstanceId, clear);
            
        if (!resp || !resp.success) {
            throw new Error(`Failed to fetch runtime errors: ${resp?.error || 'Unknown error'}`);
        }

        const errors = resp.errors || [];
            
        if (errors.length > 0) {
            logger.info(`Found ${errors.length} runtime errors: ${errors.map(e => e.message).join(', ')}`);
        }

        return errors;
    }

    /**
     * Main deployment method
     * Callbacks allow agent to broadcast at the right times
     */
    async deployToSandbox(
        files: FileOutputType[] = [],
        redeploy: boolean = false,
        commitMessage?: string,
        clearLogs: boolean = false,
        callbacks?: SandboxDeploymentCallbacks
    ): Promise<PreviewType | null> {
        const logger = this.getLog();
        
        // Queue management - prevent concurrent deployments
        if (this.currentDeploymentPromise) {
            logger.info('Deployment already in progress, waiting for completion');
            try {
                const result = await this.currentDeploymentPromise;
                if (result) {
                    logger.info('Previous deployment completed successfully, returning its result');
                    return result;
                }
            } catch (error) {
                logger.warn('Previous deployment failed, proceeding with new deployment:', error);
            }
            return null;
        }

        logger.info("Deploying to sandbox", { files: files.length, redeploy, commitMessage, sessionId: this.getSessionId() });

        // Create deployment promise
        this.currentDeploymentPromise = this.executeDeploymentWithRetry(
            files,
            redeploy,
            commitMessage,
            clearLogs,
            MAX_DEPLOYMENT_RETRIES,
            callbacks
        );

        try {
            // Wrap with timeout
            const result = await this.withTimeout(
                this.currentDeploymentPromise,
                DEPLOYMENT_TIMEOUT_MS,
                'Deployment timed out',
                () => {
                    logger.warn('Deployment timed out, resetting sessionId to provision new sandbox instance');
                    this.resetSessionId();
                }
            );
            return result;
        } finally {
            this.currentDeploymentPromise = null;
        }
    }

    /**
     * Execute deployment with retry logic
     * Handles error-specific sessionId reset and exponential backoff
     */
    private async executeDeploymentWithRetry(
        files: FileOutputType[],
        redeploy: boolean,
        commitMessage: string | undefined,
        clearLogs: boolean,
        retries: number,
        callbacks?: SandboxDeploymentCallbacks
    ): Promise<PreviewType | null> {
        const logger = this.getLog();

        try {
            // Callback: deployment actually starting now
            callbacks?.onStarted?.({
                message: "Deploying code to sandbox service",
                files: files.map(f => ({ filePath: f.filePath }))
            });

            logger.info('Deploying code to sandbox service');

            // Core deployment
            const result = await this.deploy({
                files,
                redeploy,
                commitMessage,
                clearLogs
            });

            // Start health check after successful deployment
            if (result.redeployed) {
                this.startHealthCheckInterval(result.sandboxInstanceId);
            }

            const preview = {
                runId: result.sandboxInstanceId,
                previewURL: result.previewURL,
                tunnelURL: result.tunnelURL
            };

            // Callback: deployment completed
            callbacks?.onCompleted?.({
                message: "Deployment completed",
                instanceId: preview.runId,
                previewURL: preview.previewURL ?? '',
                tunnelURL: preview.tunnelURL ?? ''
            });

            return preview;
        } catch (error) {
            logger.error("Error deploying to sandbox service:", error, { 
                sessionId: this.getSessionId(), 
                sandboxInstanceId: this.getState().sandboxInstanceId 
            });

            const errorMsg = error instanceof Error ? error.message : String(error);

            // Handle specific errors that require session reset
            if (errorMsg.includes('Network connection lost') || 
                errorMsg.includes('Container service disconnected') || 
                errorMsg.includes('Internal error in Durable Object storage')) {
                logger.warn('Session-level error detected, resetting sessionId');
                this.resetSessionId();
            }

            // Clear instance ID from state
            const state = this.getState();
            this.setState({
                ...state,
                sandboxInstanceId: undefined
            });

            // Retry logic with exponential backoff
            if (retries > 0) {
                logger.info(`Retrying deployment, ${retries} attempts remaining`);
                
                // Exponential backoff
                await new Promise(resolve => 
                    setTimeout(resolve, Math.pow(2, MAX_DEPLOYMENT_RETRIES - retries) * 1000)
                );

                return this.executeDeploymentWithRetry(
                    files,
                    redeploy,
                    commitMessage,
                    clearLogs,
                    retries - 1,
                    callbacks
                );
            }

            // Callback: deployment failed after all retries
            logger.error('Deployment failed after all retries');
            callbacks?.onError?.({
                error: `Error deploying to sandbox service: ${errorMsg}. Please report an issue if this persists`
            });
            
            return null;
        }
    }

    /**
     * Deploy files to sandbox instance (core deployment)
     */
    private async deploy(params: DeploymentParams): Promise<DeploymentResult> {
        const { files, redeploy, commitMessage, clearLogs } = params;
        const logger = this.getLog();
        const client = this.getClient();
        
        logger.info("Deploying code to sandbox service");

        // Ensure instance exists and is healthy
        const instanceResult = await this.ensureInstance(redeploy);
        const { sandboxInstanceId, previewURL, tunnelURL, redeployed } = instanceResult;

        // Determine which files to deploy
        const filesToWrite = this.getFilesToDeploy(files, redeployed);

        // Write files if any
        if (filesToWrite.length > 0) {
            const writeResponse = await client.writeFiles(
                sandboxInstanceId,
                filesToWrite,
                commitMessage
            );
            
            if (!writeResponse || !writeResponse.success) {
                logger.error(`File writing failed. Error: ${writeResponse?.error}`);
                throw new Error(`File writing failed. Error: ${writeResponse?.error}`);
            }
        }

        // Clear logs if requested
        if (clearLogs) {
            try {
                logger.info('Clearing logs and runtime errors for instance', { instanceId: sandboxInstanceId });
                await Promise.all([
                    client.getLogs(sandboxInstanceId, true),
                    client.clearInstanceErrors(sandboxInstanceId)
                ]);
            } catch (error) {
                logger.error('Failed to clear logs and runtime errors', error);
            }
        }

        return {
            sandboxInstanceId,
            previewURL,
            tunnelURL,
            redeployed
        };
    }

    /**
     * Ensure sandbox instance exists and is healthy
     */
    async ensureInstance(redeploy: boolean): Promise<DeploymentResult> {
        const state = this.getState();
        const { sandboxInstanceId } = state;
        const logger = this.getLog();
        const client = this.getClient();

        // Check existing instance if not forcing redeploy
        if (sandboxInstanceId && !redeploy) {
            const status = await client.getInstanceStatus(sandboxInstanceId);
            if (status.success && status.isHealthy) {
                logger.info(`DEPLOYMENT CHECK PASSED: Instance ${sandboxInstanceId} is running`);
                return {
                    sandboxInstanceId,
                    previewURL: status.previewURL,
                    tunnelURL: status.tunnelURL,
                    redeployed: false
                };
            }
            logger.error(`DEPLOYMENT CHECK FAILED: Failed to get status for instance ${sandboxInstanceId}, redeploying...`);
        }

        const results = await this.createNewInstance();
        if (!results || !results.runId || !results.previewURL) {
            throw new Error('Failed to create new deployment');
        }

        // Update state with new instance ID
        this.setState({
            ...state,
            sandboxInstanceId: results.runId,
        });

        return {
            sandboxInstanceId: results.runId,
            previewURL: results.previewURL,
            tunnelURL: results.tunnelURL,
            redeployed: true
        };
    }


    /**
     * Create new sandbox instance
     */
    private async createNewInstance(): Promise<BootstrapResponse | null> {
        const state = this.getState();
        const templateName = state.templateDetails?.name || 'scratch';
        
        // Generate unique project name
        let prefix = (state.blueprint?.projectName || templateName)
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '-');
        const uniqueSuffix = generateId();
        prefix = prefix.slice(0, this.projectNamePrefixMaxLength);
        const projectName = `${prefix}-${uniqueSuffix}`.toLowerCase();
        
        // Webhook URL will be passed from agent
        // Agent generates it using getProtocolForHost and getAgentId()

        // Add AI proxy vars if AI template
        let localEnvVars: Record<string, string> = {};
        if (state.templateDetails?.name?.includes('agents')) {
            localEnvVars = {
                "CF_AI_BASE_URL": generateAppProxyUrl(this.env),
                "CF_AI_API_KEY": await generateAppProxyToken(
                    state.inferenceContext.agentId,
                    state.inferenceContext.userId,
                    this.env
                )
            };
        }
        
        // Create instance
        const client = this.getClient();
        const logger = this.getLog();
        
        const createResponse = await client.createInstance(
            templateName,
            `v1-${projectName}`,
            undefined,
            localEnvVars
        );
        
        if (!createResponse || !createResponse.success || !createResponse.runId) {
            throw new Error(`Failed to create sandbox instance: ${createResponse?.error || 'Unknown error'}`);
        }

        logger.info(`Created sandbox instance`, {
            runId: createResponse.runId,
            previewURL: createResponse.previewURL
        });

        if (createResponse.runId && createResponse.previewURL) {
            return createResponse;
        }

        throw new Error(`Failed to create sandbox instance: ${createResponse?.error || 'Unknown error'}`);
    }

    /**
     * Determine which files to deploy
     */
    private getFilesToDeploy(
        requestedFiles: FileOutputType[],
        redeployed: boolean
    ): Array<{ filePath: string; fileContents: string }> {
        const state = this.getState();
        
        // If no files requested or redeploying, use all generated files from state
        if (!requestedFiles || requestedFiles.length === 0 || redeployed) {
            requestedFiles = Object.values(state.generatedFilesMap);
        }

        return requestedFiles.map(file => ({
            filePath: file.filePath,
            fileContents: file.fileContents
        }));
    }
    
    /**
     * Deploy to Cloudflare Workers
     * Returns deployment URL and deployment ID for database updates
     */
    async deployToCloudflare(callbacks?: CloudflareDeploymentCallbacks): Promise<{ deploymentUrl: string | null; deploymentId?: string }> {
        const state = this.getState();
        const logger = this.getLog();
        const client = this.getClient();
        
        await this.waitForPreview();
        
        callbacks?.onStarted?.({
            message: 'Starting deployment to Cloudflare Workers...',
            instanceId: state.sandboxInstanceId ?? ''
        });
        
        logger.info('Starting Cloudflare deployment');

        // Check if we have generated files
        if (!state.generatedFilesMap || Object.keys(state.generatedFilesMap).length === 0) {
            logger.error('No generated files available for deployment');
            callbacks?.onError?.({
                message: 'Deployment failed: No generated code available',
                instanceId: state.sandboxInstanceId ?? '',
                error: 'No files have been generated yet'
            });
            return { deploymentUrl: null };
        }

        // Ensure sandbox instance exists - return null to trigger agent orchestration
        if (!state.sandboxInstanceId) {
            logger.info('No sandbox instance ID available');
            return { deploymentUrl: null };
        }

        logger.info('Prerequisites met, initiating deployment', {
            sandboxInstanceId: state.sandboxInstanceId,
            fileCount: Object.keys(state.generatedFilesMap).length
        });

        // Deploy to Cloudflare
        const deploymentResult = await client.deployToCloudflareWorkers(
            state.sandboxInstanceId
        );

        logger.info('Deployment result:', deploymentResult);

        if (!deploymentResult || !deploymentResult.success) {
            logger.error('Deployment failed', {
                message: deploymentResult?.message,
                error: deploymentResult?.error
            });

            // Check for preview expired error
            if (deploymentResult?.error?.includes('Failed to read instance metadata') || 
                deploymentResult?.error?.includes(`/bin/sh: 1: cd: can't cd to i-`)) {
                logger.error('Deployment sandbox died - preview expired');
                callbacks?.onPreviewExpired?.();
            } else {
                callbacks?.onError?.({
                    message: `Deployment failed: ${deploymentResult?.message || 'Unknown error'}`,
                    instanceId: state.sandboxInstanceId ?? '',
                    error: deploymentResult?.error || 'Unknown deployment error'
                });
            }
            
            return { deploymentUrl: null };
        }

        const deploymentUrl = deploymentResult.deployedUrl;
        const deploymentId = deploymentResult.deploymentId;

        logger.info('Cloudflare deployment completed successfully', {
            deploymentUrl,
            deploymentId,
            message: deploymentResult.message
        });

        callbacks?.onCompleted?.({
            message: deploymentResult.message || 'Successfully deployed to Cloudflare Workers!',
            instanceId: state.sandboxInstanceId ?? '',
            deploymentUrl: deploymentUrl || ''
        });

        return { 
            deploymentUrl: deploymentUrl || null,
            deploymentId: deploymentId
        };
    }

    /**
     * Push to GitHub repository
     */
    async pushToGitHub(options: GitHubPushRequest): Promise<GitHubExportResult> {
        const state = this.getState();
        const logger = this.getLog();
        const client = this.getClient();

        logger.info('Starting GitHub export', {
            repositoryUrl: options.repositoryHtmlUrl,
            fileCount: Object.keys(state.generatedFilesMap).length
        });

        // Check if we have generated files
        if (!state.generatedFilesMap || Object.keys(state.generatedFilesMap).length === 0) {
            throw new Error('No generated files available for export');
        }

        // Ensure sandbox instance exists
        if (!state.sandboxInstanceId) {
            throw new Error('No sandbox instance available');
        }

        const allFiles = this.fileManager.getGeneratedFiles();

        // Push to GitHub
        const exportResult = await client.pushToGitHub(
            state.sandboxInstanceId,
            options,
            allFiles
        );

        if (!exportResult?.success) {
            throw new Error(`Failed to export to GitHub repository: ${exportResult?.error}`);
        }

        logger.info('GitHub export completed successfully', { 
            options,
            commitSha: exportResult.commitSha
        });

        // Update readme with Cloudflare button if exists
        // Note: This is handled by agent after this service returns
        // Agent will redeploy and call this method again if needed

        return exportResult;
    }
}
