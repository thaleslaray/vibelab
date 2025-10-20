import { TemplateDetails, TemplateFile } from "./sandboxTypes";

export function getTemplateImportantFiles(templateDetails: TemplateDetails): TemplateFile[] {
    return templateDetails.importantFiles.map(filePath => ({
        filePath,
        fileContents: templateDetails.allFiles[filePath],
    }));
}

export function getTemplateFiles(templateDetails: TemplateDetails): TemplateFile[] {
    return Object.entries(templateDetails.allFiles).map(([filePath, fileContents]) => ({
        filePath,
        fileContents,
    }));
}