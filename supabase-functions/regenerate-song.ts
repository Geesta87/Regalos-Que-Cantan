// Supabase Edge Function: regenerate-song
// Deploy to: supabase/functions/regenerate-song/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { songId } = await req.json()
    
    if (!songId) {
      return new Response(
        JSON.stringify({ success: false, error: 'Song ID required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Get the original song
    const { data: originalSong, error: songError } = await supabase
      .from('songs')
      .select('*')
      .eq('id', songId)
      .single()

    if (songError || !originalSong) {
      return new Response(
        JSON.stringify({ success: false, error: 'Song not found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
      )
    }

    // Check regeneration limit (stored in original song or separate table)
    const regenerateCount = originalSong.regenerate_count || 0
    if (regenerateCount >= 2) {
      return new Response(
        JSON.stringify({ success: false, error: 'Maximum regenerations reached' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // Create a new song with the same details but new generation
    const { data: newSong, error: insertError } = await supabase
      .from('songs')
      .insert({
        genre: originalSong.genre,
        occasion: originalSong.occasion,
        recipient_name: originalSong.recipient_name,
        sender_name: originalSong.sender_name,
        relationship: originalSong.relationship,
        details: originalSong.details,
        voice_type: originalSong.voice_type,
        email: originalSong.email,
        lyrics: originalSong.lyrics, // Keep same lyrics
        status: 'pending',
        parent_song_id: originalSong.id, // Track lineage
        regenerate_count: regenerateCount + 1
      })
      .select()
      .single()

    if (insertError) {
      throw insertError
    }

    // Update original song regenerate count
    await supabase
      .from('songs')
      .update({ regenerate_count: regenerateCount + 1 })
      .eq('id', songId)

    // Call the music generation API (Kie.ai/Suno) with the same lyrics
    // This would be your existing music generation logic
    const KIE_API_KEY = Deno.env.get('KIE_API_KEY')
    
    const genreStyles: Record<string, string> = {
      corrido: "Mexican corrido, accordion, bajo sexto, brass, epic storytelling, norteño",
      norteno: "Norteño music, accordion, polka rhythm, traditional Mexican, bajo sexto",
      banda: "Mexican brass band, tubas, trumpets, tambora, powerful vocals, sinaloense",
      cumbia: "tropical cumbia, accordion, congas, danceable Latin beat, Colombian rhythm",
      ranchera: "mariachi, violins, trumpets, passionate vocals, traditional Mexican ranchera",
      balada: "romantic Spanish ballad, piano, strings, emotional vocals, Latin pop",
      reggaeton: "urban Latin, dembow beat, modern production, reggaetón perreo",
      salsa: "Caribbean salsa, piano montuno, congas, timbales, Cuban rhythm"
    }

    const style = genreStyles[originalSong.genre] || genreStyles.corrido
    const voiceTag = originalSong.voice_type === 'female' ? 'female vocals' : 
                     originalSong.voice_type === 'duet' ? 'male and female duet' : 'male vocals'

    // Call Kie.ai API
    const kieResponse = await fetch('https://api.kie.ai/api/v1/music/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${KIE_API_KEY}`
      },
      body: JSON.stringify({
        prompt: `${style}, ${voiceTag}`,
        lyrics: originalSong.lyrics,
        style: style
      })
    })

    if (!kieResponse.ok) {
      throw new Error('Music generation failed')
    }

    const kieData = await kieResponse.json()

    // Update the new song with the task ID
    await supabase
      .from('songs')
      .update({
        kie_task_id: kieData.data?.id || kieData.task_id,
        status: 'generating'
      })
      .eq('id', newSong.id)

    return new Response(
      JSON.stringify({
        success: true,
        song: {
          id: newSong.id,
          status: 'generating'
        },
        message: 'Regenerating song with new melody'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('Error:', err)
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Regeneration failed' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
