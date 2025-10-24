/**
 * Type declarations for isomorphic-git ESM build
 * Fixes "Cannot find module 'isomorphic-git/index.js'" error
 */
declare module 'isomorphic-git/index.js' {
  export * from 'isomorphic-git';
  import git from 'isomorphic-git';
  export default git;
}
