import * as fs from "node:fs";
import type { Repository } from "./configuration";
import { logger } from "./logger.js";
import { PACKAGE_CONFIGURATION_PATH, PACKAGE_LOCK_CONFIGURATION_PATH, Publish } from "./publish.js";

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
    protected dependencyVersionFor(): string {
        // Dependency version is always "alpha".
        return "alpha";
    }

    /**
     * @inheritDoc
     */
    protected getPhaseDateTime(repository: Repository, phaseDateTime: Date): Date {
        // If beta or production has been published since the last alpha, use that instead.
        return this.latestDateTime(phaseDateTime, repository.phaseStates.beta?.dateTime, repository.phaseStates.production?.dateTime);
    }

    /**
     * @inheritDoc
     */
    protected isValidBranch(): boolean {
        // Any branch is valid for alpha publication.
        return true;
    }

    /**
     * @inheritDoc
     */
    protected publish(): void {
        let anyExternalUpdates = false;

        const repositoryState = this.repositoryState;
        const packageConfiguration = repositoryState.packageConfiguration;

        // Check for external updates, even if there are no changes.
        for (const currentDependencies of [packageConfiguration.devDependencies, packageConfiguration.dependencies]) {
            if (currentDependencies !== undefined) {
                for (const [dependencyPackageName, version] of Object.entries(currentDependencies)) {
                    // Ignore organization dependencies.
                    if (this.dependencyRepositoryName(dependencyPackageName) === null && version.startsWith("^")) {
                        const [latestVersion] = this.run(true, true, "npm", "view", dependencyPackageName, "version");

                        if (latestVersion !== version.substring(1)) {
                            logger.info(`Dependency ${dependencyPackageName}@${version} ${!this._updateAll ? "pending update" : "updating"} to version ${latestVersion}.`);

                            if (this._updateAll) {
                                currentDependencies[dependencyPackageName] = `^${latestVersion}`;

                                anyExternalUpdates = true;
                            }
                        }
                    }
                }
            }
        }

        if (anyExternalUpdates) {
            // Save the dependency updates; this will be detected by call to anyChanges().
            this.savePackageConfiguration();
        }

        if (this._updateAll) {
            logger.debug("Updating all dependencies");

            // Running this even if there are no dependency updates will update dependencies of dependencies.
            this.run(false, false, "npm", "update", ...repositoryState.npmPlatformArgs);
        }

        const anyChanges = this.anyChanges(repositoryState.phaseDateTime, true) || repositoryState.anyDependenciesUpdated;

        if (anyChanges) {
            const switchToAlpha = repositoryState.preReleaseIdentifier !== "alpha";

            if (switchToAlpha) {
                // Previous publication was beta or production.
                this.updatePackageVersion(undefined, undefined, repositoryState.patchVersion + 1, "alpha");

                // Use specified registry for organization until no longer in alpha mode.
                this.run(false, false, "npm", "config", "set", this.atOrganizationRegistry, "--location", "project");
            }

            if (repositoryState.anyDependenciesUpdated && (switchToAlpha || !this._updateAll)) {
                this.updateOrganizationDependencies();
            }
        }

        // Run lint if present.
        this.run(false, false, "npm", "run", "lint", "--if-present");

        // Run development build if present.
        this.run(false, false, "npm", "run", "build:dev", "--if-present");

        // Run test if present.
        this.run(false, false, "npm", "run", "test", "--if-present");

        if (anyChanges) {
            const now = new Date();
            // Nothing further required if this repository is not a dependency of others.
            if (repositoryState.repository.dependencyType !== "none") {
                if (!this.dryRun) {
                    // Backup the package configuration file.
                    fs.renameSync(PACKAGE_CONFIGURATION_PATH, BACKUP_PACKAGE_CONFIGURATION_PATH);
                }

                try {
                    // Package version is transient.
                    this.updatePackageVersion(undefined, undefined, undefined, `alpha.${now.toISOString().replaceAll(/\D/g, "").substring(0, 12)}`);

                    // Publish to development NPM registry.
                    this.run(false, false, "npm", "publish", "--tag", "alpha");

                    // Unpublish all prior alpha versions.
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Output is a JSON array.
                    for (const version of JSON.parse(this.run(true, true, "npm", "view", packageConfiguration.name, "versions", "--json").join("\n")) as string[]) {
                        if (/^\d+.\d+.\d+-alpha.\d+$/.test(version) && version !== packageConfiguration.version) {
                            this.run(false, false, "npm", "unpublish", `${packageConfiguration.name}@${version}`);
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

            this.commitUpdatedPackageVersion(PACKAGE_CONFIGURATION_PATH, PACKAGE_LOCK_CONFIGURATION_PATH);

            this.updatePhaseState({
                dateTime: now
            });
        }
    }
}

// Detailed syntax checking not required as this is an internal tool.
await new PublishAlpha(process.argv.includes("--update-all"), process.argv.includes("--dry-run")).publishAll().catch((e: unknown) => {
    logger.error(e);
});
