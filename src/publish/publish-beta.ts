import * as fs from "node:fs";
import * as path from "node:path";
import { setTimeout } from "node:timers/promises";
import { Octokit } from "octokit";
import { parse as yamlParse } from "yaml";
import secureConfigurationJSON from "../../config/publish.secure.json";
import { Publish } from "./publish.js";
import { logger } from "./logger.js";

/**
 * Configuration layout of publish.secure.json.
 */
interface SecureConfiguration {
    token: string;
}

/**
 * Configuration layout of release.yml workflow (relevant attributes only).
 */
interface WorkflowConfiguration {
    /**
     * Workflow name.
     */
    name: string;

    /**
     * Workflow trigger.
     */
    on: {
        /**
         * Push trigger.
         */
        push?: {
            /**
             * Push branches.
             */
            branches?: string[];
        } | null;

        /**
         * Release trigger.
         */
        release?: {
            /**
             * Release types.
             */
            types?: string[];
        } | null;
    };
}

/**
 * Publish steps.
 */
type Step = "update" | "build" | "commit" | "tag" | "push" | "workflow (push)" | "release" | "workflow (release)" | "complete";

/**
 * Publish beta versions.
 */
class PublishBeta extends Publish {
    /**
     * Secure configuration.
     */
    private readonly _secureConfiguration: SecureConfiguration = secureConfigurationJSON;

    /**
     * Octokit.
     */
    private readonly _octokit: Octokit;

    /**
     * Constructor.
     *
     * @param dryRun
     * If true, outputs what would be run rather than running it.
     */
    constructor(dryRun: boolean) {
        super("beta", dryRun);

        this._octokit = new Octokit({
            auth: this._secureConfiguration.token,
            userAgent: `${this.configuration.organization} release`
        });
    }

    /**
     * Run a step.
     *
     * Repository.
     *
     * @param step
     * State at which step takes place.
     *
     * @param stepRunner
     * Callback to execute step.
     */
    private async runStep(step: Step, stepRunner: () => (void | Promise<void>)): Promise<void> {
        if (this.repository.publishBetaStep === undefined || this.repository.publishBetaStep === step) {
            logger.debug(`Running step ${step}`);

            this.repository.publishBetaStep = step;

            await stepRunner();

            this.repository.publishBetaStep = undefined;
        } else {
            logger.debug(`Skipping step ${step}`);
        }
    }

    /**
     * Validate the workflow by waiting for it to complete.
     *
     * Branch on which workflow is running.
     */
    private async validateWorkflow(): Promise<void> {
        if (this.dryRun) {
            logger.info("Dry run: Validate workflow");
        } else {
            const commitSHA = this.run(true, true, "git", "rev-parse", this.branch)[0];

            let completed = false;
            let queryCount = 0;
            let workflowRunID = -1;

            do {
                // eslint-disable-next-line no-await-in-loop -- Loop depends on awaited response.
                const response = await setTimeout(2000).then(
                    async () => this._octokit.rest.actions.listWorkflowRunsForRepo({
                        owner: this.configuration.organization,
                        repo: this.repositoryName,
                        head_sha: commitSHA
                    })
                );

                for (const workflowRun of response.data.workflow_runs) {
                    if (workflowRun.status !== "completed") {
                        if (workflowRun.id === workflowRunID) {
                            process.stdout.write(".");
                        } else if (workflowRunID === -1) {
                            workflowRunID = workflowRun.id;

                            logger.info(`Workflow run ID ${workflowRunID}`);
                        } else {
                            throw new Error(`Parallel workflow runs for SHA ${commitSHA}`);
                        }
                    } else if (workflowRun.id === workflowRunID) {
                        process.stdout.write("\n");

                        if (workflowRun.conclusion !== "success") {
                            throw new Error(`Workflow ${workflowRun.conclusion}`);
                        }

                        completed = true;
                    }
                }

                // Abort if workflow run not started after 10 queries.
                if (++queryCount === 10 && workflowRunID === -1) {
                    throw new Error(`Workflow run not started for SHA ${commitSHA}`);
                }
            } while (!completed);
        }
    }

