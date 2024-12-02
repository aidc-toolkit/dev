import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "node:path";
import { Octokit } from "octokit";
import { parse as yamlParse } from "yaml";

import configurationJSON from "../config/publish.json" assert { type: "json" };
import secureConfigurationJSON from "../config/publish.secure.json" assert { type: "json" };

/**
 * Configuration layout of publish.json.
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
 * Configuration layout of publish.secure.json.
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
 * Publish.
 */
async function publish(): Promise<void> {
    const statePath = path.resolve("config/publish.state.json");

    let repositoryStates: Record<string, string | undefined> = {};

    if (fs.existsSync(statePath)) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Format is controlled by this process.
        repositoryStates = JSON.parse(fs.readFileSync(statePath).toString());
    }

    /**
     * Save the current state.
     */
    function saveState(): void {
        fs.writeFileSync(statePath, `${JSON.stringify(repositoryStates, null, 2)}\n`);
    }

    /**
     * Execute a step.
     *
     * @param name
     * Repository name.
     *
     * @param state
     * State at which step takes place.
     *
     * @param callback
     * Callback to execute step.
     *
     * @returns
     * Promise.
     */
    async function step(name: string, state: string, callback: () => (void | Promise<void>)): Promise<void> {
        const repositoryState = repositoryStates[name];

        if (repositoryState === undefined || repositoryState === state) {
            repositoryStates[name] = state;

            try {
                const result = callback();

                if (result instanceof Promise) {
                    await result;
                }

                repositoryStates[name] = undefined;
            } finally {
                fs.writeFileSync(statePath, `${JSON.stringify(repositoryStates, null, 2)}\n`);
            }
        }
    }

    const octokit = new Octokit({
        auth: secureConfiguration.token,
        userAgent: `${configuration.organization} publisher`
    });

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
        if (!(configuration.ignoreUncommitted ?? false) && repositoryStates[name] === undefined && run(true, "git", "status", "--short", "--untracked-files=no").length !== 0) {
            throw new Error("Repository has uncommitted changes");
        }

        const workflowsPath = ".github/workflows/";

        let hasPushWorkflow = false;
        let hasReleaseWorkflow = false;

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

        const tag = `v${repository.version}`;

        const octokitParameterBase = {
            owner: configuration.organization,
            repo: name
        };

        const commitSHA = run(true, "git", "rev-parse", "HEAD")[0];

        /**
         * Validate the workflow by waiting for it to complete.
         */
        async function validateWorkflow(): Promise<void> {
            while (!await new Promise<void>((resolve) => {
                setTimeout(resolve, 2000);
            }).then(async () => await octokit.rest.actions.listWorkflowRunsForRepo({
                ...octokitParameterBase,
                head_sha: commitSHA
            })).then((response) => {
                let workflowRunID = -1;

                let queryCount = 0;
                let completed = false;

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

                return completed;
            })) {
                // Execution within conditional.
            }
        }

        const packageConfigurationPath = "package.json";

        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Package configuration format is known.
        const packageConfiguration: PackageConfiguration = JSON.parse(fs.readFileSync(packageConfigurationPath).toString());

        const skipRepository = repositoryStates[name] === undefined && packageConfiguration.version === repository.version;

        if (packageConfiguration.version !== repository.version) {
            packageConfiguration.version = repository.version;

            const atOrganization = `@${configuration.organization}/`;

            /**
             * Update dependencies from the organization.
             *
             * @param dependencies
             * Dependencies.
             */
            function updateDependencies(dependencies: Record<string, string> | undefined): void {
                if (dependencies !== undefined) {
                    for (const dependency in dependencies) {
                        const [dependencyAtOrganization, dependencyRepositoryName] = dependency.split("/");

                        if (dependencyAtOrganization === atOrganization) {
                            dependencies[dependency] = `^${configuration.repositories[dependencyRepositoryName].version}`;
                        }
                    }
                }
            }

            updateDependencies(packageConfiguration.devDependencies);
            updateDependencies(packageConfiguration.dependencies);

            fs.writeFileSync(packageConfigurationPath, `${JSON.stringify(packageConfiguration, null, 2)}\n`);
        }

        if (!skipRepository) {
            await step(name, "npm install", () => {
                run(false, "npm", "install");
            }).then(async () => {
                await step(name, "git commit", () => {
                    run(false, "git", "commit", "--all", `--message=Updated to version ${repository.version}`);
                });
            }).then(async () => {
                await step(name, "git tag", () => {
                    run(false, "git", "tag", tag);
                });
            }).then(async () => {
                await step(name, "git push", () => {
                    run(false, "git", "push", "--atomic", "origin", "main", tag);
                });
            }).then(async () => {
                await step(name, "push workflow", async () => {
                    if (hasPushWorkflow) {
                        await validateWorkflow();
                    }
                });
            }).then(async () => {
                await step(name, "release", async () => {
                    const versionSplit = repository.version.split("-");
                    const prerelease = versionSplit.length !== 1;

                    await octokit.rest.repos.createRelease({
                        ...octokitParameterBase,
                        tag_name: tag,
                        name: `${prerelease ? `${versionSplit[1].substring(0, 1).toUpperCase()}${versionSplit[1].substring(1)} r` : "R"}elease ${versionSplit[0]}`,
                        prerelease
                    });
                });
            }).then(async () => {
                await step(name, "release workflow", async () => {
                    if (hasReleaseWorkflow) {
                        await validateWorkflow();
                    }
                });
            });

            repositoryStates[name] = "complete";
            saveState();
        }
    }

    repositoryStates = {};
    saveState();
}

await publish().catch((e: unknown) => {
    console.error(e);
});
