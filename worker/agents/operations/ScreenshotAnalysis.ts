import { Blueprint, ScreenshotAnalysisSchema, ScreenshotAnalysisType } from '../schemas';
import { createSystemMessage, createMultiModalUserMessage } from '../inferutils/common';
import { executeInference } from '../inferutils/infer';
import { PROMPT_UTILS } from '../prompts';
import { ScreenshotData } from '../core/types';
import { AgentOperation, OperationOptions } from './common';
import { OperationError } from '../utils/operationError';
import { SCREENSHOT_ANALYSIS_PROMPT } from '../inferutils/defaultPrompts';

export interface ScreenshotAnalysisInput {
    screenshotData: ScreenshotData,
}

const SYSTEM_PROMPT = SCREENSHOT_ANALYSIS_PROMPT;

const USER_PROMPT = `Analyze this screenshot against the blueprint requirements.

**Blueprint Context:**
{{blueprint}}

**Viewport:** {{viewport}}

**Analysis Required:**
- Compare visible elements against blueprint specifications
- Check layout, spacing, and component positioning
- Identify any missing or broken UI elements
- Assess responsive design for the given viewport size
- Note any visual bugs or rendering issues

Provide specific, actionable feedback focused on blueprint compliance.`

const userPromptFormatter = (screenshotData: { viewport: { width: number; height: number }; }, blueprint: Blueprint) => {
    const prompt = PROMPT_UTILS.replaceTemplateVariables(USER_PROMPT, {
        blueprint: JSON.stringify(blueprint, null, 2),
        viewport: `${screenshotData.viewport.width}x${screenshotData.viewport.height}`
    });
    return PROMPT_UTILS.verifyPrompt(prompt);
}

export class ScreenshotAnalysisOperation extends AgentOperation<ScreenshotAnalysisInput, ScreenshotAnalysisType> {
    async execute(
        input: ScreenshotAnalysisInput,
        options: OperationOptions
    ): Promise<ScreenshotAnalysisType> {
        const { screenshotData } = input;
        const { env, context, logger } = options;
        try {
            logger.info('Analyzing screenshot from preview', {
                url: screenshotData.url,
                viewport: screenshotData.viewport,
                hasScreenshotData: !!screenshotData.screenshot,
                screenshotDataLength: screenshotData.screenshot?.length || 0
            });
    
            if (!screenshotData.screenshot) {
                throw new Error('No screenshot data available for analysis');
            }

            // Create multi-modal messages
            const messages = [
                createSystemMessage(SYSTEM_PROMPT),
                createMultiModalUserMessage(
                    userPromptFormatter(screenshotData, context.blueprint),
                    screenshotData.screenshot, // The base64 data URL or image URL
                    'high' // Use high detail for better analysis
                )
            ];
    
            const { object: analysisResult } = await executeInference({
                env: env,
                messages,
                schema: ScreenshotAnalysisSchema,
                agentActionName: 'screenshotAnalysis',
                context: options.inferenceContext,
                retryLimit: 3
            });
    
            if (!analysisResult) {
                logger.warn('Screenshot analysis returned no result');
                throw new Error('No analysis result');
            }
    
            logger.info('Screenshot analysis completed', {
                hasIssues: analysisResult.hasIssues,
                issueCount: analysisResult.issues.length,
                matchesBlueprint: analysisResult.uiCompliance.matchesBlueprint
            });
    
            // Log detected UI issues
            if (analysisResult.hasIssues) {
                logger.warn('UI issues detected in screenshot', {
                    issues: analysisResult.issues,
                    deviations: analysisResult.uiCompliance.deviations
                });
            }
    
            return analysisResult;
        } catch (error) {
            OperationError.logAndThrow(logger, "screenshot analysis", error);
        }
    }
}