import { Auth0Provider, useAuth0 } from "@auth0/auth0-react";
import { useEffect, type ReactNode } from "react";

import { auth0Config } from "./lib/auth0";
import { Portal } from "./portal/Portal";

function SignInPanel() {
  const { loginWithRedirect, isLoading, error } = useAuth0();

  useEffect(() => {
    if (!error) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has("code") && !params.has("state") && !params.has("error")) return;
    window.history.replaceState({}, document.title, window.location.pathname);
  }, [error]);

  return (
    <div className="mx-auto w-full max-w-md">
      <p className="text-sm font-semibold text-violet-600">Welcome back</p>
      <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
        Sign in to your workspace
      </h2>
      <p className="mt-3 text-slate-500">
        Authenticate with Auth0 to open your agency workspace.
      </p>

      {error ? (
        <p className="mt-6 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">
          {error.message}
        </p>
      ) : null}

      <button
        className="mt-10 w-full rounded-xl bg-violet-600 px-4 py-3 font-semibold text-white shadow-sm transition hover:bg-violet-500 disabled:cursor-wait disabled:opacity-60"
        disabled={isLoading}
        type="button"
        onClick={() => {
          void loginWithRedirect();
        }}
      >
        {isLoading ? "Loading…" : "Login"}
      </button>
    </div>
  );
}

function LandingPage() {
  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="mx-auto grid min-h-screen max-w-7xl lg:grid-cols-[1.15fr_0.85fr]">
        <section className="flex flex-col justify-between px-6 py-8 sm:px-12 lg:px-16 lg:py-14">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-500 font-black text-white">
              P
            </div>
            <span className="text-lg font-bold tracking-tight">Prospect Pal</span>
          </div>

          <div className="my-20 max-w-2xl">
            <p className="mb-5 text-sm font-bold uppercase tracking-[0.24em] text-violet-600">
              Agency intelligence
            </p>
            <h1 className="text-5xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
              Find the businesses you can{" "}
              <span className="bg-gradient-to-r from-violet-600 via-fuchsia-500 to-orange-400 bg-clip-text text-transparent">
                genuinely help
              </span>
              .
            </h1>
            <p className="mt-7 max-w-xl text-lg leading-8 text-slate-500">
              Research local opportunities, verify the evidence, and keep every first social
              outreach message human-controlled.
            </p>
          </div>

          <p className="text-sm text-slate-400">Internal workspace · Auth0 sign-in</p>
        </section>

        <section className="flex items-center border-t border-slate-200 bg-slate-50 px-6 py-16 sm:px-12 lg:border-l lg:border-t-0">
          <SignInPanel />
        </section>
      </div>
    </main>
  );
}

function AuthGate() {
  const { isAuthenticated, isLoading } = useAuth0();

  if (isLoading) {
    return (
      <main className="grid min-h-screen place-items-center bg-white">
        <p className="text-slate-500">Checking session…</p>
      </main>
    );
  }

  return isAuthenticated ? <Portal /> : <LandingPage />;
}

function Auth0AppProvider({ children }: { children: ReactNode }) {
  return (
    <Auth0Provider
      domain={auth0Config.domain}
      clientId={auth0Config.clientId}
      authorizationParams={{
        audience: auth0Config.audience,
        redirect_uri: auth0Config.redirectUri,
        scope: "openid profile email offline_access",
      }}
      cacheLocation="localstorage"
      useCookiesForTransactions
      useRefreshTokens
    >
      {children}
    </Auth0Provider>
  );
}

export function App() {
  return (
    <Auth0AppProvider>
      <AuthGate />
    </Auth0AppProvider>
  );
}
