import { spawnSync } from "child_process";
import { Logger } from "tslog";

/**
 * Log level.
 */
enum LogLevel {
    Silly, Trace, Debug, Info, Warn, Error, Fatal
}

/**
 * Logger with a default minimum level of Info.
 */
export const logger = new Logger({
    minLevel: LogLevel.Info
});

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
export function run(captureOutput: boolean, command: string, ...args: string[]): string[] {
    logger.trace(`Running command "${command}" with arguments ${JSON.stringify(args)}.`);

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
    const output = captureOutput ? spawnResult.stdout.toString().split("\n").slice(0, -1) : [];

    if (captureOutput) {
        logger.trace(`Output is ${JSON.stringify(output)}.`);
    }

    return output;
}

/**
 * Create an object with omitted or picked entries.
 *
 * @param omitting
 * True if omitting.
 *
 * @param o
 * Object.
 *
 * @param keys
 * Keys to omit or pick.
 *
 * @returns
 * Edited object.
 */
function omitOrPick<Omitting extends boolean, T extends object, K extends keyof T>(omitting: Omitting, o: T, ...keys: K[]): Omitting extends true ? Omit<T, K> : Pick<T, K> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Key and value types are known.
    return Object.fromEntries(Object.entries(o).filter(([key]) => keys.includes(key as K) !== omitting)) as ReturnType<typeof omitOrPick<Omitting, T, K>>;
}

/**
 * Create an object with omitted entries.
 *
 * @param o
 * Object.
 *
 * @param keys
 * Keys to omit.
 *
 * @returns
 * Edited object.
 */
export function omit<T extends object, K extends keyof T>(o: T, ...keys: K[]): Omit<T, K> {
    return omitOrPick(true, o, ...keys);
}

/**
 * Create an object with picked entries.
 *
 * @param o
 * Object.
 *
 * @param keys
 * Keys to pick.
 *
 * @returns
 * Edited object.
 */
export function pick<T extends object, K extends keyof T>(o: T, ...keys: K[]): Pick<T, K> {
    return omitOrPick(false, o, ...keys);
}
