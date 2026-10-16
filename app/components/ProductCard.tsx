import React from "react";

export type Product = {
  id?: string;
  title?: string;
  handle?: string;
  image?: string | null;
  sku?: string | null;
  price?: string | null;
  variantTitle?: string | null;
  available?: boolean;
};


export type ThemeSettingsType = {
  primaryColor?: string;
  backgroundColor?: string;
  textColor?: string;
  mutedTextColor?: string;
  borderColor?: string;
  borderRadius?: number;
  buttonStyle?: "filled" | "outlined";
};

export type ProductCardConfigState = {
  displayTitle?: boolean;
  displayPrice?: boolean;
  displaySKU?: boolean;
  displayImage?: boolean;
  displayVariant?: boolean;
  imageSize?: "small" | "medium" | "large";
  layout?: "grid" | "list" | "horizontal" | "compact";
  showAddToCart?: boolean;
  showWishlistButton?: boolean;
  showBackInStockButton?: boolean;
  customStyles?: Record<string, string> | null;
};

type Props = {
  product: Product;
  config?: ProductCardConfigState | Record<string, any> | null;
  theme?: ThemeSettingsType | Record<string, any> | null;
};

const IMAGE_SIZES: Record<string, { width: number; height: number }> = {
  small: { width: 56, height: 56 },
  medium: { width: 96, height: 96 },
  large: { width: 140, height: 140 },
};

const DEFAULT_THEME: ThemeSettingsType = {
  primaryColor: "#e74c3c",
  backgroundColor: "#ffffff",
  textColor: "#1a1a1a",
  mutedTextColor: "#6b7280",
  borderColor: "#e5e7eb",
  borderRadius: 8,
  buttonStyle: "filled",
};

export default function ProductCard({ product, config, theme: themeProp }: Props) {
  const t: ThemeSettingsType = { ...DEFAULT_THEME, ...(themeProp || {}) };
  const c: ProductCardConfigState = {
    displayTitle: true,
    displayPrice: true,
    displaySKU: false,
    displayImage: true,
    displayVariant: true,
    imageSize: "medium",
    layout: "grid",
    showAddToCart: true,
    showWishlistButton: true,
    showBackInStockButton: false,
    ...(config || {}),
  };

  const layout = c.layout || "grid";
  const isHorizontal = layout === "horizontal" || layout === "list";
  const isCompact = layout === "compact";
  const imgSize = IMAGE_SIZES[c.imageSize || "medium"];
  const br = t.borderRadius ?? 8;
  const isOutlined = t.buttonStyle === "outlined";

  const imageBox = c.displayImage ? (
    <div
      style={{
        background: "#f6f6f8",
        width: isHorizontal ? imgSize.width : "100%",
        height: isHorizontal ? imgSize.height : isCompact ? 120 : 180,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        overflow: "hidden",
      }}
    >
      {product.image ? (
        <img
          src={product.image}
          alt={product.title || ""}
          style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "cover" }}
        />
      ) : (
        <div style={{ color: "#bbb", fontSize: 12 }}>No image</div>
      )}
    </div>
  ) : null;

  const body = (
    <>
      {c.displayTitle && (
        <div style={{ fontSize: isCompact ? 12 : 14, fontWeight: 600, lineHeight: 1.3, color: t.textColor }}>
          {product.title || "Product"}
        </div>
      )}
      {c.displayVariant && product.variantTitle && (
        <div style={{ fontSize: 12, color: t.mutedTextColor, marginTop: 2 }}>{product.variantTitle}</div>
      )}
      {c.displaySKU && product.sku && (
        <div style={{ fontSize: 12, color: t.mutedTextColor, marginTop: 2 }}>SKU: {product.sku}</div>
      )}
      {c.displayPrice && product.price && (
        <div style={{ marginTop: 6, fontWeight: 700, fontSize: isCompact ? 13 : 15, color: t.textColor }}>
          {product.price}
        </div>
      )}

      {(c.showAddToCart || c.showWishlistButton || c.showBackInStockButton) && (
        <div
          style={{
            marginTop: 10,
            display: "flex",
            gap: 6,
            flexWrap: "wrap",
            flex: 1,
            alignItems: "flex-end",
          }}
        >
          {c.showAddToCart && (
            <button
              style={{
                flex: 1,
                background: isOutlined ? "transparent" : t.primaryColor,
                color: isOutlined ? t.primaryColor : "white",
                border: isOutlined ? `2px solid ${t.primaryColor}` : "none",
                padding: isCompact ? "6px 8px" : "8px 12px",
                borderRadius: br,
                fontSize: 12,
                cursor: "pointer",
                minWidth: 64,
                fontWeight: 600,
              }}
            >
              {product.available === false ? "Sold out" : "Add to Cart"}
            </button>
          )}
          {c.showWishlistButton && (
            <button
              style={{
                background: "transparent",
                border: `1px solid ${t.borderColor}`,
                padding: isCompact ? "6px 8px" : "8px 10px",
                borderRadius: br,
                cursor: "pointer",
                color: t.primaryColor,
              }}
              aria-label="Add to wishlist"
            >
              ♥
            </button>
          )}
          {c.showBackInStockButton && product.available === false && (
            <button
              style={{
                flex: 1,
                background: isOutlined ? "transparent" : t.primaryColor,
                border: isOutlined ? `2px solid ${t.primaryColor}` : "none",
                color: isOutlined ? t.primaryColor : "white",
                padding: isCompact ? "6px 8px" : "8px 12px",
                borderRadius: br,
                fontSize: 12,
                cursor: "pointer",
                minWidth: 64,
                fontWeight: 600,
              }}
            >
              Notify me
            </button>
          )}
        </div>
      )}
    </>
  );

  return (
    <div
      style={{
        border: `1px solid ${t.borderColor}`,
        borderRadius: br,
        overflow: "hidden",
        background: t.backgroundColor,
        width: isHorizontal ? 420 : isCompact ? 180 : 260,
        display: "flex",
        flexDirection: isHorizontal ? "row" : "column",
        gap: isHorizontal ? 12 : 0,
        padding: isHorizontal ? 8 : 0,
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
      }}
    >
      {imageBox}
      <div
        style={{
          padding: isHorizontal ? 4 : 12,
          background: t.backgroundColor,
          display: "flex",
          flexDirection: "column",
          width: isHorizontal ? undefined : "100%",
          boxSizing: "border-box",
        }}
      >
        {body}
      </div>
    </div>
  );
}