/* Optional Storefront UI Elements embed. App Control Centre owns wishlist saves. */
(function () {
  let selecting = false;

  async function selectVariant(button) {
    const dialog = document.getElementById("ws-variant-selector");
    if (!dialog || dialog.dataset.enabled !== "true") return undefined;
    if (selecting) return null;
    const handle = button.dataset.productHandle;
    if (!handle)
      throw new Error("Product options are unavailable for this item.");

    selecting = true;
    try {
      const root = (dialog.dataset.productsRoot || "/").replace(/\/?$/, "/");
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      let product;
      try {
        const response = await fetch(
          `${root}products/${encodeURIComponent(handle)}.js`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error("Could not load product options.");
        product = await response.json();
      } finally {
        clearTimeout(timeout);
      }
      if (
        !product.id ||
        !Array.isArray(product.variants) ||
        !product.variants.length
      ) {
        throw new Error("This product has no available options.");
      }
      const selection = (variant) => ({
        productId: String(product.id),
        variantId: String(variant.id),
      });
      if (!dialog.isConnected) return null;
      if (typeof dialog.showModal !== "function")
        throw new Error(
          "The variant selector is not supported in this browser.",
        );

      const form = dialog.querySelector("#ws-variant-form");
      const choice = dialog.querySelector("#ws-variant-choice");
      const image = dialog.querySelector("#ws-variant-image");
      const title = dialog.querySelector("#ws-variant-product-title");
      const detail = dialog.querySelector("#ws-variant-detail");
      title.textContent = product.title;
      choice.replaceChildren();
      product.variants.forEach((variant) => {
        const option = document.createElement("option");
        option.value = String(variant.id);
        option.textContent = `${variant.title}${variant.available === false ? " — Sold out" : ""}`;
        choice.appendChild(option);
      });
      const initial =
        product.variants.find(
          (variant) => String(variant.id) === button.dataset.variantId,
        ) || product.variants[0];
      choice.value = String(initial.id);
      const updateDetails = () => {
        const variant = product.variants.find(
          (item) => String(item.id) === choice.value,
        );
        if (!variant) return;
        detail.textContent = `${variant.title}${variant.available === false ? " · Currently sold out" : ""}`;
        const source = variant.featured_image?.src || product.featured_image;
        image.hidden = true;
        image.removeAttribute("src");
        if (typeof source === "string" && source) {
          const url = new URL(source, location.origin);
          if (["http:", "https:"].includes(url.protocol)) {
            image.src = url.href;
            image.alt = product.title;
            image.hidden = false;
          }
        }
      };
      updateDetails();

      return await new Promise((resolve, reject) => {
        const cleanup = () => {
          form.removeEventListener("submit", submit);
          choice.removeEventListener("change", updateDetails);
          dialog.removeEventListener("close", cancel);
          dialog.removeEventListener("cancel", cancel);
          dialog.removeEventListener("click", backdrop);
        };
        const finish = (result) => {
          cleanup();
          dialog.close();
          if (button.isConnected) button.focus();
          resolve(result);
        };
        const cancel = () => finish(null);
        const submit = (event) => {
          event.preventDefault();
          const variant = product.variants.find(
            (item) => String(item.id) === choice.value,
          );
          if (variant) finish(selection(variant));
        };
        const backdrop = (event) => {
          if (event.target !== dialog) return;
          const bounds = dialog.getBoundingClientRect();
          if (
            event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom
          )
            cancel();
        };
        form.addEventListener("submit", submit);
        choice.addEventListener("change", updateDetails);
        dialog.addEventListener("close", cancel);
        dialog.addEventListener("cancel", cancel);
        dialog.addEventListener("click", backdrop);
        try {
          dialog.showModal();
          choice.focus();
        } catch (error) {
          cleanup();
          reject(error);
        }
      });
    } finally {
      selecting = false;
    }
  }

  window.__wishlistVariantSelector = { select: selectVariant };
})();
