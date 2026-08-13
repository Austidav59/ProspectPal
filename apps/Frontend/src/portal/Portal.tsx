import { useAuth0 } from "@auth0/auth0-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import {
  createCampaign,
  createEmailCampaign,
  createTestEmailLeads,
  deleteCampaign,
  disconnectGmail,
  fetchCurrentUser,
  fetchEmailCampaignStatus,
  fetchEmailCampaignTemplates,
  fetchGmailStatus,
  fetchOutreachSummary,
  fetchSettings,
  hideCampaign,
  listBusinesses,
  listCampaigns,
  listEmailCampaigns,
  markDmSent,
  previewEmailCampaignAudience,
  runCampaign,
  sendOfferEmail,
  setReplied,
  startEmailCampaign,
  startGmailConnect,
  unhideCampaign,
  updateSettings,
  type Business,
  type Campaign,
  type EmailCampaign,
  type EmailCampaignTemplate,
  type EmailOfferType,
  type Settings,
} from "../lib/api";
import { auth0Config } from "../lib/auth0";

type TokenGetter = () => Promise<string>;

function useApiToken(): TokenGetter {
  const { getAccessTokenSilently } = useAuth0();
  return useCallback(
    () =>
      getAccessTokenSilently({
        authorizationParams: { audience: auth0Config.audience },
      }),
    [getAccessTokenSilently],
  );
}

const inputClass =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm " +
  "placeholder:text-slate-400 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200 " +
  "dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 " +
  "dark:focus:border-violet-400 dark:focus:ring-violet-900";

const primaryButtonClass =
  "rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition " +
  "hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClass =
  "rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm " +
  "transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 " +
  "dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800";

const panelClass =
  "rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900";

const cardClass =
  "rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-900";

const instagramButtonClass =
  "rounded-lg bg-gradient-to-r from-fuchsia-500 via-pink-500 to-orange-400 px-4 py-2 text-sm " +
  "font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
const facebookButtonClass =
  "rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition " +
  "hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50";

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function ordinal(value: number): string {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  if (value % 10 === 1) return `${value}st`;
  if (value % 10 === 2) return `${value}nd`;
  if (value % 10 === 3) return `${value}rd`;
  return `${value}th`;
}

function replaceName(template: string, name: string): string {
  return template.replaceAll("{name}", name);
}

function runStatusBadge(campaign: Campaign) {
  const run = campaign.runs?.[0];
  if (!run) return <span className="text-xs text-slate-400">Never run</span>;

  const styles: Record<string, string> = {
    QUEUED: "bg-amber-100 text-amber-700",
    RUNNING: "bg-sky-100 text-sky-700",
    COMPLETED: "bg-emerald-100 text-emerald-700",
    FAILED: "bg-rose-100 text-rose-700",
  };

  return (
    <div className="flex max-w-xs flex-col items-end gap-1">
      <span
        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${styles[run.status]}`}
      >
        {run.status === "COMPLETED"
          ? `Done · ${run.discoveredCount} claimed`
          : run.status === "FAILED"
            ? `Failed${run.errorMessage ? ` · ${run.errorMessage}` : ""}`
            : run.status === "RUNNING"
              ? "Finding fresh leads…"
              : "Queued"}
      </span>
      {run.poolMessage ? (
        <span className="text-right text-xs text-amber-700">
          {run.poolMessage}
        </span>
      ) : null}
    </div>
  );
}

function DmCounter() {
  const getToken = useApiToken();
  const summaryQuery = useQuery({
    queryKey: ["outreach", "summary"],
    queryFn: async () => fetchOutreachSummary(await getToken()),
    refetchInterval: 60_000,
  });

  const summary = summaryQuery.data;
  if (!summary) return null;

  const atLimit = summary.dmsToday >= summary.dmDailyLimit;
  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-bold ${
        atLimit ? "bg-rose-100 text-rose-700" : "bg-violet-100 text-violet-700"
      }`}
      title="Direct messages sent today — stay under the limit to keep your Instagram account safe"
    >
      DMs today {summary.dmsToday}/{summary.dmDailyLimit}
    </span>
  );
}

