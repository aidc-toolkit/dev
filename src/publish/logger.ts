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
 * Set the log level.
 *
 * @param logLevel
 * Log level as enumeration value or string.
 */
export function setLogLevel(logLevel: LogLevel | string): void {
    if (typeof logLevel === "string") {
        if (logLevel in LogLevel) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- String exists as a key.
            logger.settings.minLevel = LogLevel[logLevel as keyof typeof LogLevel];
        } else {
            logger.error(`Unknown log level ${logLevel}`);
        }
    } else {
        logger.settings.minLevel = logLevel;
    }
}
