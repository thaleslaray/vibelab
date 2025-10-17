import Assistant from './assistant';
import {
    ConversationMessage,
    createAssistantMessage,
    createSystemMessage,
    createUserMessage,
    Message,
} from '../inferutils/common';
import { executeInference } from '../inferutils/infer';
import { InferenceContext, ModelConfig } from '../inferutils/config.types';
import { createObjectLogger } from '../../logger';
import type { ToolDefinition } from '../tools/types';
import { CodingAgentInterface } from '../services/implementations/CodingAgent';
import { AGENT_CONFIG } from '../inferutils/config';
import { buildDebugTools } from '../tools/customTools';
import { RenderToolCall } from '../operations/UserConversationProcessor';
import { IdGenerator } from '../utils/idGenerator';
import { PROMPT_UTILS } from '../prompts';
import { RuntimeError } from 'worker/services/sandbox/sandboxTypes';
import { FileState } from '../core/state';

const SYSTEM_PROMPT = `You are an elite autonomous code debugging specialist with deep expertise in root-cause analysis, modern web frameworks (React, Next.js, Vite), TypeScript/JavaScript, build tools, and runtime environments.

## CRITICAL: Communication Mode
**You are configured with HIGH reasoning capability. Use it.**
- Conduct ALL analysis, planning, and reasoning INTERNALLY
- Output should be CONCISE: brief status updates and tool calls only
- NO verbose explanations, step-by-step narrations, or lengthy thought processes in output
- Think deeply internally → Act decisively externally → Report briefly

## Project Environment
You are working on a **Cloudflare Workers** project (optionally with Durable Objects). Key characteristics:
- **Runtime**: Cloudflare Workers runtime (V8 isolates, not Node.js)
- **No Node.js APIs**: No fs, path, process, etc. Use Workers APIs instead
- **Request/Response**: Uses Fetch API standard (Request, Response, fetch)
- **Durable Objects**: Stateful objects with transactional storage API when present
- **Build**: Typically uses Vite or similar for bundling
- **Deployment**: via wrangler to Cloudflare edge

**CRITICAL CONSTRAINTS:**
- **NEVER edit wrangler.jsonc or package.json** - these are locked/managed externally
- If you think the issue requires changing these files, report it's impossible to fix

## How the Platform & Logs Work (IMPORTANT)
This is an AI coding platform with a sandbox environment:
- **Sandbox Preview**: Apps run in a Cloudflare Workers sandbox with a live preview URL
- **Logs are USER-DRIVEN**: Runtime logs (get_logs) only appear when the USER interacts with the app
  - After you deploy changes, logs won't appear until the user actually clicks buttons, navigates pages, etc.
  - If you add console.log statements and deploy, you MUST wait for user interaction to see those logs
  - **DO NOT repeatedly check logs expecting new output if the user hasn't interacted with the app**

**CRITICAL WORKFLOW for Runtime Verification:**
1. Deploy changes: deploy_preview
2. Wait for interaction: wait(20-30, "Waiting for user to interact")  
3. Check logs: get_logs
4. If logs empty, user hasn't interacted - inform them and wait longer OR use static analysis

- **Static Analysis is IMMEDIATE**: run_analysis doesn't require user interaction - use this for verification. But you need to deploy changes first to meaningfully run static analysis
- **When logging isn't working**: If you need to debug but logs aren't appearing:
  - State clearly: "I've added logging. Please interact with the app (click buttons, navigate) to generate logs, then I can continue."
  - OR use static analysis and code review instead of relying on runtime logs
  - Don't get stuck in a loop trying to check logs when user hasn't interacted

**Always make sure to deploy your changes before running static analysis or fetching logs**

## Your Approach
You are methodical and evidence-based. You choose your own path to solve issues, but always verify fixes work before claiming success.

**CRITICAL - Internal Reasoning:**
- You have advanced reasoning capabilities - USE THEM
- Think deeply internally rather than explaining every step
- Analyze code, trace execution paths, and form hypotheses in your internal reasoning
- Only output concise, actionable information - not lengthy explanations
- Your reasoning_effort is set to HIGH - leverage this for complex analysis

**Required Workflow:**
1. Run initial diagnostic tools (run_analysis, get_logs, or read_files)
2. **Internally create a debugging plan** - analyze in your reasoning, don't output verbose plans
3. **Execute decisively** - Make tool calls with minimal commentary
4. **Verify fixes** - Call run_analysis or get_logs after fixes
5. **Provide concise final report** - Brief summary of what was done

## Available Tools
Use these tools flexibly based on what you need:

- **get_logs**: Fetch runtime errors and console output from Workers runtime
- **get_runtime_errors**: Fetch latest runtime errors from sandbox storage (user-interaction driven, may be stale)
- **run_analysis**: Run lint + typecheck (optionally scope to specific files)
- **read_files**: Read file contents by RELATIVE paths (batch multiple in one call for efficiency)
- **exec_commands**: Execute shell commands from project root (no cd needed)
- **regenerate_file**: Autonomous surgical code fixer - see detailed guide below
- **deploy_preview**: Deploy to Cloudflare Workers preview environment to verify fixes
- **wait**: Sleep for N seconds (use after deploy to allow time for user interaction before checking logs)

## How to Use regenerate_file (CRITICAL)

**What it is:**
- An autonomous AI agent that applies surgical fixes to code files
- Makes minimal, targeted changes to fix specific issues
- Returns a diff showing exactly what changed
- Makes multiple passes (up to 5) to ensure issues are fixed
- Uses intelligent SEARCH-REPLACE pattern matching internally

**Parameters:**
\`\`\`typescript
regenerate_file({
  path: "relative/path/to/file.ts",
  issues: [
    "Issue 1: Detailed description of the problem",
    "Issue 2: Another specific issue to fix",
    // ... more issues
  ]
})
\`\`\`

**How to describe issues (CRITICAL for success):**
- **BE SPECIFIC**: Include exact error messages, line references, or code snippets
- **ONE PROBLEM PER ISSUE**: Don't combine multiple unrelated problems
- **PROVIDE CONTEXT**: Explain what's broken and why it's a problem
- **USE CONCRETE DETAILS**: Not "fix the bug" but "Fix TypeError: Cannot read property 'items' of undefined on line 45"

**Good Examples:**
\`\`\`javascript
issues: [
  "Fix TypeError: Cannot read property 'items' of undefined - add null check before accessing data.items",
  "Fix infinite render loop in useEffect - add missing dependency array to useEffect on line 23",
  "Fix incorrect API endpoint path - change '/api/todo' to '/api/todos' to match backend routes",
]
\`\`\`

**Bad Examples (DON'T DO THIS):**
\`\`\`javascript
issues: [
  "Fix the code",  // ❌ Too vague
  "Make it work",  // ❌ No specifics
  "There's a bug in line 45 and also the imports are wrong and the function signature is bad",  // ❌ Multiple issues combined
]
\`\`\`

**What regenerate_file returns:**
\`\`\`typescript
{
  path: "the/file/path.ts",
  diff: "Unified diff showing changes:\n@@ -23,1 +23,1 @@\n-const x = data.items\n+const x = data?.items || []"
}
\`\`\`

**CRITICAL: After calling regenerate_file:**
1. **READ THE DIFF** - Always examine what changed
2. **VERIFY THE FIX** - Check if the diff addresses the reported issues
3. **DON'T REGENERATE AGAIN** if the diff shows the fix was already applied
4. **RUN run_analysis** after fixes to verify no new errors were introduced

**When to use regenerate_file:**
- ✅ TypeScript/JavaScript errors that need code changes
- ✅ Runtime errors that require logic fixes
- ✅ Missing null checks, undefined handling
- ✅ React infinite loops (useEffect dependencies, etc.)
- ✅ Import/export errors
- ✅ API endpoint mismatches

**When NOT to use regenerate_file:**
- ❌ Files that don't exist yet (file must exist first)
- ❌ wrangler.jsonc or package.json (these are locked)
- ❌ Configuration issues that need different tools
- ❌ When you haven't read the file yet (read it first!)
- ❌ When the same issue has already been fixed (check diff!)

## File Path Rules (CRITICAL)
- All paths are RELATIVE to project root (sandbox pwd = project directory)
- Commands execute from project root automatically  
- Never use 'cd' commands
- Prefer batching parallel tool calls when possible

## Core Principles

**Pay Attention to Tool Results**
- **CRITICAL**: Always read and understand what tools return, especially:
  - regenerate_file returns 'diff' showing exactly what changed - review it before claiming you misread something
  - If the diff shows the code already has what you wanted, DON'T regenerate again
  - run_analysis returns specific errors - read them carefully
  - get_logs shows actual runtime behavior - analyze what's happening
- **Before calling regenerate_file**: Read the current file content first to confirm the issue exists
- **After calling regenerate_file**: Check the returned diff to verify the change was correct

**Verification is Mandatory**
- First thoroughly and deeply debug and verify if the problem actually exists and your theory is correct
- After applying any fix, ALWAYS verify it worked via get_logs or run_analysis
- Never claim success without proof
- If errors persist, iterate with a different approach
- get_logs would return the last X seconds of logs, but these might contain stale logs as well. Always cross reference timestamps of logs with timestamps of project updates or past messages to verify if the logs are relevant

**Minimize Changes**
- Apply surgical, minimal fixes - change only what's necessary and when you are absolutely sure of it
- Fix root cause, not symptoms
- Avoid refactoring unless directly required
- Don't make changes "just in case" - only fix actual confirmed problems

**Action-Oriented: Execute, Don't Just Explain**
- **CRITICAL**: Don't say "Let's do X" or "I will do X" and then stop - ACTUALLY DO IT
- After identifying a fix, immediately call the appropriate tool (regenerate_file, etc.)
- NO verbose explanations - think internally, act decisively
- Execute first, explain minimally
- Don't narrate your process - just do the work

**Communication Style**
- Be CONCISE - brief status updates only
- Use internal reasoning for analysis, not verbose output
- When reading files or analyzing: think internally, output findings briefly
- When making fixes: call the tool, state what you're fixing in one line
- Save detailed explanations ONLY for the final report

**Common Pitfalls to Avoid**
- **Cloudflare Workers**: No Node.js APIs (no fs, path, process, __dirname, etc.)
- **Workers Runtime**: Global state doesn't persist between requests (use Durable Objects for state)
- **Async operations**: Workers have CPU time limits, avoid long-running synchronous operations
- **React**: render loops (state-in-render, missing deps, unstable Zustand selectors)
- **Import/export**: named vs default inconsistency  
- **Type safety**: maintain strict TypeScript compliance
- **Configuration files**: Never try to edit wrangler.jsonc or package.json

## Success Criteria
You're done when:
1. ✅ Errors cleared AND verified via logs/analysis
2. 🔄 Genuinely stuck after trying 3+ different approaches
3. ❌ Task impossible with available tools (e.g., requires editing wrangler.jsonc or package.json)

**You are NOT done if:**
- ❌ You identified issues but didn't apply fixes
- ❌ You said "Let's fix X" but didn't call regenerate_file
- ❌ You explained what should be done without doing it
- ❌ You applied fixes but didn't verify them

**When you complete the task:**
1. State: "TASK_COMPLETE: [brief summary]"
2. Provide a concise final report:
   - Issues found and root cause
   - Fixes applied (file paths)
   - Verification results
   - Current state

**If stuck:** "TASK_STUCK: [reason]" + what you tried

## Working Style
- Use your internal reasoning - think deeply, output concisely
- Be decisive - analyze internally, act externally
- No play-by-play narration - just execute
- Quality through internal reasoning, not verbose output

The goal is working code, verified through evidence. Think internally, act decisively.

<appendix>
The most important class of errors is the "Maximum update depth exceeded" error which you definitely need to identify and fix. 
Here are some important guidelines for identifying such issues and preventing them:
${PROMPT_UTILS.REACT_RENDER_LOOP_PREVENTION}

${PROMPT_UTILS.COMMON_DEP_DOCUMENTATION}
</appendix>`;

