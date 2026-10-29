import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useNavigation, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import themeStyles from "../styles/theme.css?url";
import dashboardStyles from "../components/DashboardHome.css?url";
import dashboardHelpStyles from "../components/DashboardHelp.css?url";
import analyticsMetricsStyles from "../components/AnalyticsMetrics.css?url";
import adminPageStyles from "../components/AdminPage.css?url";

import { authenticate } from "../shopify.server";
import { syncShopSubscription, recordPlanHandle } from "../lib/billing/sync-subscription.server";

export const links = () => [
  { rel: "stylesheet", href: polarisStyles },
  { rel: "stylesheet", href: themeStyles },
  { rel: "stylesheet", href: dashboardStyles },
  { rel: "stylesheet", href: dashboardHelpStyles },
  { rel: "stylesheet", href: analyticsMetricsStyles },
  { rel: "stylesheet", href: adminPageStyles },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const planHandle = new URL(request.url).searchParams.get("plan_handle");
  await syncShopSubscription({
    admin,
    shopDomain: session.shop,
    force: Boolean(planHandle),
  }).catch(() => {});
  if (planHandle) await recordPlanHandle(session.shop, planHandle).catch(() => {});

  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isNavigating = navigation.state === "loading" || navigation.state === "submitting";

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">
          Dashboard
        </Link>
        {/* Back-in-Stock Requests are part of Analytics → Back in Stock → Stock List */}
        <Link to="/app/analytics">Analytics</Link>
        <Link to="/app/settings">Configurations</Link>
        <Link to="/app/dev/email-test">Email test</Link>
      </NavMenu>
      <div className="ws-admin-pages">
        {isNavigating ? (
          <div className="ws-admin-page-loader" role="status" aria-live="polite" aria-label="Page loading">
            <span className="ws-admin-page-loader__spinner" aria-hidden="true" />
          </div>
        ) : null}
        <Outlet />
      </div>
    </AppProvider>
  );
}

// Shopify needs Remix to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
