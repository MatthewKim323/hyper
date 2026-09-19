/* eslint-disable @next/next/no-html-link-for-pages -- The engine router owns anchor navigation and animated page transitions. */
import { PersistentContent } from "./PersistentContent";
// Persistent shell markup and engine hooks.
// Order in <body>: <Shell/> (loader, naked-loader, header, menu, click-catcher, cursor, footer),
// then the router wrapper with the route <main>, then <ShellPost/> (gl canvas,
// project filters, #p-cover, asscrollbar, height-div). Engine classes in lib/engine/dom query these hooks.
import Sprite from "./Sprite";

// Cube faces reveal in DOM order 1,2,3,4,6,5, spelling HYPER followed by a separator.
const CUBE = ["H", "Y", "P", "E", "·", "R"];

function Loader() {
  return (
    <div className="loader loader--minimal js-loader">
      <button
        className="btn btn--regular btn--fill btn--light intro-enter js-manager-ignore js-btn js-enter-btn"
        type="button"
        data-btn="fill"
        data-cursor="hide"
        disabled
        aria-busy="true"
        aria-label="Enter"
      >
        <span className="btn__inner js-btn-inner">
          <span className="btn__content js-btn-content">
            <span className="d-flex flex-row items-end">
              <span className="btn__text">Enter</span>
              <svg className="btn__icon d-inline-block js-btn-icon">
                <use href="#arrow"></use>
              </svg>
            </span>
          </span>
        </span>
      </button>
    </div>
  );
}

