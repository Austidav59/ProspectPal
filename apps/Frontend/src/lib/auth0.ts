function requiredEnv(name: keyof ImportMetaEnv, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required Vite env var: ${name}`);
  }
  return value;
}

export const auth0Config = {
  domain: requiredEnv("VITE_AUTH0_DOMAIN", import.meta.env.VITE_AUTH0_DOMAIN),
  clientId: requiredEnv("VITE_AUTH0_CLIENT_ID", import.meta.env.VITE_AUTH0_CLIENT_ID),
  audience: requiredEnv("VITE_AUTH0_AUDIENCE", import.meta.env.VITE_AUTH0_AUDIENCE),
  redirectUri:
    import.meta.env.VITE_AUTH0_REDIRECT_URI ??
    (typeof window !== "undefined" ? window.location.origin : "http://localhost:5173"),
};
