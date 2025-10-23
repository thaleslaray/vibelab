import { TemplateDetails, TemplateFile } from "./sandboxTypes";

export function getTemplateImportantFiles(templateDetails: TemplateDetails, filterRedacted: boolean = true): TemplateFile[] {
    return templateDetails.importantFiles.map(filePath => ({
        filePath,
        fileContents: filterRedacted && templateDetails.redactedFiles.includes(filePath) ? 'REDACTED' : templateDetails.allFiles[filePath]
    })).filter(f => f.fileContents);
}

export function getTemplateFiles(templateDetails: TemplateDetails): TemplateFile[] {
    return Object.entries(templateDetails.allFiles).map(([filePath, fileContents]) => ({
        filePath,
        fileContents,
    }));
}