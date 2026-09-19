// Recovered Aircord scene/UI implementation. See PROVENANCE.md.

export default function initialize() {
  ((window.PROJECTS = {
    el: document.getElementById("json-projects"),
    json: null,
    once() {
      this.json = JSON.parse(this.el.textContent);
    },
  }),
    PROJECTS.once());
}
