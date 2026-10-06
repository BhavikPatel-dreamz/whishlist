function HelpIllustration({ support = false }: { support?: boolean }) {
  return (
    <svg
      className="ws-help-illustration"
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
    >
      {support ? (
        <>
          <path
            d="M9 25v-7a15 15 0 0 1 30 0v7M38 32v3a7 7 0 0 1-7 7h-6"
            stroke="#444b68"
            strokeWidth="1.4"
          />
          <rect
            x="5"
            y="20"
            width="7"
            height="14"
            rx="3"
            fill="#fff"
            stroke="#444b68"
            strokeWidth="1.4"
          />
          <rect
            x="36"
            y="20"
            width="7"
            height="14"
            rx="3"
            fill="#fff"
            stroke="#444b68"
            strokeWidth="1.4"
          />
          <path
            d="m24 15 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2-4.5-4.4 6.2-.9L24 15Z"
            fill="#a5df63"
          />
          <rect x="20" y="40" width="9" height="3" rx="1.5" fill="#444b68" />
          <path
            d="M21 4h6"
            stroke="#444b68"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </>
      ) : (
        <>
          <rect
            x="13"
            y="7"
            width="29"
            height="36"
            rx="3"
            fill="#fff"
            stroke="#444b68"
            strokeWidth="1.4"
          />
          <rect
            x="11"
            y="3"
            width="27"
            height="36"
            rx="2"
            fill="#fff"
            stroke="#444b68"
            strokeWidth="1.4"
          />
          <path
            d="M22 13a3 3 0 1 1 4.6 2.5c-1.1.6-1.6 1.2-1.6 2.5"
            stroke="#444b68"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          <circle cx="25" cy="21" r=".9" fill="#444b68" />
          <path
            d="m5 23 6-3v3"
            fill="#a5df63"
            stroke="#444b68"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <rect
            x="4"
            y="23"
            width="32"
            height="16"
            rx="1.5"
            fill="#a5df63"
            stroke="#444b68"
            strokeWidth="1.4"
          />
          <path
            d="M11 29h18M11 33h12"
            stroke="#444b68"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  );
}

export function DashboardHelp() {
  return (
    <>
      <section className="ws-help-grid" aria-label="Help and support">
        <article className="ws-help-card">
          <div className="ws-help-content">
            <h2 className="ws-help-title">Need Help?</h2>
            <p className="ws-help-description">
              Please email us at{" "}
              <a className="ws-help-email" href="mailto:support@getswym.com">
                support@getswym.com
              </a>
              . We will respond to you within 24-48 hours
            </p>
            <a className="ws-help-button" href="mailto:support@getswym.com">
              Get Help <span aria-hidden="true">→</span>
            </a>
          </div>
          <HelpIllustration support />
        </article>
        <article className="ws-help-card">
          <div className="ws-help-content">
            <h2 className="ws-help-title">Visit Knowledge Base</h2>
            <p className="ws-help-description">
              Everything from enabling features to optimizing your store. Find
              guides, tutorials, and best practices.
            </p>
            <a
              className="ws-help-button"
              href="https://help.swym.it/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Go to knowledge Base <span aria-hidden="true">→</span>
            </a>
          </div>
          <HelpIllustration />
        </article>
      </section>
    </>
  );
}
