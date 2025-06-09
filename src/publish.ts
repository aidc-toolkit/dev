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
     * If true, only external publication is supported.
     */
    externalOnly?: boolean;

    /**
     * Date/time the package was last published internally in ISO format.
     */
    lastInternalPublished?: string;

    /**
     * If true, publish repository externally always.
     */
    publishExternalAlways?: boolean;

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
 * @returns
 * True if there is no last published date/time or if there have been any changes since then.
 */
export function anyChanges(repository: Repository, external: boolean): boolean {
    let anyChanges: boolean;

    const lastPublishedString = !external ? repository.lastInternalPublished : repository.lastExternalPublished;

    const excludedFilesSet = new Set(repository.excludeFiles ?? []);

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
            // Exclude hidden files and directories except .github directory, as well as test directory and any explicitly excluded files.
            if (((!addFile.startsWith(".") && !addFile.includes("/.")) || addFile.startsWith(".github/")) && !addFile.startsWith("test/") && !excludedFilesSet.has(addFile)) {
                changedFilesSet.add(addFile);

                logger.debug(`+${addFile}`);
            } else {
                // File is excluded.
                logger.debug(`*${addFile}`);
            }
        }
    }

    if (lastPublishedString !== undefined) {
        for (const line of run(true, "git", "log", "--since", lastPublishedString, "--name-status", "--pretty=oneline")) {
            // Header starts with 40-character SHA.
            if (/^[0-9a-f]{40} /.test(line)) {
                logger.debug(`Commit SHA ${line.substring(0, 40)}`);
            } else {
                const [status, file, newFile] = line.split("\t");

                processChangedFile(status.charAt(0), file, newFile);
            }
        }
    }

    if (lastPublishedString !== undefined || external) {
        const output = run(true, "git", "status", "--porcelain");

        if (output.length !== 0) {
            // External publication requires that repository be fully committed.
            if (external) {
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
    }

    if (lastPublishedString !== undefined) {
        const lastPublished = new Date(lastPublishedString);

        anyChanges = false;

        for (const changedFile of changedFilesSet) {
            if (fs.lstatSync(changedFile).mtime > lastPublished) {
                if (!anyChanges) {
                    anyChanges = true;

                    logger.info("Changes");
                }

                logger.info(`>${changedFile}`);
            }
        }

        if (!anyChanges) {
            logger.info("No changes");
        }
    } else {
        // No last published, so there must have been changes.
        anyChanges = true;

        logger.info("No last published");
    }

    return anyChanges;
}

const configurationPath = "config/publish.json";

// Configuration may be written from any directory so full path is required.
const configurationFullPath = path.resolve(configurationPath);

/**
 * Save the current configuration.
 */
export function saveConfiguration(): void {
    fs.writeFileSync(configurationFullPath, `${JSON.stringify(configuration, null, 2)}\n`);
}

/**
 * Publish all repositories.
 *
 * @param callback
 * Callback taking the name and properties of the repository to publish.
 */
export async function publishRepositories(callback: (name: string, repository: Repository) => void | Promise<void>): Promise<void> {
    const startDirectory = process.cwd();

    for (const [name, repository] of Object.entries(configuration.repositories)) {
        logger.info(`Repository ${name}...`);

        // All repositories are expected to be children of the parent of this repository.
        process.chdir(`../${repository.directory ?? name}`);

        await callback(name, repository);

        saveConfiguration();
    }

    // Return to the start directory.
    process.chdir(startDirectory);
}

/**
 * Commit the current configuration.
 *
 * @param external
 * False if committing due to internal publication, true if committing due to external publication.
 */
export function commitConfiguration(external: boolean): void {
    // Check for changes before committing.
    if (run(true, "git", "status", configurationPath, "--porcelain").length !== 0) {
        run(false, "git", "commit", configurationPath, "--message", !external ? "Published internally." : "Published externally.");
    }
}
