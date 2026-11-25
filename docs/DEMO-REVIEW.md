# Demo review — live runs (26 Nov)

Real Nano (Chrome on this Mac) + real Gemini (Firebase AI Logic, sim-main preview). No `?sim=1`.
Preview: https://mendcraft--sim-main-o8jrlskh.web.app/canvas.html?fresh=1

## Run 1 (old build, before fixes) — what broke
- Gemini blocked on 127.0.0.1 (App Check 403) and the app showed a SIM "prepared draft" in a live run → fixed (honest error, no SIM outside ?sim=1).
- Nano: 50 s to 2½ min per draft, renderer froze, "not a board plan", no Gemini fallback → fixed (Nano via Firebase AI Logic, tiny JSON reply, warm-up, 20 s handoff to Gemini).
- Review titles invented devices ("2 lamps found") and status tiles ("Connected · 0") → fixed (titles from the plan; status claims filtered).

## Run 2 (current sim-main) — laptop journey, all real models
| Step | Result |
|---|---|
| connect everything in this room | ONE review in 5.1 s: "This room: 2 lamps and 1 speaker, grouped + a room plan", "Drafted by Nano on this device · 0 B; improved by Gemini · 2.5 KB" |
| play music | Speaker tile "Playing · Morning light" (built-in player — this origin has no Spotify login) |
| save | new Board 2 |
| draw the floor plan | Nano on device, ~2 s, two-bedroom plan |
| check accessibility / show 3D | ran; chips advance |
| add kannada | FAILED first ("unknown intent ai") → fixed on sim-main; re-run: 385 B, 19 labels, UI in Kannada |
| try to break it (500 % brightness) | Nano proposed it, check refused: "Lamps go from 10 to 100 %. Nothing changed." — nothing sent |
| connect devices (pairing) | Nothing phone paired by typed code ("Laptop ✓" / "✓ Nothing phone"); chime NOT heard (see below) |

## Glitches found (sent to the builder; status in git log)
1. Next-step chips hidden under the Nano/Gemini bar.
2. Empty black camera box when the camera is off; it also covers the cluster's last button.
3. "play music" gives no status line.
4. Review footer bytes on a dangling line ("… addresses\n · 2.5 KB").
5. "Deep understands it better" (jargon) in the Kannada review.
6. Kannada review said 385 B, ledger later 770 B (second hedge request booked after the review).
7. Nano card stays red "Failed" after the refusal.
8. Pair panel clipped; its chime sentence printed twice.
9. Android status-bar icons white on the light canvas.
10. Chime started by a script is silent (browser autoplay rule) — a real click plays it.
11. Lamps: app lists 2 lamps, the room has 1 WiZ bulb → fix ready on branch live-ai-2 (real bulbs replace the seeded lamps), merging after review.

## For Akash (needs you)
- Chime pairing with the phone held next to the laptop speaker (my test: phone on the cable, chime not heard; typed code works).
- iPhone: its screen had gone to sleep, so I couldn't drive it overnight — latest build IS installed. Wake it and run P1–P6 and G.
- Spotify on the preview: log in once there (redirect URI https://mendcraft--sim-main-o8jrlskh.web.app/spotify must be in the Spotify app).
- Hands (E) and gestures: thumbs up/down, 1/2/3 fingers, both hands — only you can do these.
- Gimbal nod / shake / wakeup (G17–G21).

## Run 2 — Nothing phone (real Gemini)
- Paired by typed code: phone "Laptop ✓", laptop "✓ Nothing phone".
- "connect everything in this room" on the phone → review on the phone, Approve by a real tap → full-width readable board (lamp + speaker tiles). 
- Glitches (sent to the phone builder): AI monitor's Android tab never shows the phone's activity ("Not connected"); "make a dashboard…" routed to chat and the reply never showed; Gemini called twice on the phone (draft + improve, 4.6 KB); review sheet under the status bar, a truncated "What left" line, mic overlapping the sheet; white status-bar icons; empty status after "turn on the desk lamp".
- AI monitor (laptop tab) works: history, refusal, "Sent again: 2 calls, 770 B in all" for the Kannada retry.
