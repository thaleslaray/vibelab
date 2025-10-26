# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
Official Cloudflare product: AI-powered webapp generator built on Cloudflare Workers. Users describe applications in natural language, and the system generates, previews, and deploys working React+TypeScript apps through a phase-wise generation system powered by Durable Objects.

**Tech Stack:**
- Frontend: React 19 + Vite + TypeScript + Tailwind
- Backend: Cloudflare Workers + Hono
- AI Agents: Durable Objects (stateful generation orchestration)
- Database: D1 (SQLite) + Drizzle ORM
- Execution: Cloudflare Containers (sandboxed app previews)
- Deployment: Workers for Platforms (dispatch namespaces)
- Storage: R2 (templates), KV (sessions)
- AI: Multiple LLM providers via AI Gateway

## Development Commands

### Setup
```bash
npm run setup            # Interactive setup wizard (credentials, DB, OAuth)
```

### Frontend Development
```bash
npm run dev              # Vite dev server (default port 5173)
npm run build            # Production build (outputs to /dist)
npm run lint             # ESLint
npm run preview          # Preview production build
```

### Worker Development
```bash
# Local development uses Wrangler with local D1/DO
npm run dev              # Runs both frontend and worker locally
npm run cf-typegen       # Generate TypeScript types for Cloudflare bindings
npm run deploy           # Build + deploy to Cloudflare (includes DB migration)
```

### Database (Drizzle + D1)
```bash
npm run db:generate              # Generate migration from schema changes (local)
npm run db:generate:remote       # Generate migration (remote)
npm run db:migrate:local         # Apply migrations to local D1
npm run db:migrate:remote        # Apply migrations to production D1
npm run db:studio                # Drizzle Studio UI (local DB)
npm run db:studio:remote         # Drizzle Studio UI (remote DB)
npm run db:drop                  # Drop migration (local)
npm run db:introspect            # Generate schema from existing DB
```

### Testing
```bash
npm run test             # Vitest (current tests are AI-generated, need replacement)
npm run test:watch       # Vitest watch mode
npm run test:coverage    # Coverage report
```

### Code Quality
```bash
npm run knip             # Find unused files, dependencies, exports
npm run knip:fix         # Auto-remove unused exports
npm run knip:production  # Check production code only
```

## Core Architecture

### Phase-wise Generation System
The system implements a **deterministic state machine** for code generation using Durable Objects:

**Generation Flow:**
```
User Prompt → Blueprint → Phase Generation → Phase Implementation → Code Review → Deployment
                ↓             ↓                   ↓                   ↓              ↓
           (Architecture) (File Lists)    (Streaming Code)    (Error Detection) (Preview)
```

**Key Classes:**
- `SimpleCodeGeneratorAgent` (`worker/agents/core/simpleGeneratorAgent.ts`) - Main orchestrator with state machine
- `SmartCodeGeneratorAgent` (`worker/agents/core/smartGeneratorAgent.ts`) - Future LLM-based orchestration (currently extends Simple)
- State stored in Durable Object: blueprint, phases, files, conversation, deployment status

**Operations** (`worker/agents/operations/`):
1. **BlueprintGeneration** - AI creates high-level project architecture
2. **PhaseGeneration** - Breaks blueprint into ~12 implementable phases with file lists
3. **PhaseImplementation** - Streams code via SCOF (Structured Code Output Format)
4. **CodeReview** - Static analysis + runtime validation
5. **FileRegeneration** - Fixes individual files with issues
6. **FastCodeFixer** - Real-time error correction
7. **UserConversation** - Handles iterative requests

**SCOF Protocol** (`worker/agents/output-formats/streaming-formats/scof.ts`):
- Streams code files from LLM responses in real-time
- Handles arbitrary chunk boundaries (files split across streaming chunks)
- Supports full content and unified diff formats
- Line-by-line parsing with state machine for file open/close tracking

### Durable Objects Architecture

**CodeGeneratorAgent** (main generation orchestrator):
- One instance per user session (identified by agentId)
- Persists state across WebSocket disconnections
- Manages generation lifecycle and deployment queue
- Binding: `env.CodeGenObject`

