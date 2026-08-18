import React, { useEffect, useRef, useState } from 'react';

/**
 * Cenzo — the brand mascot (the cenzontle with alebrije-painted wings).
 *
 * Everything he appears in goes through this file so his placement stays
 * consistent site-wide, which is the whole point of a mascot: the same bird in
 * the same spots on every page. See public/brand/cenzo/BRAND-BIBLE.html.
 *
 * Two source images, both owner-approved:
 *   cenzo-mark.png    the cutout on a round terracota badge — for brand lockups
 *   cenzo-cutout.png  transparent, wings spread — for anything on the night sky
 *
 * RULE: never swap these for a flat/abstract bird, a square photo crop, or a
 * version with a scenic background baked in. The mark IS Cenzo himself.
 */

// The 1024px masters are ~1.5MB and 633KB. Nothing on the site displays him
// anywhere near that big, so every placement points at a right-sized derivative
// (regenerate with scripts/build-cenzo-sizes.mjs). Shipping the masters would
// undo the Vercel bandwidth work — the landing page alone would gain 2MB.
const MARK_SM = '/brand/cenzo/cenzo-mark-64.png';
const MARK_MD = '/brand/cenzo/cenzo-mark-128.png';
const CUTOUT_SM = '/brand/cenzo/cenzo-cutout-256.png';
const CUTOUT_MD = '/brand/cenzo/cenzo-cutout-512.png';
const CUTOUT_LG = '/brand/cenzo/cenzo-cutout-768.png';

/** Round badge beside a wordmark, in headers and footers. */
export function CenzoMark({ size = 34, className = '', alt = 'Cenzo' }) {
  return (
    <img
      src={size > 64 ? MARK_MD : MARK_SM}
      srcSet={`${MARK_SM} 64w, ${MARK_MD} 128w`}
      sizes={`${size}px`}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      className={`shrink-0 rounded-full object-cover ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

/**
 * Cenzo standing next to a step heading, as the guide walking the customer
 * through the funnel. Transparent, so the night sky shows through his wings.
 */
export function CenzoGuide({ size = 76, className = '', alt = 'Cenzo' }) {
  // Threshold is 128, not 256: a 200px guide on a 2x phone needs the 512 source
  // or the white dot-work on his wings goes soft.
  return (
    <img
      src={size > 128 ? CUTOUT_MD : CUTOUT_SM}
      srcSet={`${CUTOUT_SM} 256w, ${CUTOUT_MD} 512w, ${CUTOUT_LG} 768w`}
      sizes={`${size}px`}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      className={`shrink-0 select-none pointer-events-none object-contain ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

/**
 * The big moment — hero art with the cempasúchil halo behind him, so he reads
 * as lit from above rather than pasted on. `halo` off for busy backgrounds.
 */
export function CenzoHero({ className = '', halo = true, alt = 'Cenzo, el cenzontle de las 400 voces' }) {
  return (
    <div className={`relative inline-block ${className}`}>
      {halo && <span className="anil-halo" aria-hidden="true" />}
      <img
        src={CUTOUT_LG}
        srcSet={`${CUTOUT_MD} 512w, ${CUTOUT_LG} 768w`}
        sizes="(min-width: 1024px) 384px, (min-width: 768px) 320px, 256px"
        alt={alt}
        loading="eager"
        fetchPriority="high"
        className="relative w-full select-none object-contain"
        style={{ filter: 'drop-shadow(0 14px 28px rgba(10,10,32,0.75)) drop-shadow(0 0 18px rgba(232,180,74,0.28))' }}
      />
    </div>
  );
}

/**
 * Cenzo alive — the silent singing loop, for the generating screen.
 *
 * The clip has NO audio track on purpose (`-an` in build-cenzo-sizes.mjs).
 * Customers create songs on buses and next to sleeping kids, browsers block
 * audio autoplay anyway, and a five-second phrase repeating for ten minutes
 * would be worse than silence. He performs; he does not make noise.
 *
 * Three safeguards, because this screen stays open for minutes, not seconds:
 *   1. poster + preload="none" — nothing loads until the screen is on
 *   2. pauses whenever the tab is hidden — customers switch apps mid-wait
 *   3. freezes after `freezeAfterMs` and falls back to the still for anyone
 *      who asked their phone for reduced motion
 * Together these keep a long wait from cooking a cheap Android.
 */
export function CenzoLive({ size = 260, className = '', freezeAfterMs = 240000, alt = 'Cenzo cantando mientras se crea tu canción' }) {
  const videoRef = useRef(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [frozen, setFrozen] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const onChange = (e) => setReducedMotion(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      const v = videoRef.current;
      if (!v) return;
      if (document.hidden || frozen) v.pause();
      else v.play().catch(() => { /* autoplay refused — the poster still reads */ });
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [frozen]);

  useEffect(() => {
    if (!freezeAfterMs) return undefined;
    const t = setTimeout(() => {
      setFrozen(true);
      videoRef.current?.pause();
    }, freezeAfterMs);
    return () => clearTimeout(t);
  }, [freezeAfterMs]);

  if (reducedMotion) {
    return <CenzoGuide size={size} className={className} alt={alt} />;
  }

  return (
    <div className={`cenzo-live relative mx-auto ${className}`} style={{ width: size }}>
      <video
        ref={videoRef}
        src="/brand/cenzo/cenzo-sing-640.mp4"
        poster="/brand/cenzo/cenzo-sing-poster.jpg"
        preload="none"
        autoPlay
        loop
        muted
        playsInline
        disablePictureInPicture
        aria-label={alt}
        className="block w-full rounded-2xl"
      />
    </div>
  );
}

/** His sign-off. Same wording as his WhatsApp pings and social captions. */
export function CenzoSignature({ className = '', line = null }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <CenzoMark size={26} />
      <span className="font-hand text-gold text-lg leading-none">
        {line || '— Cenzo 🎶'}
      </span>
    </div>
  );
}

export default CenzoMark;
