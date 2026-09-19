// Persistent home/contact content sits outside <main>; HomeContact pulls
// .js-view-projects-btn and .js-contact-content into its CSS3D layer.
export function PersistentContent() {
  return (
    <div className="d-none">

      <div className="js-view-projects-btn" style={{ visibility: "hidden" }}>
        <a href="/projects" title="enter" className="btn btn--regular btn--fill btn--light js-manager-ignore js-btn" data-btn="fill" data-cursor="hide">
          <span className="btn__inner js-btn-inner">
            <span className="btn__content js-btn-content">
              <span className="d-flex flex-row items-end">
                <span className="btn__text">
                  enter
                </span>
                <svg className="btn__icon d-inline-block js-btn-icon">
                  <use href="#arrow"></use>
                </svg>
              </span>
            </span>
          </span>
        </a>
      </div>

      <div className="w-1/1 w-auto@sm js-contact-content" style={{ visibility: "hidden" }}>
        <div className="d-flex flex-column flex-row@sm mt-8 mt-0@sm pb-5 pb-0@sm">
          <div className="d-flex flex-column items-center items-end@sm mr-2@sm">
            <div className="mb-2 | js-reveal-anim">
              <h2 className="t-center t-5 t-6@sm t-lh-0.9 mb-0">
                <span className="d-block t-serif t-normal t-ls-tighter t-italic">Say hello</span>
              </h2>
            </div>
            <div className="d-flex justify-end t-center t-right@sm t-uppercase t-lh-1.3 | js-reveal-anim">
              <p className="t-0.9 mb-0">we look forward<br /> to hearing from you</p>
            </div>
          </div>
          <div className="d-flex flex-column mt-1 mt-2.5@sm">
            <div className="d-flex items-center items-end@sm justify-center justify-start@sm mb-1 mb-2@sm | js-reveal-anim">
              <div className="mr-1 d-flex">
                <a href="#" title="Project" className="btn btn--regular btn--border btn--dark js-content-toggle-btn js-btn-selected js-manager-ignore js-btn" data-btn="border" data-togglecontent="new-business" data-router-disabled="" data-audio-enter="audio.hover" data-cursor="hide">
                  <span className="btn__inner js-btn-inner">
                    <span className="btn__content js-btn-content">
                      <span className="d-flex flex-row items-end">
                        <span className="btn__text">
                          Project
                        </span>
                        <svg className="btn__icon d-inline-block js-btn-icon">
                          <use href="#arrow"></use>
                        </svg>
                      </span>
                    </span>
                  </span>
                </a>
              </div>
              <div className="d-flex | js-reveal-anim">
                <a href="#" title="General" className="btn btn--regular btn--border btn--dark js-content-toggle-btn js-btn-not-selected js-manager-ignore js-btn" data-btn="border" data-togglecontent="general" data-router-disabled="" data-cursor="hide">
                  <span className="btn__inner js-btn-inner">
                    <span className="btn__content js-btn-content">
                      <span className="d-flex flex-row items-end">
                        <span className="btn__text">
                          General
                        </span>
                        <svg className="btn__icon d-inline-block js-btn-icon">
                          <use href="#arrow"></use>
                        </svg>
                      </span>
                    </span>
                  </span>
                </a>
              </div>
            </div>
            <div className="t-center t-left@sm relative js-content-toggle | js-reveal-anim">
              <div data-content="general" className="js-content-toggle-section">
                <div className="t-normal mb-1 t-center overflow-hidden t-left@sm">
                  <a href="mailto:founders@kalilabs.ai" className="t-lh-1 t-2 t-no-underline t-300 d-block arrow-link arrow-link--large" data-cursor="hide"><span><span><span>{"\u2BA1\u00A0\u00A0"}</span></span>founders@kalilabs.ai</span></a>
                </div>
                <div className="d-flex flex-column flex-row@sm">
                  <div className="mr-2@sm">
                    <span className="d-block t-uppercase t-base t-small@sm mb-0.25 t-center overflow-hidden t-left@sm">Hyper</span>
                    <p className="t-1.2 t-lh-1.3 t-center overflow-hidden t-left@sm">
                      Accounts-payable<br />
                      exception resolution
                    </p>
                  </div>
                  <div>
                    <span className="d-block t-uppercase t-base t-small@sm mb-0.25 t-center overflow-hidden t-left@sm">Explore</span>
                    <p className="t-1.2 t-lh-1.3 t-center overflow-hidden t-left@sm">
                      <a href="https://github.com/MatthewKim323/hyper." target="_blank" rel="noopener noreferrer">Hyper on GitHub</a>
                    </p>
                  </div>
                </div>
              </div>
              <div className="w-1/1 absolute top js-content-toggle-section" data-content="new-business">
                <div>
                  <div className="t-normal overflow-hidden mb-0.25">
                    <a href="mailto:founders@kalilabs.ai" className="t-lh-1.1 t-2 t-no-underline t-300 d-block arrow-link arrow-link--large" data-cursor="hide"><span><span><span>{"\u2BA1\u00A0\u00A0"}</span></span>founders@kalilabs.ai</span></a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
