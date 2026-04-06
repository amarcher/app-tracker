import { useState, useEffect, useCallback } from 'react';
import type { GaTrafficResponse, ElevenLabsResponse, ApiUsageResponse, DateRange } from '../types';

const ELEVENLABS_VIEW = '__elevenlabs__';

export function useDashboardData(range: DateRange, project: string) {
  const [traffic, setTraffic] = useState<GaTrafficResponse | null>(null);
  const [elevenlabs, setElevenlabs] = useState<ElevenLabsResponse | null>(null);
  const [apiUsage, setApiUsage] = useState<ApiUsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const isElevenLabs = project === ELEVENLABS_VIEW;

    try {
      if (isElevenLabs) {
        const elevenRes = await fetch(`/api/elevenlabs-usage?range=${range}`);
        if (!elevenRes.ok) throw new Error('Failed to fetch ElevenLabs data');
        setElevenlabs(await elevenRes.json());
        setTraffic(null);
        setApiUsage(null);
      } else {
        const [trafficRes, apiUsageRes] = await Promise.all([
          fetch(`/api/ga-traffic?range=${range}&project=${project}`),
          fetch(`/api/api-usage?range=${range}&project=${project}`),
        ]);

        if (!trafficRes.ok) throw new Error('Failed to fetch traffic data');
        setTraffic(await trafficRes.json());
        setElevenlabs(null);

        if (apiUsageRes.ok) {
          setApiUsage(await apiUsageRes.json());
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [range, project]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { traffic, elevenlabs, apiUsage, loading, error, refetch: fetchData };
}
