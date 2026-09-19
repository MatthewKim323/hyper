# Router and scene transitions

The router coordinates the Highway 2.2.0 renderer lifecycle with Next App Router navigation. Supported views are `homeContact`, `projects`, and `notFound`. The landing and contact pages share a scene; `/projects` enters an empty gallery environment.

## Navigation flow

1. Match a contextual transition for the current and destination paths.
2. Run the current renderer's leave hooks and outgoing animation while its DOM remains mounted.
3. Navigate with Next using `scroll: false` and wait for the replacement `main[data-router-view]`.
4. Update body classes, enter the new renderer, and complete its incoming animation.

`setNextRouter()` accepts the router from `useRouter()`. Scene controls may call `store.Highway.redirect(url, transitionName?)`. Modifier clicks, external links, anchors, and links marked `data-router-disabled` bypass interception.

`routes.ts` normalizes trailing slashes and defines transitions between home, contact, and gallery. `to-project-menu.ts` blends the home scene into the gallery while moving both cameras. `to-home.ts` and `to-contact.ts` handle return navigation.

## View contract

The persistent layout owns `[asscroll-container][data-router-wrapper]`; its single route child is `main[data-router-view]`. Optional `data-body-class` overrides the route's body class. React owns DOM removal: transitions hide the outgoing view and let React remove it on commit.

The router constructs the first renderer only after shared managers exist. `BaseRenderer` coordinates view assets, text, DOM components, scroll, and first-load scene builds. Browser back/forward events are replayed after the outgoing transition so Next history state remains intact.

Inline route scripts are evaluated after client navigation because React does not execute inserted script elements. Keep route scripts limited to trusted application data and setup.