**UserAppSandboxService** (sandbox execution):
- Manages Cloudflare Container lifecycle for each generated app
- Bootstrap with templates, execute commands, write files
- Capture runtime errors and logs
- Static analysis and GitHub deployment
- Binding: `env.Sandbox`

**DORateLimitStore** (distributed rate limiting):
- Per-action rate limits using Durable Object storage
- Binding: `env.DORateLimitStore`

### Frontend-Worker Communication

**HTTP + WebSocket Pattern:**
```typescript
// 1. Initialize generation
POST /api/agent { query: "build a todo app" }
  → Returns: { agentId, websocketUrl }

// 2. Open persistent connection
WebSocket /api/agent/{agentId}/ws

// 3. Bidirectional messages
Client → Server: GENERATE_ALL, CODE_REVIEW, DEPLOY, USER_MESSAGE
Server → Client: cf_agent_state, file_chunk_generated, phase_completed, preview_ready
```

**Message Handlers:**
- Frontend: `src/routes/chat/utils/handle-websocket-message.ts`
- Backend: `worker/agents/core/websocket.ts`
- State management: `src/routes/chat/hooks/use-chat.ts` (React hook)

### Container Sandbox System

**Two Implementations:**
1. **SandboxSdkClient** (default) - Cloudflare Containers SDK
2. **RemoteSandboxServiceClient** - External runner service

**Factory Pattern** (`worker/services/sandbox/factory.ts`):
```typescript
getSandboxService(sessionId, agentId) {
    return env.SANDBOX_SERVICE_TYPE === 'runner'
        ? new RemoteSandboxServiceClient(sessionId)
        : new SandboxSdkClient(sessionId, agentId);
}
```

**Container Configuration:**
- Image: `SandboxDockerfile` (based on `cloudflare/sandbox:0.1.3`)
- Includes: Node.js, cloudflared tunnel, process monitoring
- Instance types: `lite`, `standard-1/2/3/4` (configurable via `SANDBOX_INSTANCE_TYPE`)
- Max instances: Configurable via `MAX_SANDBOX_INSTANCES`

### Deployment Architecture

**Two-Tier Routing** (`worker/index.ts`):
1. **Development Preview** (first priority):
   - Proxy to UserAppSandboxService container
   - Instant feedback during development
   - URL pattern: `*.{CUSTOM_DOMAIN}`

2. **Production Deployment** (fallback):
   - Workers for Platforms dispatch namespace
   - Permanent worker deployment
   - Activated after user clicks "Deploy to Cloudflare"

**WorkerDeployer** (`worker/services/deployer/`):
- Batched asset uploads (200 assets per batch)
- Worker script deployment to `DISPATCHER` namespace
- Subdomain routing: `{appName}.{CUSTOM_DOMAIN}`

## Key Directory Structure

```
/src                       # React frontend
  /routes
    /chat                  # Main code generation UI
      /components          # Blueprint, FileExplorer, Preview, Terminal
      /hooks              # use-chat.ts (main state management)
      /utils              # handle-websocket-message.ts (message processing)
    /app                  # Generated app viewing
    /apps                 # App list/dashboard
  /components             # Reusable UI components (shadcn/ui based)
  /lib                    # API client, utilities

/worker                   # Cloudflare Worker backend
  /agents
    /core                 # SimpleCodeGeneratorAgent, SmartCodeGeneratorAgent, state.ts
    /operations          # Generation, review, fixing operations
    /planning            # Blueprint generation
    /assistants          # ProjectSetup, CodeFixer
    /schemas.ts          # Zod schemas for LLM outputs
    /inferutils          # LLM configuration (models, tokens, temperature)
    /output-formats      # SCOF streaming parser
  /api
    /controllers         # Feature logic (auth, agent, apps, templates)
    /routes             # Route definitions
  /services
    /sandbox            # SandboxSdkClient, RemoteSandboxServiceClient, factory
    /deployer           # Workers for Platforms deployment
    /aigateway-proxy    # AI Gateway routing
    /code-fixer         # Error analysis and fixes
    /rate-limit         # Rate limiting (global + DO-based)
  /database
    /schema.ts          # Drizzle schema (users, sessions, apps, model_configs)
    /services           # AppService, ModelConfigService, SessionService
  /middleware           # Auth, CSRF, CORS, security
  index.ts              # Main Worker handler + routing logic

/container              # Docker environment for sandboxes
  SandboxDockerfile     # Container image definition
  packages-cache/       # NPM package cache for faster installs

/shared                 # Types shared between frontend and worker
```

