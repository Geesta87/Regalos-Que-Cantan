// supabase/functions/animado-availability/index.ts
// Deploy with: supabase functions deploy animado-availability --project-ref yzbvajungshqcpusfiia
//
// Public, lightweight check the comparison page calls to decide whether to show
// the Animado upsell. Returns available=false unless the master switch is on AND
// fewer than max_in_progress orders are unfinished — so a soft launch can't
// outrun manual fulfillment. Read-only; no auth needed. verify_jwt = false.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

// states that still need our attention (not delivered / not failed)
const IN_PROGRESS = ['awaiting_photo', 'generating_likeness', 'likeness_review', 'building', 'final_review'];

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (o: unknown) => new Response(JSON.stringify(o), { headers: { ...cors, 'Content-Type': 'application/json' } });
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: cfg } = await supabase.from('story_video_config').select('*').eq('id', true).single();
    if (!cfg || !cfg.enabled) {
      return json({ available: false, enabled: false, price_one_cents: cfg?.price_one_cents ?? 4900, price_both_cents: cfg?.price_both_cents ?? 6999 });
    }
    const { count } = await supabase.from('story_video_orders')
      .select('id', { count: 'exact', head: true }).in('state', IN_PROGRESS);
    const inProgress = count ?? 0;
    return json({
      available: inProgress < cfg.max_in_progress,
      enabled: true,
      in_progress: inProgress,
      cap: cfg.max_in_progress,
      price_one_cents: cfg.price_one_cents,
      price_both_cents: cfg.price_both_cents,
    });
  } catch (e: any) {
    // fail closed — if anything goes wrong, just don't show the offer
    return json({ available: false, error: e.message });
  }
});
