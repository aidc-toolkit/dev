import { spawnSync } from "child_process";

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

    return captureOutput ? spawnResult.stdout.toString().split("\n").slice(0, -1) : [];
}
