import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import dashboardStyles from "../components/DashboardHome.css?url";
import dashboardHelpStyles from "../components/DashboardHelp.css?url";
import analyticsMetricsStyles from "../components/AnalyticsMetrics.css?url";
import configurationFeaturesStyles from "../components/ConfigurationFeatures.css?url";
import reportsStyles from "../components/Reports.css?url";
import adminPageStyles from "../components/AdminPage.css?url";

import { authenticate } from "../shopify.server";

export const links = () => [
  { rel: "stylesheet", href: polarisStyles },
  { rel: "stylesheet", href: dashboardStyles },
  { rel: "stylesheet", href: dashboardHelpStyles },
  { rel: "stylesheet", href: analyticsMetricsStyles },
  { rel: "stylesheet", href: configurationFeaturesStyles },
  { rel: "stylesheet", href: reportsStyles },
  { rel: "stylesheet", href: adminPageStyles },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">
          Dashboard
        </Link>
        {/* <Link to="/app/alerts">Stock Alerts</Link> */}
        <Link to="/app/analytics">Analytics</Link>
        <Link to="/app/settings">Configurations</Link>
        <Link to="/app/reports">Reports</Link>
      </NavMenu>
      <div className="ws-admin-pages">
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
