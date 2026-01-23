import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const KIE_API_KEY = Deno.env.get('KIE_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    
    // Extract all fields including new ones
    const { 
      // Genre & Style
      genre, 
      genreName,
      genreStyle,  // Pre-built three-layer prompt from frontend
      subGenre,
      subGenreName,
      
      // Artist Inspiration
      artistInspiration,
      artistStylePrompt,
      
      // Occasion
      occasion, 
      occasionPrompt,  // Full occasion context (handles "otro")
      customOccasion,
      emotionalTone,
      
      // Names & Relationship
      recipientName, 
      senderName, 
      relationship,
      relationshipContext,  // Human-readable relationship (handles "otro")
      customRelationship,
      
      // Details & Contact
      details, 
      email, 
      voiceType 
    } = body;

    if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
    if (!KIE_API_KEY) throw new Error('KIE_API_KEY not configured');

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    console.log('=== GENERATE SONG REQUEST ===');
    console.log('Genre:', genreName || genre, subGenreName ? `(${subGenreName})` : '');
    console.log('Artist Inspiration:', artistInspiration || 'None');
    console.log('Occasion:', occasion, customOccasion ? `- Custom: ${customOccasion.slice(0,50)}...` : '');
    console.log('Emotional Tone:', emotionalTone || 'Default');
    console.log('For:', recipientName, `(${relationshipContext || relationship})`);
    console.log('From:', senderName);

    // The genreStyle from frontend already contains the three-layer prompt
    // Only enhance if artist inspiration exists AND we don't already have artistStylePrompt
    let finalMusicStyle = genreStyle;
    
    if (artistInspiration && artistInspiration.trim() && !artistStylePrompt) {
      // Use Claude to translate unknown artist to style tags
      console.log('Translating unknown artist inspiration:', artistInspiration);
      
      const artistPrompt = `You are a Mexican and Latin music production expert.

The user wants a ${genreName || genre}${subGenreName ? ` (${subGenreName})` : ''} song inspired by: ${artistInspiration}

Translate this artist's signature sound into PRODUCTION TAGS for an AI music generator.

RULES:
1. NEVER include artist names - only describe the SOUND
2. Focus on: instruments, tempo (BPM), vocal style, production, mood
3. Stay TRUE to ${genreName || genre} genre
4. Be SPECIFIC - avoid generic terms
5. Maximum 50 words, comma-separated tags only

BASE STYLE TO ENHANCE:
${genreStyle}

OUTPUT: Return ONLY comma-separated production tags. No explanations.`;

      try {
        const styleResponse = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json', 
            'x-api-key': ANTHROPIC_API_KEY!, 
            'anthropic-version': '2023-06-01' 
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 300,
            messages: [{ role: 'user', content: artistPrompt }]
          })
        });
        
        const styleData = await styleResponse.json();
        if (styleResponse.ok && styleData.content?.[0]?.text) {
          const enhancedStyle = styleData.content[0].text.trim().replace(/^["']|["']$/g, '');
          finalMusicStyle = enhancedStyle;
          console.log('Enhanced style from Claude:', enhancedStyle.slice(0, 100) + '...');
        }
      } catch (e) {
        console.log('Artist translation failed, using base style:', e.message);
      }
    }

    // Add voice type to final style
    const voiceDesc = voiceType === 'female' 
      ? 'female vocals, feminine voice, woman singer' 
      : voiceType === 'duet' 
      ? 'male and female duet, two voices harmonizing' 
      : 'male vocals, masculine voice, man singer';
    
    finalMusicStyle = `${finalMusicStyle}, ${voiceDesc}`;
    console.log('Final music style length:', finalMusicStyle.length);

    // Build comprehensive lyrics prompt
    console.log('Generating lyrics...');
    
    // Build occasion description
    let occasionDescription = occasionPrompt || 'una canción personalizada';
    if (occasion === 'otro' && customOccasion) {
      occasionDescription = customOccasion;
      if (emotionalTone) {
        const toneDescriptions: Record<string, string> = {
          celebracion: 'alegre y festivo',
          amor: 'romántico y tierno',
          agradecimiento: 'sincero y emotivo',
          nostalgia: 'nostálgico y reflexivo',
          motivacion: 'inspirador y motivacional',
          despedida: 'emotivo y de homenaje',
          humor: 'divertido y ligero'
        };
        occasionDescription += `. El tono debe ser ${toneDescriptions[emotionalTone] || emotionalTone}`;
      }
    }

    // Build relationship description
    const relationshipDesc = relationshipContext || relationship || 'ser querido';

    const lyricsPrompt = `Eres un compositor experto de música ${genreName || genre} mexicana/latina. Escribe una letra auténtica y emotiva.

═══════════════════════════════════════
INFORMACIÓN DE LA CANCIÓN
═══════════════════════════════════════

GÉNERO: ${genreName || genre}${subGenreName ? ` - Estilo: ${subGenreName}` : ''}
${artistInspiration ? `INSPIRACIÓN ARTÍSTICA: Estilo similar a ${artistInspiration} (NO mencionar el nombre)` : ''}

DESTINATARIO: ${recipientName}
REMITENTE: ${senderName}
RELACIÓN: ${relationshipDesc}

OCASIÓN: ${occasionDescription}

HISTORIA Y DETALLES PERSONALES:
${details || 'No se proporcionaron detalles específicos. Crea una letra emotiva y general apropiada para la ocasión.'}

═══════════════════════════════════════
REGLAS DE COMPOSICIÓN
═══════════════════════════════════════

1. NOMBRE: Menciona "${recipientName}" al menos 2-3 veces de forma natural en la letra
2. REMITENTE: Si es apropiado, menciona que es de parte de "${senderName}"
3. IDIOMA: Español mexicano auténtico (NO español de España)
4. ESTILO: Usa expresiones y modismos apropiados para ${genreName || genre}
5. EMOCIÓN: Sé emotivo pero auténtico - evita clichés genéricos
6. DETALLES: Incorpora los detalles específicos proporcionados en la historia
7. TONO: Debe coincidir con la ocasión${emotionalTone ? ` y ser ${emotionalTone}` : ''}

═══════════════════════════════════════
ESTRUCTURA REQUERIDA
═══════════════════════════════════════

[Verso 1]
(4-6 líneas estableciendo la historia)

[Coro]
(4-6 líneas - parte más memorable, mencionar a ${recipientName})

[Verso 2]
(4-6 líneas desarrollando la emoción)

[Coro]
(repetir)

[Verso 3 o Puente]
(4-6 líneas - momento más emotivo)

[Coro Final]
(puede incluir variación emotiva)

═══════════════════════════════════════

IMPORTANTE: Responde SOLO con la letra. Sin explicaciones, sin comentarios, sin introducciones.`;

    const lyricsResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json', 
        'x-api-key': ANTHROPIC_API_KEY!, 
        'anthropic-version': '2023-06-01' 
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        messages: [{ role: 'user', content: lyricsPrompt }]
      })
    });
    
    const lyricsData = await lyricsResponse.json();
    if (!lyricsResponse.ok || !lyricsData.content?.[0]?.text) {
      throw new Error('Failed to generate lyrics: ' + JSON.stringify(lyricsData));
    }
    const lyrics = lyricsData.content[0].text;
    console.log('Lyrics generated successfully, length:', lyrics.length);

    // Create PROCESSING record in database with all new fields
    const { data: songRecord, error: dbError } = await supabase.from('songs').insert({
      recipient_name: recipientName,
      sender_name: senderName,
      relationship: relationship,
      relationship_custom: customRelationship || null,
      genre: genre,
      genre_name: genreName || null,
      sub_genre: subGenre || null,
      sub_genre_name: subGenreName || null,
      occasion: occasion,
      occasion_custom: customOccasion || null,
      emotional_tone: emotionalTone || null,
      details: details,
      email: email,
      lyrics: lyrics,
      audio_url: null,
      preview_url: null,
      status: 'processing',
      paid: false,
      voice_type: voiceType || 'male',
      artist_inspiration: artistInspiration || null,
      style_used: finalMusicStyle
    }).select().single();

    if (dbError) {
      console.error('DB Error:', dbError);
      throw new Error('DB error: ' + dbError.message);
    }
    
    const songId = songRecord.id;
    console.log('Created processing record:', songId);

    // Start Kie.ai generation with callback
    console.log('Starting Kie.ai generation...');
    console.log('Music style (first 200 chars):', finalMusicStyle.slice(0, 200));
    
    const callBackUrl = `${SUPABASE_URL}/functions/v1/song-callback`;
    
    const musicResponse = await fetch('https://api.kie.ai/api/v1/generate', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json', 
        'Authorization': `Bearer ${KIE_API_KEY}` 
      },
      body: JSON.stringify({
        prompt: lyrics,
        customMode: true,
        style: finalMusicStyle,
        title: `Canción para ${recipientName}`,
        instrumental: false,
        model: 'V4_5',
        callBackUrl: callBackUrl
      })
    });
    
    const musicData = await musicResponse.json();
    console.log('Kie.ai response:', JSON.stringify(musicData));
    
    const taskId = musicData.data?.taskId;
    if (!taskId) {
      await supabase.from('songs').update({ status: 'failed' }).eq('id', songId);
      throw new Error('No taskId from Kie.ai: ' + JSON.stringify(musicData));
    }

    // Save taskId
    await supabase.from('songs').update({ task_id: taskId }).eq('id', songId);
    console.log('TaskId saved:', taskId);

    // Return immediately - frontend will poll for status
    return new Response(JSON.stringify({
      success: true,
      song: {
        id: songId,
        status: 'processing'
      }
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });

  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500
    });
  }
});