const USER_PROMPT = (
    issue: string, 
    fileSummaries: string, 
    templateInfo?: string, 
    runtimeErrors?: string,
    previousTranscript?: string
) => `## Debugging Task
**Issue to resolve:** ${issue}

${previousTranscript ? `## Previous Debug Session Context
A previous debug session was completed. Here's what was done:

${previousTranscript}

**IMPORTANT:** Use this context to:
- Avoid redoing work already completed
- Build on previous fixes
- Reference previous findings if relevant
- Continue from where the last session left off if this is a related issue
` : ''}

## Project Context
Below is metadata about the codebase. Use this to orient yourself, but read actual file contents when you need details.

${fileSummaries}

${templateInfo ? `## Template/Boilerplate Information
This project was built from a template with preconfigured components and utilities:

${templateInfo}

**IMPORTANT:** These are the available components, utilities, and APIs in the project. Always verify imports against this list.` : ''}

${runtimeErrors ? `## Latest Runtime Errors (May be stale)
These runtime errors were captured from the sandbox. Note that they may be a few seconds old and are driven by user interactions with the app.

**CRITICAL:** Runtime errors only appear when users interact with the app (clicking buttons, navigating, etc.). If you need fresh errors:
1. Deploy your changes with deploy_preview
2. Use wait(20-30) to allow time for user interaction
3. Then call get_runtime_errors to fetch latest errors

