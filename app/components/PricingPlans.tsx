import { useRef, useState } from "react";

const plans = [
  {
    name: "Pro",
    monthly: "59.99",
    annual: "599.99",
    description:
      "For ambitious brands ready to go beyond the basics and maximize wishlist-driven revenue.",
    actions: "10,000 wishlist actions per month",
    stored: "50,000 lifetime stored items",
    highlights: [
      "Meta ads retargeting",
      "Customer segments",
      "Wishlist summary alerts",
      "Klaviyo, Attentive, Tapcart, Omnisend",
      "Email + Chat Support",
    ],
    note: "Best $/wishlist action when you're scaling",
  },
  {
    name: "Premium",
    monthly: "99.99",
    annual: "999.99",
    description:
      "For large brands needing API access to further tailor their Wishlist experience.",
    actions: "25,000 wishlist actions per month",
    stored: "125,000 lifetime stored items",
    highlights: [
      "REST API access",
      "JavaScript SDK",
      "Custom data models",
      "Advanced configuration",
      "24×5 Support · <4 hour response",
    ],
    note: "Make the wishlist look, feel, and behave your way",
  },
  {
    name: "Enterprise",
    monthly: null,
    annual: null,
    description:
      "For high-growth Shopify Plus brands with global storefronts and complex stacks.",
    actions: "250,000+ Monthly Wishlist Actions",
    stored: null,
    highlights: [
      "Enterprise ESP integrations",
      "Shopify Markets support",
      "Custom Webhooks",
      "Enterprise Security & compliance",
      "Premium hosting infrastructure",
      "Dedicated Customer Support Manager",
      "24×7 Support · <2 hour response",
    ],
    note: "",
  },
];

const comparison = [
  {
    group: "Capture Shopper Intent",
    rows: [
      "Add to Wishlist",
      "View Customer Wishlists",
      "Collections & Quick View Support",
      "Email Opt-Ins",
    ],
  },
  {
    group: "Nudge Shoppers back to your Store",
    rows: [
      "Share Wishlist",
      "3rd Party Integrations",
      "Automated Alerts",
      "Retargeting (Facebook & Instagram)",
    ],
  },
  {
    group: "Tailoring Shopper Experience",
    rows: ["Shopify POS", "REST & JavaScript API Customization"],
  },
  { group: "Support", rows: ["24×5 Support", "Lifetime Wishlist Actions"] },
];

function PricingArt({ support = false }: { support?: boolean }) {
  return (
    <svg
      className="ws-pricing-art"
      viewBox="0 0 112 112"
      fill="none"
      aria-hidden="true"
    >
      {support ? (
        <>
          <rect width="112" height="112" rx="14" fill="#95d1ff" />
          <path d="M29 48a30 30 0 0 1 60 0v4H29z" fill="white" />
          <path d="M25 52h68v4H25zM56 15h7v4h-7z" fill="#073b52" />
          <path
            d="m0 89 35-8 18-19 9 3-7 13 20-17 6 5-27 30-19 7L0 112z"
            fill="white"
          />
          <path d="m0 83 31-5 7 28-38 6z" fill="#003a50" />
        </>
      ) : (
        <>
          <circle cx="60" cy="56" r="44" fill="#f1f2f3" />
          <path d="M13 21h83v34H13z" fill="#e9ab48" />
          <path d="M17 25h75v26H17z" stroke="#ffe4ac" strokeWidth="2" />
          <text x="24" y="45" fill="white" fontSize="25" fontWeight="700">
            %
          </text>
          <path
            d="M72 18v41"
            stroke="white"
            strokeWidth="2"
            strokeDasharray="3 3"
          />
          <path d="m48 90 22-67M80 89 56 16" stroke="#879798" strokeWidth="5" />
          <circle cx="47" cy="92" r="10" stroke="#2a9b91" strokeWidth="5" />
          <circle cx="81" cy="93" r="10" stroke="#178579" strokeWidth="5" />
        </>
      )}
    </svg>
  );
}

