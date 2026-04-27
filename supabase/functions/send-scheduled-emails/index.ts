import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const sendgridApiKey = Deno.env.get('SENDGRID_API_KEY')!

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const now = new Date()
    const fifteenMinAgo = new Date(now.getTime() - 15 * 60 * 1000)
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const fiveMinWindow = 5 * 60 * 1000

    let emailsSent = 0
    const errors: string[] = []

    async function logEmail(email: string, recipientName: string, emailType: string, subject: string, status: string, songIds: string[], errorMessage?: string) {
      try {
        await supabase.from('email_logs').insert({
          email, recipient_name: recipientName, email_type: emailType,
          subject, song_ids: songIds, status, error_message: errorMessage || null
        })
      } catch (err) { console.error('Failed to log email:', err) }
    }

    async function sendEmail(to: string, subject: string, htmlContent: string): Promise<boolean> {
      const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${sendgridApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: to }], subject }],
          from: { email: 'hola@regalosquecantan.com', name: 'RegalosQueCantan' },
          content: [{ type: 'text/html', value: htmlContent }]
        }),
      })
      return response.status === 202
    }

    function groupSongs(songs: any[]): Map<string, any[]> {
      const groups = new Map<string, any[]>()
      for (const song of songs) {
        const baseKey = `${song.email}|${song.recipient_name}`
        let foundGroup = false
        for (const [key, group] of groups.entries()) {
          if (key.startsWith(baseKey)) {
            const existingTime = new Date(group[0].created_at).getTime()
            const songTime = new Date(song.created_at).getTime()
            if (Math.abs(existingTime - songTime) < fiveMinWindow) {
              group.push(song)
              foundGroup = true
              break
            }
          }
        }
        if (!foundGroup) groups.set(`${baseKey}|${song.created_at}`, [song])
      }
      return groups
    }

    // ============================================
    // STRIPE CHECKOUT RECOVERY
    // ============================================
    const { data: expiredCheckouts, error: errorExpired } = await supabase
      .from('funnel_events')
      .select('*')
      .eq('step', 'checkout_expired')
      .gt('created_at', twentyFourHoursAgo.toISOString())
      .limit(50)

    if (errorExpired) console.error('Error fetching expired checkouts:', errorExpired)

    let checkoutRecoverySent = 0
    for (const event of (expiredCheckouts || [])) {
      try {
        const meta = event.metadata || {}
        const email = meta.email
        const songIds = meta.song_ids || []
        if (!email || songIds.length === 0) continue

        const { data: existingLog } = await supabase
          .from('email_logs')
          .select('id')
          .eq('email', email)
          .eq('email_type', 'checkout_recovery')
          .gt('created_at', twentyFourHoursAgo.toISOString())
          .limit(1)

        if (existingLog && existingLog.length > 0) continue

        const { data: song } = await supabase
          .from('songs')
          .select('id, paid, recipient_name, genre, audio_url')
          .eq('id', songIds[0])
          .single()

        if (!song || song.paid) continue
        if (!song.audio_url) continue

        const recipientName = song.recipient_name || 'tu ser querido'
        const url = `https://regalosquecantan.com/comparison?song_ids=${songIds.join(',')}&from=checkout_recovery`
        const subject = `\u{1F3B5} Tu pago no se complet\u00f3 \u2014 la canci\u00f3n de ${recipientName} te espera`
        const html = buildCheckoutRecoveryEmail(recipientName, songIds.length, url)
        const success = await sendEmail(email, subject, html)

        if (success) {
          await logEmail(email, recipientName, 'checkout_recovery', subject, 'sent', songIds)
          checkoutRecoverySent++
          emailsSent++
        } else {
          await logEmail(email, recipientName, 'checkout_recovery', subject, 'failed', songIds, 'SendGrid error')
          errors.push(`Failed checkout recovery to ${email}`)
        }
      } catch (err) {
        errors.push(`Error checkout recovery: ${err.message}`)
      }
    }

    // ============================================
    // 30-MINUTE PURCHASE REMINDER (belt-and-suspenders for paying customers)
    //   "In case you missed it" — supplemental to the immediate purchase email.
    //   Cron runs every 15 min, so this fires 30-45 min after payment.
    // ============================================
    const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000)
    const ninetyMinAgo = new Date(now.getTime() - 90 * 60 * 1000)

    const { data: paidNeedReminder, error: errorReminder } = await supabase
      .from('songs').select('*')
      .eq('paid', true)
      .lt('paid_at', thirtyMinAgo.toISOString())
      .gt('paid_at', ninetyMinAgo.toISOString())
      .or('purchase_reminder_30min_sent.is.null,purchase_reminder_30min_sent.eq.false')
      .not('email', 'is', null)
      .not('audio_url', 'is', null)
      .limit(100)

    if (errorReminder) console.error('Error fetching 30min reminders:', errorReminder)

    const groupsReminder = groupSongs(paidNeedReminder || [])
    for (const [_, songs] of groupsReminder) {
      const primary = songs[0]
      const songIds = songs.map(s => s.id)
      try {
        const url = `https://regalosquecantan.com/listen?song_id=${primary.id}&utm_source=email&utm_medium=transactional&utm_campaign=purchase_reminder_30min`
        const subject = `\u{1F4EC} Recordatorio: tu canci\u00f3n para ${primary.recipient_name} (por si no la viste)`
        const html = build30MinPurchaseReminderEmail(primary.recipient_name, songs.length, url)
        const success = await sendEmail(primary.email, subject, html)
        if (success) {
          await supabase.from('songs')
            .update({ purchase_reminder_30min_sent: true, purchase_reminder_30min_sent_at: new Date().toISOString() })
            .in('id', songIds)
          await logEmail(primary.email, primary.recipient_name, 'purchase_reminder_30min', subject, 'sent', songIds)
          emailsSent++
        } else {
          await logEmail(primary.email, primary.recipient_name, 'purchase_reminder_30min', subject, 'failed', songIds, 'SendGrid error')
          errors.push(`Failed 30min purchase reminder to ${primary.email}`)
        }
      } catch (err) { errors.push(`Error 30min purchase reminder: ${err.message}`) }
    }

    // ============================================
    // 15-MINUTE ABANDONED CART
    // ============================================
    const { data: abandoned15Min, error: error15min } = await supabase
      .from('songs').select('*')
      .eq('paid', false).eq('status', 'completed')
      .lt('created_at', fifteenMinAgo.toISOString())
      .gt('created_at', oneHourAgo.toISOString())
      .or('abandoned_cart_15min_sent.is.null,abandoned_cart_15min_sent.eq.false')
      .not('email', 'is', null).not('audio_url', 'is', null)
      .limit(100)

    if (error15min) console.error('Error fetching 15min abandoned:', error15min)

    const groups15Min = groupSongs(abandoned15Min || [])
    for (const [_, songs] of groups15Min) {
      const primary = songs[0]
      const songIds = songs.map(s => s.id)
      try {
        const url = `https://regalosquecantan.com/comparison?song_ids=${songIds.join(',')}&from=email`
        const subject = `\u{1F3B5} \u00a1${songs.length > 1 ? 'Tus canciones' : 'Tu canci\u00f3n'} para ${primary.recipient_name} ${songs.length > 1 ? 'est\u00e1n listas' : 'est\u00e1 lista'}!`
        const html = build15MinEmail(primary.recipient_name, songs.length, url)
        const success = await sendEmail(primary.email, subject, html)
        if (success) {
          await supabase.from('songs').update({ abandoned_cart_15min_sent: true }).in('id', songIds)
          await logEmail(primary.email, primary.recipient_name, 'abandoned_15min', subject, 'sent', songIds)
          emailsSent++
        } else {
          await logEmail(primary.email, primary.recipient_name, 'abandoned_15min', subject, 'failed', songIds, 'SendGrid error')
          errors.push(`Failed 15min email to ${primary.email}`)
        }
      } catch (err) { errors.push(`Error 15min: ${err.message}`) }
    }

    // ============================================
    // 1-HOUR ABANDONED CART
    // ============================================
    const { data: abandoned1Hr, error: error1hr } = await supabase
      .from('songs').select('*')
      .eq('paid', false).eq('status', 'completed')
      .lt('created_at', oneHourAgo.toISOString())
      .gt('created_at', twentyFourHoursAgo.toISOString())
      .eq('abandoned_cart_15min_sent', true)
      .or('abandoned_cart_1hr_sent.is.null,abandoned_cart_1hr_sent.eq.false')
      .not('email', 'is', null).not('audio_url', 'is', null)
      .limit(100)

    if (error1hr) console.error('Error fetching 1hr abandoned:', error1hr)

    const groups1Hr = groupSongs(abandoned1Hr || [])
    for (const [_, songs] of groups1Hr) {
      const primary = songs[0]
      const songIds = songs.map(s => s.id)
      try {
        const url = `https://regalosquecantan.com/comparison?song_ids=${songIds.join(',')}&from=email`
        const subject = `\u{1F381} \u00bfOlvidaste algo? Tu regalo para ${primary.recipient_name} espera`
        const html = build1HrEmail(primary.recipient_name, songs.length, url)
        const success = await sendEmail(primary.email, subject, html)
        if (success) {
          await supabase.from('songs').update({ abandoned_cart_1hr_sent: true }).in('id', songIds)
          await logEmail(primary.email, primary.recipient_name, 'abandoned_1hr', subject, 'sent', songIds)
          emailsSent++
        } else {
          await logEmail(primary.email, primary.recipient_name, 'abandoned_1hr', subject, 'failed', songIds, 'SendGrid error')
          errors.push(`Failed 1hr email to ${primary.email}`)
        }
      } catch (err) { errors.push(`Error 1hr: ${err.message}`) }
    }

    // ============================================
    // 24-HOUR ABANDONED CART
    // ============================================
    const { data: abandoned24Hr, error: error24hr } = await supabase
      .from('songs').select('*')
      .eq('paid', false).eq('status', 'completed')
      .lt('created_at', twentyFourHoursAgo.toISOString())
      .eq('abandoned_cart_1hr_sent', true)
      .or('abandoned_cart_24hr_sent.is.null,abandoned_cart_24hr_sent.eq.false')
      .not('email', 'is', null).not('audio_url', 'is', null)
      .limit(100)

    if (error24hr) console.error('Error fetching 24hr abandoned:', error24hr)

    const groups24Hr = groupSongs(abandoned24Hr || [])
    for (const [_, songs] of groups24Hr) {
      const primary = songs[0]
      const songIds = songs.map(s => s.id)
      try {
        const url = `https://regalosquecantan.com/comparison?song_ids=${songIds.join(',')}&from=email`
        const subject = `\u23f0 \u00daltima oportunidad: ${songs.length > 1 ? 'Canciones' : 'Canci\u00f3n'} para ${primary.recipient_name}`
        const html = build24HrEmail(primary.recipient_name, songs.length, url)
        const success = await sendEmail(primary.email, subject, html)
        if (success) {
          await supabase.from('songs').update({ abandoned_cart_24hr_sent: true }).in('id', songIds)
          await logEmail(primary.email, primary.recipient_name, 'abandoned_24hr', subject, 'sent', songIds)
          emailsSent++
        } else {
          await logEmail(primary.email, primary.recipient_name, 'abandoned_24hr', subject, 'failed', songIds, 'SendGrid error')
          errors.push(`Failed 24hr email to ${primary.email}`)
        }
      } catch (err) { errors.push(`Error 24hr: ${err.message}`) }
    }

    // ============================================
    // 3-DAY FOLLOW-UP (with VUELVE10 coupon)
    // ============================================
    const { data: abandoned3Day, error: error3day } = await supabase
      .from('songs').select('*')
      .eq('paid', false).eq('status', 'completed')
      .lt('created_at', threeDaysAgo.toISOString())
      .gt('created_at', thirtyDaysAgo.toISOString())
      .eq('abandoned_cart_24hr_sent', true)
      .or('followup_3day_sent.is.null,followup_3day_sent.eq.false')
      .not('email', 'is', null).not('audio_url', 'is', null)
      .limit(50)

    if (error3day) console.error('Error fetching 3-day followup:', error3day)

    const groups3Day = groupSongs(abandoned3Day || [])
    for (const [_, songs] of groups3Day) {
      const primary = songs[0]
      const songIds = songs.map(s => s.id)
      try {
        const url = `https://regalosquecantan.com/listen?song_ids=${songIds.join(',')}&coupon=VUELVE10&from=email_3day`
        const subject = `\u{1F381} Regalo especial: 20% OFF en tu canci\u00f3n para ${primary.recipient_name}`
        const html = build3DayEmail(primary.recipient_name, songs.length, url)
        const success = await sendEmail(primary.email, subject, html)
        if (success) {
          await supabase.from('songs').update({
            followup_3day_sent: true,
            followup_3day_sent_at: new Date().toISOString()
          }).in('id', songIds)
          await logEmail(primary.email, primary.recipient_name, 'followup_3day', subject, 'sent', songIds)
          emailsSent++
        } else {
          await logEmail(primary.email, primary.recipient_name, 'followup_3day', subject, 'failed', songIds, 'SendGrid error')
          errors.push(`Failed 3-day followup to ${primary.email}`)
        }
      } catch (err) { errors.push(`Error 3-day followup: ${err.message}`) }
    }

    return new Response(
      JSON.stringify({
        success: true, emailsSent,
        processed: {
          checkoutRecovery: checkoutRecoverySent,
          fifteenMin: groups15Min.size,
          oneHour: groups1Hr.size,
          twentyFourHour: groups24Hr.size,
          threeDayFollowup: groups3Day.size
        },
        errors: errors.length > 0 ? errors : undefined,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error) {
    console.error('Scheduled email error:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})

// ============================================
// HELPER FUNCTIONS
// ============================================

function emailShell(bannerBg: string, bannerText: string, heroContent: string, bodyContent: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background-color:#111111;font-family:'Nunito','Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#111111;">
    <tr>
      <td align="center" style="padding:0;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#111111;">
          <!-- Top accent bar -->
          <tr>
            <td style="height:4px;background:linear-gradient(90deg,#ff6b35,#ff8c42,#ffd23f);font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <!-- Logo -->
          <tr>
            <td style="padding:32px 40px 0;text-align:center;">
              <p style="font-family:'Nunito','Helvetica Neue',Arial,sans-serif;color:#ff6b35;font-size:20px;font-weight:800;letter-spacing:1px;margin:0;">&#127925; RegalosQueCantan</p>
            </td>
          </tr>
          <!-- Hero -->
          <tr>
            <td style="padding:40px 40px 32px;text-align:center;">
              ${heroContent}
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:0 40px 32px;">
              ${bodyContent}
            </td>
          </tr>
          <!-- Bottom accent bar -->
          <tr>
            <td style="height:4px;background:linear-gradient(90deg,#ff6b35,#ff8c42,#ffd23f);font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color:#0a0a0a;padding:28px 40px;text-align:center;">
              <p style="color:#ff6b35;font-size:14px;font-weight:800;margin:0 0 8px;">&#127925; RegalosQueCantan</p>
              <p style="color:#555555;font-size:12px;margin:0 0 12px;">
                <a href="mailto:hola@regalosquecantan.com" style="color:#777777;text-decoration:none;">hola@regalosquecantan.com</a>
              </p>
              <p style="color:#333333;font-size:10px;margin:0;">&copy; 2026 Regalos Que Cantan</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

function ctaButton(label: string, url: string, bg: string = '#ff6b35', color: string = '#ffffff'): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">
    <tr>
      <td align="center" style="border-radius:8px;background-color:${bg};">
        <a href="${url}" target="_blank" style="display:inline-block;padding:16px 48px;font-family:'Nunito','Helvetica Neue',Arial,sans-serif;font-size:16px;font-weight:800;color:${color};text-decoration:none;border-radius:8px;">
          ${label}
        </a>
      </td>
    </tr>
  </table>`
}

function featureRow(icon: string, title: string, desc: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px;">
    <tr>
      <td style="width:48px;vertical-align:top;padding-right:16px;">
        <div style="width:44px;height:44px;background-color:#1a1a1a;border-radius:12px;text-align:center;line-height:44px;font-size:22px;">${icon}</div>
      </td>
      <td style="vertical-align:top;">
        <p style="color:#ffffff;font-size:15px;font-weight:700;margin:0 0 2px;">${title}</p>
        <p style="color:#999999;font-size:13px;margin:0;line-height:1.5;">${desc}</p>
      </td>
    </tr>
  </table>`
}

function progressBar(pct: number, label: string, note: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;">
    <tr>
      <td>
        <p style="color:#999999;font-size:13px;font-weight:700;margin:0 0 6px;">${label}</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#1a1a1a;border-radius:8px;overflow:hidden;">
          <tr>
            <td style="width:${pct}%;height:8px;background-color:#ff6b35;border-radius:8px;font-size:0;line-height:0;">&nbsp;</td>
            <td style="height:8px;font-size:0;line-height:0;">&nbsp;</td>
          </tr>
        </table>
        <p style="color:#666666;font-size:11px;margin:4px 0 0;">${note}</p>
      </td>
    </tr>
  </table>`
}

function testimonialCard(quote: string, name: string, location: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;margin-top:20px;">
    <tr>
      <td style="padding:20px 24px;">
        <p style="color:#ff6b35;font-size:20px;margin:0 0 8px;">&#9733;&#9733;&#9733;&#9733;&#9733;</p>
        <p style="color:#cccccc;font-size:14px;font-style:italic;margin:0 0 12px;line-height:1.6;">&ldquo;${quote}&rdquo;</p>
        <p style="color:#666666;font-size:12px;margin:0;font-weight:700;">${name} &bull; ${location}</p>
      </td>
    </tr>
  </table>`
}

function trustStrip(): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="padding:0 12px;text-align:center;">
              <span style="font-size:20px;">&#128274;</span><br>
              <span style="color:#666666;font-size:10px;">Pago seguro</span>
            </td>
            <td style="padding:0 12px;text-align:center;">
              <span style="font-size:20px;">&#9889;</span><br>
              <span style="color:#666666;font-size:10px;">Entrega instant&aacute;nea</span>
            </td>
            <td style="padding:0 12px;text-align:center;">
              <span style="font-size:20px;">&#10084;&#65039;</span><br>
              <span style="color:#666666;font-size:10px;">+500 canciones</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>`
}

// ============================================
// EMAIL BUILDERS
// ============================================

function buildCheckoutRecoveryEmail(recipientName: string, songCount: number, url: string): string {
  const hero = `
    <div style="width:64px;height:64px;background-color:#dc2626;border-radius:50%;margin:0 auto 24px;line-height:64px;font-size:28px;">&#128179;</div>
    <p style="color:#dc2626;font-size:12px;font-weight:800;letter-spacing:3px;text-transform:uppercase;margin:0 0 12px;">PAGO NO COMPLETADO</p>
    <h1 style="color:#ffffff;font-size:28px;font-weight:800;margin:0 0 8px;line-height:1.3;">Tu pago no se complet&oacute;</h1>
    <p style="color:#999999;font-size:15px;margin:0;line-height:1.6;">
      ${songCount > 1 ? 'Las canciones' : 'La canci&oacute;n'} para <strong style="color:#ffffff;">${recipientName}</strong> ${songCount > 1 ? 'est&aacute;n listas' : 'est&aacute; lista'}. Puedes intentar de nuevo.
    </p>`

  const body = `
    ${progressBar(90, 'Tu regalo est&aacute; casi listo', 'Solo falta completar el pago')}
    ${ctaButton('Completar Mi Pago', url, '#dc2626')}
    <p style="color:#666666;font-size:13px;text-align:center;margin:16px 0 0;">Tu canci&oacute;n se guarda por tiempo limitado.</p>
    ${testimonialCard('Mi esposa llor&oacute; de la emoci&oacute;n. El mejor regalo que le he dado.', 'Carlos M.', 'Los Angeles, CA')}
    ${trustStrip()}`

  return emailShell('#dc2626', '&#9888;&#65039; PAGO NO COMPLETADO', hero, body)
}

function build30MinPurchaseReminderEmail(recipientName: string, songCount: number, url: string): string {
  const hero = `
    <div style="width:64px;height:64px;background-color:#ff6b35;border-radius:50%;margin:0 auto 24px;line-height:64px;font-size:28px;">&#128236;</div>
    <p style="color:#ff6b35;font-size:12px;font-weight:800;letter-spacing:3px;text-transform:uppercase;margin:0 0 12px;">RECORDATORIO AMISTOSO</p>
    <h1 style="color:#ffffff;font-size:28px;font-weight:800;margin:0 0 8px;line-height:1.3;">
      Por si no la viste &mdash; tu ${songCount > 1 ? 'canciones' : 'canci&oacute;n'} para ${recipientName} ${songCount > 1 ? 'est&aacute;n' : 'est&aacute;'} listas
    </h1>
    <p style="color:#999999;font-size:15px;margin:0;line-height:1.6;">
      Aqu&iacute; est&aacute; de nuevo el enlace de descarga, por si el primer correo se te pas&oacute;.
    </p>`

  const body = `
    ${featureRow('&#127911;', 'Escucha y descarga', 'Tu canci&oacute;n est&aacute; lista para compartir')}
    ${featureRow('&#128274;', 'Acceso permanente', 'El enlace no expira &mdash; descarga cuando quieras')}
    ${ctaButton('Escuchar y Descargar', url, '#ff6b35')}
    <p style="color:#999;font-size:13px;text-align:center;margin:20px 0 0;">
      &iquest;Ya la descargaste? &iexcl;Ignora este correo!<br>
      &iquest;Problemas? Escr&iacute;benos a <a href="mailto:hola@regalosquecantan.com" style="color:#ff6b35;">hola@regalosquecantan.com</a>
    </p>`

  return emailShell('#ff6b35', '&#128236; Recordatorio: tu canci&oacute;n te espera', hero, body)
}

function build15MinEmail(recipientName: string, songCount: number, url: string): string {
  const hero = `
    <div style="width:64px;height:64px;background-color:#16a34a;border-radius:50%;margin:0 auto 24px;line-height:64px;font-size:28px;">&#127925;</div>
    <p style="color:#16a34a;font-size:12px;font-weight:800;letter-spacing:3px;text-transform:uppercase;margin:0 0 12px;">CANCI&Oacute;N LISTA</p>
    <h1 style="color:#ffffff;font-size:28px;font-weight:800;margin:0 0 8px;line-height:1.3;">
      ${songCount > 1 ? 'Tus canciones para ' + recipientName + ' est&aacute;n listas' : 'Tu canci&oacute;n para ' + recipientName + ' est&aacute; lista'}
    </h1>
    <p style="color:#999999;font-size:15px;margin:0;line-height:1.6;">
      Escucha el resultado y completa tu regalo.
    </p>`

  const body = `
    ${featureRow('&#127926;', 'Calidad profesional', 'Creada con inteligencia artificial de &uacute;ltima generaci&oacute;n')}
    ${featureRow('&#128149;', 'Letra personalizada', 'Con los detalles &uacute;nicos que compartiste')}
    ${featureRow('&#128228;', 'Lista para compartir', 'Desc&aacute;rgala o comp&aacute;rtela al instante')}
    ${ctaButton('Escuchar Ahora', url, '#16a34a')}
    ${trustStrip()}`

  return emailShell('#16a34a', '&#127925; &iexcl;TU CANCI&Oacute;N EST&Aacute; LISTA!', hero, body)
}

function build1HrEmail(recipientName: string, songCount: number, url: string): string {
  const hero = `
    <div style="width:64px;height:64px;background-color:#ea580c;border-radius:50%;margin:0 auto 24px;line-height:64px;font-size:28px;">&#127873;</div>
    <p style="color:#ea580c;font-size:12px;font-weight:800;letter-spacing:3px;text-transform:uppercase;margin:0 0 12px;">REGALO PENDIENTE</p>
    <h1 style="color:#ffffff;font-size:28px;font-weight:800;margin:0 0 8px;line-height:1.3;">Tu regalo para ${recipientName} sigue esperando</h1>
    <p style="color:#999999;font-size:15px;margin:0;line-height:1.6;">
      ${songCount > 1 ? 'Las canciones est&aacute;n listas' : 'La canci&oacute;n est&aacute; lista'} para ser ${songCount > 1 ? 'escuchadas' : 'escuchada'}. Solo falta completar tu compra.
    </p>`

  const body = `
    ${progressBar(75, 'Tu regalo est&aacute; casi listo', 'Solo falta elegir y pagar')}
    ${ctaButton('Completar Mi Regalo', url, '#ea580c')}
    ${testimonialCard('Nunca hab&iacute;a visto a mi mam&aacute; tan feliz. La canci&oacute;n fue perfecta.', 'Ana L.', 'Houston, TX')}
    ${trustStrip()}`

  return emailShell('#ea580c', '&#127873; TIENES UN REGALO PENDIENTE', hero, body)
}

function build24HrEmail(recipientName: string, songCount: number, url: string): string {
  const hero = `
    <div style="width:64px;height:64px;background-color:#dc2626;border-radius:50%;margin:0 auto 24px;line-height:64px;font-size:28px;">&#9200;</div>
    <p style="color:#dc2626;font-size:12px;font-weight:800;letter-spacing:3px;text-transform:uppercase;margin:0 0 12px;">&Uacute;LTIMA OPORTUNIDAD</p>
    <h1 style="color:#ffffff;font-size:28px;font-weight:800;margin:0 0 8px;line-height:1.3;">
      ${songCount > 1 ? 'Tus canciones para ' + recipientName + ' se borrar&aacute;n pronto' : 'Tu canci&oacute;n para ' + recipientName + ' se borrar&aacute; pronto'}
    </h1>
    <p style="color:#999999;font-size:15px;margin:0;line-height:1.6;">
      No pierdas este regalo &uacute;nico. Completa tu compra antes de que expire.
    </p>`

  const body = `
    ${progressBar(95, 'Tiempo limit&aacute;ndose', '&iexcl;&Uacute;ltimas horas disponibles!')}
    ${ctaButton('Salvar Mi Canci&oacute;n', url, '#dc2626')}
    ${testimonialCard('Pens&eacute; que era tarde, pero logr&eacute; completar el regalo justo a tiempo. &iexcl;Mi pap&aacute; llor&oacute;!', 'Roberto S.', 'Dallas, TX')}
    ${trustStrip()}`

  return emailShell('#dc2626', '&#9200; &Uacute;LTIMA OPORTUNIDAD', hero, body)
}

function build3DayEmail(recipientName: string, songCount: number, url: string): string {
  const hero = `
    <div style="width:64px;height:64px;background-color:#7c3aed;border-radius:50%;margin:0 auto 24px;line-height:64px;font-size:28px;">&#127873;</div>
    <p style="color:#7c3aed;font-size:12px;font-weight:800;letter-spacing:3px;text-transform:uppercase;margin:0 0 12px;">OFERTA ESPECIAL</p>
    <h1 style="color:#ffffff;font-size:28px;font-weight:800;margin:0 0 8px;line-height:1.3;">
      20% OFF en tu canci&oacute;n para ${recipientName}
    </h1>
    <p style="color:#999999;font-size:15px;margin:0;line-height:1.6;">
      Tu canci&oacute;n sigue esperando. Usa el c&oacute;digo <strong style="color:#7c3aed;">VUELVE10</strong> para obtener tu descuento.
    </p>`

  const body = `
    <!-- Coupon Code Box -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#1a1a1a;border:2px dashed #7c3aed;border-radius:12px;margin-bottom:24px;">
      <tr>
        <td style="padding:24px;text-align:center;">
          <p style="color:#7c3aed;font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">TU C&Oacute;DIGO DE DESCUENTO</p>
          <p style="color:#ffffff;font-size:32px;font-weight:800;margin:0 0 8px;letter-spacing:4px;">VUELVE10</p>
          <p style="color:#999999;font-size:13px;margin:0;">Se aplica autom&aacute;ticamente con el enlace de abajo</p>
        </td>
      </tr>
    </table>

    ${ctaButton('Escuchar y Obtener 20% OFF', url, '#7c3aed', '#ffffff')}

    <p style="color:#666666;font-size:13px;text-align:center;margin:16px 0 0;line-height:1.5;">
      Oferta por tiempo limitado.
    </p>

    ${testimonialCard('No sab&iacute;a qu&eacute; regalarle a mi abuela y esta canci&oacute;n la hizo llorar de felicidad. Vale cada centavo.', 'Mar&iacute;a G.', 'Miami, FL')}
    ${trustStrip()}`

  return emailShell('#7c3aed', '&#127873; 20% DE DESCUENTO', hero, body)
}