## AI Model Configuration

**Multi-Provider Support** (`worker/agents/inferutils/config.ts`):
- Anthropic Claude (Sonnet, Opus)
- OpenAI GPT (4, 4-Turbo, o1)
- Google Gemini (2.0 Flash, Pro)

**Per-Action Model Configuration:**
```typescript
AGENT_CONFIG = {
    BLUEPRINT: { model: "gemini-2.0-flash-exp", maxTokens: 16384 },
    TEMPLATE_SELECTION: { model: "gemini-2.0-flash-exp", maxTokens: 8000 },
    PHASE_GENERATION: { model: "gemini-2.0-flash-thinking-exp-01-21" },
    PHASE_IMPLEMENTATION: { model: "gemini-2.0-flash-exp", maxTokens: 8000 },
    CODE_REVIEW: { model: "gemini-2.0-flash-exp", maxTokens: 8000 },
    // ... etc
}
```

**User Model Overrides:**
- Database: `model_configs` table (per user, per action)
- Service: `ModelConfigService` (`worker/database/services/modelConfigService.ts`)
- Fallback chain: User override → Default config → System fallback

**AI Gateway Integration:**
- Proxy endpoint: `/api/proxy/openai/*`
- JWT-based auth for generated apps to call AI
- Unified routing to multiple LLM providers
- Configuration: `CLOUDFLARE_AI_GATEWAY` var in wrangler.jsonc

## Environment Configuration

**Required Variables** (`.dev.vars` for local, secrets for production):
```bash
# AI Providers (at least one required)
GOOGLE_AI_STUDIO_API_KEY="..."
ANTHROPIC_API_KEY="..."
OPENAI_API_KEY="..."

# Security
JWT_SECRET="random-secure-string"
WEBHOOK_SECRET="random-secure-string"
SECRETS_ENCRYPTION_KEY="random-secure-string"

# Cloudflare
CLOUDFLARE_AI_GATEWAY_TOKEN="..."  # Token with Run permissions
CLOUDFLARE_ACCOUNT_ID="..."        # Auto-provided in Workers Builds
CLOUDFLARE_API_TOKEN="..."         # Auto-provided in Workers Builds

# OAuth (optional, for user authentication)
GOOGLE_CLIENT_ID="..."
GOOGLE_CLIENT_SECRET="..."
GITHUB_CLIENT_ID="..."
GITHUB_CLIENT_SECRET="..."

# GitHub Export (optional)
GITHUB_EXPORTER_CLIENT_ID="..."
GITHUB_EXPORTER_CLIENT_SECRET="..."

# Custom Configuration
CUSTOM_DOMAIN="build.example.com"
ALLOWED_EMAIL="user@example.com"   # Email allowed to use the app
```

**Wrangler Bindings** (auto-configured in `wrangler.jsonc`):
- `AI` - Workers AI binding
- `DB` - D1 database binding
- `CodeGenObject` - CodeGeneratorAgent Durable Object
- `Sandbox` - UserAppSandboxService Durable Object
- `DORateLimitStore` - Rate limiting Durable Object
- `DISPATCHER` - Workers for Platforms namespace
- `TEMPLATES_BUCKET` - R2 bucket for templates
- `VibecoderStore` - KV namespace for sessions
- `ASSETS` - Static asset serving

## Working with the Codebase

