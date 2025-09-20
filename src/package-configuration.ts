import fs from "node:fs";

export const PACKAGE_CONFIGURATION_PATH = "package.json";

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
 * Load package configuration.
 *
 * @returns
 * Package configuration.
 */
export function loadPackageConfiguration(): PackageConfiguration {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Package configuration format is known.
    return JSON.parse(fs.readFileSync(PACKAGE_CONFIGURATION_PATH).toString()) as PackageConfiguration;
}

/**
 * Save package configuration.
 *
 * @param packageConfiguration
 * Package configuration.
 */
export function savePackageConfiguration(packageConfiguration: PackageConfiguration): void {
    fs.writeFileSync(PACKAGE_CONFIGURATION_PATH, `${JSON.stringify(packageConfiguration, null, 2)}\n`);
}

/**
 * Package version parsed into its individual components.
 */
interface ParsedPackageVersion {
    /**
     * Major version.
     */
    majorVersion: number;

    /**
     * Minor version.
     */
    minorVersion: number;

    /**
     * Patch version.
     */
    patchVersion: number;

    /**
     * Pre-release identifier or null if none.
     */
    preReleaseIdentifier: string | null;
}

/**
 * Parse a package version into its components.
 *
 * @param packageVersion
 * Package version.
 *
 * @returns
 * Package version components.
 */
export function parsePackageVersion(packageVersion: string): ParsedPackageVersion {
    const packageVersionSplits = packageVersion.split("-");

    // Extract semantic version and pre-release identifier.
    const semanticVersion = packageVersionSplits[0];
    const preReleaseIdentifier = packageVersionSplits.length !== 1 ? `-${packageVersionSplits[1]}` : null;

    // Parse semantic version into its components.
    const [majorVersion, minorVersion, patchVersion] = semanticVersion.split(".").map(versionString => Number(versionString));

    return {
        majorVersion,
        minorVersion,
        patchVersion,
        preReleaseIdentifier
    };
}

/**
 * Build a package version from its components.
 *
 * @param parsedPackageVersion
 * Package version components.
 *
 * @returns
 * Package version.
 */
export function buildPackageVersion(parsedPackageVersion: ParsedPackageVersion): string {
    return `${parsedPackageVersion.majorVersion}.${parsedPackageVersion.minorVersion}.${parsedPackageVersion.patchVersion}${parsedPackageVersion.preReleaseIdentifier !== null ? `-${parsedPackageVersion.preReleaseIdentifier}` : ""}`;
}
