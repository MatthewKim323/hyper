// The route's visible content is rendered by the WebGL HomeContact scene; the persistent home/contact templates (.js-view-projects-btn, .js-contact-content) live in
// the shell because the scene holds them across every route.
export default function HomePage() {
  return (
    <main {...{ asscroll: "" }} data-router-view="homeContact" role="main" itemScope itemProp="mainContentOfPage">
      <h1>hyper.</h1>
      <p>Matthew Kim &amp; Stephen Hung · HackMIT</p>
    </main>
  );
}
