// Recovered Aircord scene/UI implementation. See PROVENANCE.md.

export default function initialize() {
  PAGE_TRANSITION.setting = () => {
    const t = PAGE_TRANSITION;
    (barba.init({
      timeout: 3e4,
      debug: !1,
      name: "overlap",
      sync: !0,
      schema: { prefix: "data-xhr" },
      prevent: ({ el: t }) => t.classList.contains("js-a"),
      transitions: [
        {
          beforeLeave(e) {
            t.onLeaveBefore(e);
          },
          leave: (t) => PAGE_TRANSITION.onLeave(t),
          afterLeave(t) {},
          beforeEnter(e) {
            t.onBeforeEnter(e);
          },
          enter: (t) => PAGE_TRANSITION.onEnter(t),
          afterEnter(e) {
            t.afterEnter(e);
          },
          after({ current: t, next: e, trigger: i }) {},
        },
      ],
    }),
      barba.hooks.beforeEnter((t) => {
        replaceHead(t);
      }),
      t.run());
  };
}
