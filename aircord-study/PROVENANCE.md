# Aircord fidelity study

This private study reconstructs the published Aircord site at https://aircord.co.jp/en/.
Original art direction, design, rendering code and content belong to Aircord and its credited collaborators, including Garden Eight / Kenta Toshikura. This is not an independently designed portfolio.

The captured page markup, styles, scene equations and authored interaction logic are preserved to meet the requested visual fidelity. The major vendor dependencies (Three.js, GSAP and Barba) are replaced with pinned npm packages, and the application is reconstructed as native ES modules. GLSL sources are extracted into editable shader files. Neither original desktop nor mobile production bundle is shipped. The original embedded smooth-scroll implementation is retained for matching behavior.

The local source is organized by responsibility under `src/runtime`, with editable GLSL in `src/shaders`, responsive stylesheet `src/site.css`, and page content in route-level `index.html` files. Exact asset origins and local copies are recorded in the acquisition manifest.

The original device detector is replaced by a small local capability detector with regression tests. Verification results and remaining limitations are documented in VERIFICATION.md.
