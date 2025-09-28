import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as process from "node:process";
import sharedConfigurationJSON from "../../config/publish.json";
import localConfigurationJSON from "../../config/publish.local.json";
import { logger, setLogLevel } from "./logger.js";
import { omit, pick } from "./type-helper.js";

const SHARED_CONFIGURATION_PATH = "config/publish.json";
const LOCAL_CONFIGURATION_PATH = "config/publish.local.json";

// Configuration may be written from any directory so full paths are required.
const SHARED_CONFIGURATION_FULL_PATH = path.resolve(SHARED_CONFIGURATION_PATH);
const LOCAL_CONFIGURATION_FULL_PATH = path.resolve(LOCAL_CONFIGURATION_PATH);

/**
 * Repository.
 */
export interface Repository {
    /**
     * Directory in which repository resides, if different from repository name.
     */
    directory?: string;

    /**
     * Dependency type, dictating how it is published.
     */
    dependencyType: string;

    /**
     * Platform if building across platforms (local configuration), e.g., macOS hosting Windows on Parallels.
     */
    platform?: {
        /**
         * CPU architecture of native modules to install.
         */
        cpu: string;

        /**
         * OS of native modules to install.
         */
        os: string;
    };

    /**
     * Additional dependencies not included in package configuration.
     */
    additionalDependencies?: string[];

    /**
     * Paths to exclude from consideration when checking for changes.
     */
    excludePaths?: string[];

    /**
     * Date/time in ISO format the last alpha version was published.
     */
    lastAlphaPublished?: string;

    /**
     * Current step in beta publication; used to resume after failure recovery.
     */
    publishBetaStep?: string | undefined;

    /**
     * Date/time in ISO format the last beta version was published.
     */
    lastBetaPublished?: string;

    /**
     * Date/time in ISO format the last production version was published.
     */
    lastProductionPublished?: string;

    /**
     * Last production version.
     */
    lastProductionVersion?: string;
}

/**
 * Configuration layout of merged publish.json and publish.local.json.
 */
export interface Configuration {
    /**
     * Organization that owns the repositories.
     */
    organization: string;

    /**
     * Log level (local configuration).
     */
    logLevel?: string;

    /**
     * Registry hosting organization's alpha repositories (local configuration).
     */
    alphaRegistry: string;

    /**
     * Repositories.
     */
    repositories: Record<string, Repository>;
}

export const PACKAGE_CONFIGURATION_PATH = "package.json";

export const PACKAGE_LOCK_CONFIGURATION_PATH = "package-lock.json";

/**
 * Configuration layout of package.json (relevant attributes only).
 */
export interface PackageConfiguration {
    /**
     * Name.
     */
    name: string;

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
 * Release type.
 */
type ReleaseType = "alpha" | "beta" | "production";

/**
 * Publish base class.
 */
export abstract class Publish {
    /**
     * Release type.
     */
    private readonly _releaseType: ReleaseType;

    /**
     * If true, outputs what would be run rather than running it.
     */
    private readonly _dryRun: boolean;

    /**
     * Configuration. Merger of shared and local configurations.
     */
    private readonly _configuration: Configuration;

    /**
     * At organization.
     */
    private readonly _atOrganization: string;

    /**
     * At organization registry parameter.
     */
    private readonly _atOrganizationRegistry: string;

    /**
     * All organization dependencies, keyed on repository name.
     */
    private readonly _allOrganizationDependencies: Record<string, Record<string, string | null>>;

    /**
     * Current repository name.
     */
    private _repositoryName!: string;

    /**
     * Current repository.
     */
    private _repository!: Repository;

    /**
     * NPM platform arguments if any.
     */
    private _npmPlatformArgs!: string[];

    /**
     * Branch.
     */
    private _branch!: string;

    /**
     * Package configuration.
     */
    private _packageConfiguration!: PackageConfiguration;

    /**
     * Major version.
     */
    private _majorVersion!: number;

    /**
     * Minor version.
     */
    private _minorVersion!: number;

    /**
     * Patch version.
     */
    private _patchVersion!: number;

