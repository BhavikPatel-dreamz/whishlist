import type { LinksFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Link } from "@remix-run/react";
import { Page, InlineStack, Text } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { PricingPlans } from "../components/PricingPlans";
import pricingStyles from "../components/PricingPlans.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: pricingStyles },
];

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  return null;
}

export default function PricingPage() {
  return (
    <Page fullWidth>
      <TitleBar title="Pricing Plan" />
      <nav aria-label="Breadcrumb">
        <InlineStack gap="200" blockAlign="center">
          <Link to="/app/settings">Configurations</Link>
          <Text as="span" tone="subdued">
            /
          </Text>
          <Text as="span" fontWeight="semibold">
            Pricing Plan
          </Text>
        </InlineStack>
      </nav>
      <PricingPlans />
    </Page>
  );
}
