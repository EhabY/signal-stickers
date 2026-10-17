export const ENVIRONMENTS = ["production", "staging"] as const;

export type Environment = (typeof ENVIRONMENTS)[number];

export type EnvironmentConfig = Readonly<{ chatUrl: string; cdnUrl: string }>;

const CONFIGS: Record<Environment, EnvironmentConfig> = {
	production: { chatUrl: "https://chat.signal.org", cdnUrl: "https://cdn.signal.org" },
	staging: { chatUrl: "https://chat.staging.signal.org", cdnUrl: "https://cdn-staging.signal.org" },
};

export function getEnvironmentConfig(env: Environment): EnvironmentConfig {
	return CONFIGS[env];
}

export function isEnvironment(value: unknown): value is Environment {
	return ENVIRONMENTS.some((env) => env === value);
}

/** A mistake in `SIGNAL_STICKERS_ENV`; front ends report it like a wrong command line. */
export class UnknownEnvironmentError extends Error {
	override name = "UnknownEnvironmentError";
}

/**
 * The environment a front end uses: staging when its `--staging` flag is set, otherwise
 * `SIGNAL_STICKERS_ENV` from `variables`, otherwise production.
 */
export function resolveEnvironment(
	staging: boolean | undefined,
	variables: Readonly<Record<string, string | undefined>>,
): Environment {
	if (staging === true) {
		return "staging";
	}
	const value = variables.SIGNAL_STICKERS_ENV;
	if (value === undefined || value === "") {
		return "production";
	}
	if (!isEnvironment(value)) {
		throw new UnknownEnvironmentError(
			`SIGNAL_STICKERS_ENV must be one of: ${ENVIRONMENTS.join(", ")}`,
		);
	}
	return value;
}
