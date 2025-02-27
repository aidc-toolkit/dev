import * as fs from "fs";
import { run } from "./command-util.js";

/**
 * Configuration layout of package.json (relevant attributes only).
 */
interface PackageConfiguration {
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

/**
 * Fix alpha dependencies from the organization.
 *
 * @param atOrganization
 * '@' symbol and organization.
 * @param dependencies
 * Dependencies.
 */
function fixAlphaDependencies(atOrganization: string, dependencies: Record<string, string> | undefined): void {
    if (dependencies !== undefined) {
        for (const dependency in dependencies) {
            if (dependency.split("/")[0] === atOrganization) {
                // npm update --save updates this with the latest.
                dependencies[dependency] = "alpha";
            }
        }
    }
}

/**
 * Publish to development npm registry.
 */
export function publishDev(): void {
    // Ensure that packages are up to date.
    run(false, "npm", "update", "--save");

    const now = new Date();

    const packageConfigurationPath = "package.json";
    const backupPackageConfigurationPath = "_package.json";

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Package configuration format is known.
    const packageConfiguration: PackageConfiguration = JSON.parse(fs.readFileSync(packageConfigurationPath).toString());

    const atOrganization = packageConfiguration.name.split("/")[0];

    fixAlphaDependencies(atOrganization, packageConfiguration.devDependencies);
    fixAlphaDependencies(atOrganization, packageConfiguration.dependencies);

    // Save the package configuration.
    fs.writeFileSync(packageConfigurationPath, `${JSON.stringify(packageConfiguration, null, 2)}\n`);

    // Backup the package configuration file.
    fs.renameSync(packageConfigurationPath, backupPackageConfigurationPath);

    try {
        // Strip pre-release identifier if any and parse semantic version into its components.
        const [majorVersion, minorVersion, patchVersion] = packageConfiguration.version.split("-")[0].split(".").map(versionString => Number(versionString));

        // Set version to alpha version with incremental patch version number.
        packageConfiguration.version = `${majorVersion}.${minorVersion}.${patchVersion + 1}-alpha.${now.getFullYear()}${zeroPadded(now.getMonth() + 1, 2)}${zeroPadded(now.getDate(), 2)}${zeroPadded(now.getHours(), 2)}${zeroPadded(now.getMinutes(), 2)}`;

        // Save the package configuration.
        fs.writeFileSync(packageConfigurationPath, `${JSON.stringify(packageConfiguration, null, 2)}\n`);

        // Run the development build.
        run(false, "npm", "run", "build:dev");

        // Publish to the registry.
        run(false, "npm", "publish", "--tag", "alpha");

        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Result is an array.
        for (const version of JSON.parse(run(true, "npm", "view", packageConfiguration.name, "versions", "--json").join("\n")) as string[]) {
            if (/^[0-9]+.[0-9]+.[0-9]+-alpha.[0-9]+$/.test(version) && version !== packageConfiguration.version) {
                run(false, "npm", "unpublish", `${packageConfiguration.name}@${version}`);
            }
        }
    } finally {
        // Restore the package configuration file.
        fs.rmSync(packageConfigurationPath);
        fs.renameSync(backupPackageConfigurationPath, packageConfigurationPath);
    }
}