    /**
     * Pre-release identifier or null if none.
     */
    private _preReleaseIdentifier!: string | null;

    /**
     * Dependencies that belong to the organization, keyed on repository name; null if additional (not included in
     * package configuration).
     */
    private _organizationDependencies!: Record<string, string | null>;

    /**
     * True if any organization dependency has been updated.
     */
    private _organizationDependenciesUpdated!: boolean;

    /**
     * Constructor.
     *
     * @param releaseType
     * Release type.
     *
     * @param dryRun
     * If true, outputs what would be run rather than running it.
     */
    protected constructor(releaseType: ReleaseType, dryRun: boolean) {
        this._releaseType = releaseType;
        this._dryRun = dryRun;

        // Merge shared and local configurations.
        this._configuration = {
            ...omit(sharedConfigurationJSON, "repositories"),
            ...omit(localConfigurationJSON, "repositories"),
            repositories: Object.fromEntries(Object.entries(sharedConfigurationJSON.repositories).map(([repositoryName, repository]) => [repositoryName, {
                ...repository,
                ...((localConfigurationJSON.repositories as Record<string, Partial<Repository> | undefined>)[repositoryName] ?? {})
            }]))
        };

        this._atOrganization = `@${this.configuration.organization}`;

        this._atOrganizationRegistry = `${this.atOrganization}:registry=${this.configuration.alphaRegistry}`;

        this._allOrganizationDependencies = {};

        if (this._configuration.logLevel !== undefined) {
            setLogLevel(this._configuration.logLevel);
        }
    }

    /**
     * Get the release type.
     */
    protected get releaseType(): ReleaseType {
        return this._releaseType;
    }

    /**
     * Determine if outputs what would be run rather than running it.
     */
    protected get dryRun(): boolean {
        return this._dryRun;
    }

    /**
     * Get the configuration.
     */
    protected get configuration(): Configuration {
        return this._configuration;
    }

    /**
     * Get the at organization.
     */
    protected get atOrganization(): string {
        return this._atOrganization;
    }

    /**
     * Get the at organization registry parameter.
     */
    protected get atOrganizationRegistry(): string {
        return this._atOrganizationRegistry;
    }

    /**
     * Get all organization dependencies, keyed on repository name.
     */
    protected get allOrganizationDependencies(): Record<string, Record<string, string | null>> {
        return this._allOrganizationDependencies;
    }

    /**
     * Get the current repository name.
     */
    protected get repositoryName(): string {
        return this._repositoryName;
    }

    /**
     * Get the current repository.
     */
    protected get repository(): Repository {
        return this._repository;
    }

    /**
     * Get the NPM platform arguments if any.
     */
    get npmPlatformArgs(): string[] {
        return this._npmPlatformArgs;
    }

    /**
     * Get the branch.
     */
    protected get branch(): string {
        return this._branch;
    }

    /**
     * Get the package configuration.
     */
    protected get packageConfiguration(): PackageConfiguration {
        return this._packageConfiguration;
    }

    /**
     * Get the major version.
     */
    protected get majorVersion(): number {
        return this._majorVersion;
    }

    /**
     * Get the minor version.
     */
    protected get minorVersion(): number {
        return this._minorVersion;
    }

    /**
     * Get the patch version.
     */
    protected get patchVersion(): number {
        return this._patchVersion;
    }

    /**
     * Get the pre-release identifier.
     */
    protected get preReleaseIdentifier(): string | null {
        return this._preReleaseIdentifier;
    }

    /**
     * Get dependencies that belong to the organization, keyed on repository name.
     */
    protected get organizationDependencies(): Record<string, string | null> {
        return this._organizationDependencies;
    }

    /**
     * Determine if any organization dependency has been updated.
     */
    protected get organizationDependenciesUpdated(): boolean {
        return this._organizationDependenciesUpdated;
    }

