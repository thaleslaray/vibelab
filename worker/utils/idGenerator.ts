/**
 * ID Generation Utility
 * Simple wrapper around crypto.randomUUID() for consistent ID generation
 */

export function generateId(): string {
    return crypto.randomUUID();
}

/**
 * Generate ID without hyphens, suitable for subdomain usage
 * Standard wildcard SSL certificates (*.domain.com) only cover single-level subdomains
 * UUIDs with hyphens would create multi-level subdomains (e.g., prefix-xxxx-yyyy.domain.com)
 * This function removes hyphens to ensure single-level subdomain compatibility
 */
export function generateIdForSubdomain(): string {
    return crypto.randomUUID().replace(/-/g, '');
}