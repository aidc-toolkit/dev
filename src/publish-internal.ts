import * as fs from "fs";
import {
    anyChanges,
    commitConfiguration,
    organizationRepository,
    type PackageConfiguration,
    publishRepositories
} from "./publish";
import { logger, run } from "./utility.js";

/**
 * Check dependencies for belonging to the organization; if not, check for updates and log a message if an update is
 * available.
 *
 * @param dependencies
 * Dependencies.
 *
 * @returns
 * Dependencies belonging to the organization.
 */
function checkDependencyUpdates(dependencies?: Record<string, string>): string[] {
    const organizationDependencies = [];

    if (dependencies !== undefined) {
        for (const [dependency, version] of Object.entries(dependencies)) {
            if (organizationRepository(dependency) !== null) {
                organizationDependencies.push(dependency);
            } else if (version.startsWith("^")) {
                const [latestVersion] = run(true, "npm", "view", dependency, "version");

                if (latestVersion !== version.substring(1)) {
                    logger.info(`Dependency ${dependency}@${version} pending update to version ${latestVersion}.`);
                }
            }
        }
    }

    return organizationDependencies;
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

await publishRepositories((_name, repository) => {
    const packageConfigurationPath = "package.json";

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Package configuration format is known.
    const packageConfiguration: PackageConfiguration = JSON.parse(fs.readFileSync(packageConfigurationPath).toString());

    // Check dependency updates, even if there are no changes.
    const organizationDependencies = [...checkDependencyUpdates(packageConfiguration.devDependencies), ...checkDependencyUpdates(packageConfiguration.dependencies)];

    if (organizationDependencies.length !== 0) {
        logger.debug(`Updating organization dependencies ${JSON.stringify(organizationDependencies)}`);

        run(true, "npm", "update", ...organizationDependencies);
    }

    // Nothing further required if this repository is not a dependency.
    if (repository.dependencyType !== "none" && anyChanges(repository, false)) {
        const backupPackageConfigurationPath = ".package.json";

        // Backup the package configuration file.
        fs.renameSync(packageConfigurationPath, backupPackageConfigurationPath);

        try {
            const now = new Date();

            // Strip pre-release identifier if any.
            const [semanticVersion] = packageConfiguration.version.split("-");

            // Parse semantic version into its components.
            const [majorVersion, minorVersion, patchVersion] = semanticVersion.split(".").map(versionString => Number(versionString));

            // Set version to alpha version with incremental patch version number.
            packageConfiguration.version = `${majorVersion}.${minorVersion}.${patchVersion + 1}-alpha.${now.getFullYear()}${zeroPadded(now.getMonth() + 1, 2)}${zeroPadded(now.getDate(), 2)}${zeroPadded(now.getHours(), 2)}${zeroPadded(now.getMinutes(), 2)}`;

            // Update the package configuration for the build.
            fs.writeFileSync(packageConfigurationPath, `${JSON.stringify(packageConfiguration, null, 2)}\n`);

            // Run development build.
            run(true, "npm", "run", "build:dev");

            // Publish to development npm registry.
            run(true, "npm", "publish", "--tag", "alpha");

            // Unpublish all prior alpha versions.
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Output is a JSON array.
            for (const version of JSON.parse(run(true, "npm", "view", packageConfiguration.name, "versions", "--json").join("\n")) as string[]) {
                if (/^[0-9]+.[0-9]+.[0-9]+-alpha.[0-9]+$/.test(version) && version !== packageConfiguration.version) {
                    run(true, "npm", "unpublish", `${packageConfiguration.name}@${version}`);
                }
            }

            repository.lastInternalPublished = now.toISOString();
        } finally {
            // Restore the package configuration file.
            fs.rmSync(packageConfigurationPath);
            fs.renameSync(backupPackageConfigurationPath, packageConfigurationPath);
        }
    }
}).then(() => {
    commitConfiguration(false);
}).catch((e: unknown) => {
    logger.error(e);
});
