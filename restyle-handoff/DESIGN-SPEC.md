# The AI Wire — design spec (handoff)

Give this file to the agent that generates news.baeke.info, together with the two reference HTML files in this folder. Rule: reproduce these pages exactly; only the story content changes.

## Aesthetic
Wire-service editorial. Warm newsprint, flat, no shadows, no rounded cards, no gradients. Square-cornered images with a 1px ink border. Subtle paper grain: `radial-gradient(var(--dot) 1px, transparent 1px); background-size: 5px 5px`.

## Tokens (CSS variables on <body>)
Day:
- --paper: #F4F0E8 (background)
- --ink: #191713 (headlines, rules, borders)
- --txt: #3B372F (body text)
- --mut: #6B6459 (metadata)
- --acc: #C8361E (signal red: accents, hovers, numbers, badges)
- --rule: rgba(25,23,19,.25) · --soft: rgba(25,23,19,.3) · --dot: rgba(25,23,19,.035)

Night (`body.night`, persisted in localStorage key `aiwire-theme` = "night" | "day"):
- --paper: #171310 · --ink: #EDE7DB · --txt: #C9C1B2 · --mut: #97907F · --acc: #E0603F
- --rule: rgba(237,231,219,.25) · --soft: rgba(237,231,219,.3) · --dot: rgba(237,231,219,.05)

Never pure black/white. All colors via var(--*) so the night toggle works.

## Type
- Headlines/body: Newsreader (Google Fonts), opsz axis. Headlines 700–800, tracking −0.02 to −0.03em, line-height ≤1.1.
- Metadata/UI: IBM Plex Mono, 10.5–12px, uppercase, letter-spacing 0.1–0.18em.
- Masthead: "The AI *Wire*" — "Wire" italic, weight 400, in --acc.
- Body copy 19.5px/1.65 in --txt, measure ~680px.

## Layout — homepage
1. Top bar (mono): blinking red dot + "Live wire — dispatch open" left; date + night-mode pill button right.
2. Masthead band: 3px ink rule above, 1px below; giant wordmark left, tagline (mono, ~260px) right.
3. Filter rail: "FILTER /" label + pill buttons per tag (active = ink fill, paper text).
4. Lead story: 2-col grid (1.15fr/0.85fr, 56px gap). Red "LEAD DISPATCH" badge, kicker `source ▸ tag · filed date`, huge headline, summary, mono "READ THE DISPATCH →" link with red underline. Image right with "No. NNN" ink tag overlapping top-right corner.
5. "LATEST ON THE WIRE" divider: mono label + full-width rule + dispatch count (zero-padded).
6. Story rows: grid 72px / 1fr / 220px — big red mono number (newest = highest), kicker, 28px headline, summary, thumbnail. 1px --rule separators.
7. Footer: 3px rule, small wordmark, "END OF TRANSMISSION · HUMAN-REVIEWED · date".

## Layout — article page
Compact masthead ("← Back to the wire" + toggle; thin wordmark band + "Dispatch No. NNN"). Header max 820px: red kicker badge, `· filed date · N min read`, 40–62px headline, italic standfirst. Full-width hero image with mono figcaption ("FIG. 01" right-aligned). Body max 680px: red drop cap on first paragraph, one pull-quote (3px red left border, 26px italic), "END OF DISPATCH" centered rule. Then "More on the wire" list + footer.

## Behavior
- Night toggle button (mono pill, "☾ night mode" / "☀ day mode") toggles `night` class on body + saves to localStorage; read on every page load.
- Tag filter filters client-side; count updates.
- Hovers: text → --acc. No transforms/scales. Transitions ≤ .35s ease.

## Copy voice
Lowercase-ish sentence case headlines, wire jargon: "dispatch", "filed", "on the wire", "end of transmission". Kickers always `source ▸ tag`.
