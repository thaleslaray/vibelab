/**
 * GitHub service for repository creation and export
 */

import { Octokit } from '@octokit/rest';
import { createLogger } from '../../logger';
import {
    GitHubRepository,
    CreateRepositoryOptions,
    CreateRepositoryResult,
    GitHubServiceError,
} from './types';
import { GitHubPushResponse, TemplateDetails } from '../sandbox/sandboxTypes';
import { GitCloneService } from '../../agents/git/git-clone-service';
import git from '@ashishkumar472/cf-git';
import { prepareCloudflareButton } from '../../utils/deployToCf';
import type { MemFS } from '../../agents/git/memfs';


export class GitHubService {
    private static readonly logger = createLogger('GitHubService');

    static createOctokit(token: string): Octokit {
        if (!token?.trim()) {
            throw new GitHubServiceError('No GitHub token provided', 'NO_TOKEN');
        }
        return new Octokit({ auth: token });
    }
    
    /**
     * Create a new GitHub repository
     */
    static async createUserRepository(
        options: CreateRepositoryOptions
    ): Promise<CreateRepositoryResult> {
        const autoInit = options.auto_init ?? true;
        
        GitHubService.logger.info('Creating GitHub repository', {
            name: options.name,
            private: options.private,
            auto_init: autoInit,
            description: options.description ? 'provided' : 'none'
        });
        
        try {
            const octokit = GitHubService.createOctokit(options.token);
            
            const { data: repository } = await octokit.repos.createForAuthenticatedUser({
                name: options.name,
                description: options.description,
                private: options.private,
                auto_init: autoInit,
            });

            GitHubService.logger.info('Successfully created repository', {
                html_url: repository.html_url
            });

            return {
                success: true,
                repository: repository as GitHubRepository
            };
        } catch (error: unknown) {
            const octokitError = error as { status?: number; message?: string; response?: { data?: { errors?: Array<{ field?: string; message?: string }> } } };
            
            GitHubService.logger.error('Repository creation failed', {
                status: octokitError?.status,
                message: octokitError?.message,
                name: options.name
            });
            
            if (octokitError?.status === 403) {
                return {
                    success: false,
                    error: 'GitHub App lacks required permissions. Please ensure the app has Contents: Write and Metadata: Read permissions, then re-install it.'
                };
            }
            
            // Check if repository already exists (422 Unprocessable Entity)
            if (octokitError?.status === 422) {
                const hasNameExistsError = octokitError?.response?.data?.errors?.some((e) => 
                    e.field === 'name' && e.message?.includes('already exists')
                );
                
                if (hasNameExistsError) {
                    return {
                        success: false,
                        error: `Repository '${options.name}' already exists on this account`,
                        alreadyExists: true,
                        repositoryName: options.name
                    };
                }
            }
            
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to create repository'
            };
        }
    }


    /**
     * Get repository information from GitHub
     */
    static async getRepository(options: {
        owner: string;
        repo: string;
        token: string;
    }): Promise<{ success: boolean; repository?: GitHubRepository; error?: string }> {
        try {
            const octokit = GitHubService.createOctokit(options.token);
            
            const { data: repository } = await octokit.repos.get({
                owner: options.owner,
                repo: options.repo
            });

            GitHubService.logger.info('Successfully fetched repository', {
                html_url: repository.html_url
            });
            
            return { 
                success: true, 
                repository: repository as GitHubRepository 
            };
        } catch (error: unknown) {
            const octokitError = error as { status?: number; message?: string };
            
            GitHubService.logger.error('Failed to fetch repository', {
                owner: options.owner,
                repo: options.repo,
                status: octokitError?.status,
                message: octokitError?.message
            });
            return { 
                success: false, 
                error: error instanceof Error ? error.message : 'Failed to fetch repository' 
            };
        }
    }

    /**
     * Parse owner and repo name from GitHub URL
     */
    static extractRepoInfo(url: string): { owner: string; repo: string } | null {
        try {
            // Convert SSH URLs to HTTPS
            let cleanUrl = url;
            
            if (url.startsWith('git@github.com:')) {
                cleanUrl = url.replace('git@github.com:', 'https://github.com/');
            }
            
            const urlObj = new URL(cleanUrl);
            const pathParts = urlObj.pathname.split('/').filter(part => part);
            
            if (pathParts.length >= 2) {
                const owner = pathParts[0];
                const repo = pathParts[1].replace('.git', '');
                return { owner, repo };
            }
            
            return null;
        } catch (error) {
            GitHubService.logger.error('Failed to parse repository URL', { url, error });
            return null;
        }
    }

    /**
     * Export git repository to GitHub
     */
    static async exportToGitHub(options: {
        gitObjects: Array<{ path: string; data: Uint8Array }>;
        templateDetails: TemplateDetails | null;
        appQuery: string;
        appCreatedAt?: Date;
        token: string;
        repositoryUrl: string;
        username: string;
        email: string;
    }): Promise<GitHubPushResponse> {
        try {
            GitHubService.logger.info('Starting GitHub export from DO git', {
                gitObjectCount: options.gitObjects.length,
                repositoryUrl: options.repositoryUrl
            });

            // Build in-memory repo from DO git objects
            const fs = await GitCloneService.buildRepository({
                gitObjects: options.gitObjects,
                templateDetails: options.templateDetails,
                appQuery: options.appQuery,
                appCreatedAt: options.appCreatedAt
            });

            // Modify README to add GitHub deploy button
            await GitHubService.modifyReadmeForGitHub(fs, options.repositoryUrl);

            // Get all commits and files from built repo
            const commits = await git.log({ fs, dir: '/', depth: 1000 });
            const files = await GitHubService.getAllFilesFromRepo(fs);

            GitHubService.logger.info('Repository built', {
                commitCount: commits.length,
                fileCount: files.length
            });

            // Push to GitHub with force
            const result = await GitHubService.forcePushToGitHub(
                options.token,
                options.repositoryUrl,
                commits,
                files,
                { name: options.username, email: options.email }
            );

            return result;
        } catch (error) {
            GitHubService.logger.error('GitHub export failed', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            return {
                success: false,
                error: `GitHub export failed: ${errorMessage}`
            };
        }
    }

    /**
     * Replace [cloudflarebutton] placeholder with deploy button
     */
    private static async modifyReadmeForGitHub(fs: MemFS, githubRepoUrl: string): Promise<void> {
        try {
            // Check if README exists
            try {
                await fs.stat('/README.md');
            } catch {
                GitHubService.logger.info('No README.md found, skipping modification');
                return;
            }

            const contentRaw = await fs.readFile('/README.md', { encoding: 'utf8' });
            const content = typeof contentRaw === 'string' ? contentRaw : new TextDecoder().decode(contentRaw);
            
            if (!content.includes('[cloudflarebutton]')) {
                GitHubService.logger.info('README.md has no [cloudflarebutton] placeholder');
                return;
            }

            const modified = content.replaceAll(
                '[cloudflarebutton]',
                prepareCloudflareButton(githubRepoUrl, 'markdown')
            );

            await fs.writeFile('/README.md', modified);
            await git.add({ fs, dir: '/', filepath: 'README.md' });
            await git.commit({
                fs,
                dir: '/',
                message: 'docs: Add Cloudflare deploy button to README',
                author: { 
                    name: 'vibesdk-bot', 
                    email: 'bot@vibesdk.com',
                    timestamp: Math.floor(Date.now() / 1000)
                }
            });

            GitHubService.logger.info('README.md modified and committed');
        } catch (error) {
            GitHubService.logger.warn('Failed to modify README, continuing without', error);
        }
    }

    /**
     * Recursively get all files from repository
     */
    private static async getAllFilesFromRepo(fs: MemFS): Promise<Array<{ path: string; content: string }>> {
        const files: Array<{ path: string; content: string }> = [];
        
        const walkDir = async (dir: string) => {
            const entries = await fs.readdir(dir);
            
            for (const entry of entries) {
                const fullPath = dir === '/' ? `/${entry}` : `${dir}/${entry}`;
                
                // Skip .git
                if (fullPath === '/.git') continue;
                
                const stat = await fs.lstat(fullPath);
                
                if (stat.type === 'dir') {
                    await walkDir(fullPath);
                } else if (stat.type === 'file') {
                    const contentRaw = await fs.readFile(fullPath, { encoding: 'utf8' });
                    const content = typeof contentRaw === 'string' ? contentRaw : new TextDecoder().decode(contentRaw);
                    // Strip leading slash
                    const relativePath = fullPath.slice(1);
                    files.push({ path: relativePath, content });
                }
            }
        };
        
        await walkDir('/');
        return files;
    }

    /**
     * Force push to GitHub while preserving commit history
     */
    private static async forcePushToGitHub(
        token: string,
        repoUrl: string,
        commits: Awaited<ReturnType<typeof git.log>>,
        files: Array<{ path: string; content: string }>,
        author: { name: string; email: string }
    ): Promise<GitHubPushResponse> {
        try {
            const repoInfo = GitHubService.extractRepoInfo(repoUrl);
            if (!repoInfo) {
                throw new GitHubServiceError('Invalid repository URL format', 'INVALID_REPO_URL');
            }

            const { owner, repo } = repoInfo;
            const octokit = GitHubService.createOctokit(token);

            // Get repository and default branch
            const { data: repository } = await octokit.rest.repos.get({ owner, repo });
            const branch = repository.default_branch || 'main';

            GitHubService.logger.info('Pushing to GitHub', {
                owner,
                repo,
                branch,
                commitCount: commits.length,
                fileCount: files.length
            });

            // Create file blobs
            const blobPromises = files.map(file =>
                octokit.git.createBlob({
                    owner,
                    repo,
                    content: Buffer.from(file.content, 'utf8').toString('base64'),
                    encoding: 'base64'
                })
            );
            const blobs = await Promise.all(blobPromises);

            GitHubService.logger.info('Blobs created', { blobCount: blobs.length });

            // Create tree
            const { data: tree } = await octokit.git.createTree({
                owner,
                repo,
                tree: files.map((file, i) => ({
                    path: file.path,
                    mode: '100644' as '100644',
                    type: 'blob' as 'blob',
                    sha: blobs[i].data.sha
                }))
            });

            GitHubService.logger.info('Tree created', { treeSha: tree.sha });

            // Replay commits in order
            let parentSha: string | undefined;
            const reversedCommits = [...commits].reverse();
            
            for (const commit of reversedCommits) {
                const { data: newCommit } = await octokit.git.createCommit({
                    owner,
                    repo,
                    message: commit.commit.message,
                    tree: tree.sha,
                    parents: parentSha ? [parentSha] : [],
                    author: {
                        name: commit.commit.author.name,
                        email: commit.commit.author.email,
                        date: new Date(commit.commit.author.timestamp * 1000).toISOString()
                    },
                    committer: {
                        name: commit.commit.committer?.name || author.name,
                        email: commit.commit.committer?.email || author.email,
                        date: new Date((commit.commit.committer?.timestamp || commit.commit.author.timestamp) * 1000).toISOString()
                    }
                });
                parentSha = newCommit.sha;
            }

            if (!parentSha) {
                throw new Error('No commits were created');
            }

            // Update branch
            await octokit.git.updateRef({
                owner,
                repo,
                ref: `heads/${branch}`,
                sha: parentSha,
                force: true
            });

            GitHubService.logger.info('Force push completed', {
                finalCommitSha: parentSha,
                branch
            });

            return {
                success: true,
                commitSha: parentSha
            };
        } catch (error) {
            GitHubService.logger.error('Force push failed', error);
            throw error;
        }
    }

    /**
     * Check remote repository status vs local commits
     * Builds local repo with template to match export structure
     */
    static async checkRemoteStatus(options: {
        gitObjects: Array<{ path: string; data: Uint8Array }>;
        templateDetails: TemplateDetails | null;
        appQuery: string;
        appCreatedAt?: Date;
        repositoryUrl: string;
        token: string;
    }): Promise<{
        compatible: boolean;
        behindBy: number;
        aheadBy: number;
        divergedCommits: Array<{
            sha: string;
            message: string;
            author: string;
            date: string;
        }>;
    }> {
        try {
            const repoInfo = GitHubService.extractRepoInfo(options.repositoryUrl);
            if (!repoInfo) {
                throw new GitHubServiceError('Invalid repository URL', 'INVALID_REPO_URL');
            }

            const { owner, repo } = repoInfo;
            const octokit = GitHubService.createOctokit(options.token);

            // Get remote commits
            const { data: remoteCommits } = await octokit.repos.listCommits({
                owner,
                repo,
                per_page: 100
            });

            // Build local repo with same template as export
            const fs = await GitCloneService.buildRepository({
                gitObjects: options.gitObjects,
                templateDetails: options.templateDetails,
                appQuery: options.appQuery,
                appCreatedAt: options.appCreatedAt
            });

            const localCommits = await git.log({ fs, dir: '/', depth: 100 });

            // Find divergence
            // Normalize commit messages by trimming whitespace (git.log adds trailing \n, GitHub API doesn't)
            const normalizeMessage = (msg: string) => msg.trim();
            
            // Ignore system-generated commits that we add to GitHub but don't track locally
            const isSystemGeneratedCommit = (message: string) => {
                return normalizeMessage(message).startsWith('docs: Add Cloudflare deploy button');
            };
            
            const localMessages = new Set(localCommits.map(c => normalizeMessage(c.commit.message)));
            const remoteMessages = new Set(remoteCommits.map(c => normalizeMessage(c.commit.message)));

            const hasCommonCommit = localCommits.some(local =>
                remoteCommits.some(remote => 
                    normalizeMessage(remote.commit.message) === normalizeMessage(local.commit.message)
                )
            );

            const localOnly = localCommits.filter(c => !remoteMessages.has(normalizeMessage(c.commit.message)));
            const remoteOnly = remoteCommits.filter(c => 
                !localMessages.has(normalizeMessage(c.commit.message)) && !isSystemGeneratedCommit(c.commit.message)
            );

            return {
                compatible: hasCommonCommit || remoteCommits.length === 0,
                behindBy: localOnly.length,
                aheadBy: remoteOnly.length,
                divergedCommits: remoteOnly.map(c => ({
                    sha: c.sha,
                    message: c.commit.message,
                    author: c.commit.author?.name || 'Unknown',
                    date: c.commit.author?.date || new Date().toISOString()
                }))
            };
        } catch (error) {
            GitHubService.logger.error('Failed to check remote status', error);
            throw error;
        }
    }

}