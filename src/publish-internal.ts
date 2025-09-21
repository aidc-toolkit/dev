import * as fs from "fs";
import {
    buildPackageVersion,
    loadPackageConfiguration,
    PACKAGE_CONFIGURATION_PATH, parsePackageVersion,
    savePackageConfiguration
} from "./package-configuration";
import {
    anyChanges,
    atOrganizationRegistry,
    commitConfiguration,
    organizationRepository,
    publishRepositories
} from "./publish";
import { logger, run } from "./utility.js";

// Detailed syntax checking not required as this is an internal tool.
const updateAll = process.argv[2] === "--update-all";

/**
 * Check dependencies for belonging to the organization; if not, check for updates and log a message, and optionally
 * update, if an update is available.
 *
 * @param dependencies
 * Dependencies.
 *
 * @returns
 * Dependencies belonging to the organization if not updating all, or external dependencies pending update if updating
 * all.
 */
function checkDependencyUpdates(dependencies?: Record<string, string>): string[] {
    const dependencyUpdates = [];

    if (dependencies !== undefined) {
        for (const [dependency, version] of Object.entries(dependencies)) {
            if (organizationRepository(dependency) !== null) {
                if (!updateAll) {
                    dependencyUpdates.push(dependency);
                }
            } else if (version.startsWith("^")) {
                const [latestVersion] = run(true, "npm", "view", dependency, "version");

                if (latestVersion !== version.substring(1)) {
                    logger.info(`Dependency ${dependency}@${version} ${!updateAll ? "pending update" : "updating"} to version ${latestVersion}.`);

                    if (updateAll) {
                        dependencies[dependency] = `^${latestVersion}`;

                        dependencyUpdates.push(dependency);
                    }
                }
            }
        }
    }

    return dependencyUpdates;
}

/**
 * Convert a number to a zero-padded string.
 *
 * @param n
 * Number.
 *
 * @param length
 * Length of required string.
 *
 * @returns
 * Zero-padded string.
 */
function zeroPadded(n: number, length: number): string {
    return `${"0".repeat(length - 1)}${n}`.slice(-length);
}

const dependencyDependenciesMap = new Map<string, string[]>();

const BACKUP_PACKAGE_CONFIGURATION_PATH = ".package.json";

await publishRepositories((name, repository) => {
    const packageConfiguration = loadPackageConfiguration();

    // Check dependency updates, even if there are no changes.
    const dependencyUpdates = [...checkDependencyUpdates(packageConfiguration.devDependencies), ...checkDependencyUpdates(packageConfiguration.dependencies)];

    if (!updateAll) {
        if (dependencyUpdates.length !== 0) {
            dependencyDependenciesMap.set(name, dependencyUpdates);

            const allDependencyUpdates = new Array<string>();

            /**
             * Add all dependency updates and those of their dependencies.
             *
             * @param dependencies
             * Dependencies.
             */
            function addAllDependencyUpdates(dependencies: string[]): void {
                for (const dependency of dependencies) {
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Dependency is an organization repository.
                    const dependencyDependencies = dependencyDependenciesMap.get(organizationRepository(dependency)!);

                    if (dependencyDependencies !== undefined) {
                        addAllDependencyUpdates(dependencyDependencies);
                    }

                    if (!allDependencyUpdates.includes(dependency)) {
                        allDependencyUpdates.push(dependency);
                    }
                }
            }

            addAllDependencyUpdates(dependencyUpdates);

            logger.debug(`Updating organization dependencies ${JSON.stringify(allDependencyUpdates)}`);

            run(false, "npm", "update", atOrganizationRegistry, ...allDependencyUpdates);
        }
    } else {
        if (dependencyUpdates.length !== 0) {
            // Update the package configuration for the update.
            savePackageConfiguration(packageConfiguration);
        }

        logger.debug("Updating all dependencies");

        run(false, "npm", "update", atOrganizationRegistry);
    }

    // Run lint if present.
    run(false, "npm", "run", "lint", "--if-present");

    // Run development build if present.
    run(false, "npm", "run", "build:dev", "--if-present");

    // Nothing further required if this repository is not a dependency.
    if (repository.dependencyType !== "none" && anyChanges(repository, false)) {
        // Backup the package configuration file.
        fs.renameSync(PACKAGE_CONFIGURATION_PATH, BACKUP_PACKAGE_CONFIGURATION_PATH);

        try {
            const now = new Date();

            const parsedPackageVersion = parsePackageVersion(packageConfiguration.version);

            // Set version to incremental patch version number with alpha pre-release identifiers.
            parsedPackageVersion.patchVersion++;
            parsedPackageVersion.preReleaseIdentifier = `alpha.${now.getFullYear()}${zeroPadded(now.getMonth() + 1, 2)}${zeroPadded(now.getDate(), 2)}${zeroPadded(now.getHours(), 2)}${zeroPadded(now.getMinutes(), 2)}`;
            packageConfiguration.version = buildPackageVersion(parsedPackageVersion);

            // Update the package configuration for the build.
            savePackageConfiguration(packageConfiguration);

            // Publish to development npm registry.
            run(false, "npm", "publish", atOrganizationRegistry, "--tag", "alpha");

            // Unpublish all prior alpha versions.
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Output is a JSON array.
            for (const version of JSON.parse(run(true, "npm", "view", atOrganizationRegistry, packageConfiguration.name, "versions", "--json").join("\n")) as string[]) {
                if (/^[0-9]+.[0-9]+.[0-9]+-alpha.[0-9]+$/.test(version) && version !== packageConfiguration.version) {
                    run(false, "npm", "unpublish", atOrganizationRegistry, `${packageConfiguration.name}@${version}`);
                }
            }

            repository.lastInternalPublished = now.toISOString();
        } finally {
            // Restore the package configuration file.
            fs.rmSync(PACKAGE_CONFIGURATION_PATH);
            fs.renameSync(BACKUP_PACKAGE_CONFIGURATION_PATH, PACKAGE_CONFIGURATION_PATH);
        }
    }
}).then(() => {
    commitConfiguration(false);
}).catch((e: unknown) => {
    logger.error(e);
});
