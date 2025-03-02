import * as fs from "node:fs";
import * as path from "node:path";
import configurationJSON from "../config/publish.json";
import secureConfigurationJSON from "../config/publish.secure.json";
import { logger, run } from "./utility";

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
     * Files excluded from consideration when checking for changes.
     */
    excludeFiles?: string[];

    /**
     * Date/time the package was last published internally in ISO format.
     */
    lastInternalPublished?: string;

    /**
     * Date/time the package was last published externally in ISO format.
     */
    lastExternalPublished?: string;

    /**
     * Last external published version.
     */
    lastExternalVersion?: string;

    /**
     * Current step in external publication; used to resume after failure recovery.
     */
    publishExternalStep?: string | undefined;
}

/**
 * Configuration layout of publish.json.
 */
export interface Configuration {
    /**
     * Organization that owns the repositories.
     */
    organization: string;

    /**
     * Repositories.
     */
    repositories: Record<string, Repository>;
}

/**
 * Configuration layout of publish.secure.json.
 */
interface SecureConfiguration {
    token: string;
}

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

export const configuration: Configuration = configurationJSON;
export const secureConfiguration: SecureConfiguration = secureConfigurationJSON;

const atOrganization = `@${configuration.organization}`;

/**
 * Get the organization repository name or a dependency if it belongs to the organization or null if not.
 *
 * @param dependency
 * Dependency.
 *
 * @returns
 * Organization repository name or null.
 */
export function organizationRepository(dependency: string): string | null {
    const [dependencyAtOrganization, dependencyRepositoryName] = dependency.split("/");

    return dependencyAtOrganization === atOrganization ? dependencyRepositoryName : null;
}

/**
 * Determine if there have been any changes to a repository.
 *
 * @param repository
 * Repository configuration.
 *
 * @param external
 * False if comparing to the last internal published date/time, true if comparing to the last external published
 * date/time.
 *
 * @param allowUncommitted
 * True if uncommitted files are allowed.
 *
 * @returns
 * True if there is no last published date/time or if there have been any changes since then.
 */
export function anyChanges(repository: Repository, external: boolean): boolean {
    let anyChanges: boolean;

    const lastPublishedString = !external ? repository.lastInternalPublished : repository.lastExternalPublished;

    const changedFilesSet = new Set<string>();

    if (lastPublishedString !== undefined) {
        for (const line of run(true, "git", "log", `--since="${lastPublishedString}"`, "--name-status", "--pretty=oneline")) {
            // Header starts with 40-character SHA.
            if (!/^[0-9a-f]{40} /.test(line)) {
                const [status, file] = line.split("\t");

                // Ignore deleted files; anything that depends on a deleted file will have been modified.
                if (status !== "D") {
                    logger.debug(`+File: ${file}`);

                    changedFilesSet.add(file);
                }
            } else {
                logger.debug(`Commit SHA ${line.substring(0, 40)}`);
            }
        }
    }

    if (lastPublishedString !== undefined || external) {
        const output = run(true, "git", "status", "--porcelain");

        if (output.length !== 0) {
            if (external) {
                throw new Error("Repository has uncommitted changes");
            }

            logger.debug("Uncommitted");

            for (const line of output) {
                // Line is two-character status, space, and detail.
                const status = line.substring(0, 2);
                const detail = line.substring(3);

                // Ignore deleted files; anything that depends on a deleted file will have been modified.
                if (status !== "D ") {
                    let file: string;

                    if (status.startsWith("R")) {
                        // File has been renamed; get old and new file names.
                        const [oldFile, newFile] = detail.split(" -> ");

                        logger.debug(`-File: ${oldFile}`);

                        changedFilesSet.delete(oldFile);

                        file = newFile;
                    } else {
                        file = detail;
                    }

                    logger.debug(`+File: ${file}`);

                    changedFilesSet.add(file);
                }
            }
        }
    }

    if (lastPublishedString !== undefined) {
        logger.debug("Excluded");

        const hiddenFiles = [];

        // Get list of hidden files and directories.
        for (const changedFile of changedFilesSet) {
            if (changedFile.startsWith(".") || changedFile.includes("/.")) {
                hiddenFiles.push(changedFile);
            }
        }

        // Exclude hidden files and directories.
        for (const hiddenFile of hiddenFiles) {
            logger.debug(`-File: ${hiddenFile}`);

            changedFilesSet.delete(hiddenFile);
        }

        if (repository.excludeFiles !== undefined) {
            for (const excludeFile of repository.excludeFiles) {
                if (changedFilesSet.delete(excludeFile)) {
                    logger.debug(`-File: ${excludeFile}`);
                }
            }
        }

        logger.debug("Changed");

        const lastPublished = new Date(lastPublishedString);

        anyChanges = false;

        for (const changedFile of changedFilesSet) {
            if (fs.lstatSync(changedFile).mtime > lastPublished) {
                logger.debug(`Changed: ${changedFile}`);

                anyChanges = true;
            }
        }
    } else {
        // No last published, so there must have been changes.
        anyChanges = true;
    }

    if (!anyChanges) {
        logger.debug("No changes");
    }

    return anyChanges;
}

// Configuration may be written from any directory so full path is required.
const configurationPath = path.resolve("config/publish.json");

/**
 * Save the current configuration.
 */
export function saveConfiguration(): void {
    fs.writeFileSync(configurationPath, `${JSON.stringify(configuration, null, 2)}\n`);
}

/**
 * Publish all repositories.
 *
 * @param callback
 * Callback taking the name and properties of the repository to publish.
 */
export async function publishRepositories(callback: (name: string, repository: Repository) => void | Promise<void>): Promise<void> {
    logger.settings.minLevel = 2;

    for (const [name, repository] of Object.entries(configuration.repositories)) {
        logger.info(`Repository ${name}...`);

        // All repositories are expected to be children of the parent of this repository.
        process.chdir(`../${repository.directory ?? name}`);

        await callback(name, repository);

        saveConfiguration();
    }
}
