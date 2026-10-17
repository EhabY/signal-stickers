export const ENVIRONMENTS = ["production", "staging"] as const;

export type Environment = (typeof ENVIRONMENTS)[number];

export type EnvironmentConfig = Readonly<{ cdnUrl: string }>;

const CONFIGS: Record<Environment, EnvironmentConfig> = {
	production: { cdnUrl: "https://cdn.signal.org" },
	staging: { cdnUrl: "https://cdn-staging.signal.org" },
};

export function getEnvironmentConfig(env: Environment): EnvironmentConfig {
	return CONFIGS[env];
}

export function isEnvironment(value: unknown): value is Environment {
	return ENVIRONMENTS.some((env) => env === value);
}
