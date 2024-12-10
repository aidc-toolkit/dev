import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "node:path";
import { Octokit } from "octokit";
import { parse as yamlParse } from "yaml";

import configurationJSON from "../config/release.json" assert { type: "json" };
import secureConfigurationJSON from "../config/release.secure.json" assert { type: "json" };

/**
 * Configuration layout of release.json.
 */
interface Configuration {
    /**
     * Organization that owns the repositories.
     */
    organization: string;

    /**
     * Repositories.
     */
    repositories: Record<string, {
        /**
         * Directory in which repository resides, if different from repository name.
         */
        directory?: string;

        /**
         * Version for repository. Not all repositories will be in sync with the version.
         */
        version: string;
    }>;

    /**
     * If true, the fact that the repository is uncommitted is ignored. For development and testing purposes only.
     */
    ignoreUncommitted?: boolean;
}

/**
 * Configuration layout of release.secure.json.
 */
interface SecureConfiguration {
    token: string;
}

const configuration: Configuration = configurationJSON;
const secureConfiguration: SecureConfiguration = secureConfigurationJSON;

/**
 * Configuration layout of package.json (relevant attributes only).
 */
interface PackageConfiguration {
    /**
     * Version.
     */
    version: string;

    /**
     * If true, package is private and not linked by others.
     */
    private?: boolean;

    /**
     * Development dependencies.
     */
    devDependencies?: Record<string, string>;

    /**
     * Dependencies.
     */
    dependencies?: Record<string, string>;
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
 * Run a command and optionally capture its output.
 *
 * @param captureOutput
 * If true, output is captured and returned.
 *
 * @param command
 * Command to run.
 *
 * @param args
 * Arguments to command.
 *
 * @returns
 * Output if captured or empty array if not.
 */
function run(captureOutput: boolean, command: string, ...args: string[]): string[] {
    const spawnResult = spawnSync(command, args, {
        stdio: ["inherit", captureOutput ? "pipe" : "inherit", "inherit"]
    });

    if (spawnResult.error !== undefined) {
        throw spawnResult.error;
    }

    if (spawnResult.status === null) {
        throw new Error(`Terminated by signal ${spawnResult.signal}`);
    }

    if (spawnResult.status !== 0) {
        throw new Error(`Failed with status ${spawnResult.status}`);
    }

    return captureOutput ? spawnResult.stdout.toString().split("\n").slice(0, -1) : [];
}

/**
 * Supported states.
 */
type State = "skipped" | "install" | "build" | "link" | "commit" | "tag" | "push" | "workflow (push)" | "release" | "workflow (release)" | "complete";

/**
 * Release.
 */
async function release(): Promise<void> {
    const statePath = path.resolve("config/release.state.json");

    let state: Record<string, State | undefined> = {};

    if (fs.existsSync(statePath)) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Format is controlled by this process.
        state = JSON.parse(fs.readFileSync(statePath).toString());
    }

    /**
     * Save the current state.
     */
    function saveState(): void {
        fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
    }

    /**
     * Execute a step.
     *
     * @param name
     * Repository name.
     *
     * @param stepState
     * State at which step takes place.
     *
     * @param callback
     * Callback to execute step.
     *
     * @returns
     * Promise.
     */
    async function step(name: string, stepState: State, callback: () => (void | Promise<void>)): Promise<void> {
        const repositoryState = state[name];

        if (repositoryState === undefined || repositoryState === stepState) {
            state[name] = stepState;

            try {
                const result = callback();

                if (result instanceof Promise) {
                    await result;
                }

                state[name] = undefined;
            } finally {
                saveState();
            }
        }
    }

    const octokit = new Octokit({
        auth: secureConfiguration.token,
        userAgent: `${configuration.organization} release`
    });

    let allSkipped = true;