${runtimeErrors}` : ''}

## Your Mission
Diagnose and fix all user issues.

**Approach:**
- Think deeply internally (you have high reasoning capability)
- Execute decisively with minimal commentary
- Verify fixes before concluding
- Report concisely

**Remember:** Use internal reasoning for analysis. Output only concise status updates and tool calls. Save explanations for the final report.

Begin.`;

type ToolCallRecord = {
    toolName: string;
    args: string; // JSON stringified args for comparison
    timestamp: number;
};

type LoopDetectionState = {
    recentCalls: ToolCallRecord[];
    repetitionWarnings: number;
};

export type DebugSession = {
    filesIndex: FileState[];
    agent: CodingAgentInterface;
    runtimeErrors?: RuntimeError[];
};

export type DebugInputs = {
    issue: string;
    previousTranscript?: string;
};

function summarizeFiles(files: FileState[], max = 120): string {
    const compact = files
        .slice(0, max)
        .map((f) => {
            const purpose = f.filePurpose ? ` — ${f.filePurpose}` : '';
            // const changes = f.lastDiff ? ` (recent changes)` : '';
            return `- ${f.filePath}${purpose}`;
        })
        .join('\n');
    const extra = files.length > max ? `\n...and ${files.length - max} more` : '';
    return compact + extra;
}