    /**
     * @inheritDoc
     */
    protected async publish(): Promise<void> {
        let publish: boolean;

        // Scrap any incomplete publishing if pre-release identifier is not beta.
        if (this.preReleaseIdentifier !== "beta") {
            this.repository.publishBetaStep = undefined;
        }

        if (this.preReleaseIdentifier === "alpha") {
            if (this.anyChanges(this.repository.lastAlphaPublished, true)) {
                throw new Error("Repository has changed since last alpha published");
            }

            publish = true;

            this.updatePackageVersion(undefined, undefined, undefined, "beta");

            // Revert to default registry for organization.
            this.run(false, false, "npm", "config", "delete", this.atOrganizationRegistry, "--location", "project");
        } else {
            const startingPublication = this.repository.publishBetaStep === undefined;

            // Publish beta step is defined and not "complete" if previous attempt failed at that step.
            publish = !startingPublication && this.repository.publishBetaStep !== "complete";

            // Ignore changes after publication process has started.
            if (startingPublication && this.anyChanges(this.repository.lastAlphaPublished, false)) {
                throw new Error("Internal error, repository has changed without intermediate alpha publication");
            }
        }

        if (publish) {
            const tag = `v${this.packageConfiguration.version}`;

            if (this.repository.publishBetaStep !== undefined) {
                logger.debug(`Repository failed at step "${this.repository.publishBetaStep}" on prior run`);
            }

            const workflowsPath = ".github/workflows/";

            let hasPushWorkflow = false;
            let hasReleaseWorkflow = false;

            if (fs.existsSync(workflowsPath)) {
                logger.debug("Checking workflows");

                for (const workflowFile of fs.readdirSync(workflowsPath).filter(workflowFile => workflowFile.endsWith(".yml"))) {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Workflow configuration format is known.
                    const workflowOn = (yamlParse(fs.readFileSync(path.resolve(workflowsPath, workflowFile)).toString()) as WorkflowConfiguration).on;

                    if (workflowOn.push !== undefined && (workflowOn.push?.branches === undefined || workflowOn.push.branches.includes("v*"))) {
                        logger.debug("Repository has push workflow");

                        hasPushWorkflow = true;
                    }

                    if (workflowOn.release !== undefined && (workflowOn.release?.types === undefined || workflowOn.release.types.includes("published"))) {
                        logger.debug("Repository has release workflow");

                        hasReleaseWorkflow = true;
                    }
                }
            }

            await this.runStep("update", () => {
                this.updateOrganizationDependencies();
            });

            await this.runStep("build", () => {
                this.run(false, false, "npm", "run", "build:release", "--if-present");
            });

            await this.runStep("commit", () => {
                this.commitUpdatedPackageVersion();
            });

            await this.runStep("tag", () => {
                this.run(false, false, "git", "tag", tag);
            });

            await this.runStep("push", () => {
                this.run(false, false, "git", "push", "--atomic", "origin", this.branch, tag);
            });

            if (hasPushWorkflow) {
                await this.runStep("workflow (push)", async () => {
                    await this.validateWorkflow();
                });
            }

            await this.runStep("release", async () => {
                if (this.dryRun) {
                    logger.info("Dry run: Create release");
                } else {
                    await this._octokit.rest.repos.createRelease({
                        owner: this.configuration.organization,
                        repo: this.repositoryName,
                        tag_name: tag,
                        name: `Release ${tag}`,
                        prerelease: true
                    });
                }
            });

            if (hasReleaseWorkflow) {
                await this.runStep("workflow (release)", async () => {
                    await this.validateWorkflow();
                });
            }

            this.repository.lastBetaPublished = new Date().toISOString();
            this.repository.lastBetaTag = tag;
            this.repository.publishBetaStep = "complete";
        }
    }

    /**
     * @inheritDoc
     */
    protected override finalizeAll(): void {
        // Publication complete; reset steps to undefined for next run.
        for (const repository of Object.values(this.configuration.repositories)) {
            repository.publishBetaStep = undefined;
        }
    }
}

// Detailed syntax checking not required as this is an internal tool.
await new PublishBeta(process.argv.includes("--dry-run")).publishAll().catch((e: unknown) => {
    logger.error(e);
});