    for (const name of Object.keys(configuration.repositories)) {
        const repository = configuration.repositories[name];

        console.log(`Repository ${name}...`);

        // All repositories are expected to be children of the parent of this repository.
        process.chdir(`../${repository.directory ?? name}`);

        // Repository must be on main branch.
        if (run(true, "git", "branch", "--show-current")[0] !== "main") {
            throw new Error("Repository is not on main branch");
        }

        // Repository must be fully committed except for untracked files.
        if (!(configuration.ignoreUncommitted ?? false) && state[name] === undefined && run(true, "git", "status", "--short", "--untracked-files=no").length !== 0) {
            throw new Error("Repository has uncommitted changes");
        }

        const tag = `v${repository.version}`;

        const octokitParameterBase = {
            owner: configuration.organization,
            repo: name
        };

        const packageConfigurationPath = "package.json";

        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Package configuration format is known.
        const packageConfiguration: PackageConfiguration = JSON.parse(fs.readFileSync(packageConfigurationPath).toString());

        let skipRepository: boolean;

        switch (state[name]) {
            case undefined:
                // No steps have yet been taken; skip if repository is already at the required version.
                skipRepository = packageConfiguration.version === repository.version;

                if (!skipRepository) {
                    allSkipped = false;

                    packageConfiguration.version = repository.version;

                    const atOrganization = `@${configuration.organization}`;

                    /**
                     * Update dependencies from the organization.
                     *
                     * @param dependencies
                     * Dependencies.
                     *
                     * @returns
                     * List of dependencies that require linking.
                     */
                    function updateDependencies(dependencies: Record<string, string> | undefined): string[] {
                        const linkDependencies = new Array<string>();

                        if (dependencies !== undefined) {
                            // eslint-disable-next-line guard-for-in -- Dependency record type is shallow.
                            for (const dependency in dependencies) {
                                const [dependencyAtOrganization, dependencyRepositoryName] = dependency.split("/");

                                if (dependencyAtOrganization === atOrganization) {
                                    dependencies[dependency] = `^${configuration.repositories[dependencyRepositoryName].version}`;

                                    linkDependencies.push(dependency);
                                }
                            }
                        }

                        return linkDependencies;
                    }

                    const linkDependencies = updateDependencies(packageConfiguration.devDependencies);
                    linkDependencies.push(...updateDependencies(packageConfiguration.dependencies));

                    fs.writeFileSync(packageConfigurationPath, `${JSON.stringify(packageConfiguration, null, 2)}\n`);

                    for (const dependency of linkDependencies) {
                        run(false, "npm", "link", dependency);
                    }
                } else if (!allSkipped) {
                    throw new Error(`Repository ${name} is supposed to be skipped but at least one prior repository has been updated`);
                }
                break;

            case "skipped":
                // Repository was skipped on the prior run.
                skipRepository = true;
                break;

            case "complete":
                // Repository was fully updated on the prior run.
                skipRepository = true;

                allSkipped = false;
                break;

            default:
                // Repository failed at some step on the prior run.
                skipRepository = false;

                allSkipped = false;
                break;
        }

        if (!skipRepository) {
            const workflowsPath = ".github/workflows/";

            let hasPushWorkflow = false;
            let hasReleaseWorkflow = false;

            if (fs.existsSync(workflowsPath)) {
                for (const workflowFile of fs.readdirSync(workflowsPath)) {
                    if (workflowFile.endsWith(".yml")) {
                        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Workflow configuration format is known.
                        const workflowOn = (yamlParse(fs.readFileSync(path.resolve(workflowsPath, workflowFile)).toString()) as WorkflowConfiguration).on;

                        if (workflowOn.push !== undefined && (workflowOn.push.branches === undefined || workflowOn.push.branches.includes("main"))) {
                            hasPushWorkflow = true;
                        }

                        if (workflowOn.release !== undefined && (workflowOn.release.types === undefined || workflowOn.release.types.includes("published"))) {
                            hasReleaseWorkflow = true;
                        }
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
                    await new Promise<void>((resolve) => {
                        setTimeout(resolve, 2000);
                    });

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

                                console.log(`Workflow run ID ${workflowRunID}`);
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

            await step(name, "install", () => {
                run(false, "npm", "install");
            });

            await step(name, "build", () => {
                run(false, "npm", "run", "build", "--if-present");
            });

            if (!(packageConfiguration.private ?? false)) {
                await step(name, "link", () => {
                    run(false, "npm", "link");
                });
            }

            await step(name, "commit", () => {
                run(false, "git", "commit", "--all", `--message=Updated to version ${repository.version}`);
            });

            await step(name, "tag", () => {
                run(false, "git", "tag", tag);
            });

            await step(name, "push", () => {
                run(false, "git", "push", "--atomic", "origin", "main", tag);
            });

            if (hasPushWorkflow) {
                await step(name, "workflow (push)", async () => {
                    await validateWorkflow();
                });
            }

            await step(name, "release", async () => {
                const versionSplit = repository.version.split("-");
                const prerelease = versionSplit.length !== 1;

                await octokit.rest.repos.createRelease({
                    ...octokitParameterBase,
                    tag_name: tag,
                    name: `${prerelease ? `${versionSplit[1].substring(0, 1).toUpperCase()}${versionSplit[1].substring(1)} r` : "R"}elease ${versionSplit[0]}`,
                    // TODO Remove "false" override.
                    prerelease: false
                });
            });

            if (hasReleaseWorkflow) {
                await step(name, "workflow (release)", async () => {
                    await validateWorkflow();
                });
            }

            state[name] = "complete";
        } else {
            state[name] = "skipped";
        }

        saveState();
    }

    // All repositories released.
    fs.rmSync(statePath);
}

await release().catch((e: unknown) => {
    console.error(e);
});
