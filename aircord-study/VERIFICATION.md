# Verification — 2026-09-19

## Visual fidelity

Compared the fully loaded live reference against the local implementation in headed Chromium. Desktop viewport: 1440 × 900. Phone viewport: 390 × 844. Tablet viewport: 834 × 1112. Device pixel ratio: 1.

Each comparison uses the entire unmasked frame. A matching pixel has an absolute difference of at most 12/255 in each RGB channel. Autoplay/video time and pointer inputs are synchronized; the desktop gallery additionally uses the same scroll fraction. These are explicitly controlled snapshots, not a guarantee that every animation frame, device or network condition is identical.

| View | Desktop agreement | Phone agreement |
| --- | ---: | ---: |
| Home | 99.694% | 100.000% |
| Projects | 98.924% | 96.671% |
| About | 99.073% | 100.000% |
| Archives | 99.922% | 100.000% |
| Lexus project detail | 99.966% | 100.000% |

Additional checkpoints: desktop expanded menu in light mode, 99.496%; tablet home, 100.000%. All 12 checkpoints exceed the requested 95% target. No JavaScript exceptions occurred in either side of these comparisons. Major measured layout rectangles match within 0.5px, apart from the continuously animated homepage hit area's roughly 1px variation.

Screenshots, full measurements, and amplified difference images remain in the local `work/fidelity/` directory. The comparison never replaces the application canvas with a reference screenshot.

## Motion and behavior

- Project-zoom animation: all four animated values match exactly at seven checkpoints from 0 to 6 seconds; durations and delays also match.
- Menu animation: values match exactly at five checkpoints from 0 to 1.4 seconds.
- Desktop and phone: menu open/close; light/dark theme and saved preference; reel open/play/pause/close; home-to-projects transition; browser back; English/Japanese switching; about navigation and content scrolling pass.
- Phone reduced-motion mode: the above interactions pass and route animation duration is zero, matching the reference's reduced-motion behavior.
- Earlier navigation checks cover project gallery scrolling, archives and direct project-detail entry on desktop and phone.
- Six automated device-detector regression tests pass, including iPad desktop user agents, phone/tablet resizing, desktop/touch implementation changes and reduced-motion preference.

## Production checks

- Production build succeeds with Vite 6.4.3.
- The built homepage boots and renders the 2160 × 1350 WebGL canvas without JavaScript exceptions. Some offscreen Vimeo requests are intentionally aborted during media selection; these are network cancellations, not script failures.
- All 32 English/Japanese routes return HTTP 200 from the production preview.
- All 13 unique stylesheet, script, font and icon URLs directly referenced by built HTML return their expected non-HTML assets; no missing internal route/asset references remain.
- `npm test`: 6 passed, 0 failed.
- `npm audit`: 0 vulnerabilities.

## Limits

This is an attributed private reconstruction, preserving original rendering logic and assets; it is not a clean-room implementation or independent design. Project images/videos retain the original CDN/Vimeo dependencies, and remote media readiness can vary. All 12 project details exist in both languages, but only the Lexus detail received a pixel comparison. Testing used Chromium with emulated touch devices, not a physical iPhone/Safari/Firefox matrix. The numerical fidelity claim applies to the listed checkpoints.