export function PricingPlans() {
  const [annual, setAnnual] = useState(false);
  const [discount, setDiscount] = useState("");
  const [discountMessage, setDiscountMessage] = useState("");
  const [preview, setPreview] = useState({ title: "", description: "" });
  const dialog = useRef<HTMLDialogElement>(null);
  const showPreview = (title: string, description: string) => {
    setPreview({ title, description });
    dialog.current?.showModal();
  };
  const contact = () =>
    showPreview(
      "Let's find the right plan",
      "Meeting bookings and support contact options will be available when subscriptions launch.",
    );

  return (
    <div className="ws-pricing">
      <div className="ws-pricing-top">
        <p className="ws-pricing-preview-note">
          Pricing preview · Subscriptions are not available yet.
        </p>
        <div
          className="ws-pricing-cycle"
          role="group"
          aria-label="Billing period"
        >
          <button
            type="button"
            aria-pressed={!annual}
            onClick={() => setAnnual(false)}
          >
            Monthly
          </button>
          <button
            type="button"
            aria-pressed={annual}
            onClick={() => setAnnual(true)}
          >
            Annual <span>17% off</span>
          </button>
        </div>
      </div>

      <section className="ws-pricing-plans" aria-label="Available plans">
        {plans.map((plan) => (
          <article className="ws-pricing-card" key={plan.name}>
            <h2>
              {plan.name === "Enterprise" && <span aria-hidden="true">♙ </span>}
              {plan.name}
            </h2>
            <p className="ws-pricing-description">{plan.description}</p>
            <p className="ws-pricing-price" aria-live="polite">
              <strong>
                {plan.monthly
                  ? `$${annual ? plan.annual : plan.monthly}`
                  : "Custom Pricing"}
              </strong>
              {plan.monthly && <span>USD / {annual ? "year" : "month"}</span>}
            </p>
            <div className="ws-pricing-limits">
              <span>{plan.actions}</span>
              {plan.stored && <span>{plan.stored}</span>}
            </div>
            <p className="ws-pricing-highlights-label">Key highlights:</p>
            <ul>
              {plan.highlights.map((item) => (
                <li key={item}>
                  <span aria-hidden="true">✓</span>
                  {item}
                </li>
              ))}
            </ul>
            {plan.note && <p className="ws-pricing-plan-note">{plan.note}</p>}
            <div className="ws-pricing-card-action">
              <button
                type="button"
                className={`ws-pricing-button ${plan.monthly ? "" : "ws-pricing-button-primary"}`}
                onClick={() =>
                  plan.monthly
                    ? showPreview(
                        `${plan.name} · ${annual ? "Annual" : "Monthly"}`,
                        `$${annual ? plan.annual : plan.monthly} USD per ${annual ? "year" : "month"}. ${plan.actions}. ${plan.stored}.`,
                      )
                    : contact()
                }
              >
                {plan.monthly ? "Choose plan" : "Schedule a Meeting"}
              </button>
            </div>
          </article>
        ))}
      </section>

      <section
        className="ws-pricing-panel ws-pricing-discount"
        aria-labelledby="discount-title"
      >
        <div>
          <h2 id="discount-title">Apply Discount Code</h2>
          <p>
            Enter your discount code to activate special pricing for your store
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setDiscountMessage(
                discount.trim()
                  ? "Discount codes will be available when subscriptions launch. No discount has been applied."
                  : "Enter a discount code.",
              );
            }}
          >
            <label className="ws-pricing-sr-only" htmlFor="pricing-discount">
              Discount code
            </label>
            <input
              id="pricing-discount"
              value={discount}
              onChange={(event) => {
                setDiscount(event.target.value);
                setDiscountMessage("");
              }}
              placeholder="Enter discount code"
              aria-describedby="pricing-discount-status"
            />
            <button className="ws-pricing-button" type="submit">
              Apply
            </button>
          </form>
          <p id="pricing-discount-status" role="status">
            {discountMessage}
          </p>
        </div>
        <PricingArt />
      </section>

      <section
        className="ws-pricing-panel ws-pricing-help"
        aria-label="Plan selection help"
      >
        <PricingArt support />
        <div>
          <h3>
            Not sure which plan suits you? Talk to our experts - we’ll help you:
          </h3>
          <ul>
            <li>✓ &nbsp; Define goals</li>
            <li>✓ &nbsp; Select key features</li>
            <li>✓ &nbsp; Engage your customers</li>
          </ul>
          <button className="ws-pricing-button" type="button" onClick={contact}>
            Start a chat!
          </button>
        </div>
      </section>
      <div className="ws-pricing-contact">
        Looking for a customized plan for your business?{" "}
        <button type="button" onClick={contact}>
          Contact Us
        </button>
      </div>

      <section
        className="ws-pricing-comparison"
        aria-label="Compare all plans"
        tabIndex={0}
      >
        <table>
          <caption className="ws-pricing-sr-only">
            Pro and Premium plan comparison
          </caption>
          <thead>
            <tr>
              <th scope="col">All Plans</th>
              <th scope="col">
                Pro<small>Full-featured wishlist for maximum engagement</small>
              </th>
              <th scope="col">
                Premium
                <small>
                  For brands customizing the wishlist to fit their stack
                </small>
              </th>
            </tr>
          </thead>
          {comparison.map(({ group, rows }) => (
            <tbody key={group}>
              <tr className="ws-pricing-group">
                <th colSpan={3} scope="rowgroup">
                  {group}
                </th>
              </tr>
              {rows.map((row) => (
                <tr key={row}>
                  <th scope="row">{row}</th>
                  <td>
                    {row === "Lifetime Wishlist Actions" ? (
                      "50,000"
                    ) : row === "REST & JavaScript API Customization" ? (
                      <span aria-label="Not included">—</span>
                    ) : (
                      <span aria-label="Included">✓</span>
                    )}
                  </td>
                  <td>
                    {row === "Lifetime Wishlist Actions" ? (
                      "125,000"
                    ) : (
                      <span aria-label="Included">✓</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </section>
      <dialog
        ref={dialog}
        className="ws-pricing-dialog"
        aria-labelledby="pricing-preview-title"
        aria-describedby="pricing-preview-description"
      >
        <h2 id="pricing-preview-title">{preview.title}</h2>
        <p id="pricing-preview-description">{preview.description}</p>
        <p>
          This is a preview. No subscription will be created and no payment will
          be taken.
        </p>
        <form method="dialog">
          <button className="ws-pricing-button ws-pricing-button-primary">
            Close
          </button>
        </form>
      </dialog>
    </div>
  );
}
