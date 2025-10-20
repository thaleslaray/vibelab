import * as Diff from 'diff';
import { IFileManager } from '../interfaces/IFileManager';
import { IStateManager } from '../interfaces/IStateManager';
import { FileOutputType } from '../../schemas';
// import { TemplateDetails } from '../../../services/sandbox/sandboxTypes';
import { FileProcessing } from '../../domain/pure/FileProcessing';
import { FileState } from 'worker/agents/core/state';

/**
 * Manages file operations for code generation
 * Handles both template and generated files
 */
export class FileManager implements IFileManager {
    constructor(
        private stateManager: IStateManager
    ) {}

    getGeneratedFile(path: string): FileOutputType | null {
        const state = this.stateManager.getState();
        return state.generatedFilesMap[path] || null;
    }

    getAllFiles(): FileOutputType[] {
        const state = this.stateManager.getState();
        return FileProcessing.getAllFiles(state.templateDetails, state.generatedFilesMap);
    }

    saveGeneratedFile(file: FileOutputType): FileState {
        return this.saveGeneratedFiles([file])[0];
    }

    saveGeneratedFiles(files: FileOutputType[]): FileState[] {
        const state = this.stateManager.getState();
        const filesMap = { ...state.generatedFilesMap };
        const fileStates: FileState[] = [];
        
        for (const file of files) {
            let lastDiff = '';
            const oldFile = filesMap[file.filePath];
            
            // Get comparison base: from generatedFilesMap, template/filesystem, or empty string for new files
            // TODO: fix checking against template files
            const oldFileContents = oldFile?.fileContents ?? (this.getGeneratedFile(file.filePath)?.fileContents || '');
            
            // Generate diff if contents changed
            if (oldFileContents !== file.fileContents) {
                try {
                    lastDiff = Diff.createPatch(file.filePath, oldFileContents, file.fileContents);
                    if (lastDiff) {
                        const isNewFile = oldFileContents === '';
                        console.log(`Generated diff for ${isNewFile ? 'new' : ''} file ${file.filePath}:`, lastDiff);
                    }
                } catch (error) {
                    console.error(`Failed to generate diff for file ${file.filePath}:`, error);
                }
            }
            
            const fileState = {
                ...file,
                lasthash: '',
                lastmodified: Date.now(),
                unmerged: [],
                lastDiff
            }
            filesMap[file.filePath] = fileState;
            fileStates.push(fileState);
        }
        
        this.stateManager.setState({
            ...state,
            generatedFilesMap: filesMap
        });
        return fileStates;
    }

    deleteFiles(filePaths: string[]): void {
        const state = this.stateManager.getState();
        const newFilesMap = { ...state.generatedFilesMap };
        
        for (const filePath of filePaths) {
            delete newFilesMap[filePath];
        }
        
        this.stateManager.setState({
            ...state,
            generatedFilesMap: newFilesMap
        });
    }
    fileExists(path: string): boolean {
        return !!this.getGeneratedFile(path)
    }

    getGeneratedFilePaths(): string[] {
        const state = this.stateManager.getState();
        return Object.keys(state.generatedFilesMap);
    }

    getGeneratedFilesMap(): Record<string, FileOutputType> {
        const state = this.stateManager.getState();
        return state.generatedFilesMap;
    }

    getGeneratedFiles(): FileOutputType[] {
        const state = this.stateManager.getState();
        return Object.values(state.generatedFilesMap);
    }
}