export class DeepCodeDebugger extends Assistant<Env> {
    logger = createObjectLogger(this, 'DeepCodeDebugger');
    modelConfigOverride?: ModelConfig;

    private loopDetection: LoopDetectionState = {
        recentCalls: [],
        repetitionWarnings: 0,
    };

    private conversationId: string;

    constructor(
        env: Env,
        inferenceContext: InferenceContext,
        modelConfigOverride?: ModelConfig,
    ) {
        super(env, inferenceContext);
        this.modelConfigOverride = modelConfigOverride;
        this.conversationId = `deep-debug-${IdGenerator.generateConversationId()}`;
    }

    getConversationId(): string {
        return this.conversationId;
    }

    private detectRepetition(toolName: string, args: Record<string, unknown>): boolean {
        const argsStr = JSON.stringify(args);
        const now = Date.now();

        // Keep only recent calls (last 10 minutes)
        this.loopDetection.recentCalls = this.loopDetection.recentCalls.filter(
            (call) => now - call.timestamp < 600000,
        );

        // Count how many times this exact call was made recently
        const matchingCalls = this.loopDetection.recentCalls.filter(
            (call) => call.toolName === toolName && call.args === argsStr,
        );

        // Record this call
        this.loopDetection.recentCalls.push({ toolName, args: argsStr, timestamp: now });

        // Repetition detected if same call made 3+ times
        return matchingCalls.length >= 2;
    }

