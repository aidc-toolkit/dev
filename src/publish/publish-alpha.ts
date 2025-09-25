import * as fs from "fs";
import { PACKAGE_CONFIGURATION_PATH, Publish } from "./publish";
import { logger } from "./logger";

const BACKUP_PACKAGE_CONFIGURATION_PATH = ".package.json";

/**
 * Publish alpha versions.
 */
class PublishAlpha extends Publish {
    /**
     * If true, update all dependencies automatically.
     */
    private readonly _updateAll: boolean;

    /**
     * Constructor.
     *
     * If true, outputs what would be run rather than running it.
     *
     * @param updateAll
     * If true, update all dependencies automatically.
     *
     * @param dryRun
     * If true, outputs what would be run rather than running it.
     */
    constructor(updateAll: boolean, dryRun: boolean) {
        super("alpha", dryRun);

        this._updateAll = updateAll;
    }

    /**
     * @inheritDoc
     */
    protected publish(): void {
        let anyDependencyUpdates = false;

        // Check for external dependency updates, even if there are no changes.
        for (const currentDependencies of [this.packageConfiguration.devDependencies, this.packageConfiguration.dependencies]) {
            if (currentDependencies !== undefined) {
                for (const [dependency, version] of Object.entries(currentDependencies)) {
                    // Ignore organization dependencies.
                    if (this.dependencyRepositoryName(dependency) === null && version.startsWith("^")) {
                        const [latestVersion] = this.run(true, true, "npm", "view", dependency, "version");

                        if (latestVersion !== version.substring(1)) {
                            logger.info(`Dependency ${dependency}@${version} ${!this._updateAll ? "pending update" : "updating"} to version ${latestVersion}.`);

                            if (this._updateAll) {
                                currentDependencies[dependency] = `^${latestVersion}`;

                                anyDependencyUpdates = true;
                            }
                        }
                    }
                }
            }
        }

        if (anyDependencyUpdates) {
            // Save the dependency updates; this will be detected by call to anyChanges().
            this.savePackageConfiguration();
        }

        if (this._updateAll) {
            logger.debug("Updating all dependencies");

            // Running this even if there are no dependency updates will update dependencies of dependencies.
            this.run(false, false, "npm", "update");
        }

        const anyChanges = this.anyChanges(this.repository.lastAlphaPublished);

        if (anyChanges) {
            const switchToAlpha = this.preReleaseIdentifier !== "alpha";

            if (switchToAlpha) {
                // Previous publication was beta or production.
                this.updatePackageVersion(undefined, undefined, this.patchVersion + 1, "alpha");

                // Use specified registry for organization until no longer in alpha mode.
                this.run(false, false, "npm", "set", this.atOrganizationRegistry, "--location", "project");
            }

            if (this.organizationDependenciesUpdated && (switchToAlpha || !this._updateAll)) {
                const updateOrganizationDependencies = Object.values(this.organizationDependencies).filter(updateOrganizationDependency => updateOrganizationDependency !== null);

                logger.debug(`Updating organization dependencies [${updateOrganizationDependencies.join(", ")}]`);

                this.run(false, false, "npm", "update", ...updateOrganizationDependencies);
            }
        }

        // Run lint if present.
        this.run(false, false, "npm", "run", "lint", "--if-present");

        // Run development build if present.
        this.run(false, false, "npm", "run", "build:dev", "--if-present");

        if (anyChanges) {
            const nowISOString = new Date().toISOString();

            // Nothing further required if this repository is not a dependency of others.
            if (this.repository.dependencyType !== "none") {
                if (!this.dryRun) {
                    // Backup the package configuration file.
                    fs.renameSync(PACKAGE_CONFIGURATION_PATH, BACKUP_PACKAGE_CONFIGURATION_PATH);
                }

                try {
                    // Package version is transient.
                    this.updatePackageVersion(undefined, undefined, undefined, `alpha.${nowISOString.replaceAll(/[^\d]/g, "").substring(0, 12)}`);

                    // Publish to development NPM registry.
                    this.run(false, false, "npm", "publish", "--tag", "alpha");

                    // Unpublish all prior alpha versions.
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Output is a JSON array.
                    for (const version of JSON.parse(this.run(true, true, "npm", "view", this.packageConfiguration.name, "versions", "--json").join("\n")) as string[]) {
                        if (/^\d+.\d+.\d+-alpha.\d+$/.test(version) && version !== this.packageConfiguration.version) {
                            this.run(false, false, "npm", "unpublish", `${this.packageConfiguration.name}@${version}`);
                        }
                    }
                } finally {
                    if (!this.dryRun) {
                        // Restore the package configuration file.
                        fs.rmSync(PACKAGE_CONFIGURATION_PATH);
                        fs.renameSync(BACKUP_PACKAGE_CONFIGURATION_PATH, PACKAGE_CONFIGURATION_PATH);
                    }
                }
            }

            // TODO Add commit for package.json and package-lock.json.
            this.repository.lastAlphaPublished = nowISOString;
        }
    }
}

// Detailed syntax checking not required as this is an internal tool.
await new PublishAlpha(process.argv.includes("--update-all"), process.argv.includes("--dry-run")).publishAll().catch((e: unknown) => {
    logger.error(e);
});
