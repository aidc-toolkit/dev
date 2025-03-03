import * as fs from "fs";
import * as path from "node:path";
import * as util from "node:util";
import { Octokit } from "octokit";
import { parse as yamlParse } from "yaml";
import {
    anyChanges,
    configuration,
    organizationRepository, type PackageConfiguration,
    publishRepositories,
    type Repository,
    saveConfiguration,
    secureConfiguration
} from "./publish";
import { logger, run } from "./utility.js";

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
        };

        /**
         * Release trigger.
         */
        release?: {
            /**
             * Release types.
             */
            types?: string[];
        };
    };
}

/**
 * Supported steps.
 */
type Step =
    "skipped" | "install" | "build" | "commit" | "tag" | "push" | "workflow (push)" | "release" | "workflow (release)" | "restore alpha" | "complete";

/**
 * Execute a step.
 *
 * @param repository
 * Repository.
 *
 * @param step
 * State at which step takes place.
 *
 * @param callback
 * Callback to execute step.
 *
 * @returns
 * Promise.
 */
async function runStep(repository: Repository, step: Step, callback: () => (void | Promise<void>)): Promise<void> {
    if (repository.publishExternalStep === undefined || repository.publishExternalStep === step) {
        logger.debug(`Running step ${step}`);

        repository.publishExternalStep = step;

        try {
            const result = callback();

            if (result instanceof Promise) {
                await result;
            }

            repository.publishExternalStep = undefined;
        } finally {
            saveConfiguration();
        }
    } else {
        logger.debug(`Skipping step ${step}`);
    }
}

/**
 * Update dependencies from the organization.
 *
 * @param restoreAlpha
 * If true, restore "alpha" as the version for development.
 *
 * @param development
 * True if updating development dependencies.
 *
 * @param internal
 * True if the package is for internal use only and its version should not be used in dependencies.
 *
 * @param dependencies
 * Dependencies.
 *
 * @returns
 * True if any dependencies were updated.
 */
function updateDependencies(restoreAlpha: boolean, development: boolean, internal: boolean | undefined, dependencies: Record<string, string> | undefined): boolean {
    let anyUpdated = false;

    if (dependencies !== undefined) {
        // eslint-disable-next-line guard-for-in -- Dependency record type is shallow.
        for (const dependency in dependencies) {
            const dependencyRepositoryName = organizationRepository(dependency);

            if (dependencyRepositoryName !== null) {
                const dependencyRepository = configuration.repositories[dependencyRepositoryName];

                // Set to explicit version for external dependency.
                if (dependencyRepository.dependencyType === "external") {
                    dependencies[dependency] = !restoreAlpha ? `^${dependencyRepository.lastExternalVersion}` : "alpha";
                    anyUpdated = true;
                } else if (!restoreAlpha && !development && internal !== true) {
                    throw new Error("Internal dependency specified for external package");
                }
            }
        }
    }

    return anyUpdated;
}

const octokit = new Octokit({
    auth: secureConfiguration.token,
    userAgent: `${configuration.organization} release`
});

