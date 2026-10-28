import type { LoaderFunctionArgs } from "@remix-run/node";
import {
  AppProvider as PolarisAppProvider,
  Card,
  FormLayout,
  Page,
  Text,
} from "@shopify/polaris";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import themeStyles from "../../styles/theme.css?url";
import { useLoaderData } from "@remix-run/react";

import { login } from "../../shopify.server";

export const links = () => [
  { rel: "stylesheet", href: polarisStyles },
  { rel: "stylesheet", href: themeStyles },
];

/**
 * When `shop` is present (CLI / Admin deep link), start OAuth immediately.
 * No free-form shop-domain field (App Store 2.3.1 + automated install checks).
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) {
    await login(request);
  }
  return { polarisTranslations };
};

export default function Auth() {
  const { polarisTranslations: i18n } = useLoaderData<typeof loader>();

  return (
    <PolarisAppProvider i18n={i18n}>
      <Page>
        <Card>
          <FormLayout>
            <Text variant="headingMd" as="h2">
              Install from Shopify
            </Text>
            <Text as="p">
              Wishlist Stock Notify must be installed from the Shopify App Store
              or Shopify admin. Shop domains are not entered here.
            </Text>
          </FormLayout>
        </Card>
      </Page>
    </PolarisAppProvider>
  );
}
