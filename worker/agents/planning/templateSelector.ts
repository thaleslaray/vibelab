import { createSystemMessage, createUserMessage, createMultiModalUserMessage } from '../inferutils/common';
import { TemplateListResponse} from '../../services/sandbox/sandboxTypes';
import { createLogger } from '../../logger';
import { executeInference } from '../inferutils/infer';
import { InferenceContext } from '../inferutils/config.types';
import { RateLimitExceededError, SecurityError } from 'shared/types/errors';
import { TemplateSelection, TemplateSelectionSchema } from '../../agents/schemas';
import { generateSecureToken } from 'worker/utils/cryptoUtils';
import type { ImageAttachment } from '../../types/image-attachment';
import { TEMPLATE_SELECTION_PROMPT } from '../inferutils/defaultPrompts';

const logger = createLogger('TemplateSelector');
interface SelectTemplateArgs {
    env: Env;
    query: string;
    availableTemplates: TemplateListResponse['templates'];
    inferenceContext: InferenceContext;
    images?: ImageAttachment[];
}

/**
 * Uses AI to select the most suitable template for a given query.
 */
export async function selectTemplate({ env, query, availableTemplates, inferenceContext, images }: SelectTemplateArgs): Promise<TemplateSelection> {
    if (availableTemplates.length === 0) {
        logger.info("No templates available for selection.");
        return { selectedTemplateName: null, reasoning: "No templates were available to choose from.", useCase: null, complexity: null, styleSelection: null, projectName: '' };
    }

    try {
        logger.info("Asking AI to select a template", { 
            query, 
            queryLength: query.length,
            imagesCount: images?.length || 0,
            availableTemplates: availableTemplates.map(t => t.name),
            templateCount: availableTemplates.length 
        });

        const templateDescriptions = availableTemplates.map((t, index) =>
            `- Template #${index + 1} \n Name - ${t.name} \n Language: ${t.language}, Frameworks: ${t.frameworks?.join(', ') || 'None'}\n ${t.description.selection}`
        ).join('\n\n');

        const systemPrompt = TEMPLATE_SELECTION_PROMPT;

        const userPrompt = `**User Request:** "${query}"

**Available Templates:**
${templateDescriptions}

**Task:** Select the most suitable template and provide:
1. Template name (exact match from list)
2. Clear reasoning for why it fits the user's needs
3. Appropriate style for the project type. Try to come up with unique styles that might look nice and unique. Be creative about your choices. But don't pick brutalist all the time.
4. Descriptive project name

Analyze each template's features, frameworks, and architecture to make the best match.
${images && images.length > 0 ? `\n**Note:** User provided ${images.length} image(s) - consider visual requirements and UI style from the images.` : ''}

ENTROPY SEED: ${generateSecureToken(64)} - for unique results`;

        const userMessage = images && images.length > 0
            ? createMultiModalUserMessage(
                userPrompt,
                images.map(img => `data:${img.mimeType};base64,${img.base64Data}`),
                'high'
              )
            : createUserMessage(userPrompt);

        const messages = [
            createSystemMessage(systemPrompt),
            userMessage
        ];

        const { object: selection } = await executeInference({
            env,
            messages,
            agentActionName: "templateSelection",
            schema: TemplateSelectionSchema,
            context: inferenceContext,
            maxTokens: 2000,
        });


        logger.info(`AI template selection result: ${selection.selectedTemplateName || 'None'}, Reasoning: ${selection.reasoning}`);
        return selection;

    } catch (error) {
        logger.error("Error during AI template selection:", error);
        if (error instanceof RateLimitExceededError || error instanceof SecurityError) {
            throw error;
        }
        // Fallback to no template selection in case of error
        return { selectedTemplateName: null, reasoning: "An error occurred during the template selection process.", useCase: null, complexity: null, styleSelection: null, projectName: '' };
    }
}