await publishRepositories(async (name, repository) => {
    // Repository must be on main branch.
    if (run(true, "git", "branch", "--show-current")[0] !== "main") {
        throw new Error("Repository is not on main branch");
    }

    const packageConfigurationPath = "package.json";

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Package configuration format is known.
    const packageConfiguration: PackageConfiguration = JSON.parse(fs.readFileSync(packageConfigurationPath).toString());

    let publish: boolean;

    switch (repository.publishExternalStep) {
        case undefined:
            // Check for publish external always is done afterward so that check for uncommitted files can be done.
            publish = anyChanges(repository, true) || repository.publishExternalAlways === true;

            if (publish && anyChanges(repository, false)) {
                throw new Error("Repository has internal changes that have not been published");
            }
            break;

        case "complete":
            // Previous publication succeeded but subsequent repository failed; skip this repository.
            publish = false;
            break;

        default:
            // Previous publication failed.
            publish = true;
            break;
    }

    if (packageConfiguration.version !== repository.lastExternalVersion) {
        // Package version has already been updated, either manually or by previous failed run.
        publish = true;
    } else if (publish) {
        const packageVersionSplits = packageConfiguration.version.split("-");

        // Extract semantic version and pre-release identifier.
        const semanticVersion = packageVersionSplits[0];
        const preReleaseIdentifier = packageVersionSplits.length !== 1 ? `-${packageVersionSplits[1]}` : "";

        // Parse semantic version into its components.
        const [majorVersion, minorVersion, patchVersion] = semanticVersion.split(".").map(versionString => Number(versionString));

        // Increment patch version number.
        packageConfiguration.version = `${majorVersion}.${minorVersion}.${patchVersion + 1}${preReleaseIdentifier}`;
    }

    const tag = `v${packageConfiguration.version}`;

    const octokitParameterBase = {
        owner: configuration.organization,
        repo: name
    };

    const internal = repository.dependencyType === "internal";

    if (publish) {
        if (repository.publishExternalStep === undefined) {
            updateDependencies(false, true, internal, packageConfiguration.devDependencies);
            updateDependencies(false, false, internal, packageConfiguration.dependencies);

            fs.writeFileSync(packageConfigurationPath, `${JSON.stringify(packageConfiguration, null, 2)}\n`);
        } else {
            logger.debug(`Repository failed at step ${repository.publishExternalStep} on prior run`);
        }

        const workflowsPath = ".github/workflows/";

        let hasPushWorkflow = false;
        let hasReleaseWorkflow = false;

        if (fs.existsSync(workflowsPath)) {
            logger.debug("Checking workflows");

            for (const workflowFile of fs.readdirSync(workflowsPath).filter(workflowFile => workflowFile.endsWith(".yml"))) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Workflow configuration format is known.
                const workflowOn = (yamlParse(fs.readFileSync(path.resolve(workflowsPath, workflowFile)).toString()) as WorkflowConfiguration).on;

                if (workflowOn.push !== undefined && (workflowOn.push.branches === undefined || workflowOn.push.branches.includes("main"))) {
                    logger.debug("Repository has push workflow");

                    hasPushWorkflow = true;
                }

                if (workflowOn.release !== undefined && (workflowOn.release.types === undefined || workflowOn.release.types.includes("published"))) {
                    logger.debug("Repository has release workflow");

                    hasReleaseWorkflow = true;
                }
            }
        }

        /**
         * Validate the workflow by waiting for it to complete.
         */
        async function validateWorkflow(): Promise<void> {
            const commitSHA = run(true, "git", "rev-parse", "HEAD")[0];

            let completed = false;
            let queryCount = 0;
            let workflowRunID = -1;

            do {
                await util.promisify(setTimeout)(2000);

                const response = await octokit.rest.actions.listWorkflowRunsForRepo({
                    ...octokitParameterBase,
                    head_sha: commitSHA
                });

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

        await runStep(repository, "install", () => {
            run(false, "npm", "install");
        });

        await runStep(repository, "build", () => {
            run(false, "npm", "run", "build", "--if-present");
        });

        await runStep(repository, "commit", () => {
            run(false, "git", "commit", "--all", `--message=Updated to version ${packageConfiguration.version}.`);
        });

        await runStep(repository, "tag", () => {
            run(false, "git", "tag", tag);
        });

        await runStep(repository, "push", () => {
            run(false, "git", "push", "--atomic", "origin", "main", tag);
        });

        if (hasPushWorkflow) {
            await runStep(repository, "workflow (push)", async () => {
                await validateWorkflow();
            });
        }

        await runStep(repository, "release", async () => {
            const versionSplit = packageConfiguration.version.split("-");
            const prerelease = versionSplit.length !== 1;

            await octokit.rest.repos.createRelease({
                ...octokitParameterBase,
                tag_name: tag,
                name: `${prerelease ? `${versionSplit[1].substring(0, 1).toUpperCase()}${versionSplit[1].substring(1)}` : "Production"} release ${versionSplit[0]}`,
                prerelease
            });
        });

        if (hasReleaseWorkflow) {
            await runStep(repository, "workflow (release)", async () => {
                await validateWorkflow();
            });
        }

        await runStep(repository, "restore alpha", () => {
            // Restore dependencies to "alpha" version for development.
            const devDependenciesUpdated = updateDependencies(true, true, internal, packageConfiguration.devDependencies);
            const dependenciesUpdated = updateDependencies(true, false, internal, packageConfiguration.dependencies);

            if (devDependenciesUpdated || dependenciesUpdated) {
                fs.writeFileSync(packageConfigurationPath, `${JSON.stringify(packageConfiguration, null, 2)}\n`);
                run(false, "git", "commit", "--all", "--message=Restored alpha version.");
            }
        });

        repository.lastExternalPublished = new Date().toISOString();
        repository.lastExternalVersion = packageConfiguration.version;
        repository.publishExternalStep = "complete";
    }
}).then(() => {
    // Publication complete; reset steps to undefined for next run.
    for (const repository of Object.values(configuration.repositories)) {
        repository.publishExternalStep = undefined;
    }

    saveConfiguration();

    run(false, "git", "commit", "--all", "--message=Published externally.");
}).catch((e: unknown) => {
    logger.error(e);
});
