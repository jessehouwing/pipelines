"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PipelineRunner = void 0;
const core = __importStar(require("@actions/core"));
const azdev = __importStar(require("azure-devops-node-api"));
const task_parameters_1 = require("./task.parameters");
const pipeline_error_1 = require("./pipeline.error");
const ReleaseInterfaces = __importStar(require("azure-devops-node-api/interfaces/ReleaseInterfaces"));
const BuildInterfaces = __importStar(require("azure-devops-node-api/interfaces/BuildInterfaces"));
const pipeline_helper_1 = require("./util/pipeline.helper");
const logger_1 = require("./util/logger");
const url_parser_1 = require("./util/url.parser");
class PipelineRunner {
    taskParameters;
    repository = pipeline_helper_1.PipelineHelper.processEnv("GITHUB_REPOSITORY");
    branch = pipeline_helper_1.PipelineHelper.processEnv("GITHUB_REF");
    commitId = pipeline_helper_1.PipelineHelper.processEnv("GITHUB_SHA");
    githubRepo = "GitHub";
    constructor(taskParameters) {
        this.taskParameters = taskParameters;
    }
    async start() {
        try {
            const taskParams = task_parameters_1.TaskParameters.getTaskParams();
            const authHandler = azdev.getPersonalAccessTokenHandler(taskParams.azureDevopsToken);
            const collectionUrl = url_parser_1.UrlParser.GetCollectionUrlBase(this.taskParameters.azureDevopsProjectUrl);
            core.info(`Creating connection with Azure DevOps service : "${collectionUrl}"`);
            const webApi = new azdev.WebApi(collectionUrl, authHandler);
            core.info("Connection created");
            const pipelineName = this.taskParameters.azurePipelineName;
            try {
                core.debug(`Triggering Yaml pipeline : "${pipelineName}"`);
                await this.RunYamlPipeline(webApi);
            }
            catch (error) {
                if (error instanceof pipeline_error_1.PipelineNotFoundError) {
                    core.debug(`Triggering Designer pipeline : "${pipelineName}"`);
                    await this.RunDesignerPipeline(webApi);
                }
                else {
                    throw error;
                }
            }
        }
        catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            core.setFailed(err.message);
        }
    }
    async RunYamlPipeline(webApi) {
        const projectName = url_parser_1.UrlParser.GetProjectName(this.taskParameters.azureDevopsProjectUrl);
        const pipelineName = this.taskParameters.azurePipelineName;
        const buildApi = await webApi.getBuildApi();
        // Get matching build definitions for the given project and pipeline name
        const buildDefinitions = await buildApi.getDefinitions(projectName, pipelineName);
        pipeline_helper_1.PipelineHelper.EnsureValidPipeline(projectName, pipelineName, buildDefinitions);
        // Extract Id from build definition
        const buildDefinitionReference = buildDefinitions[0];
        const buildDefinitionId = buildDefinitionReference.id;
        // Get build definition for the matching definition Id
        const buildDefinition = await buildApi.getDefinition(projectName, buildDefinitionId);
        logger_1.Logger.LogPipelineObject(buildDefinition);
        // Fetch repository details from build definition
        const repositoryId = buildDefinition.repository.id.trim();
        const repositoryType = buildDefinition.repository.type.trim();
        let sourceBranch = null;
        let sourceVersion = null;
        // If definition is linked to existing github repo, pass github source branch and source version to build
        if (pipeline_helper_1.PipelineHelper.equals(repositoryId, this.repository) && pipeline_helper_1.PipelineHelper.equals(repositoryType, this.githubRepo)) {
            core.debug("pipeline is linked to same Github repo");
            sourceBranch = this.branch;
            sourceVersion = this.commitId;
        }
        else {
            core.debug("pipeline is not linked to same Github repo");
        }
        const build = {
            definition: {
                id: buildDefinition.id
            },
            project: {
                id: buildDefinition.project.id
            },
            sourceBranch: sourceBranch,
            sourceVersion: sourceVersion,
            reason: BuildInterfaces.BuildReason.Triggered,
            parameters: this.taskParameters.azurePipelineVariables
        };
        logger_1.Logger.LogPipelineTriggerInput(build);
        // Queue build
        const buildQueueResult = await buildApi.queueBuild(build, build.project.id, true);
        if (buildQueueResult != null) {
            logger_1.Logger.LogPipelineTriggerOutput(buildQueueResult);
            // If build result contains validation errors set result to FAILED
            if (buildQueueResult.validationResults != null && buildQueueResult.validationResults.length > 0) {
                const errorAndWarningMessage = pipeline_helper_1.PipelineHelper.getErrorAndWarningMessageFromBuildResult(buildQueueResult.validationResults);
                core.setFailed("Errors: " + errorAndWarningMessage.errorMessage + " Warnings: " + errorAndWarningMessage.warningMessage);
            }
            else {
                logger_1.Logger.LogPipelineTriggered(pipelineName, projectName);
                if (buildQueueResult._links != null) {
                    logger_1.Logger.LogOutputUrl(buildQueueResult._links.web.href);
                }
            }
        }
    }
    async RunDesignerPipeline(webApi) {
        const projectName = url_parser_1.UrlParser.GetProjectName(this.taskParameters.azureDevopsProjectUrl);
        const pipelineName = this.taskParameters.azurePipelineName;
        const releaseApi = await webApi.getReleaseApi();
        // Get release definitions for the given project name and pipeline name
        const releaseDefinitions = await releaseApi.getReleaseDefinitions(projectName, pipelineName, ReleaseInterfaces.ReleaseDefinitionExpands.Artifacts);
        pipeline_helper_1.PipelineHelper.EnsureValidPipeline(projectName, pipelineName, releaseDefinitions);
        const releaseDefinition = releaseDefinitions[0];
        logger_1.Logger.LogPipelineObject(releaseDefinition);
        // Create ConfigurationVariableValue objects from the input variables
        let variables = undefined;
        if (this.taskParameters.azurePipelineVariables) {
            const parsed = JSON.parse(this.taskParameters.azurePipelineVariables);
            variables = {};
            Object.keys(parsed).forEach((key) => {
                variables[key] = { value: parsed[key] };
            });
        }
        // Filter Github artifacts from release definition
        const gitHubArtifacts = releaseDefinition.artifacts.filter(pipeline_helper_1.PipelineHelper.isGitHubArtifact);
        const artifacts = [];
        if (gitHubArtifacts == null || gitHubArtifacts.length == 0) {
            core.debug("Pipeline is not linked to any GitHub artifact");
            // If no GitHub artifacts found it means pipeline is not linked to any GitHub artifact
        }
        else {
            // If pipeline has any matching Github artifact
            core.debug("Pipeline is linked to GitHub artifact. Looking for now matching repository");
            gitHubArtifacts.forEach(gitHubArtifact => {
                if (gitHubArtifact.definitionReference != null && pipeline_helper_1.PipelineHelper.equals(gitHubArtifact.definitionReference.definition.name, this.repository)) {
                    // Add version information for matching GitHub artifact
                    const artifactMetadata = {
                        alias: gitHubArtifact.alias,
                        instanceReference: {
                            id: this.commitId,
                            sourceBranch: this.branch,
                            sourceRepositoryType: this.githubRepo,
                            sourceRepositoryId: this.repository,
                            sourceVersion: this.commitId
                        }
                    };
                    core.debug("pipeline is linked to same Github repo");
                    artifacts.push(artifactMetadata);
                }
            });
        }
        const releaseStartMetadata = {
            definitionId: releaseDefinition.id,
            reason: ReleaseInterfaces.ReleaseReason.ContinuousIntegration,
            artifacts: artifacts,
            variables: variables
        };
        logger_1.Logger.LogPipelineTriggerInput(releaseStartMetadata);
        // create release
        const release = await releaseApi.createRelease(releaseStartMetadata, projectName);
        if (release != null) {
            logger_1.Logger.LogPipelineTriggered(pipelineName, projectName);
            logger_1.Logger.LogPipelineTriggerOutput(release);
            if (release._links != null) {
                logger_1.Logger.LogOutputUrl(release._links.web.href);
            }
        }
    }
}
exports.PipelineRunner = PipelineRunner;
//# sourceMappingURL=pipeline.runner.js.map