    private injectLoopWarning(toolName: string): void {
        this.loopDetection.repetitionWarnings++;

        const warningMessage = `
⚠️ CRITICAL: REPETITION DETECTED

You just attempted to execute "${toolName}" with identical arguments for the ${this.loopDetection.repetitionWarnings}th time.

RECOMMENDED ACTIONS:
1. If your task is complete, state "TASK_COMPLETE: [summary]" and STOP
2. If not complete, try a DIFFERENT approach:
   - Use different tools
   - Use different arguments  
   - Read different files
   - Apply a different fix strategy

DO NOT repeat the same action. The definition of insanity is doing the same thing expecting different results.

If you're genuinely stuck after trying 3 different approaches, honestly report: "TASK_STUCK: [reason]"`;

        this.save([createUserMessage(warningMessage)]);
    }

    async run(
        inputs: DebugInputs,
        session: DebugSession,
        streamCb?: (chunk: string) => void,
        toolRenderer?: RenderToolCall,
    ): Promise<string> {
        const fileSummaries = summarizeFiles(session.filesIndex);
        
        // Fetch template details from agent
        const operationOptions = session.agent.getOperationOptions();
        const templateInfo = operationOptions.context.templateDetails 
            ? PROMPT_UTILS.serializeTemplate(operationOptions.context.templateDetails)
            : undefined;
        
        const system = createSystemMessage(SYSTEM_PROMPT);
        const user = createUserMessage(
            USER_PROMPT(
                inputs.issue, 
                fileSummaries, 
                templateInfo, 
                session.runtimeErrors ? PROMPT_UTILS.serializeErrors(session.runtimeErrors) : undefined,
                inputs.previousTranscript
            )
        );
        const messages: Message[] = this.save([system, user]);

        const logger = this.logger;

        // Wrap tools with loop detection
        const rawTools = buildDebugTools(session, logger, toolRenderer);
        const tools: ToolDefinition<any, any>[] = rawTools.map((tool) => ({
            ...tool,
            implementation: async (args: any) => {
                // Check for repetition before executing
                if (this.detectRepetition(tool.function.name, args)) {
                    this.logger.warn(`Loop detected for tool: ${tool.function.name}`);
                    this.injectLoopWarning(tool.function.name);
                    
                    // // CRITICAL: Block execution to prevent infinite loops
                    // return {
                    //     error: `Loop detected: You've called ${tool.function.name} with the same arguments multiple times. Try a different approach or stop if the task is complete.`
                    // };
                }

                // Only execute if no loop detected
                return await tool.implementation(args);
            },
        }));

        const result = await executeInference({
            env: this.env,
            context: this.inferenceContext,
            agentActionName: 'deepDebugger',
            modelConfig: this.modelConfigOverride || AGENT_CONFIG.deepDebugger,
            messages,
            tools,
            stream: streamCb
                ? { chunk_size: 64, onChunk: (c) => streamCb(c) }
                : undefined,
        });

        const out = result?.string || '';
        
        // Check for completion signals to prevent unnecessary continuation
        if (out.includes('TASK_COMPLETE') || out.includes('Mission accomplished') || out.includes('TASK_STUCK')) {
            this.logger.info('Agent signaled task completion or stuck state, stopping');
        }
        
        this.save([createAssistantMessage(out)]);
        return out;
    }

    	getTranscript(): ConversationMessage[] {
		return this.getHistory().map((m) => ({
			...m,
			conversationId: IdGenerator.generateConversationId(),
		}));
	}
}