    /**
     * Run a command and optionally capture its output.
     *
     * @param ignoreDryRun
     * If true, dry run setting is ignored.
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
    protected run(ignoreDryRun: boolean, captureOutput: boolean, command: string, ...args: string[]): string[] {
        if (!ignoreDryRun && captureOutput) {
            throw new Error("Cannot capture output in dry run");
        }

        let output: string[] = [];

        const runningCommand = `Running command "${command}" with arguments [${args.join(", ")}].`;

        if (this.dryRun && !ignoreDryRun) {
            logger.info(`Dry run: ${runningCommand}`);

            output = [];
        } else {
            logger.debug(runningCommand);

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

            // Last line is also terminated by newline and split() places empty string at the end, so use slice() to remove it.
            output = captureOutput ? spawnResult.stdout.toString().split("\n").slice(0, -1) : [];

            if (captureOutput) {
                logger.trace(`Output:\n${output.join("\n")}`);
            }
        }

        return output;
    }

    /**
     * Get the repository name for a dependency if it belongs to the organization or null if not.
     *
     * @param dependency
     * Dependency.
     *
     * @returns
     * Repository name for dependency or null.
     */
    protected dependencyRepositoryName(dependency: string): string | null {
        const parsedDependency = dependency.split("/");

        return parsedDependency.length === 2 && parsedDependency[0] === this.atOrganization ? parsedDependency[1] : null;
    }

    /**
     * Determine if there have been any changes to the current repository.
     *
     * @param lastPublished
     * Date/time in ISO format to check against.
     *
     * @returns
     * True if there is no last published date/time or if there have been any changes since then.
     */
    protected anyChanges(lastPublished: string | undefined): boolean {
        let anyChanges: boolean;

        const excludePaths = this.repository.excludePaths ?? [];

        const changedFilesSet = new Set<string>();

        /**
         * Process a changed file.
         *
         * @param status
         * "R" if the file has been renamed, "D" if the file has been deleted, otherwise file has been added.
         *
         * @param file
         * Original file name if status is "R", otherwise file to be added or deleted.
         *
         * @param newFile
         * New file name if status is "R", undefined otherwise.
         */
        function processChangedFile(status: string, file: string, newFile: string | undefined): void {
            // Status is "D" if deleted, "R" if renamed.
            const deleteFile = status === "D" || status === "R" ? file : undefined;
            const addFile = status === "R" ? newFile : status !== "D" ? file : undefined;

            // Remove deleted file; anything that depends on a deleted file will have been modified.
            if (deleteFile !== undefined && changedFilesSet.delete(deleteFile)) {
                logger.debug(`-${deleteFile}`);
            }

            if (addFile !== undefined && !changedFilesSet.has(addFile)) {
                // Exclude hidden files and directories except .github directory, as well as test directory and any explicitly excluded files or directories.
                if (((!addFile.startsWith(".") && !addFile.includes("/.")) || addFile.startsWith(".github/")) && !addFile.startsWith("test/") && excludePaths.filter(excludePath => addFile === excludePath || (excludePath.endsWith("/") && addFile.startsWith(excludePath))).length === 0) {
                    logger.debug(`+${addFile}`);

                    changedFilesSet.add(addFile);
                } else {
                    // File is excluded.
                    logger.debug(`*${addFile}`);
                }
            }
        }

        if (this.releaseType !== "alpha" && this.run(true, true, "git", "fetch", "--porcelain", "--dry-run").length !== 0) {
            throw new Error("Remote repository has outstanding changes");
        }

        if (lastPublished !== undefined) {
            // Get all files committed since last published.
            for (const line of this.run(true, true, "git", "log", "--since", lastPublished, "--name-status", "--pretty=oneline")) {
                // Header starts with 40-character SHA.
                if (/^[0-9a-f]{40} /.test(line)) {
                    logger.debug(`Commit SHA ${line.substring(0, 40)}`);
                } else {
                    const [status, file, newFile] = line.split("\t");

                    processChangedFile(status.charAt(0), file, newFile);
                }
            }

            // Get all uncommitted files.
            const output = this.run(true, true, "git", "status", "--porcelain");

            if (output.length !== 0) {
                // Beta or production publication requires that repository be fully committed.
                if (this.releaseType !== "alpha") {
                    throw new Error("Repository has uncommitted changes");
                }

                logger.debug("Uncommitted");

                for (const line of output) {
                    // Line is two-character status, space, and detail.
                    const status = line.substring(0, 1);
                    const [file, newFile] = line.substring(3).split(" -> ");

                    processChangedFile(status, file, newFile);
                }
            }

            const lastPublishedDateTime = new Date(lastPublished);

            anyChanges = false;

            for (const changedFile of changedFilesSet) {
                if (fs.lstatSync(changedFile).mtime > lastPublishedDateTime) {
                    if (!anyChanges) {
                        logger.info("Changes");

                        anyChanges = true;
                    }

                    logger.info(`>${changedFile}`);
                }
            }

            if (!anyChanges && this.organizationDependenciesUpdated) {
                logger.info("Organization dependencies updated");

                anyChanges = true;
            }

            if (!anyChanges) {
                logger.info("No changes");
            }
        } else {
            logger.info("No last published");

            // No last published, so there must have been changes.
            anyChanges = true;
        }

        return anyChanges;
    }

