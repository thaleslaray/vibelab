import { FileGenerationOutputType } from '../schemas';
import { AgentOperation, OperationOptions } from '../operations/common';
import { RealtimeCodeFixer } from '../assistants/realtimeCodeFixer';
import { FileOutputType } from '../schemas';
import { AGENT_CONFIG } from '../inferutils/config';
import { FILE_REGENERATION_PROMPT } from '../inferutils/defaultPrompts';

export interface FileRegenerationInputs {
    file: FileOutputType;
    issues: string[];
    retryIndex: number;
}

const SYSTEM_PROMPT = FILE_REGENERATION_PROMPT;

const USER_PROMPT = `<SURGICAL_FIX_REQUEST: {{filePath}}>

<CONTEXT>
User Query: {{query}}
File Path: {{filePath}}
File Purpose: {{filePurpose}}
</CONTEXT>

<CURRENT_FILE_CONTENTS>
{{fileContents}}
</CURRENT_FILE_CONTENTS>

<SPECIFIC_ISSUES_TO_FIX>
{{issues}}
</SPECIFIC_ISSUES_TO_FIX>

<FIX_PROTOCOL>
## Step 1: Validate Issue Exists
- Confirm each reported issue is present in the current file contents
- SKIP issues that don't match the current code
- SKIP issues about code that has already been changed

## Step 2: Minimal Fix Identification  
- Identify the smallest possible change to fix each valid issue
- Avoid touching any working code
- Preserve all existing patterns and structures

## Step 3: Apply Surgical Fixes
Use this exact format for each fix:

**Example - Null Safety Fix:**
Issue: "Cannot read property 'items' of undefined"
<fix>
# Add null check to prevent undefined access

\`\`\`
<<<<<<< SEARCH
const total = data.items.length;
=======
const total = data?.items?.length || 0;
>>>>>>> REPLACE
\`\`\`
</fix>

**Example - Render Loop Fix:**
Issue: "Maximum update depth exceeded in useEffect"
<fix>
# Add missing dependency array to prevent infinite loop

\`\`\`
<<<<<<< SEARCH
useEffect(() => {
  setState(newValue);
});
=======
useEffect(() => {
  setState(newValue);
}, [newValue]);
>>>>>>> REPLACE
\`\`\`
</fix>

## SAFETY CONSTRAINTS:
- SEARCH block must match existing code character-for-character
- Only fix the exact reported problem
- Never modify imports, exports, or function signatures
- Preserve all existing error handling
- Do not add new dependencies or change existing patterns
- If an issue cannot be fixed surgically, explain why instead of forcing a fix
</FIX_PROTOCOL>`;

export class FileRegenerationOperation extends AgentOperation<FileRegenerationInputs, FileGenerationOutputType> {    
    async execute(
        inputs: FileRegenerationInputs,
        options: OperationOptions
    ): Promise<FileGenerationOutputType> {
        try {
            // Use realtime code fixer to fix the file with enhanced surgical fix prompts
            const realtimeCodeFixer = new RealtimeCodeFixer(options.env, options.inferenceContext, false, undefined, AGENT_CONFIG.fileRegeneration, SYSTEM_PROMPT, USER_PROMPT);
            const fixedFile = await realtimeCodeFixer.run(
                inputs.file, {
                    previousFiles: options.context.allFiles,
                    query: options.context.query,
                    template: options.context.templateDetails
                },
                undefined,
                inputs.issues,
                5
            );

            return {
                ...fixedFile,
                format: "full_content"
            };
        } catch (error) {
            options.logger.error(`Error fixing file ${inputs.file.filePath}:`, error);
            throw error;
        }
    }
}
