export declare class TaskParameters {
    private static taskparams;
    private _azureDevopsProjectUrl;
    private _azurePipelineName;
    private _azureDevopsToken;
    private _azurePipelineVariables;
    private constructor();
    static getTaskParams(): TaskParameters;
    get azureDevopsProjectUrl(): string;
    get azurePipelineName(): string;
    get azureDevopsToken(): string;
    get azurePipelineVariables(): string;
}
//# sourceMappingURL=task.parameters.d.ts.map