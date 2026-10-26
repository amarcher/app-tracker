import { useState, useEffect, useCallback, useRef } from 'react';
import type { GaTrafficResponse, ElevenLabsResponse, ApiUsageResponse, CdnResponse, PortfolioResponse, TrafficOverviewResponse, AgentStatsResponse, PosthogResponse, SearchConsoleResponse, SearchConsoleSitesResponse, AppStoreResponse, AmazonAppstoreResponse, GooglePlayResponse, DateRange } from '../types';

const ELEVENLABS_VIEW = '__elevenlabs__';
const PORTFOLIO_VIEW = '__portfolio__';
const HOME_VIEW = '__home__';

export function useDashboardData(range: DateRange, project: string, hasCloudflare?: boolean, hasAgents?: boolean, hasPosthog?: boolean, hasAppStore?: boolean, hasAmazonAppstore?: boolean, hasGooglePlay?: boolean) {
  const [traffic, setTraffic] = useState<GaTrafficResponse | null>(null);
  const [elevenlabs, setElevenlabs] = useState<ElevenLabsResponse | null>(null);
  const [apiUsage, setApiUsage] = useState<ApiUsageResponse | null>(null);
  const [cloudflare, setCloudflare] = useState<CdnResponse | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null);
  const [overview, setOverview] = useState<TrafficOverviewResponse | null>(null);
  const [agentStats, setAgentStats] = useState<AgentStatsResponse | null>(null);
  const [posthog, setPosthog] = useState<PosthogResponse | null>(null);
  const [searchConsole, setSearchConsole] = useState<SearchConsoleResponse | null>(null);
  const [searchConsoleSites, setSearchConsoleSites] = useState<SearchConsoleSitesResponse | null>(null);
  const [appStore, setAppStore] = useState<AppStoreResponse | null>(null);
  const [amazonAppstore, setAmazonAppstore] = useState<AmazonAppstoreResponse | null>(null);
  const [googlePlay, setGooglePlay] = useState<GooglePlayResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const activeRequest = useRef<AbortController | null>(null);
  const fetchData = useCallback(async () => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const request = (url: string) => fetch(url, { signal: controller.signal });
    const readJson = async (response: Response) => {
      const data = await response.json();
      if (controller.signal.aborted) throw new Error('Request superseded');
      return data;
    };
    // A new selection must never display another project's cached response.
    setTraffic(null);
    setApiUsage(null);
    setOverview(null);
    setPortfolio(null);
    setElevenlabs(null);
    setCloudflare(null);
    setAgentStats(null);
    setPosthog(null);
    setSearchConsole(null);
    setSearchConsoleSites(null);
    setAppStore(null);
    setAmazonAppstore(null);
    setGooglePlay(null);
    if (project === '__businesses__') { setLoading(false); return; }
    setLoading(true);
    setError(null);

    const isElevenLabs = project === ELEVENLABS_VIEW;
    const isPortfolio = project === PORTFOLIO_VIEW;
    const isHome = project === HOME_VIEW;

    try {
      if (isHome) {
        const res = await request(`/api/traffic-overview?range=${range}`);
        if (!res.ok) throw new Error('Failed to fetch traffic overview');
        setOverview(await readJson(res));
        setTraffic(null);
        setElevenlabs(null);
        setApiUsage(null);
        setCloudflare(null);
        setPortfolio(null);
        setAgentStats(null);
        setPosthog(null);
        setSearchConsole(null);
        const surveyRes = await request(`/api/search-console-sites?range=${range}`);
        setSearchConsoleSites(surveyRes.ok ? await readJson(surveyRes) : null);
      } else if (isElevenLabs) {
        const elevenRes = await request(`/api/elevenlabs-usage?range=${range}`);
        if (!elevenRes.ok) throw new Error('Failed to fetch ElevenLabs data');
        setElevenlabs(await readJson(elevenRes));
        setTraffic(null);
        setApiUsage(null);
        setCloudflare(null);
        setPortfolio(null);
        setOverview(null);
        setAgentStats(null);
        setPosthog(null);
        setSearchConsole(null);
        setSearchConsoleSites(null);
      } else if (isPortfolio) {
        const portfolioRes = await request(`/api/portfolio-summary?range=${range}`);
        if (!portfolioRes.ok) throw new Error('Failed to fetch portfolio data');
        setPortfolio(await readJson(portfolioRes));
        setTraffic(null);
        setElevenlabs(null);
        setApiUsage(null);
        setCloudflare(null);
        setOverview(null);
        setAgentStats(null);
        setPosthog(null);
        setSearchConsole(null);
        setSearchConsoleSites(null);
      } else {
        const fetches: Promise<Response>[] = [
          request(`/api/ga-traffic?range=${range}&project=${project}`),
          request(`/api/api-usage?range=${range}&project=${project}`),
          request(`/api/search-console?range=${range}&project=${project}`),
        ];
        const searchConsoleIndex = 2;
        const cfIndex = hasCloudflare ? fetches.length : -1;
        if (hasCloudflare) {
          fetches.push(request(`/api/cloudflare-cdn?range=${range}&project=${project}`));
        }
        const agentsIndex = hasAgents ? fetches.length : -1;
        if (hasAgents) {
          fetches.push(request(`/api/elevenlabs-agent-stats?range=${range}&project=${project}`));
        }
        const posthogIndex = hasPosthog ? fetches.length : -1;
        if (hasPosthog) {
          fetches.push(request(`/api/posthog-events?range=${range}&project=${project}`));
        }
        const appStoreIndex = hasAppStore ? fetches.length : -1;
        if (hasAppStore) {
          fetches.push(request(`/api/app-store?range=${range}&project=${project}`));
        }
        const amazonIndex = hasAmazonAppstore ? fetches.length : -1;
        if (hasAmazonAppstore) {
          fetches.push(request(`/api/amazon-appstore?range=${range}&project=${project}`));
        }
        const googlePlayIndex = hasGooglePlay ? fetches.length : -1;
        if (hasGooglePlay) {
          fetches.push(request(`/api/google-play?range=${range}&project=${project}`));
        }

        const results = await Promise.all(fetches);
        const [trafficRes, apiUsageRes] = results;

        if (!trafficRes.ok) throw new Error('Failed to fetch traffic data');
        setTraffic(await readJson(trafficRes));
        setElevenlabs(null);
        setPortfolio(null);
        setOverview(null);
        setSearchConsoleSites(null);

        if (apiUsageRes.ok) {
          setApiUsage(await readJson(apiUsageRes));
        } else {
          setError('API usage unavailable for this selection');
        }

        if (results[searchConsoleIndex]?.ok) {
          setSearchConsole(await readJson(results[searchConsoleIndex]));
        } else {
          setSearchConsole(null);
        }

        if (cfIndex >= 0 && results[cfIndex]?.ok) {
          setCloudflare(await readJson(results[cfIndex]));
        } else {
          setCloudflare(null);
        }

        if (agentsIndex >= 0 && results[agentsIndex]?.ok) {
          setAgentStats(await readJson(results[agentsIndex]));
        } else {
          setAgentStats(null);
        }

        if (posthogIndex >= 0 && results[posthogIndex]?.ok) {
          setPosthog(await readJson(results[posthogIndex]));
        } else {
          setPosthog(null);
        }

        if (appStoreIndex >= 0 && results[appStoreIndex]?.ok) {
          setAppStore(await readJson(results[appStoreIndex]));
        } else {
          setAppStore(null);
        }

        if (amazonIndex >= 0 && results[amazonIndex]?.ok) {
          setAmazonAppstore(await readJson(results[amazonIndex]));
        } else {
          setAmazonAppstore(null);
        }

        if (googlePlayIndex >= 0 && results[googlePlayIndex]?.ok) {
          setGooglePlay(await readJson(results[googlePlayIndex]));
        } else {
          setGooglePlay(null);
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [range, project, hasCloudflare, hasAgents, hasPosthog, hasAppStore, hasAmazonAppstore, hasGooglePlay]);

  useEffect(() => {
    fetchData();
    return () => activeRequest.current?.abort();
  }, [fetchData]);

  return { traffic, elevenlabs, apiUsage, cloudflare, portfolio, overview, agentStats, posthog, searchConsole, searchConsoleSites, appStore, amazonAppstore, googlePlay, loading, error, refetch: fetchData };
}