    /**
     * Commit files that have been modified.
     *
     * @param message
     * Commit message.
     *
     * @param files
     * Files to commit; if none, defaults to "--all".
     */
    protected commitModified(message: string, ...files: string[]): void {
        const modifiedFiles: string[] = [];

        if (files.length === 0) {
            modifiedFiles.push("--all");
        } else {
            for (const line of this.run(true, true, "git", "status", ...files, "--porcelain")) {
                const status = line.substring(0, 3);
                const modifiedFile = line.substring(3);

                // Only interest is in local additions and modifications with no conflicts.
                if (status !== "A  " && status !== " M " && status !== "AM ") {
                    throw new Error(`Unsupported status "${status}" for ${modifiedFile}`);
                }

                modifiedFiles.push(modifiedFile);
            }
        }

        if (modifiedFiles.length !== 0) {
            this.run(false, false, "git", "commit", ...modifiedFiles, "--message", message);
        }
    }

    /**
     * Save package configuration.
     */
    protected savePackageConfiguration(): void {
        if (this.dryRun) {
            logger.info(`Dry run: Saving package configuration\n${JSON.stringify(pick(this.packageConfiguration, "name", "version", "devDependencies", "dependencies"), null, 2)}\n`);
        } else {
            fs.writeFileSync(PACKAGE_CONFIGURATION_PATH, `${JSON.stringify(this.packageConfiguration, null, 2)}\n`);
        }
    }

    /**
     * Update the package version.
     *
     * @param majorVersion
     * Major version or undefined if no change.
     *
     * @param minorVersion
     * Minor version or undefined if no change.
     *
     * @param patchVersion
     * Patch version or undefined if no change.
     *
     * @param preReleaseIdentifier
     * Pre-release identifier or undefined if no change.
     */
    protected updatePackageVersion(majorVersion: number | undefined, minorVersion: number | undefined, patchVersion: number | undefined, preReleaseIdentifier: string | null | undefined): void {
        if (majorVersion !== undefined) {
            this._majorVersion = majorVersion;
        }

        if (minorVersion !== undefined) {
            this._minorVersion = minorVersion;
        }

        if (patchVersion !== undefined) {
            this._patchVersion = patchVersion;
        }

        if (preReleaseIdentifier !== undefined) {
            this._preReleaseIdentifier = preReleaseIdentifier;
        }

        this.packageConfiguration.version = `${this.majorVersion}.${this.minorVersion}.${this.patchVersion}${this.preReleaseIdentifier !== null ? `-${this.preReleaseIdentifier}` : ""}`;

        this.savePackageConfiguration();
    }

    /**
     * Commit changes resulting from updating the package version.
     *
     * @param files
     * Files to commit; if none, defaults to "--all".
     */
    protected commitUpdatedPackageVersion(...files: string[]): void {
        this.commitModified(`Updated to version ${this.packageConfiguration.version}.`, ...files);
    }