function CampaignRowMenu({
  busy,
  onRunAgain,
  onDelete,
  onHide,
}: {
  busy: boolean;
  onRunAgain: () => void;
  onDelete: () => void;
  onHide: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [placeAbove, setPlaceAbove] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !rootRef.current || !menuRef.current) return;
    const trigger = rootRef.current.getBoundingClientRect();
    const menuHeight = menuRef.current.offsetHeight;
    const spaceBelow = window.innerHeight - trigger.bottom - 8;
    const spaceAbove = trigger.top - 8;
    setPlaceAbove(spaceBelow < menuHeight && spaceAbove > spaceBelow);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onViewportChange = () => setOpen(false);
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [open]);

  return (
    <div className="relative shrink-0" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="More search actions"
        className="flex size-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
        disabled={busy}
        type="button"
        onClick={() => setOpen((value) => !value)}
      >
        <span
          aria-hidden="true"
          className="text-lg leading-none tracking-widest"
        >
          ···
        </span>
      </button>
      {open ? (
        <div
          ref={menuRef}
          className={`absolute right-0 z-30 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900 ${
            placeAbove ? "bottom-full mb-1" : "top-full mt-1"
          }`}
          role="menu"
        >
          <button
            className="block w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
            role="menuitem"
            type="button"
            onClick={() => {
              setOpen(false);
              onRunAgain();
            }}
          >
            Run again — find possible new leads
          </button>
          <button
            className="block w-full px-3 py-2.5 text-left text-sm text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950"
            role="menuitem"
            type="button"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            Delete
            <span className="mt-0.5 block text-xs font-normal text-rose-400 dark:text-rose-500">
              Remove from this list — pool data stays for others
            </span>
          </button>
          <button
            className="block w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
            role="menuitem"
            type="button"
            onClick={() => {
              setOpen(false);
              onHide();
            }}
          >
            Hide
            <span className="mt-0.5 block text-xs font-normal text-slate-400">
              Hide this search from Recent searches
            </span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function SearchTab({
  onViewLeads,
}: {
  onViewLeads: (campaignId: string) => void;
}) {
  const getToken = useApiToken();
  const queryClient = useQueryClient();

  const [niche, setNiche] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [maxResults, setMaxResults] = useState(50);
  const [showHidden, setShowHidden] = useState(false);

  const campaignsQuery = useQuery({
    queryKey: ["campaigns", { status: showHidden ? "PAUSED" : "active" }],
    queryFn: async () =>
      listCampaigns(
        await getToken(),
        showHidden ? { status: "PAUSED" } : undefined,
      ),
    refetchInterval: (query) => {
      if (showHidden) return false;
      const hasActiveRun = query.state.data?.items.some((campaign) => {
        const status = campaign.runs?.[0]?.status;
        return status === "QUEUED" || status === "RUNNING";
      });
      return hasActiveRun ? 4000 : false;
    },
  });

  const refreshCampaigns = () => {
    void queryClient.invalidateQueries({ queryKey: ["campaigns"] });
  };

  const searchMutation = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      const campaign = await createCampaign(token, {
        name: `${niche.trim()} · ${city.trim()}${state.trim() ? `, ${state.trim()}` : ""}`,
        niche: niche.trim(),
        city: city.trim(),
        state: state.trim() || null,
        country: "United States",
        maximumResults: maxResults,
      });
      await runCampaign(token, campaign.id);
      return campaign;
    },
    onSuccess: () => {
      setNiche("");
      setCity("");
      setState("");
      setShowHidden(false);
      refreshCampaigns();
    },
  });

  const runAgainMutation = useMutation({
    mutationFn: async (campaignId: string) =>
      runCampaign(await getToken(), campaignId),
    onSuccess: refreshCampaigns,
  });

  const deleteMutation = useMutation({
    mutationFn: async (campaignId: string) =>
      deleteCampaign(await getToken(), campaignId),
    onSuccess: refreshCampaigns,
  });

  const hideMutation = useMutation({
    mutationFn: async (campaignId: string) =>
      hideCampaign(await getToken(), campaignId),
    onSuccess: refreshCampaigns,
  });

  const unhideMutation = useMutation({
    mutationFn: async (campaignId: string) =>
      unhideCampaign(await getToken(), campaignId),
    onSuccess: () => {
      setShowHidden(false);
      refreshCampaigns();
    },
  });

  const menuBusy =
    runAgainMutation.isPending ||
    deleteMutation.isPending ||
    hideMutation.isPending ||
    unhideMutation.isPending;
  const menuError =
    runAgainMutation.error ??
    deleteMutation.error ??
    hideMutation.error ??
    unhideMutation.error;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (niche.trim().length < 2 || city.trim().length < 2) return;
    searchMutation.mutate();
  };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-10">
      <form className={panelClass} onSubmit={handleSubmit}>
        <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Find businesses
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Leads come from a shared pool first (cheaper) and each claimed lead is
          locked to you for 6 months so other users don&apos;t burn it. Ranked
          by who is most likely to want SEO help.
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
              Business type
            </span>
            <input
              className={inputClass}
              placeholder="home cleaners"
              value={niche}
              onChange={(event) => setNiche(event.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">City</span>
            <input
              className={inputClass}
              placeholder="McAllen"
              value={city}
              onChange={(event) => setCity(event.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">
              State (optional)
            </span>
            <input
              className={inputClass}
              placeholder="Texas"
              value={state}
              onChange={(event) => setState(event.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">
              Max results (1–60)
            </span>
            <input
              className={inputClass}
              max={60}
              min={1}
              type="number"
              value={maxResults}
              onChange={(event) =>
                setMaxResults(Number(event.target.value) || 1)
              }
            />
          </label>
        </div>

        {searchMutation.error ? (
          <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">
            {searchMutation.error.message}
          </p>
        ) : null}

        <button
          className={`${primaryButtonClass} mt-6`}
          disabled={
            searchMutation.isPending ||
            niche.trim().length < 2 ||
            city.trim().length < 2
          }
          type="submit"
        >
          {searchMutation.isPending
            ? "Starting search…"
            : "Search Google Places"}
        </button>
      </form>

      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {showHidden ? "Hidden searches" : "Recent searches"}
          </h3>
          <button
            className="text-sm font-semibold text-violet-600 hover:text-violet-500 dark:text-violet-400"
            type="button"
            onClick={() => setShowHidden((value) => !value)}
          >
            {showHidden ? "Back to recent" : "Show hidden"}
          </button>
        </div>
        {showHidden ? (
          <p className="mt-1 text-xs text-slate-400">
            Hidden searches stay in your workspace. Unhide to put them back in
            Recent searches.
          </p>
        ) : null}
        {menuError ? (
          <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600 dark:bg-rose-950 dark:text-rose-300">
            {menuError.message}
          </p>
        ) : null}
        {campaignsQuery.isLoading ? (
          <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
            Loading searches…
          </p>
        ) : campaignsQuery.data && campaignsQuery.data.items.length > 0 ? (
          <ul className="mt-4 space-y-3">
            {campaignsQuery.data.items.map((campaign) => (
              <li
                key={campaign.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900 dark:text-slate-100">
                    {campaign.name}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {campaign.niche} · {campaign.city}
                    {campaign.state ? `, ${campaign.state}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-3">
                  {runStatusBadge(campaign)}
                  <button
                    className={primaryButtonClass}
                    type="button"
                    onClick={() => onViewLeads(campaign.id)}
                  >
                    View leads
                  </button>
                  {showHidden ? (
                    <button
                      className={secondaryButtonClass}
                      disabled={unhideMutation.isPending}
                      type="button"
                      onClick={() => unhideMutation.mutate(campaign.id)}
                    >
                      Unhide
                    </button>
                  ) : (
                    <CampaignRowMenu
                      busy={menuBusy}
                      onDelete={() => deleteMutation.mutate(campaign.id)}
                      onHide={() => hideMutation.mutate(campaign.id)}
                      onRunAgain={() => runAgainMutation.mutate(campaign.id)}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-slate-400">
            {showHidden
              ? "No hidden searches."
              : "No searches yet. Run your first one above."}
          </p>
        )}
      </section>
    </div>
  );
}

function ContactBadge({ business }: { business: Business }) {
  if (business.repliedAt) {
    return (
      <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
        Replied ✓
      </span>
    );
  }
  if (business.dmSentAt || business.emailSentAt) {
    const parts = [
      business.dmSentAt ? `DM'd ${formatDay(business.dmSentAt)}` : null,
      business.emailSentAt
        ? `Emailed ${formatDay(business.emailSentAt)}`
        : null,
    ].filter(Boolean);
    return (
      <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-semibold text-violet-700">
        {parts.join(" · ")}
      </span>
    );
  }
  return (
    <span className="rounded-full border border-slate-200 px-2.5 py-0.5 text-xs font-semibold text-slate-400">
      Not messaged
    </span>
  );
}

function LeadLinks({ business }: { business: Business }) {
  return (
    <div className="mt-2 flex flex-wrap gap-3 text-xs font-medium">
      {business.websiteUrl ? (
        <a
          className="text-violet-600 hover:underline"
          href={business.websiteUrl}
          rel="noreferrer"
          target="_blank"
        >
          Website
        </a>
      ) : (
        <span className="text-slate-300">No website</span>
      )}
      {business.googleMapsUrl ? (
        <a
          className="text-violet-600 hover:underline"
          href={business.googleMapsUrl}
          rel="noreferrer"
          target="_blank"
        >
          Google Maps
        </a>
      ) : null}
      {business.instagramUrl ? (
        <a
          className="text-pink-600 hover:underline"
          href={business.instagramUrl}
          rel="noreferrer"
          target="_blank"
        >
          {business.instagramUrl
            .replace("https://www.instagram.com/", "@")
            .replace(/\/$/, "")}
        </a>
      ) : null}
      {business.facebookUrl ? (
        <a
          className="text-blue-600 hover:underline"
          href={business.facebookUrl}
          rel="noreferrer"
          target="_blank"
        >
          Facebook
        </a>
      ) : null}
      {business.email ? (
        <span className="text-slate-500">{business.email}</span>
      ) : null}
    </div>
  );
}

function LeadCard({
  business,
  dmTemplate,
  dmBlocked,
  gmailConnected,
  onConnectGmail,
}: {
  business: Business;
  dmTemplate: string;
  dmBlocked: boolean;
  gmailConnected: boolean;
  onConnectGmail: () => void;
}) {
  const getToken = useApiToken();
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["businesses"] });
    void queryClient.invalidateQueries({ queryKey: ["outreach", "summary"] });
  };

  const dmMutation = useMutation({
    mutationFn: async () => markDmSent(await getToken(), business.id),
    onSuccess: refresh,
  });

  const emailMutation = useMutation({
    mutationFn: async () => sendOfferEmail(await getToken(), business.id),
    onSuccess: refresh,
  });

  const handleDirectMessage = async (profileUrl: string) => {
    if (dmBlocked) return;
    try {
      await navigator.clipboard.writeText(
        replaceName(dmTemplate, business.name),
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard can be blocked; still open Instagram and count the DM.
    }
    window.open(profileUrl, "_blank", "noopener,noreferrer");
    dmMutation.mutate();
  };

  const stillEnriching =
    (!business.websiteUrl && !business.websiteDiscoveryAttemptedAt) ||
    (Boolean(business.websiteUrl) && !business.instagramScrapedAt) ||
    (!business.instagramUrl && !business.googleSearchAttemptedAt);
  const outreachReady = Boolean(
    business.instagramUrl || business.facebookUrl || business.email,
  );

  let action: ReactNode;
  if (business.instagramUrl) {
    action = (
      <button
        className={instagramButtonClass}
        disabled={dmBlocked || dmMutation.isPending}
        title={
          dmBlocked ? "Daily DM limit reached — try again tomorrow" : undefined
        }
        type="button"
        onClick={() => handleDirectMessage(business.instagramUrl!)}
      >
        {copied
          ? "Message copied!"
          : business.dmSentAt
            ? "DM again"
            : "Direct Message"}
      </button>
    );
  } else if (business.facebookUrl) {
    action = (
      <button
        className={facebookButtonClass}
        disabled={dmBlocked || dmMutation.isPending}
        title={
          dmBlocked ? "Daily DM limit reached — try again tomorrow" : undefined
        }
        type="button"
        onClick={() => handleDirectMessage(business.facebookUrl!)}
      >
        {copied
          ? "Message copied!"
          : business.dmSentAt
            ? "Message on Facebook again"
            : "Message on Facebook"}
      </button>
    );
  } else if (business.email) {
    if (!gmailConnected) {
      action = (
        <button
          className={secondaryButtonClass}
          type="button"
          onClick={onConnectGmail}
        >
          Connect Gmail to email
        </button>
      );
    } else {
      action = (
        <button
          className={primaryButtonClass}
          disabled={emailMutation.isPending || Boolean(business.emailSentAt)}
          type="button"
          onClick={() => emailMutation.mutate()}
        >
          {business.emailSentAt
            ? `Emailed ${formatDay(business.emailSentAt)} ✓`
            : emailMutation.isPending
              ? "Sending…"
              : "Email them"}
        </button>
      );
    }
  } else if (stillEnriching) {
    action = (
      <div className="w-44 space-y-1.5">
        <div className="h-1.5 overflow-hidden rounded-full bg-sky-100">
          <div className="h-full w-2/3 animate-pulse rounded-full bg-sky-400" />
        </div>
        <span className="block text-right text-xs font-medium text-sky-600">
          Finding a way to contact…
        </span>
      </div>
    );
  } else {
    action = <span className="text-xs text-slate-400">No contact found</span>;
  }

  const errorMessage =
    dmMutation.error?.message ?? emailMutation.error?.message;

  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-slate-900">{business.name}</p>
            <ContactBadge business={business} />
            {business.googleRank ? (
              <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                {ordinal(business.googleRank)} on Google
              </span>
            ) : null}
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                outreachReady
                  ? "bg-emerald-100 text-emerald-700"
                  : stillEnriching
                    ? "bg-sky-100 text-sky-700"
                    : "bg-slate-100 text-slate-500"
              }`}
            >
              {outreachReady
                ? "Ready to reach out"
                : stillEnriching
                  ? "Finding contact info"
                  : "No contact found"}
            </span>
            {business.receptivenessLabel ? (
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  business.receptivenessScore &&
                  business.receptivenessScore >= 75
                    ? "bg-emerald-100 text-emerald-700"
                    : business.receptivenessScore &&
                        business.receptivenessScore >= 55
                      ? "bg-sky-100 text-sky-700"
                      : "bg-slate-100 text-slate-600"
                }`}
                title={(business.receptivenessReasons ?? []).join(" · ")}
              >
                {business.receptivenessLabel}
                {business.receptivenessScore !== undefined
                  ? ` · ${business.receptivenessScore}`
                  : ""}
              </span>
            ) : null}
          </div>
          {business.receptivenessReasons &&
          business.receptivenessReasons.length > 0 ? (
            <p className="mt-1 text-xs text-slate-500">
              {business.receptivenessReasons.slice(0, 2).join(" · ")}
            </p>
          ) : null}
          <p className="mt-0.5 text-xs text-slate-400">
            {business.primaryCategory ?? "Business"} · {business.address}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {business.rating !== null ? (
              <span className="font-medium text-amber-500">
                ★ {business.rating.toFixed(1)}
              </span>
            ) : (
              "No rating"
            )}
            {business.reviewCount !== null
              ? ` (${business.reviewCount} reviews)`
              : ""}
            {business.phone ? ` · ${business.phone}` : ""}
          </p>
          <LeadLinks business={business} />
        </div>

        <div className="flex max-w-64 flex-col items-end gap-2">
          {action}
          {errorMessage ? (
            <span className="max-w-56 text-right text-xs text-rose-500">
              {errorMessage}
            </span>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function LeadsTab({
  campaignFilter,
  onOpenSettings,
}: {
  campaignFilter: string;
  onOpenSettings: () => void;
}) {
  const getToken = useApiToken();
  const queryClient = useQueryClient();

  const [campaignId, setCampaignId] = useState(campaignFilter);
  const [search, setSearch] = useState("");
  const [contactedFilter, setContactedFilter] = useState<
    "all" | "not-messaged" | "messaged"
  >("all");
  const [page, setPage] = useState(1);

  useEffect(() => {
    setCampaignId(campaignFilter);
    setPage(1);
  }, [campaignFilter]);

  const campaignsQuery = useQuery({
    queryKey: ["campaigns"],
    queryFn: async () => listCampaigns(await getToken()),
  });

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: async () => fetchSettings(await getToken()),
  });

  const gmailQuery = useQuery({
    queryKey: ["email", "gmail"],
    queryFn: async () => fetchGmailStatus(await getToken()),
  });

  const summaryQuery = useQuery({
    queryKey: ["outreach", "summary"],
    queryFn: async () => fetchOutreachSummary(await getToken()),
  });

  const businessesQuery = useQuery({
    queryKey: ["businesses", { campaignId, search, contactedFilter, page }],
    queryFn: async () =>
      listBusinesses(await getToken(), {
        page,
        search: search.trim() || undefined,
        campaignId: campaignId || undefined,
        contacted:
          contactedFilter === "all"
            ? undefined
            : contactedFilter === "messaged",
        contactableOnly: false,
      }),
    refetchInterval: (query) => {
      const scanning = query.state.data?.items.some(
        (business) =>
          (!business.websiteUrl && !business.websiteDiscoveryAttemptedAt) ||
          (business.websiteUrl && !business.instagramScrapedAt) ||
          (!business.instagramUrl && !business.googleSearchAttemptedAt),
      );
      return scanning ? 2500 : 20000;
    },
  });

  const data = businessesQuery.data;
  const totalPages = data
    ? Math.max(1, Math.ceil(data.total / data.pageSize))
    : 1;
  const dmBlocked = summaryQuery.data
    ? summaryQuery.data.dmsToday >= summaryQuery.data.dmDailyLimit
    : false;
  const dmTemplate = settingsQuery.data?.dmTemplate ?? "";
  const gmailConnected = Boolean(gmailQuery.data?.connected);

  const testLeadsMutation = useMutation({
    mutationFn: async () => createTestEmailLeads(await getToken()),
    onSuccess: () => {
      setCampaignId("");
      setSearch("TEST —");
      setContactedFilter("all");
      setPage(1);
      void queryClient.invalidateQueries({ queryKey: ["businesses"] });
    },
  });

  const enriching =
    data?.items.filter(
      (business) =>
        (!business.websiteUrl && !business.websiteDiscoveryAttemptedAt) ||
        (business.websiteUrl && !business.instagramScrapedAt) ||
        (!business.instagramUrl && !business.googleSearchAttemptedAt),
    ) ?? [];
  const ready =
    data?.items.filter(
      (business) =>
        business.instagramUrl || business.facebookUrl || business.email,
    ) ?? [];
  const noContact =
    data?.items.filter(
      (business) =>
        !business.instagramUrl &&
        !business.facebookUrl &&
        !business.email &&
        !(
          (!business.websiteUrl && !business.websiteDiscoveryAttemptedAt) ||
          (business.websiteUrl && !business.instagramScrapedAt) ||
          (!business.instagramUrl && !business.googleSearchAttemptedAt)
        ),
    ) ?? [];
  const enrichTotal = data?.items.length ?? 0;
  const enrichDone = enrichTotal - enriching.length;
  const scanPercent =
    enrichTotal > 0 ? Math.round((enrichDone / enrichTotal) * 100) : 100;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      {enriching.length > 0 ? (
        <section className="rounded-2xl border border-sky-200 bg-sky-50 px-5 py-4">
          <div className="flex items-center justify-between gap-3 text-sm">
            <p className="font-semibold text-sky-800">
              Auto-finding contact info… {enrichDone}/{enrichTotal} checked
            </p>
            <span className="text-xs font-medium text-sky-600">
              {scanPercent}%
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-sky-100">
            <div
              className="h-full rounded-full bg-sky-500 transition-all duration-500"
              style={{ width: `${scanPercent}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-sky-700">
            {ready.length} ready to reach out · {enriching.length} processing ·{" "}
            {noContact.length} checked with no contact found
          </p>
        </section>
      ) : null}

      {dmBlocked ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-600">
          You hit your daily DM limit of {summaryQuery.data?.dmDailyLimit}.
          Direct messaging is paused until tomorrow to keep your Instagram
          account safe.
        </p>
      ) : null}

      {!gmailConnected && gmailQuery.isFetched ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 dark:border-amber-900 dark:bg-amber-950/40">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                Connect Gmail to email leads
              </p>
              <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-200/80">
                Outreach emails send from your personal inbox — no Resend domain
                required.
              </p>
            </div>
            <button
              className={primaryButtonClass}
              type="button"
              onClick={onOpenSettings}
            >
              Connect in Settings
            </button>
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-violet-200 bg-violet-50 px-5 py-4 dark:border-violet-900 dark:bg-violet-950/40">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-violet-900 dark:text-violet-100">
              Gmail test leads
            </p>
            <p className="mt-0.5 text-xs text-violet-800 dark:text-violet-200/80">
              Adds two fake leads: one to you
              {gmailQuery.data?.email ? ` (${gmailQuery.data.email})` : ""}, and
              one to marisabeltrejoo@gmail.com. Click Email them on each.
            </p>
          </div>
          <button
            className={secondaryButtonClass}
            disabled={testLeadsMutation.isPending || !gmailConnected}
            title={!gmailConnected ? "Connect Gmail first" : undefined}
            type="button"
            onClick={() => testLeadsMutation.mutate()}
          >
            {testLeadsMutation.isPending ? "Adding…" : "Add test email leads"}
          </button>
        </div>
        {testLeadsMutation.error ? (
          <p className="mt-2 text-xs text-rose-600">
            {testLeadsMutation.error.message}
          </p>
        ) : null}
        {testLeadsMutation.isSuccess ? (
          <p className="mt-2 text-xs text-violet-800 dark:text-violet-200">
            Ready — search filtered to “TEST —”. Email both leads from your
            connected Gmail.
          </p>
        ) : null}
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            className={`${inputClass} max-w-60`}
            placeholder="Search by name…"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
          <select
            className={`${inputClass} max-w-72`}
            value={campaignId}
            onChange={(event) => {
              setCampaignId(event.target.value);
              setPage(1);
            }}
          >
            <option value="">All searches</option>
            {campaignsQuery.data?.items.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name}
              </option>
            ))}
          </select>
          <select
            className={`${inputClass} max-w-44`}
            value={contactedFilter}
            onChange={(event) => {
              setContactedFilter(event.target.value as typeof contactedFilter);
              setPage(1);
            }}
          >
            <option value="all">All leads</option>
            <option value="not-messaged">Not messaged</option>
            <option value="messaged">Messaged</option>
          </select>
          <span className="ml-auto text-sm text-slate-400">
            {data
              ? `${ready.length} ready · ${enriching.length} processing · ${data.total} total`
              : ""}
          </span>
        </div>

        {businessesQuery.isLoading ? (
          <p className="text-sm text-slate-500">Loading leads…</p>
        ) : businessesQuery.error ? (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">
            {businessesQuery.error.message}
          </p>
        ) : data && data.items.length > 0 ? (
          <>
            <ul className="space-y-3">
              {data.items.map((business) => (
                <LeadCard
                  key={business.id}
                  business={business}
                  dmBlocked={dmBlocked}
                  dmTemplate={dmTemplate}
                  gmailConnected={gmailConnected}
                  onConnectGmail={onOpenSettings}
                />
              ))}
            </ul>
            {totalPages > 1 ? (
              <div className="flex items-center justify-center gap-4 pt-2">
                <button
                  className={secondaryButtonClass}
                  disabled={page <= 1}
                  type="button"
                  onClick={() => setPage((current) => current - 1)}
                >
                  Previous
                </button>
                <span className="text-sm text-slate-500">
                  Page {page} of {totalPages}
                </span>
                <button
                  className={secondaryButtonClass}
                  disabled={page >= totalPages}
                  type="button"
                  onClick={() => setPage((current) => current + 1)}
                >
                  Next
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-slate-400">
            No leads match. Run a search from the Find businesses tab or change
            the filters.
          </p>
        )}
      </section>
    </div>
  );
}

function FollowUpCard({ business }: { business: Business }) {
  const getToken = useApiToken();
  const queryClient = useQueryClient();

  const repliedMutation = useMutation({
    mutationFn: async () =>
      setReplied(await getToken(), business.id, business.repliedAt === null),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["businesses"] }),
  });

  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-slate-900">{business.name}</p>
            <ContactBadge business={business} />
          </div>
          <p className="mt-0.5 text-xs text-slate-400">
            {business.primaryCategory ?? "Business"} · {business.city}
          </p>
          <LeadLinks business={business} />
        </div>

        <div className="flex flex-col items-end gap-2">
          <button
            className={
              business.repliedAt ? secondaryButtonClass : primaryButtonClass
            }
            disabled={repliedMutation.isPending}
            type="button"
            onClick={() => repliedMutation.mutate()}
          >
            {business.repliedAt ? "Mark as not replied" : "Mark as replied"}
          </button>
          {business.instagramUrl ? (
            <a
              className="text-xs font-medium text-pink-600 hover:underline"
              href={business.instagramUrl}
              rel="noreferrer"
              target="_blank"
            >
              Open Instagram chat
            </a>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function FollowUpTab() {
  const getToken = useApiToken();
  const [view, setView] = useState<"awaiting" | "replied" | "all">("awaiting");

  const businessesQuery = useQuery({
    queryKey: ["businesses", { contacted: true }],
    queryFn: async () => listBusinesses(await getToken(), { contacted: true }),
  });

  const items = (businessesQuery.data?.items ?? []).filter((business) =>
    view === "all"
      ? true
      : view === "replied"
        ? business.repliedAt !== null
        : business.repliedAt === null,
  );

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <section className="rounded-2xl border border-sky-200 bg-sky-50 p-5 text-sm text-sky-800">
        <p className="font-semibold">How follow-ups work</p>
        <p className="mt-1">
          Everyone you've messaged or emailed lands here. When a business
          replies to your Instagram DM, hit “Mark as replied” so you can focus
          on warm leads. Automated drip replies through the official Instagram
          API need a Meta developer app connected to an Instagram professional
          account — once you have that, this tab is where it will plug in. Until
          then, use “Open Instagram chat” to reply by hand.
        </p>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <select
          className={`${inputClass} max-w-48`}
          value={view}
          onChange={(event) => setView(event.target.value as typeof view)}
        >
          <option value="awaiting">Awaiting reply</option>
          <option value="replied">Replied</option>
          <option value="all">All contacted</option>
        </select>
        <span className="ml-auto text-sm text-slate-400">
          {items.length} lead{items.length === 1 ? "" : "s"}
        </span>
      </div>

      {businessesQuery.isLoading ? (
        <p className="text-sm text-slate-500">Loading follow-ups…</p>
      ) : items.length > 0 ? (
        <ul className="space-y-3">
          {items.map((business) => (
            <FollowUpCard key={business.id} business={business} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-400">
          Nothing here yet — leads appear after you direct message or email
          them.
        </p>
      )}
    </div>
  );
}

function applyDocumentTheme(darkMode: boolean): void {
  document.documentElement.classList.toggle("dark", darkMode);
}

function SettingsTab() {
  const getToken = useApiToken();
  const queryClient = useQueryClient();

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: async () => fetchSettings(await getToken()),
  });

  const gmailQuery = useQuery({
    queryKey: ["email", "gmail"],
    queryFn: async () => fetchGmailStatus(await getToken()),
  });

  const [form, setForm] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  const [gmailBanner, setGmailBanner] = useState<"connected" | "error" | null>(
    null,
  );
  const [gmailErrorReason, setGmailErrorReason] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gmail = params.get("gmail");
    if (gmail === "connected") {
      setGmailBanner("connected");
      void queryClient.invalidateQueries({ queryKey: ["email", "gmail"] });
    } else if (gmail === "error") {
      setGmailBanner("error");
      setGmailErrorReason(params.get("reason"));
    }
    if (gmail) {
      params.delete("gmail");
      params.delete("reason");
      const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}${window.location.hash}`;
      window.history.replaceState({}, "", next);
    }
  }, [queryClient]);

  // Seed once when settings first load. Remount (leaving/returning to this tab) also
  // starts with form === null, so it picks up whatever is in the query cache.
  useEffect(() => {
    if (settingsQuery.data && form === null) {
      setForm(settingsQuery.data);
      applyDocumentTheme(settingsQuery.data.darkMode);
    }
  }, [settingsQuery.data, form]);

  const saveMutation = useMutation({
    mutationFn: async (payload: Settings) =>
      updateSettings(await getToken(), payload),
    onSuccess: (updated) => {
      setForm(updated);
      applyDocumentTheme(updated.darkMode);
      queryClient.setQueryData(["settings"], updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      void queryClient.invalidateQueries({ queryKey: ["outreach", "summary"] });
    },
  });

  const connectMutation = useMutation({
    mutationFn: async () => startGmailConnect(await getToken()),
    onSuccess: ({ url }) => {
      window.location.assign(url);
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => disconnectGmail(await getToken()),
    onSuccess: (status) => {
      queryClient.setQueryData(["email", "gmail"], status);
      setGmailBanner(null);
    },
  });

  const toggleDarkMode = () => {
    if (!form) return;
    const next = { ...form, darkMode: !form.darkMode };
    setForm(next);
    applyDocumentTheme(next.darkMode);
    // Optimistic cache update so remounting Settings still shows dark mode
    // even if the network save hasn't finished yet.
    queryClient.setQueryData(["settings"], next);
    saveMutation.mutate(next);
  };

  if (settingsQuery.isLoading || !form) {
    return (
      <p className="mx-auto max-w-3xl text-sm text-slate-500 dark:text-slate-400">
        Loading settings…
      </p>
    );
  }

  const gmail = gmailQuery.data;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <section className={panelClass}>
        <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Email inbox
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Connect your personal Gmail. Lead emails are sent from that inbox.
        </p>

        {gmailBanner === "connected" ? (
          <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            Gmail connected. You can email leads from the Leads tab.
          </p>
        ) : null}
        {gmailBanner === "error" ? (
          <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600 dark:bg-rose-950 dark:text-rose-300">
            Couldn’t connect Gmail
            {gmailErrorReason ? `: ${gmailErrorReason}` : "."}
          </p>
        ) : null}

        {gmailQuery.isLoading ? (
          <p className="mt-5 text-sm text-slate-500">Checking Gmail…</p>
        ) : gmail?.connected ? (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-900 dark:bg-emerald-950/40">
            <div>
              <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">
                Connected
              </p>
              <p className="text-xs text-emerald-700 dark:text-emerald-300/80">
                {gmail.email}
              </p>
            </div>
            <button
              className={secondaryButtonClass}
              disabled={disconnectMutation.isPending}
              type="button"
              onClick={() => disconnectMutation.mutate()}
            >
              {disconnectMutation.isPending ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
        ) : (
          <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 dark:border-amber-900 dark:bg-amber-950/40">
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
              Gmail not connected
            </p>
            <p className="mt-1 text-xs text-amber-800 dark:text-amber-200/80">
              {gmail?.configured === false
                ? "Server is missing Google OAuth env vars (GOOGLE_GMAIL_CLIENT_ID / SECRET / REDIRECT_URI)."
                : "Connect the Gmail you want leads to see as the sender."}
            </p>
            <button
              className={`${primaryButtonClass} mt-3`}
              disabled={
                connectMutation.isPending || gmail?.configured === false
              }
              type="button"
              onClick={() => connectMutation.mutate()}
            >
              {connectMutation.isPending ? "Opening Google…" : "Connect Gmail"}
            </button>
            {connectMutation.error ? (
              <p className="mt-2 text-xs text-rose-600">
                {connectMutation.error.message}
              </p>
            ) : null}
          </div>
        )}
        {disconnectMutation.error ? (
          <p className="mt-2 text-xs text-rose-600">
            {disconnectMutation.error.message}
          </p>
        ) : null}
      </section>

      <section className={panelClass}>
        <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Appearance
        </h2>
        <label className="mt-5 flex cursor-pointer items-center justify-between gap-4">
          <span>
            <span className="block text-sm font-medium text-slate-700 dark:text-slate-200">
              Dark mode
            </span>
            <span className="mt-0.5 block text-xs text-slate-400">
              Saves instantly to your workspace and stays on when you leave this
              tab.
            </span>
          </span>
          <button
            aria-pressed={form.darkMode}
            className={`relative h-7 w-12 rounded-full transition ${
              form.darkMode ? "bg-violet-600" : "bg-slate-300 dark:bg-slate-600"
            }`}
            disabled={saveMutation.isPending}
            type="button"
            onClick={toggleDarkMode}
          >
            <span
              className={`absolute top-0.5 left-0.5 size-6 rounded-full bg-white shadow transition ${
                form.darkMode ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </label>
      </section>

      <section className={panelClass}>
        <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Direct messages
        </h2>
        <label className="mt-5 block text-sm">
          <span className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
            Daily DM limit
          </span>
          <input
            className={`${inputClass} max-w-32`}
            min={1}
            max={500}
            type="number"
            value={form.dmDailyLimit}
            onChange={(event) =>
              setForm({
                ...form,
                dmDailyLimit: Number(event.target.value) || 1,
              })
            }
          />
          <span className="mt-1 block text-xs text-slate-400">
            40 per day is the recommended maximum to avoid Instagram bans.
          </span>
        </label>
        <label className="mt-4 block text-sm">
          <span className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
            First offer message
          </span>
          <textarea
            className={`${inputClass} min-h-28 resize-y`}
            value={form.dmTemplate}
            onChange={(event) =>
              setForm({ ...form, dmTemplate: event.target.value })
            }
          />
          <span className="mt-1 block text-xs text-slate-400">
            Saved to the database for your workspace. Copied when you press
            Direct Message. Use {"{name}"} for the business name.
          </span>
        </label>
      </section>

      <section className={panelClass}>
        <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Website offer email
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Template sent from your connected Gmail to businesses without a
          website.
        </p>
        <label className="mt-5 block text-sm">
          <span className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
            Subject
          </span>
          <input
            className={inputClass}
            value={form.emailSubject}
            onChange={(event) =>
              setForm({ ...form, emailSubject: event.target.value })
            }
          />
        </label>
        <label className="mt-4 block text-sm">
          <span className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
            Email body
          </span>
          <textarea
            className={`${inputClass} min-h-40 resize-y`}
            value={form.emailTemplate}
            onChange={(event) =>
              setForm({ ...form, emailTemplate: event.target.value })
            }
          />
          <span className="mt-1 block text-xs text-slate-400">
            Use {"{name}"} for the business name.
          </span>
        </label>
      </section>

      {saveMutation.error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600 dark:bg-rose-950 dark:text-rose-300">
          {saveMutation.error.message}
        </p>
      ) : null}

      <button
        className={primaryButtonClass}
        disabled={saveMutation.isPending}
        type="button"
        onClick={() => {
          if (form) saveMutation.mutate(form);
        }}
      >
        {saveMutation.isPending
          ? "Saving…"
          : saved
            ? "Saved ✓"
            : "Save settings"}
      </button>
    </div>
  );
}

type Tab = "search" | "leads" | "email" | "followup" | "settings";

const OFFER_LABELS: Record<EmailOfferType, string> = {
  NEED_WEBSITE: "Need a website",
  NEED_SEO: "Need SEO / ranking",
  NEED_REVIEWS: "Need review help",
};

function EmailCampaignsTab() {
  const getToken = useApiToken();
  const queryClient = useQueryClient();
  const [offerType, setOfferType] = useState<EmailOfferType>("NEED_WEBSITE");
  const [skipAlreadyEmailed, setSkipAlreadyEmailed] = useState(true);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionOk, setActionOk] = useState<string | null>(null);
  const seededOffer = useRef<EmailOfferType | null>(null);

  const statusQuery = useQuery({
    queryKey: ["email-campaigns", "status"],
    queryFn: async () => fetchEmailCampaignStatus(await getToken()),
  });

  const templatesQuery = useQuery({
    queryKey: ["email-campaigns", "templates"],
    queryFn: async () => fetchEmailCampaignTemplates(await getToken()),
  });

  const audienceQuery = useQuery({
    queryKey: ["email-campaigns", "audience", offerType, skipAlreadyEmailed],
    queryFn: async () =>
      previewEmailCampaignAudience(await getToken(), {
        offerType,
        skipAlreadyEmailed,
      }),
  });

  const campaignsQuery = useQuery({
    queryKey: ["email-campaigns", "list"],
    queryFn: async () => listEmailCampaigns(await getToken()),
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      return items.some((c) => c.status === "SENDING" || c.status === "DRAFT")
        ? 2500
        : false;
    },
  });

  const applyTemplate = useCallback(
    (template: EmailCampaignTemplate) => {
      setName(template.defaultName);
      setSubject(template.subject);
      setBody(template.body);
    },
    [],
  );

  useEffect(() => {
    const templates = templatesQuery.data;
    if (!templates) return;
    const template = templates.find((t) => t.offerType === offerType);
    if (!template) return;
    if (seededOffer.current === offerType) return;
    seededOffer.current = offerType;
    applyTemplate(template);
  }, [templatesQuery.data, offerType, applyTemplate]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      const campaign = await createEmailCampaign(token, {
        name: name.trim() || OFFER_LABELS[offerType],
        offerType,
        subject,
        body,
        skipAlreadyEmailed,
      });
      return startEmailCampaign(token, campaign.id);
    },
    onSuccess: (campaign) => {
      setActionError(null);
      setActionOk(
        `Started “${campaign.name}” for ${campaign.audienceCount} stored lead${
          campaign.audienceCount === 1 ? "" : "s"
        }. Sending via Resend…`,
      );
      void queryClient.invalidateQueries({ queryKey: ["email-campaigns"] });
      void queryClient.invalidateQueries({ queryKey: ["businesses"] });
      void queryClient.invalidateQueries({ queryKey: ["outreach"] });
    },
    onError: (error: Error) => {
      setActionOk(null);
      setActionError(error.message);
    },
  });

  const templates = templatesQuery.data ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Email campaigns</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
          Blast offers to leads already saved in your database. Contact enrichment
          only re-scans when website/email/social info is still missing — stored
          leads are reused as-is.
        </p>
      </div>

      {statusQuery.data && !statusQuery.data.configured ? (
        <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Add <code className="font-mono">RESEND_API_KEY</code> to your{" "}
          <code className="font-mono">.env</code> to send campaigns. Until then you
          can still preview audiences.
        </div>
      ) : null}

      {statusQuery.data?.configured ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Sending from{" "}
          <span className="font-medium text-slate-700 dark:text-slate-200">
            {statusQuery.data.defaultFrom ?? "configured Resend from-address"}
          </span>
          . Use a verified Resend domain for production (not{" "}
          <code className="font-mono">onboarding@resend.dev</code>).
        </p>
      ) : null}

      <section className={panelClass}>
        <h2 className="text-lg font-semibold">Start a campaign</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Pick an offer type. Audience is built from stored leads that already have
          an email.
        </p>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {templates.map((template) => {
            const active = offerType === template.offerType;
            return (
              <button
                key={template.offerType}
                type="button"
                className={`rounded-xl border px-4 py-3 text-left transition ${
                  active
                    ? "border-violet-500 bg-violet-50 shadow-sm dark:border-violet-400 dark:bg-violet-950"
                    : "border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600"
                }`}
                onClick={() => {
                  seededOffer.current = null;
                  setOfferType(template.offerType);
                  setActionError(null);
                  setActionOk(null);
                }}
              >
                <p className="text-sm font-semibold">{template.label}</p>
                <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                  {template.description}
                </p>
              </button>
            );
          })}
        </div>

        <label className="mt-5 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={skipAlreadyEmailed}
            onChange={(event) => setSkipAlreadyEmailed(event.target.checked)}
          />
          Skip leads already emailed
        </label>

        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-950">
          {audienceQuery.isLoading ? (
            <p className="text-sm text-slate-500">Counting matching leads…</p>
          ) : audienceQuery.error ? (
            <p className="text-sm text-rose-600">{audienceQuery.error.message}</p>
          ) : (
            <>
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                {audienceQuery.data?.total ?? 0} matching lead
                {(audienceQuery.data?.total ?? 0) === 1 ? "" : "s"} ready
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Cap per send: 100. Missing emails are not included — find businesses
                first and let enrichment finish.
              </p>
              {audienceQuery.data?.sample.length ? (
                <ul className="mt-3 space-y-1 text-xs text-slate-600 dark:text-slate-300">
                  {audienceQuery.data.sample.map((lead) => (
                    <li key={lead.id}>
                      {lead.name}
                      {lead.email ? ` · ${lead.email}` : ""}
                      {lead.websiteUrl ? " · has site" : " · no site"}
                      {lead.reviewCount != null
                        ? ` · ${lead.reviewCount} reviews`
                        : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
        </div>

        <div className="mt-5 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Campaign name
            </label>
            <input
              className={inputClass}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Website offer — Austin"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Subject
            </label>
            <input
              className={inputClass}
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Body
            </label>
            <textarea
              className={`${inputClass} min-h-40 font-mono text-xs`}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
            <p className="mt-1 text-xs text-slate-400">
              Placeholders: {"{name}"}, {"{city}"}
            </p>
          </div>
        </div>

        {actionError ? (
          <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600 dark:bg-rose-950 dark:text-rose-300">
            {actionError}
          </p>
        ) : null}
        {actionOk ? (
          <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            {actionOk}
          </p>
        ) : null}

        <button
          className={`${primaryButtonClass} mt-5`}
          type="button"
          disabled={
            createMutation.isPending ||
            !subject.trim() ||
            !body.trim() ||
            (audienceQuery.data?.total ?? 0) === 0 ||
            statusQuery.data?.configured === false
          }
          onClick={() => createMutation.mutate()}
        >
          {createMutation.isPending ? "Starting…" : "Create & send campaign"}
        </button>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Recent campaigns</h2>
        {campaignsQuery.isLoading ? (
          <p className="text-sm text-slate-500">Loading campaigns…</p>
        ) : campaignsQuery.error ? (
          <p className="text-sm text-rose-600">{campaignsQuery.error.message}</p>
        ) : (campaignsQuery.data?.items.length ?? 0) === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No email campaigns yet.
          </p>
        ) : (
          <ul className="space-y-3">
            {campaignsQuery.data?.items.map((campaign) => (
              <EmailCampaignRow key={campaign.id} campaign={campaign} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function EmailCampaignRow({ campaign }: { campaign: EmailCampaign }) {
  const statusClass =
    campaign.status === "COMPLETED"
      ? "text-emerald-600 dark:text-emerald-400"
      : campaign.status === "FAILED"
        ? "text-rose-600 dark:text-rose-400"
        : campaign.status === "SENDING"
          ? "text-violet-600 dark:text-violet-400"
          : "text-slate-500";

  return (
    <li className={cardClass}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{campaign.name}</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {OFFER_LABELS[campaign.offerType]} · {formatDay(campaign.createdAt)}
          </p>
        </div>
        <p className={`text-xs font-semibold uppercase tracking-wide ${statusClass}`}>
          {campaign.status}
        </p>
      </div>
      <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
        Audience {campaign.audienceCount} · sent {campaign.sentCount} · failed{" "}
        {campaign.failedCount}
      </p>
      {campaign.errorMessage ? (
        <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">
          {campaign.errorMessage}
        </p>
      ) : null}
    </li>
  );
}

export function Portal() {
  const { user, logout } = useAuth0();
  const getToken = useApiToken();
  const [tab, setTab] = useState<Tab>(() =>
    window.location.hash.replace("#", "") === "settings"
      ? "settings"
      : "search",
  );
  const [campaignFilter, setCampaignFilter] = useState("");

  useEffect(() => {
    if (window.location.hash.replace("#", "") === "settings") {
      setTab("settings");
    }
  }, []);

  // Ensures the user + organization exist in our database on first login.
  const profileQuery = useQuery({
    queryKey: ["auth", "me", user?.sub],
    queryFn: async () => fetchCurrentUser(await getToken()),
    retry: 2,
    retryDelay: 800,
  });

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: async () => fetchSettings(await getToken()),
  });

  useEffect(() => {
    if (settingsQuery.data) {
      applyDocumentTheme(settingsQuery.data.darkMode);
    }
  }, [settingsQuery.data]);

  const tabClass = (active: boolean) =>
    `rounded-lg px-2.5 py-1.5 text-sm font-semibold whitespace-nowrap transition ${
      active
        ? "bg-violet-600 text-white shadow-sm"
        : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
    }`;

  const tabs: { id: Tab; label: string }[] = [
    { id: "search", label: "Find Businesses" },
    { id: "leads", label: "Leads" },
    { id: "email", label: "Email" },
    { id: "followup", label: "Follow-up" },
    { id: "settings", label: "Settings" },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
          <div className="flex shrink-0 items-center gap-2.5">
            <div className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-500 font-black text-white">
              P
            </div>
            <span className="hidden font-bold tracking-tight sm:inline">
              Prospect Pal
            </span>
          </div>

          <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto sm:gap-1.5">
            {tabs.map(({ id, label }) => (
              <button
                key={id}
                className={tabClass(tab === id)}
                type="button"
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <DmCounter />
            <span className="hidden text-sm text-slate-500 dark:text-slate-400 xl:block">
              {profileQuery.data?.name ?? user?.name ?? ""}
            </span>
            <button
              className={secondaryButtonClass}
              type="button"
              onClick={() => {
                void logout({
                  logoutParams: { returnTo: window.location.origin },
                });
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="px-6 py-10">
        {profileQuery.isLoading ? (
          <p className="mx-auto max-w-4xl text-sm text-slate-500 dark:text-slate-400">
            Loading your workspace…
          </p>
        ) : profileQuery.error ? (
          <div className="mx-auto max-w-4xl space-y-3 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-600 dark:bg-rose-950 dark:text-rose-300">
            <p>{profileQuery.error.message}</p>
            <button
              className={secondaryButtonClass}
              type="button"
              onClick={() => void profileQuery.refetch()}
            >
              Try again
            </button>
          </div>
        ) : tab === "search" ? (
          <SearchTab
            onViewLeads={(id) => {
              setCampaignFilter(id);
              setTab("leads");
            }}
          />
        ) : tab === "leads" ? (
          <LeadsTab
            campaignFilter={campaignFilter}
            onOpenSettings={() => setTab("settings")}
          />
        ) : tab === "email" ? (
          <EmailCampaignsTab />
        ) : tab === "followup" ? (
          <FollowUpTab />
        ) : (
          <SettingsTab />
        )}
      </main>
    </div>
  );
}
