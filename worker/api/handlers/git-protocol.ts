/**
 * Git Protocol Handler
 * Handles git clone/fetch operations via HTTP protocol
 * Route: /apps/:id.git/info/refs and /apps/:id.git/git-upload-pack
 * 
 * Architecture: Export git objects from DO, build repo in worker to save DO memory
 */
import { getAgentStub } from '../../agents';
import { createLogger } from '../../logger';
import { GitCloneService } from '../../agents/git/git-clone-service';

const logger = createLogger('GitProtocol');

/**
 * Git protocol route patterns
 */
const GIT_INFO_REFS_PATTERN = /^\/apps\/([a-f0-9-]+)\.git\/info\/refs$/;
const GIT_UPLOAD_PACK_PATTERN = /^\/apps\/([a-f0-9-]+)\.git\/git-upload-pack$/;

/**
 * Check if request is a Git protocol request
 */
export function isGitProtocolRequest(pathname: string): boolean {
    return GIT_INFO_REFS_PATTERN.test(pathname) || GIT_UPLOAD_PACK_PATTERN.test(pathname);
}

/**
 * Extract app ID from Git protocol URL
 */
function extractAppId(pathname: string): string | null {
    const infoRefsMatch = pathname.match(GIT_INFO_REFS_PATTERN);
    if (infoRefsMatch) return infoRefsMatch[1];
    
    const uploadPackMatch = pathname.match(GIT_UPLOAD_PACK_PATTERN);
    if (uploadPackMatch) return uploadPackMatch[1];
    
    return null;
}

/**
 * Handle Git info/refs request
 */
async function handleInfoRefs(env: Env, appId: string): Promise<Response> {
    try {
        const agentStub = await getAgentStub(env, appId, true, logger);
        if (!agentStub || !(await agentStub.isInitialized())) {
            return new Response('Repository not found', { status: 404 });
        }
        
        // Export git objects from DO
        const { gitObjects, query, hasCommits, templateDetails } = await agentStub.exportGitObjects();
        
        if (!hasCommits) {
            // Return empty advertisement for repos with no commits
            return new Response('001e# service=git-upload-pack\n0000', {
                status: 200,
                headers: {
                    'Content-Type': 'application/x-git-upload-pack-advertisement',
                    'Cache-Control': 'no-cache'
                }
            });
        }
        
        // Build repository in worker
        const repoFS = await GitCloneService.buildRepository({
            gitObjects,
            templateDetails,
            appQuery: query
        });
        
        // Generate info/refs response
        const response = await GitCloneService.handleInfoRefs(repoFS);
        return new Response(response, {
            status: 200,
            headers: {
                'Content-Type': 'application/x-git-upload-pack-advertisement',
                'Cache-Control': 'no-cache'
            }
        });
    } catch (error) {
        logger.error('Git info/refs error:', error);
        return new Response('Internal server error', { status: 500 });
    }
}

/**
 * Handle Git upload-pack request
 */
async function handleUploadPack(env: Env, appId: string): Promise<Response> {
    try {
        const agentStub = await getAgentStub(env, appId, true, logger);
        if (!agentStub || !(await agentStub.isInitialized())) {
            return new Response('Repository not found', { status: 404 });
        }
        
        // Export git objects from DO
        const { gitObjects, query, hasCommits, templateDetails } = await agentStub.exportGitObjects();
        
        if (!hasCommits) {
            return new Response('No commits to pack', { status: 404 });
        }
        
        // Build repository in worker
        const repoFS = await GitCloneService.buildRepository({
            gitObjects,
            templateDetails,
            appQuery: query
        });
        
        // Generate packfile with full commit history
        const packfile = await GitCloneService.handleUploadPack(repoFS);
        return new Response(packfile, {
            status: 200,
            headers: {
                'Content-Type': 'application/x-git-upload-pack-result',
                'Cache-Control': 'no-cache'
            }
        });
    } catch (error) {
        logger.error('Git upload-pack error:', error);
        return new Response('Internal server error', { status: 500 });
    }
}

/**
 * Main handler for Git protocol requests
 */
export async function handleGitProtocolRequest(
    request: Request,
    env: Env
): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;
    
    // Extract app ID
    const appId = extractAppId(pathname);
    if (!appId) {
        return new Response('Invalid Git URL', { status: 400 });
    }
    
    // Route to appropriate handler
    if (GIT_INFO_REFS_PATTERN.test(pathname)) {
        return handleInfoRefs(env, appId);
    } else if (GIT_UPLOAD_PACK_PATTERN.test(pathname)) {
        return handleUploadPack(env, appId);
    }
    
    return new Response('Not found', { status: 404 });
}