    /**
     * Save the current configuration.
     */
    protected saveConfiguration(): void {
        const saveSharedRepositories: Record<string, Omit<Repository, "platform" | "lastAlphaPublished">> = {};
        const saveLocalRepositories: Record<string, Pick<Repository, "platform" | "lastAlphaPublished">> = {};

        for (const [repositoryName, repository] of Object.entries(this.configuration.repositories)) {
            saveSharedRepositories[repositoryName] = omit(repository, "platform", "lastAlphaPublished");
            saveLocalRepositories[repositoryName] = pick(repository, "platform", "lastAlphaPublished");
        }

        const saveSharedConfigurationJSON = JSON.stringify({
            ...omit(this.configuration, "logLevel", "alphaRegistry", "repositories"),
            repositories: saveSharedRepositories
        }, null, 2);

        const saveLocalConfigurationJSON = JSON.stringify({
            ...pick(this.configuration, "logLevel", "alphaRegistry"),
            repositories: saveLocalRepositories
        }, null, 2);

        if (this.dryRun) {
            logger.info(`Dry run: Saving shared configuration\n${saveSharedConfigurationJSON}\n`);
            logger.info(`Dry run: Saving local configuration\n${saveLocalConfigurationJSON}\n`);
        } else {
            fs.writeFileSync(SHARED_CONFIGURATION_FULL_PATH, saveSharedConfigurationJSON);
            fs.writeFileSync(LOCAL_CONFIGURATION_FULL_PATH, saveLocalConfigurationJSON);
        }
    }

    /**
     * Publish current repository.
     */
    protected abstract publish(): void | Promise<void>;

