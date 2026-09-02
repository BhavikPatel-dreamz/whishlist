import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  BlockStack,
  InlineStack,
  Checkbox,
  Select,
  Button,
  RadioButton,
  Banner,
  Box,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { useEffect, useState } from "react";
import { authenticate, unauthenticated } from "../shopify.server";
import { requireShop } from "../lib/shop.server";
import {
  getUIConfigByShopDomain,
  upsertUIConfigForShopDomain,
} from "../models/ui-config.server";
import {
  defaultProductCardConfig,
  isExtensionActive,
  type ExtensionActive,
  type ProductCardConfig,
} from "../lib/ui-config.shared";
import { formatMoney, getFirstProduct } from "../lib/shopify-data.server";
import ProductCard, { type Product } from "../components/ProductCard";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await requireShop(session.shop);

  const view =
    (await getUIConfigByShopDomain(session.shop)) || {
      extensionActive: "none" as ExtensionActive,
      productCardConfig: defaultProductCardConfig(),
    };

  let previewProduct: Product | null = null;
  try {
    const { admin } = await unauthenticated.admin(session.shop);
    const first = await getFirstProduct(admin as never);
    if (first) {
      const firstVariant = first.variants[0];
      previewProduct = {
        id: first.productId,
        title: first.title,
        handle: first.handle,
        image: firstVariant?.imageUrl ?? first.imageUrl ?? null,
        sku: firstVariant?.sku ?? null,
        price: formatMoney(first.minPrice, first.currencyCode),
        available: first.availableForSale,
        variantTitle:
          firstVariant && firstVariant.title !== "Default Title"
            ? firstVariant.title
            : null,
      };
    }
  } catch {
    /* preview is best-effort */
  }

  return { config: view, previewProduct };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await requireShop(session.shop);
  const formData = await request.formData();

  const extensionActiveRaw = String(formData.get("extensionActive") || "none");
  const extensionActive: ExtensionActive = isExtensionActive(extensionActiveRaw)
    ? (extensionActiveRaw as ExtensionActive)
    : "none";

  const checked = (name: string) => formData.get(`pc_${name}`) === "on";

  const productCardConfig: Partial<ProductCardConfig> = {
    displayTitle: checked("displayTitle"),
    displayPrice: checked("displayPrice"),
    displaySKU: checked("displaySKU"),
    displayImage: checked("displayImage"),
    displayVariant: checked("displayVariant"),
    imageSize: (String(formData.get("imageSize") || "medium") as ProductCardConfig["imageSize"]),
    layout: (String(formData.get("layout") || "horizontal") as ProductCardConfig["layout"]),
    showAddToCart: checked("showAddToCart"),
    showWishlistButton: checked("showWishlistButton"),
    showBackInStockButton: checked("showBackInStockButton"),
  };

  await upsertUIConfigForShopDomain(session.shop, {
    extensionActive,
    productCardConfig,
  });
  return { saved: true };
};

function ActiveExtensionPicker({
  value,
  onChange,
}: {
  value: ExtensionActive;
  onChange: (value: ExtensionActive) => void;
}) {
  const options: Array<{ value: ExtensionActive; label: string }> = [
    { value: "none", label: "None (disable both)" },
    { value: "wishlist", label: "Wishlist only" },
    { value: "back_in_stock", label: "Back-in-Stock only" },
    { value: "both", label: "Both extensions" },
  ];
  return (
    <BlockStack gap="200">
      {options.map((option) => (
        <RadioButton
          key={option.value}
          label={option.label}
          name="extensionActive"
          value={option.value}
          checked={value === option.value}
          onChange={() => onChange(option.value)}
        />
      ))}
    </BlockStack>
  );
}

