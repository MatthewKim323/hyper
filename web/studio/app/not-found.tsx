// The engine uses the notFound view for this route.

function Btn({ href, title, className }: { href: string; title: string; className: string }) {
  return (
    <a href={href} title={title} className={className} data-btn="fill" data-cursor="hide">
      <span className="btn__inner js-btn-inner">
        <span className="btn__content js-btn-content">
          <span className="d-flex flex-row items-end">
            <span className="btn__text">{title}</span>
            <svg className="btn__icon d-inline-block js-btn-icon">
              <use href="#arrow" />
            </svg>
          </span>
        </span>
      </span>
    </a>
  );
}

export default function NotFound() {
  return (
    <main
      {...({ asscroll: "" } as React.HTMLAttributes<HTMLElement>)}
      data-router-view="notFound"
      data-body-class="error404 dark"
      role="main"
      itemScope
      itemProp="mainContentOfPage"
    >
      <div className="d-flex items-center justify-center w-1/1 relative bg-black" style={{ minHeight: "100vh" }}>
        <div className="container py-8">
          <h1 className="t-5 t-10@sm t-lh-0.85 t-ls-0.3 t-normal t-uppercase mb-2">
            <span className="d-block t-pink">404/</span>
            <span className="d-block pl-9 pl-19@sm">Page</span>
            <span className="d-block">Not Found</span>
          </h1>
          <hr className="mb-1" />
          <div className="d-flex@md items-center">
            <div className="w-3/4 w-1/2@sm mb-2 mb-0@md">
              <p className="pl-19.5@md t-lh-1.1 mb-0">
                It looks like the page you were looking for has moved or can’t be found, maybe you’d like to visit one
                of these pages instead?
              </p>
            </div>
            <div className="w-1/2@md d-flex@md justify-end">
              <Btn href="/" title="Back to the homepage" className="btn btn--regular btn--fill btn--light mr-1 js-btn" />
              <Btn href="/projects" title="View our work" className="btn btn--regular btn--fill btn--light js-btn" />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