    /**
     * Publish all repositories.
     */
    async publishAll(): Promise<void> {
        const startDirectory = process.cwd();

        for (const [repositoryName, repository] of Object.entries(this.configuration.repositories)) {
            this._repositoryName = repositoryName;
            this._repository = repository;

            this._npmPlatformArgs = repository.platform !== undefined ?
                [
                    "--cpu",
                    repository.platform.cpu,
                    "--os",
                    repository.platform.os
                ] :
                [];

            this._branch = this.run(true, true, "git", "branch", "--show-current")[0];

            // All repositories are expected to be children of the parent of this repository.
            const directory = `../${repository.directory ?? repositoryName}`;

            if (fs.existsSync(directory) && fs.statSync(directory).isDirectory()) {
                logger.info(`Repository ${repositoryName}...`);

                process.chdir(directory);

                // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Package configuration format is known.
                this._packageConfiguration = JSON.parse(fs.readFileSync(PACKAGE_CONFIGURATION_PATH).toString()) as PackageConfiguration;

                const version = this.packageConfiguration.version;

                const parsedVersion = /^(\d+)\.(\d+)\.(\d+)(-(alpha|beta))?$/.exec(version);

                if (parsedVersion === null) {
                    throw new Error(`Invalid package version ${version}`);
                }

                this._majorVersion = Number(parsedVersion[1]);
                this._minorVersion = Number(parsedVersion[2]);
                this._patchVersion = Number(parsedVersion[3]);
                this._preReleaseIdentifier = parsedVersion.length === 6 ? parsedVersion[5] : null;

                const parsedBranch = /^v(\d+)\.(\d+)$/.exec(this.branch);

                if (this.releaseType === "beta" && parsedBranch === null) {
                    throw new Error(`Beta release must be from version branch v${this.majorVersion}.${this.minorVersion}`);
                }

                if (this.releaseType === "production" && this.branch !== "main") {
                    throw new Error("Production release must be from main branch");
                }

                this._organizationDependencies = {};

                for (const currentDependencies of [this.packageConfiguration.devDependencies, this.packageConfiguration.dependencies]) {
                    if (currentDependencies !== undefined) {
                        for (const dependency of Object.keys(currentDependencies)) {
                            const dependencyRepositoryName = this.dependencyRepositoryName(dependency);

                            if (dependencyRepositoryName !== null) {
                                logger.trace(`Organization dependency from package configuration ${dependencyRepositoryName}:${dependency}`);

                                this.organizationDependencies[dependencyRepositoryName] = dependency;

                                if (this.releaseType !== "production") {
                                    // This change will ultimately be discarded if there are no changes and no updates to organization dependencies.
                                    currentDependencies[dependency] = this.releaseType;
                                } else {
                                    const dependencyRepository = this.configuration.repositories[dependencyRepositoryName];

                                    const lastProductionVersion = dependencyRepository.lastProductionVersion;

                                    if (lastProductionVersion === undefined) {
                                        throw new Error(`Internal error, last production version not set for ${dependencyRepositoryName}`);
                                    }

                                    currentDependencies[dependency] = `^${lastProductionVersion}`;
                                }
                            }
                        }
                    }
                }

                if (repository.additionalDependencies !== undefined) {
                    for (const additionalDependency of repository.additionalDependencies) {
                        if (additionalDependency in this.organizationDependencies) {
                            logger.warn(`Additional dependency ${additionalDependency} already exists`);
                        } else {
                            logger.trace(`Organization dependency from additional dependencies ${additionalDependency}:null`);

                            this.organizationDependencies[additionalDependency] = null;
                        }
                    }
                }

                // Add dependency repositories of dependency repositories.
                for (const dependencyRepositoryName of Object.keys(this.organizationDependencies)) {
                    const dependencyOrganizationDependencies = this.allOrganizationDependencies[dependencyRepositoryName];

                    for (const [dependencyDependencyRepositoryName, dependencyDependency] of Object.entries(dependencyOrganizationDependencies)) {
                        if (!(dependencyDependencyRepositoryName in this.organizationDependencies)) {
                            logger.trace(`Organization dependency from dependencies ${dependencyDependencyRepositoryName}:${dependencyDependency}`);

                            this.organizationDependencies[dependencyDependencyRepositoryName] = dependencyDependency;
                        }
                    }
                }

                // Save organization dependencies for future repositories.
                this.allOrganizationDependencies[repositoryName] = this.organizationDependencies;

                let getLastPublished: (repository: Repository) => string | undefined;

                switch (this.releaseType) {
                    case "alpha":
                        getLastPublished = repository => repository.lastAlphaPublished;
                        break;

                    case "beta":
                        getLastPublished = repository => repository.lastBetaPublished;
                        break;

                    case "production":
                        getLastPublished = repository => repository.lastProductionPublished;
                        break;
                }

                const lastPublished = getLastPublished(repository);

                this._organizationDependenciesUpdated = false;

                for (const dependencyRepositoryName of Object.keys(this.organizationDependencies)) {
                    const dependencyRepository = this.configuration.repositories[dependencyRepositoryName];
                    const dependencyLastPublished = getLastPublished(dependencyRepository);

                    if (dependencyLastPublished === undefined) {
                        throw new Error(`Internal error, last ${this.releaseType} published not set for ${dependencyRepositoryName}`);
                    }

                    if (lastPublished === undefined || dependencyLastPublished > lastPublished) {
                        logger.info(`Repository ${dependencyRepositoryName} recently published`);

                        // At least one dependency repository has been published since the last publication of this repository.
                        this._organizationDependenciesUpdated = true;
                    }
                }

                if (parsedBranch !== null) {
                    const branchMajorVersion = Number(parsedBranch[1]);
                    const branchMinorVersion = Number(parsedBranch[2]);

                    // If in a version branch and version doesn't match, update it.
                    if (this.majorVersion !== branchMajorVersion || this.minorVersion !== branchMinorVersion) {
                        this.updatePackageVersion(branchMajorVersion, branchMinorVersion, 0, null);
                        this.commitUpdatedPackageVersion(PACKAGE_CONFIGURATION_PATH);
                    }
                }

                try {
                    await this.publish();
                } finally {
                    this.saveConfiguration();
                }
            // Non-external repositories may be private and not accessible to all developers.
            } else if (repository.dependencyType === "external") {
                throw new Error(`Repository ${repositoryName} not found`);
            }
        }

        // Return to the start directory.
        process.chdir(startDirectory);

        this.finalizeAll();

        this.saveConfiguration();

        if (this.releaseType !== "alpha") {
            this.commitModified(`Published ${this.releaseType} release.`, SHARED_CONFIGURATION_PATH);
        }
    }

    /**
     * Finalize publishing all repositories.
     */
    protected finalizeAll(): void {
    }
}
