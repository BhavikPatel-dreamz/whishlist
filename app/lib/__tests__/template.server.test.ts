import { describe, it, expect } from "vitest";
import {
  render,
  escapeHtml,
  backInStockHtml,
  backInStockText,
  confirmationEmailHtml,
  confirmationEmailText,
} from "../notifications/template.server";

describe("render (mustache-style)", () => {
  it("replaces known tokens", () => {
    const result = render("Hello {{ name }}, your {{ product }} is here!", {
      name: "Alice",
      product: "Sneakers",
    });
    expect(result).toBe("Hello Alice, your Sneakers is here!");
  });

  it("replaces unknown tokens with empty string", () => {
    expect(render("Hello {{ unknown }}", {})).toBe("Hello ");
  });

  it("handles whitespace around token names", () => {
    expect(render("{{  name  }}", { name: "test" })).toBe("test");
  });
});

describe("escapeHtml", () => {
  it("escapes dangerous characters", () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;"
    );
  });

  it("escapes ampersand", () => {
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  it("escapes single quotes", () => {
    expect(escapeHtml("it's")).toBe("it&#39;s");
  });
});

describe("backInStockHtml", () => {
  const input = {
    heading: "It's back!",
    body: "Great news.",
    buttonLabel: "Buy now",
    productTitle: "Cool Sneakers",
    variantTitle: "Red / Size 10",
    imageUrl: "https://cdn.example.com/img.jpg",
    price: "$99.00",
    actionUrl: "https://store.com/cart/123:1",
    shopName: "My Store",
    unsubscribeUrl: "https://store.com/unsub?id=1",
  };

  it("contains the heading", () => {
    const html = backInStockHtml(input);
    expect(html).toContain("It&#39;s back!");
  });

  it("contains the product title", () => {
    const html = backInStockHtml(input);
    expect(html).toContain("Cool Sneakers");
  });

  it("contains the action URL", () => {
    const html = backInStockHtml(input);
    expect(html).toContain("https://store.com/cart/123:1");
  });

  it("contains unsubscribe link", () => {
    const html = backInStockHtml(input);
    expect(html).toContain("Unsubscribe from this alert");
  });

  it("contains variant title when provided", () => {
    const html = backInStockHtml(input);
    expect(html).toContain("Red / Size 10");
  });
});

describe("backInStockText", () => {
  it("contains key elements", () => {
    const text = backInStockText({
      heading: "Back!",
      body: "It's available.",
      buttonLabel: "Buy",
      productTitle: "Shoes",
      actionUrl: "https://example.com/buy",
      shopName: "Store",
      unsubscribeUrl: "https://example.com/unsub",
    });
    expect(text).toContain("Back!");
    expect(text).toContain("Shoes");
    expect(text).toContain("Buy: https://example.com/buy");
    expect(text).toContain("Unsubscribe: https://example.com/unsub");
  });
});

describe("confirmationEmailHtml", () => {
  it("contains confirm button with URL", () => {
    const html = confirmationEmailHtml({
      shopName: "Test Shop",
      productTitle: "Widget",
      confirmUrl: "https://example.com/r/confirm/123?sig=abc",
      unsubscribeUrl: "https://example.com/unsub?id=123&sig=abc",
    });
    expect(html).toContain("https://example.com/r/confirm/123?sig=abc");
    expect(html).toContain("Yes, notify me");
  });

  it("contains the product title", () => {
    const html = confirmationEmailHtml({
      shopName: "Shop",
      productTitle: "Widget",
      confirmUrl: "#",
      unsubscribeUrl: "#",
    });
    expect(html).toContain("Widget");
  });
});

describe("confirmationEmailText", () => {
  it("contains confirm URL", () => {
    const text = confirmationEmailText({
      shopName: "Shop",
      productTitle: "Widget",
      confirmUrl: "https://example.com/confirm",
      unsubscribeUrl: "https://example.com/unsub",
    });
    expect(text).toContain("https://example.com/confirm");
    expect(text).toContain("Widget");
  });
});
