# Job 2 — retire the stale `SubGenreStep.jsx`

Written 2026-08-05, out of the claymation-ad work.

## What's wrong

There are **two** sub-genre definitions in the frontend and they disagree.

| | File | Ranchera sub-genre ids |
|---|---|---|
| **Live** | `src/config/genres.js` | `lenta`, `brava`, `moderna` |
| **Stale** | `src/pages/SubGenreStep.jsx` | `clasica`, `bravia`, `romantica` |

The backend recipe table (`genreDNA` in `supabase/functions/generate-song/index.ts`) is keyed
`lenta` / `brava` / `moderna`, and the lookup is a direct index:

```ts
const subGenreData = subGenre ? genreData.subGenres[subGenre] : null;   // ~line 1420
```

`genres.js` matches. `SubGenreStep.jsx` does not — every one of its ranchera ids would
resolve to `null` and silently fall back to the generic ranchera style.

## Why it isn't currently breaking anything

`GenreStep.jsx` builds its genre + sub-genre list from `genres.js` and handles sub-genre
selection **inline** — it never navigates to the `subgenre` page. So `SubGenreStep.jsx` is
mounted in the router but unreachable through the normal funnel.

## Why it's still worth fixing

`App.jsx` still routes it:

```js
'/create/subgenre': 'subgenre',            // ~line 85
{currentPage === 'subgenre' && <SubGenreStep />}   // ~line 420
```

So it is reachable by direct URL, and by anything that deep-links to `/create/subgenre`
(an old email, an ad, a bookmark, a returning customer's history). A buyer arriving that
way picks "Clásica" and receives generic ranchera — no error anywhere, just a song that
isn't the style they chose. That is exactly the shape of the "this isn't my song"
complaints already on record.

It's also a landmine for future work: the next person to edit sub-genres has a 50/50
chance of editing the wrong file, and nothing will tell them.

## Divergences beyond ranchera

`SubGenreStep.jsx` is stale across the board, not just ranchera:

- **corrido** — has `clasico`, `tumbado`; live/backend use `tradicional`, `tumbados` (note the plural)
- **banda** — has `sinaloense`, `pop`; live/backend use `sinaloense_clasica`, `banda_90s`, `quebradita`, `tecnobanda`
- **norteno** — has `moderno`, which doesn't exist; live/backend have `con_sax_romantico`, `con_sax_bailar`, `nortena_banda`
- **no mariachi at all**, though `genres.js` and the backend both have four mariachi sub-genres
- missing genres entirely: duranguense, sierreño, bolero, vals, cristiana, grupera, tejano, vallenato, merengue, latin_trap, pop_latino, rock_espanol

## Recommended fix

**Delete `src/pages/SubGenreStep.jsx` and its route.** It has no unique behaviour —
`GenreStep.jsx` already does sub-genre selection from the correct source. Deleting removes
the divergence permanently rather than leaving two lists to drift again.

1. Remove the import and the `currentPage === 'subgenre'` branch in `src/App.jsx`
2. Remove `'/create/subgenre': 'subgenre'` from the route map
3. Delete `src/pages/SubGenreStep.jsx`
4. Redirect `/create/subgenre` → `/create/genre` so any live deep-link lands somewhere sane
   instead of 404-ing
5. Grep for other referrers before deleting: `rg -n "subgenre" src/`

**Do not** simply correct the ids in `SubGenreStep.jsx`. That keeps two lists in sync by
hand, which is the condition that produced this.

## Effort

Small — under an hour including checking for deep-links in emails and ad destinations.
Frontend only, ships via the normal Vercel push to `main`. No edge function deploy.

## Verify after

- `/create/subgenre` redirects rather than rendering the old page
- A normal order through `/create/genre` still shows sub-genres and still produces the
  chosen style
- `rg -n "SubGenreStep|/create/subgenre" src/` returns nothing
