import { useState, useEffect, useCallback } from 'react';
import type { GaTrafficResponse, ElevenLabsResponse, ApiUsageResponse, CdnResponse, PortfolioResponse, TrafficOverviewResponse, AgentStatsResponse, DateRange } from '../types';

const ELEVENLABS_VIEW = '__elevenlabs__';
const PORTFOLIO_VIEW = '__portfolio__';
const HOME_VIEW = '__home__';

export function useDashboardData(range: DateRange, project: string, hasCloudflare?: boolean, hasAgents?: boolean) {
  const [traffic, setTraffic] = useState<GaTrafficResponse | null>(null);
  const [elevenlabs, setElevenlabs] = useState<ElevenLabsResponse | null>(null);
  const [apiUsage, setApiUsage] = useState<ApiUsageResponse | null>(null);
  const [cloudflare, setCloudflare] = useState<CdnResponse | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null);
  const [overview, setOverview] = useState<TrafficOverviewResponse | null>(null);
  const [agentStats, setAgentStats] = useState<AgentStatsResponse | null>(null);
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
      } else {
        const fetches: Promise<Response>[] = [
          fetch(`/api/ga-traffic?range=${range}&project=${project}`),
          fetch(`/api/api-usage?range=${range}&project=${project}`),
        ];
        const cfIndex = hasCloudflare ? fetches.length : -1;
        if (hasCloudflare) {
          fetches.push(fetch(`/api/cloudflare-cdn?range=${range}&project=${project}`));
        }
        const agentsIndex = hasAgents ? fetches.length : -1;
        if (hasAgents) {
          fetches.push(fetch(`/api/elevenlabs-agent-stats?range=${range}&project=${project}`));
        }

        const results = await Promise.all(fetches);
        const [trafficRes, apiUsageRes] = results;

        if (!trafficRes.ok) throw new Error('Failed to fetch traffic data');
        setTraffic(await trafficRes.json());
        setElevenlabs(null);
        setPortfolio(null);
        setOverview(null);

        if (apiUsageRes.ok) {
          setApiUsage(await apiUsageRes.json());
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
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [range, project, hasCloudflare, hasAgents]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { traffic, elevenlabs, apiUsage, cloudflare, portfolio, overview, agentStats, loading, error, refetch: fetchData };
}
