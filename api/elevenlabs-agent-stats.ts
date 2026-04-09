import type { VercelRequest, VercelResponse } from '@vercel/node';
import { agentsForProject } from './_shared/elevenlabs-agents.js';

const API_KEY = process.env.ELEVENLABS_API_KEY?.trim();

// One row as returned by GET /v1/convai/conversations
interface ElevenLabsConversation {
  agent_id: string;
  agent_name: string;
  conversation_id: string;
  start_time_unix_secs: number;
  call_duration_secs: number;
  message_count: number;
  status: string;
  call_successful: string; // "success" | "failure" | "unknown"
  call_summary_title: string | null;
  main_language: string | null;
}

interface ListResponse {
  conversations: ElevenLabsConversation[];
  next_cursor: string | null;
  has_more: boolean;
}

async function listConversations(
  agentId: string,
  afterUnix: number,
  beforeUnix: number,
): Promise<ElevenLabsConversation[]> {
  const all: ElevenLabsConversation[] = [];
  let cursor: string | null = null;
  // Pagination safety: cap at 10 pages (~1000 conversations) so a pathological
  // agent can't exhaust the serverless budget.
  for (let page = 0; page < 10; page++) {
    const url = new URL('https://api.elevenlabs.io/v1/convai/conversations');
    url.searchParams.set('agent_id', agentId);
    url.searchParams.set('page_size', '100');
    url.searchParams.set('call_start_after_unix', String(afterUnix));
    url.searchParams.set('call_start_before_unix', String(beforeUnix));
    if (cursor) url.searchParams.set('cursor', cursor);

    const res = await fetch(url.toString(), {
      headers: { 'xi-api-key': API_KEY! },
    });
    if (!res.ok) {
      throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
    }
    const body = (await res.json()) as ListResponse;
    all.push(...body.conversations);
    if (!body.has_more || !body.next_cursor) break;
    cursor = body.next_cursor;
  }
  return all;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (!API_KEY) {
      return res.status(500).json({ error: 'ELEVENLABS_API_KEY not configured' });
    }
    const project = (req.query.project as string) || '';
    const range = (req.query.range as string) || '30d';
    const days = parseInt(range.replace('d', ''), 10) || 30;

    const agentIds = agentsForProject(project);
    if (agentIds.length === 0) {
      // No agents mapped — return an empty shape instead of 400 so the
      // frontend can hide the section cleanly.
      return res.json({
        hasAgents: false,
        totals: { conversations: 0, totalDurationSecs: 0, avgDurationSecs: 0, messages: 0, successRate: 0 },
        recentConversations: [],
      });
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const afterSec = nowSec - days * 24 * 60 * 60;

    // Fan out across agents (usually 1 per project, but the map supports N).
    const perAgent = await Promise.all(
      agentIds.map((id) => listConversations(id, afterSec, nowSec)),
    );
    const conversations = perAgent.flat();

    const totalDuration = conversations.reduce((s, c) => s + c.call_duration_secs, 0);
    const totalMessages = conversations.reduce((s, c) => s + c.message_count, 0);
    const successful = conversations.filter((c) => c.call_successful === 'success').length;
    const failed = conversations.filter((c) => c.call_successful === 'failure').length;
    const evaluated = successful + failed; // exclude 'unknown' from the denominator

    // Sort recent (most recent first) and take up to 20.
    const recentConversations = [...conversations]
      .sort((a, b) => b.start_time_unix_secs - a.start_time_unix_secs)
      .slice(0, 20)
      .map((c) => ({
        conversationId: c.conversation_id,
        agentName: c.agent_name,
        startTimeUnix: c.start_time_unix_secs,
        durationSecs: c.call_duration_secs,
        messageCount: c.message_count,
        callSuccessful: c.call_successful,
        summaryTitle: c.call_summary_title,
      }));

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    res.json({
      hasAgents: true,
      totals: {
        conversations: conversations.length,
        totalDurationSecs: totalDuration,
        avgDurationSecs: conversations.length > 0 ? totalDuration / conversations.length : 0,
        messages: totalMessages,
        successRate: evaluated > 0 ? successful / evaluated : 0,
        successful,
        failed,
      },
      recentConversations,
    });
  } catch (error) {
    console.error('ElevenLabs agent stats error:', error);
    res.status(500).json({ error: 'Failed to fetch ElevenLabs agent stats' });
  }
}
