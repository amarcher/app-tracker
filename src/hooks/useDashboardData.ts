import { useState, useEffect, useCallback } from 'react';
import type { GaTrafficResponse, ElevenLabsResponse, ApiUsageResponse, CdnResponse, PortfolioResponse, TrafficOverviewResponse, AgentStatsResponse, PosthogResponse, SearchConsoleResponse, SearchConsoleSitesResponse, DateRange } from '../types';

const ELEVENLABS_VIEW = '__elevenlabs__';
const PORTFOLIO_VIEW = '__portfolio__';
const HOME_VIEW = '__home__';

export function useDashboardData(range: DateRange, project: string, hasCloudflare?: boolean, hasAgents?: boolean, hasPosthog?: boolean) {
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const isElevenLabs = project === ELEVENLABS_VIEW;
    const isPortfolio = project === PORTFOLIO_VIEW;
    const isHome = project === HOME_VIEW;

    try {
      if (isHome) {
        const res = await fetch(`/api/traffic-overview?range=${range}`);
        if (!res.ok) throw new Error('Failed to fetch traffic overview');
        setOverview(await res.json());
        setTraffic(null);
        setElevenlabs(null);
        setApiUsage(null);
        setCloudflare(null);
        setPortfolio(null);
        setAgentStats(null);
        setPosthog(null);
        setSearchConsole(null);
        const surveyRes = await fetch('/api/search-console-sites');
        setSearchConsoleSites(surveyRes.ok ? await surveyRes.json() : null);
      } else if (isElevenLabs) {
        const elevenRes = await fetch(`/api/elevenlabs-usage?range=${range}`);
        if (!elevenRes.ok) throw new Error('Failed to fetch ElevenLabs data');
        setElevenlabs(await elevenRes.json());
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
        const portfolioRes = await fetch(`/api/portfolio-summary?range=${range}`);
        if (!portfolioRes.ok) throw new Error('Failed to fetch portfolio data');
        setPortfolio(await portfolioRes.json());
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
          fetch(`/api/ga-traffic?range=${range}&project=${project}`),
          fetch(`/api/api-usage?range=${range}&project=${project}`),
          fetch(`/api/search-console?range=${range}&project=${project}`),
        ];
        const searchConsoleIndex = 2;
        const cfIndex = hasCloudflare ? fetches.length : -1;
        if (hasCloudflare) {
          fetches.push(fetch(`/api/cloudflare-cdn?range=${range}&project=${project}`));
        }
        const agentsIndex = hasAgents ? fetches.length : -1;
        if (hasAgents) {
          fetches.push(fetch(`/api/elevenlabs-agent-stats?range=${range}&project=${project}`));
        }
        const posthogIndex = hasPosthog ? fetches.length : -1;
        if (hasPosthog) {
          fetches.push(fetch(`/api/posthog-events?range=${range}&project=${project}`));
        }

        const results = await Promise.all(fetches);
        const [trafficRes, apiUsageRes] = results;

        if (!trafficRes.ok) throw new Error('Failed to fetch traffic data');
        setTraffic(await trafficRes.json());
        setElevenlabs(null);
        setPortfolio(null);
        setOverview(null);
        setSearchConsoleSites(null);

        if (apiUsageRes.ok) {
          setApiUsage(await apiUsageRes.json());
        }

        if (results[searchConsoleIndex]?.ok) {
          setSearchConsole(await results[searchConsoleIndex].json());
        } else {
          setSearchConsole(null);
        }

        if (cfIndex >= 0 && results[cfIndex]?.ok) {
          setCloudflare(await results[cfIndex].json());
        } else {
          setCloudflare(null);
        }

        if (agentsIndex >= 0 && results[agentsIndex]?.ok) {
          setAgentStats(await results[agentsIndex].json());
        } else {
          setAgentStats(null);
        }

        if (posthogIndex >= 0 && results[posthogIndex]?.ok) {
          setPosthog(await results[posthogIndex].json());
        } else {
          setPosthog(null);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [range, project, hasCloudflare, hasAgents, hasPosthog]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { traffic, elevenlabs, apiUsage, cloudflare, portfolio, overview, agentStats, posthog, searchConsole, searchConsoleSites, loading, error, refetch: fetchData };
}
