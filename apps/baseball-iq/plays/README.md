# Baseball Feud Plays — “What Went Wrong?”

Plays mode runs real MLB plays on the normal Baseball IQ / Baseball Feud board:
**Situation → Watch the play → What went wrong? (board) → Teaching review**.
Open it from the start screen (**🎬 PLAYS**, or press **P**).

## Adding plays without code

1. Start screen → **🎬 PLAYS** → **+ NEW PLAY**.
2. Paste the clip’s **MLB.com video page link** (`https://www.mlb.com/video/…`). The form shows
   “✓ Plays inside the game” when MLB’s own embed is available. Any other link opens in a new tab.
3. Set the camera angle (High Home / Wide / Broadcast) and any timecoded views (`0:20–0:24 | what it shows`).
   They become **JUMP TO** buttons under the video.
4. Fill in the situation, **4–6 teaching answers** (board label, category, coaching explanation, accepted phrasings),
   the coach’s explanation, the bonus question, sources and verification status.
5. **SAVE PLAY**. Add plays to **This game**, reorder them, and **SAVE COLLECTION** to keep a set.

Or **IMPORT PLAYS (JSON)**: either a library export (`{ "plays": [...] }`, the format below) or a research
file from the Baseball Feud Plays research (`{ "rounds": [...] }`). Plays with the same `id` are updated, never duplicated.
**EXPORT LIBRARY** saves everything (plays + collections) as one JSON file.

The library lives in this browser (`localStorage` key `baseballIQ.plays.v1`), separately from the regular game
(`baseballIQ.v1`), which Plays mode never changes. Export it to move it to another computer.

## Video: how it plays, and what is allowed

- The player is **MLB.com’s own embed** (the Share → Embed code on MLB.com, hosted by Streamable at
  `https://streamable.com/m/<mlb.com video slug>`). The game drives it through the embed’s player.js interface:
  play, pause, replay, ±5 s, frame step, scrub, jump to timecodes, freeze point. Fullscreen uses the video frame
  (or a full-window view on iPhone).
- **Clips are never downloaded, copied or rehosted.** MLB’s terms allow display only with MLB’s permission or as
  its properties expressly offer; the embed code is what MLB.com offers. Using the raw MP4/HLS files in our own
  player, or hosting copies (R2 / Stream), would need written permission or a licence from MLB.
- A play without an MLB.com clip (e.g. Volume 1 round 11, a Baseball Savant page) opens on MLB’s site in a new tab;
  the board stays where it was.
- Embeds can show MLB’s own advertising and need an internet connection. Speed control isn’t offered by the embed.

## Play format (`plays/volume-1.js`, library export)

```jsonc
{
  "id": "unique-id", "title": "Board title", "subtitle": "", "stage": "2025 NLCS · Game 1 · HIGH HOME",
  "category": "Baserunning", "categories": ["Baserunning", "Know the outs"], "difficulty": "" /* Intro | Intermediate | Advanced */,
  "situation": { "teams": "Away at Home", "date": "YYYY-MM-DD", "venue": "", "inning": "Top 4th", "outs": 1,
    "runners": "Bases loaded", "bases": { "1B": true, "2B": true, "3B": true }, "score": "", "count": "1-0",
    "batter": "", "pitcher": "", "setup": "What happened before the pitch", "anticipate": "What the defense should anticipate" },
  "video": { "embedUrl": "https://streamable.com/m/<slug>", "pageUrl": "https://www.mlb.com/video/<slug>", "title": "", "savantUrl": "",
    "angle": { "category": "high-home | wide | broadcast", "label": "", "howVerified": "",
      "segments": [{ "time": "0:20–0:24", "view": "Elevated view from behind home", "start": 20 }] },
    "pauseAt": null /* seconds — the host can also set it during the game (❄ SET FREEZE POINT) */ },
  "answers": [{ "label": "Board label", "category": "Baserunning", "explanation": "Coaching explanation",
    "evidence": "record | report | fundamental | record+report", "aliases": ["accepted phrasing"], "checkClip": false }],
  "coach": "Coach’s explanation", "bonus": { "question": "", "answer": "" }, "officialRecord": "",
  "sources": [{ "label": "", "url": "https://…" }],
  "verification": { "status": "verified | unverified | review", "notes": "", "gamePk": "", "playId": "" }
}
```

Every answer is worth the same (10 points) in team play: these are curated coaching points, never survey results.

`volume-1.js` is generated from the research file (12 plays; 2 High Home, 10 broadcast with timecoded wide views).
Don’t hand-edit it — edit plays in the app, or regenerate it from a new research file.
