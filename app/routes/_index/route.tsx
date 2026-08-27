import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <div className={styles.badge}>Shopify App</div>
        <h1 className={styles.heading}>
          Wishlist &amp; Back-in-Stock
          <br />
          Notifications
        </h1>
        <p className={styles.text}>
          Let shoppers save products they love and get notified the moment
          out-of-stock items come back. Boost repeat traffic and recover
          lost sales — automatically.
        </p>

        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input
                className={styles.input}
                type="text"
                name="shop"
                placeholder="your-store.myshopify.com"
              />
              <span className={styles.hint}>e.g. my-store.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}

        <div className={styles.features}>
          <div className={styles.feature}>
            <div className={styles.featureIcon}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 21s-6.716-4.434-9.333-7.14C-1.333 10.9 1.333 6 6 6c2.76 0 4 2 6 2s3.24-2 6-2c4.667 0 7.333 4.9 3.333 7.86C18.716 16.566 12 21 12 21z" />
              </svg>
            </div>
            <h3>Wishlist Heart Button</h3>
            <p>
              One-click save on product pages and collection cards. Works
              for guests and logged-in customers.
            </p>
          </div>
          <div className={styles.feature}>
            <div className={styles.featureIcon}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </div>
            <h3>Back-in-Stock Alerts</h3>
            <p>
              Capture demand for sold-out items. Automatic email &
              SMS notifications when inventory returns.
            </p>
          </div>
          <div className={styles.feature}>
            <div className={styles.featureIcon}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M3 9h18" />
                <path d="M9 21V9" />
              </svg>
            </div>
            <h3>Merchant Dashboard</h3>
            <p>
              Track demand signals, most-wishlisted products, and
              alert conversion rates — all in your admin.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
