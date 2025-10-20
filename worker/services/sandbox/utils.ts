import { TemplateDetails, TemplateFile } from "./sandboxTypes";

export function getTemplateImportantFiles(templateDetails: TemplateDetails): TemplateFile[] {
    return templateDetails.importantFiles.map(filePath => ({
        filePath,
        fileContents: templateDetails.allFiles[filePath],
    }));
}