### Adding a New Generation Operation
1. Create operation class in `worker/agents/operations/` extending `BaseOperation`
2. Define Zod schema in `worker/agents/schemas.ts` for LLM output validation
3. Add operation to `SimpleCodeGeneratorAgent.executeOperation()`
4. Update WebSocket message handler in `worker/agents/core/websocket.ts`
5. Add frontend handling in `src/routes/chat/utils/handle-websocket-message.ts`
6. Update state types in `worker/agents/core/state.ts` if needed

### Modifying AI Model Configuration
1. Update `AGENT_CONFIG` in `worker/agents/inferutils/config.ts`
2. Change model, max tokens, temperature per action type
3. Add fallback models for reliability
4. Test with different providers (Anthropic, OpenAI, Google)

### Adding Template Support
1. Upload template files to R2 bucket (`TEMPLATES_BUCKET`)
2. Template structure: project files + `.template-config.json`
3. AI selects template via `TemplateSelection` operation
4. Bootstrap sandbox with template in `PhaseImplementation`

### Debugging Code Generation
**Local Development:**
```bash
npm run dev              # Start both frontend and worker
# Open browser DevTools → Network → WS to see WebSocket messages
# Check Wrangler logs in terminal for Durable Object logs
```

**Check Generation State:**
- WebSocket message `cf_agent_state` contains full agent state
- Includes: blueprint, phases, files, conversation, errors
- Frontend stores in `useChat` hook state

**Common Issues:**
- **No preview URL**: Check container logs, verify `MAX_SANDBOX_INSTANCES`
- **Generation stuck**: Check `CurrentDevState` in agent state
- **File not appearing**: SCOF parser issue, check streaming logs
- **Deployment failed**: Verify `DISPATCHER` binding, check asset upload

### Database Schema Changes
```bash
# 1. Modify schema.ts
vim worker/database/schema.ts

# 2. Generate migration
npm run db:generate

# 3. Review migration in /migrations directory

# 4. Apply locally
npm run db:migrate:local

# 5. Test changes with Drizzle Studio
npm run db:studio

# 6. Deploy to production (included in deploy script)
npm run deploy
```

### Cloudflare-Specific Patterns

**Durable Objects:**
- State persists automatically (SQLite storage)
- One instance per ID (deterministic routing)
- Access via `env.CodeGenObject.get(id)`
- Hibernation API for WebSockets (auto-resume on message)

**D1 Database:**
- SQLite at the edge (low latency)
- Use batch operations: `db.batch([query1, query2])`
- Read replicas: Enable via `ENABLE_READ_REPLICAS` var
- Connection via Drizzle ORM for type safety

**Workers for Platforms:**
- Deploy user apps to `DISPATCHER` namespace
- Subdomain routing: `{appId}.{CUSTOM_DOMAIN}`
- Isolated execution per user app
- Asset management via Upload API

**Containers:**
- Sandboxed execution environment
- Process monitoring for error capture
- Cloudflared tunnel for preview URLs
- Package cache for faster npm installs

## Code Quality Standards
- **Type Safety**: Never use `any` type. Create proper types or find existing ones.
- **No Dynamic Imports**: Static imports only for better bundling and type checking.
- **DRY Principles**: Strictly avoid code duplication.
- **Edit, Don't Rewrite**: Fix existing files instead of creating new versions.
- **Professional Comments**: Explain code logic, not change history.
- **Correct Over Fast**: Prioritize proper implementation over quick hacks.
- **Cloudflare-Native**: Use Cloudflare platform features when possible.

## Testing Strategy (Needs Implementation)
Current tests are AI-generated placeholders. Required test coverage:
- Unit tests for operations (`worker/agents/operations/`)
- Integration tests for Durable Objects
- SCOF parser tests (streaming edge cases)
- WebSocket message handling tests
- E2E generation workflow tests

## Known Limitations
- **Durable Object State**: Can be evicted if idle; images stored in memory
- **Container Warm-up**: First sandbox bootstrap takes ~30s
- **LLM Rate Limits**: Implement retry with exponential backoff
- **Asset Upload**: 200 asset per batch limit for Workers for Platforms
- **SCOF Parsing**: Line-by-line, can't handle binary files