export default function Customise() {
  const { config, previewProduct } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";
  const shopify = useAppBridge();

  const [extensionActive, setExtensionActive] = useState<ExtensionActive>(
    config.extensionActive,
  );
  const [cfg, setCfg] = useState<ProductCardConfig>({
    ...defaultProductCardConfig(),
    ...config.productCardConfig,
  });

  useEffect(() => {
    if (actionData?.saved) {
      shopify.toast.show("Customization saved");
    }
  }, [actionData, shopify]);

  const setField = <K extends keyof ProductCardConfig>(key: K, value: ProductCardConfig[K]) => {
    setCfg((prev) => ({ ...prev, [key]: value }));
  };

  const noProductNotice = !previewProduct ? (
    <Banner tone="info">
      No products found yet in this store — the preview shows a placeholder card.
    </Banner>
  ) : null;

  const previewProductData: Product = previewProduct || {
    id: "1",
    title: "Sample Product",
    handle: "sample-product",
    image: null,
    sku: "SMP-001",
    price: "$29.00",
    available: true,
  };

  return (
    <Page>
      <TitleBar title="Customize" />
      <Form method="post">
        <BlockStack gap="500">
          {noProductNotice}

          <Layout>
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Active extensions
                  </Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Choose which extension runs on the storefront. They are installed as
                    two separate theme extensions and can also be toggled independently in
                    the theme editor.
                  </Text>
                  <ActiveExtensionPicker
                    value={extensionActive}
                    onChange={(value) => setExtensionActive(value)}
                  />
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>

          <Layout>
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Product card fields
                  </Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Choose which fields appear on product cards (wishlist page and drawer).
                  </Text>
                  <InlineStack gap="300" wrap>
                    <Checkbox
                      label="Title"
                      checked={cfg.displayTitle !== false}
                      onChange={(checked) => setField("displayTitle", checked)}
                      name="pc_displayTitle"
                    />
                    <Checkbox
                      label="Price"
                      checked={cfg.displayPrice !== false}
                      onChange={(checked) => setField("displayPrice", checked)}
                      name="pc_displayPrice"
                    />
                    <Checkbox
                      label="SKU"
                      checked={cfg.displaySKU === true}
                      onChange={(checked) => setField("displaySKU", checked)}
                      name="pc_displaySKU"
                    />
                    <Checkbox
                      label="Image"
                      checked={cfg.displayImage !== false}
                      onChange={(checked) => setField("displayImage", checked)}
                      name="pc_displayImage"
                    />
                    <Checkbox
                      label="Variant"
                      checked={cfg.displayVariant !== false}
                      onChange={(checked) => setField("displayVariant", checked)}
                      name="pc_displayVariant"
                    />
                  </InlineStack>

                  <InlineStack gap="300" wrap>
                    <Box width="220px">
                      <Select
                        label="Card layout"
                        name="layout"
                        value={cfg.layout || "horizontal"}
                        onChange={(value) => setField("layout", value as ProductCardConfig["layout"])}
                        options={[
                          { label: "Horizontal (image left)", value: "horizontal" },
                          { label: "Grid (vertical card)", value: "grid" },
                          { label: "List (full-width row)", value: "list" },
                          { label: "Compact", value: "compact" },
                        ]}
                      />
                    </Box>
                    <Box width="220px">
                      <Select
                        label="Image size"
                        name="imageSize"
                        value={cfg.imageSize || "medium"}
                        onChange={(value) => setField("imageSize", value as ProductCardConfig["imageSize"])}
                        options={[
                          { label: "Small", value: "small" },
                          { label: "Medium", value: "medium" },
                          { label: "Large", value: "large" },
                        ]}
                      />
                    </Box>
                  </InlineStack>

                  <InlineStack gap="300" wrap>
                    <Checkbox
                      label="Show 'Add to cart' button"
                      checked={cfg.showAddToCart !== false}
                      onChange={(checked) => setField("showAddToCart", checked)}
                      name="pc_showAddToCart"
                    />
                    <Checkbox
                      label="Show wishlist heart"
                      checked={cfg.showWishlistButton !== false}
                      onChange={(checked) => setField("showWishlistButton", checked)}
                      name="pc_showWishlistButton"
                    />
                    <Checkbox
                      label="Show 'Notify me' (out of stock)"
                      checked={cfg.showBackInStockButton === true}
                      onChange={(checked) => setField("showBackInStockButton", checked)}
                      name="pc_showBackInStockButton"
                    />
                  </InlineStack>
                </BlockStack>
              </Card>
            </Layout.Section>

            <Layout.Section variant="oneThird">
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Live preview
                  </Text>
                  <ProductCard product={previewProductData} config={cfg} />
                  <Text as="p" variant="bodyXs" tone="subdued">
                    {previewProduct
                      ? "Showing your first product — updates as you change the options."
                      : "Placeholder preview."}
                  </Text>
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>

          <Layout>
            <Layout.Section>
              <InlineStack align="end">
                <Button submit variant="primary" loading={isSaving}>
                  Save customization
                </Button>
              </InlineStack>
            </Layout.Section>
          </Layout>
        </BlockStack>
      </Form>
    </Page>
  );
}