function NakedLoader() {
  return (
    <div className="naked-loader js-naked-loader">
      <div className="loader__inner">
        <div className="loader__wrap js-naked-loader-wrap">
          <div className="loader__box">
            {CUBE.map((l, i) => (
              <div key={i} className="js-naked-loader-box">
                {l}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="naked-loader__text absolute t-sans t-uppercase t-1.3 t-normal t-lh-1 js-naked-loader-text">
        <div>(Loading)</div>
      </div>
    </div>
  );
}

// The wordmark uses the header's fixed 13.2rem by 1.7rem proportions.
function Logo() {
  return (
    <svg viewBox="0 0 1263.3 159.6" xmlns="http://www.w3.org/2000/svg" aria-label="Hyper">
      <text
        x="0"
        y="157"
        fontSize="214"
        fontFamily="Neue Montreal, sans-serif"
        textLength="1263.3"
        lengthAdjust="spacingAndGlyphs"
      >
        HYPER
      </text>
    </svg>
  );
}

const NAV = [
  { href: "/", label: "Index", extra: " js-nav-home", hoverStyle: undefined },
  { href: "/projects", label: "Gallery", extra: "", hoverStyle: { paddingLeft: "0.1rem" } },
  { href: "/contact", label: "Contact", extra: " js-nav-contact", hoverStyle: undefined },
];

function Header() {
  return (
    <header className="header fixed d-flex items-center w-1/1 p-1 px-2@sm z-80 justify-center justify-between@sm">
      <div className="header__logo d-flex absolute relative@sm items-center flex-no-shrink h-1/1 pointer-events-none">
        <a href="/" className="d-block pointer-events-auto" data-cursor="hide" title="Hyper Home">
          <Logo />
        </a>
      </div>
      <div className="d-flex justify-end items-center w-1/1 w-auto@sm js-navigation">
        <nav className="overflow-hidden d-block js-nav-inner" data-cursor="navWrapper">
          <div className="d-none d-flex@sm align-center justify-end">
            {NAV.map((n) => (
              <a
                key={n.href}
                href={n.href}
                className={"nav-item js-nav-item" + n.extra}
                data-cursor="navItem"
                data-audio-enter="audio.ratchet"
                aria-label={n.label}
                title={n.label}
              >
                <div className="relative">
                  <div className="nav-item__text t-lh-1.1 t-1.2 js-nav-item-text">{n.label}</div>
                  <div
                    className="nav-item__text--hover t-lh-0.9 absolute t-serif t-1.3 t-italic js-nav-item-hover-text"
                    style={n.hoverStyle}
                  >
                    {n.label}
                  </div>
                </div>
              </a>
            ))}
          </div>
        </nav>
        <button
          className="btn btn--circle menu-btn d-flex js-menu-toggle"
          data-cursor="hide"
          data-audio-enter="audio.hover"
        >
          <span className="sr">Toggle Menu</span>
          <div className="btn__bg absolute d-block menu-btn__bg js-menu-toggle-bg"></div>
          <svg viewBox="0 0 14 5" className="btn__icon menu-btn__icon relative js-menu-icon" fill="none">
            <circle cx="2.4" className="js-menu-icon-circle" cy="2.4" r="2.4" fill="#212121" />
            <circle cx="11.6" className="js-menu-icon-circle" cy="2.4" r="2.4" fill="#212121" />
          </svg>
          <div className="btn__inner menu-btn__inner absolute">
            <span className="btn__inner-bg menu-btn__inner-bg js-menu-toggle-inner-bg"></span>
            <svg className="btn__inner-icon menu-btn__inner-icon js-menu-toggle-inner-icon">
              <use href="#close"></use>
            </svg>
          </div>
        </button>
      </div>
    </header>
  );
}

const MENU = [
  { href: "/", label: "Index", num: "01", extra: " js-nav-home", serif: true },
  { href: "/projects", label: "Gallery", num: "02", extra: "", serif: true },
  { href: "/contact", label: "Contact", num: "03", extra: " js-nav-contact", serif: true },
];

const SOCIALS = [
  { label: "GitHub", href: "https://github.com/MatthewKim323/hyper." },
];

function ArrowLabel({ children }: { children: React.ReactNode }) {
  return (
    <span>
      <span>
        <span>{"⮡ "}</span>
      </span>
      {children}
    </span>
  );
}

function Menu() {
  return (
    <>
      <div className="menu open overflow-hidden fixed z-70 h-1/1 js-menu">
        <div className="menu__inner absolute h-1/1 d-flex justify-center justify-start@lg items-center js-menu-inner">
          <div className="menu__nav d-flex items-start w-auto w-1/1@lg">
            {MENU.map((m) => (
              <a
                key={m.href}
                href={m.href}
                className={"menu__nav-item relative d-flex items-start js-menu-item" + m.extra}
                data-cursor="hide"
                aria-label={m.label}
                title={m.label}
              >
                <span className="menu__nav-number js-menu-number">{m.num}</span>
                <span className="menu__text t-ls-tighter relative js-menu-text">
                  {m.label}
                  <span className="menu__underline js-active-underline"></span>
                </span>
                <span
                  className={(m.serif ? "t-serif " : "") + "t-italic t-ls-tighter menu__hover-text js-menu-hover-text"}
                >
                  {m.label}
                </span>
              </a>
            ))}
          </div>
          <div className="menu__footer absolute d-flex justify-between items-end">
            <div>
              <a
                className="d-block arrow-link js-menu-link"
                data-audio-enter="audio.ratchet"
                href="mailto:founders@kalilabs.ai"
                data-cursor="hide"
              >
                <ArrowLabel>founders@kalilabs.ai</ArrowLabel>
              </a>
            </div>
            <div className="overflow-hidden">
              {SOCIALS.map((s) => (
                <a
                  key={s.label}
                  className="social-link arrow-link js-social-links"
                  data-audio-enter="audio.ratchet"
                  href={s.href}
                  rel="noopener noreferrer"
                  target="_blank"
                  data-cursor="hide"
                >
                  <ArrowLabel>{s.label}</ArrowLabel>
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="fixed fill z-40 js-menu-wrapper" style={{ display: "none" }}></div>
    </>
  );
}

function Cursor() {
  return (
    <div className="cursor js-cursor">
      <div className="cursor__wrap js-cursor-wrap">
        <div className="cursor__inner js-cursor-inner">
          <span className="cursor__circle absolute fill js-cursor-circle"></span>
        </div>
        <span className="cursor__hold absolute fill">
          <span className="cursor__hold-inner absolute fill js-cursor-hold-inner"></span>
          <span className="cursor__hold-outer absolute fill js-cursor-hold-outer"></span>
        </span>
        <span className="cursor__video video-indicator video-indicator--cursor absolute fill">
          <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
            <circle cx="50" cy="50" r="49" className="video-indicator__outer js-cursor-video-outer"></circle>
            <g className="js-cursor-video-icon">
              <path
                className="js-cursor-video-play"
                d="M58,49.1c0.7,0.4,0.7,1.3,0,1.7l-14.2,8.2c-0.7,0.4-1.5-0.1-1.5-0.9V41.8c0-0.8,0.8-1.3,1.5-0.9L58,49.1z"
                fill="#040404"
              />
              <g className="js-cursor-video-pause">
                <path d="M47.1,38.5h-4.2c-0.7,0-1.2,0.6-1.2,1.2v17.5c0,0.7,0.6,1.2,1.2,1.2h4.2c0.7,0,1.2-0.6,1.2-1.2V39.7 C48.3,39.1,47.8,38.5,47.1,38.5z" />
                <path d="M57.1,38.5h-4.2c-0.7,0-1.2,0.6-1.2,1.2v17.5c0,0.7,0.6,1.2,1.2,1.2h4.2c0.7,0,1.2-0.6,1.2-1.2V39.7 C58.3,39.1,57.8,38.5,57.1,38.5z" />
              </g>
            </g>
          </svg>
        </span>
        <span className="cursor__click-hold-prompt absolute fill | js-cursor-click-hold-prompt">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <line x1="14" y1="25" x2="34" y2="25" strokeWidth="2" />
            <line opacity="0.4" x1="16" y1="20" x2="32" y2="20" strokeWidth="2" />
            <line opacity="0.4" x1="16" y1="30" x2="32" y2="30" strokeWidth="2" />
            <circle cx="24" cy="24" r="23.5" />
          </svg>
          <span>
            <span>Click &amp; Hold</span>
          </span>
        </span>
        <span className="absolute fill cursor__drag | js-cursor-drag">
          <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
            <circle cx="50" cy="50" r="49" className="video-indicator__outer"></circle>
          </svg>
          <svg
            className="cursor__drag__arrows"
            width="46"
            height="10"
            viewBox="0 0 46 10"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M14.1667 5.625H2.15333L5.32667 9.125L4.53333 10L0 5L4.53333 0L5.32667 0.875L2.15333 4.375H14.1667V5.625Z"
              fill="black"
            />
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M31.0001 4.375L43.0134 4.375L39.8401 0.875L40.6334 -3.96317e-07L45.1667 5L40.6334 10L39.8401 9.125L43.0134 5.625L31.0001 5.625L31.0001 4.375Z"
              fill="black"
            />
          </svg>
        </span>
        <span className="absolute fill cursor__progress | js-cursor-progress">
          <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
            <circle className="video-indicator__inner" cx="50" cy="50" r="39" stroke="#EAEAEA" />
            <circle
              className="video-indicator__progress js-cursor-progress-ring"
              style={{ transformOrigin: "center center" }}
              transform="rotate(-90)"
              cx="50"
              cy="50"
              r="39"
              stroke="#6D6D6D"
              strokeDasharray="244px"
              strokeDashoffset="244px"
            />
          </svg>
        </span>
      </div>
    </div>
  );
}

function Footer() {
  return (
    <div className="footer">
      <button
        className="btn btn--circle d-flex mute-btn js-mute mute-btn--global z-60 js-global-mute-btn"
        data-cursor="hide"
        data-audio-enter="audio.hover"
      >
        <span className="sr">Toggle Sound</span>
        <div className="btn__bg mute-btn__bg absolute d-block js-mute-bg"></div>
        <svg
          className="btn__icon mute-btn__icon absolute fill js-mute-icon"
          version="1.1"
          xmlns="http://www.w3.org/2000/svg"
          x="0px"
          y="0px"
          viewBox="0 0 18 16"
          enableBackground="new 0 0 18 16"
          xmlSpace="preserve"
        >
          <line className="mute-btn__icon-line js-sound-line" strokeWidth="2" x1="1" y1="0" x2="1" y2="16" />
          <line className="mute-btn__icon-line js-sound-line" strokeWidth="2" x1="13" y1="0" x2="13" y2="16" />
          <line className="mute-btn__icon-line js-sound-line" strokeWidth="2" x1="5" y1="0" x2="5" y2="16" />
          <line className="mute-btn__icon-line js-sound-line" strokeWidth="2" x1="17" y1="0" x2="17" y2="16" />
          <line className="mute-btn__icon-line js-sound-line" strokeWidth="2" x1="9" y1="0" x2="9" y2="16" />
        </svg>
        <div className="btn__inner mute-btn__inner absolute">
          <span className="btn__inner-bg mute-btn__fill absolute fill js-mute-fill"></span>
        </div>
      </button>
      <div className="footer__cta z-50 fixed d-flex justify-center justify-start@md js-footer-cta">
        <a
          href="https://github.com/MatthewKim323/hyper."
          target="_blank"
          rel="noopener noreferrer"
          title="Explore Hyper on GitHub"
          className="btn btn--regular btn--border btn--light js-rebrand-btn js-btn"
          data-btn="border"
          data-cursor="hide"
        >
          <span className="btn__inner js-btn-inner">
            <span className="btn__content js-btn-content">
              <span className="d-flex flex-row items-end">
                <span className="btn__text">Explore on GitHub</span>
              </span>
            </span>
          </span>
        </a>
      </div>
      <div className="footer__cr z-50 fixed d-none d-block@md js-footer-cr">&#169;2026</div>
    </div>
  );
}

export default function Shell() {
  return (
    <>
      <Sprite />
      <Loader />
      <NakedLoader />
      <Header />
      <Menu />
      <Cursor />
      <Footer />
    </>
  );
}

const WORKSPACE_SECTIONS: [string, string][] = [
  ["overview", "Overview"],
  ["cases", "Cases"],
  ["evidence", "Evidence"],
  ["activity", "Activity"],
  ["review", "Review"],
];

// Post-main globals. Gl creates the CSS3D layer and appends it to <body>.
export function ShellPost() {
  return (
    <>
      <div className="fixed fill w-1/1 h-1/1 z-40 user-select-none pointer-events-none">
        <canvas id="gl"></canvas>
      </div>
      <div className="project-filters | js-project-filters" style={{ visibility: "hidden", opacity: 0 }}>
        <div className="project-filters__overlay js-project-filters:overlay"></div>
        <nav className="project-filters__inner | js-project-filters-inner" aria-label="Workspace sections">
          <div className="project-filters__filter | js-project-filters:filter">
            <div className="project-filters__filter__bg | pointer-events-none | js-project-filters:filterBg"></div>
            <button
              type="button"
              className="project-filters__filter__toggle d-none@md | js-project-filters:toggle"
              aria-controls="workspace-section-list"
              aria-expanded="false"
              aria-label="Workspace sections, selected: Overview"
            >
              Sections
              <svg className="project-filters__filter__chevron js-project-filters:chevron">
                <use href="#chevron-down"></use>
              </svg>
            </button>
            <div id="workspace-section-list" className="project-filters__filter__list | js-project-filters:filterList">
              {WORKSPACE_SECTIONS.map(([f, label], i) => (
                <button
                  key={f}
                  id={`workspace-section-${f}`}
                  type="button"
                  data-filter={f}
                  data-label={label}
                  aria-pressed={i === 0}
                  className={
                    "project-filters__filter__button | " + (i === 0 ? "is-active " : "") + "js-project-filters:filterBtn"
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </nav>
      </div>
      <PersistentContent />
      <div id="p-cover"></div>
      <div className="asscrollbar">
        <div className="asscrollbar__handle">
          <div></div>
        </div>
      </div>
      <div className="height-div"></div>
    </>
  );
}
