import db from "../db.server";
import { ProxyError } from "../lib/proxy.server";
import { identityWhere, type Identity } from "./wishlist.server";

export const DEFAULT_LIST = "My Wishlist";
export function listName(value: unknown): string {
  if (value == null || value === "") return DEFAULT_LIST;
  if (typeof value !== "string" || !value.trim() || value.trim().length > 60 || Array.from(value).some((char) => char.charCodeAt(0) < 32)) {
    throw new ProxyError(422, "Choose a list name between 1 and 60 characters.", "invalid_list");
  }
  return value.trim();
}
export function listOwner(identity: Identity) {
  return identity.customerId ? `customer:${identity.customerId}` : `guest:${identity.guestToken}`;
}
export async function wishlistFeatures(shopId: string) {
  const config = await db.uIConfig.findUnique({ where: { shopId } });
  return (config?.productCardConfig || {}) as Record<string, unknown>;
}
export async function ensureList(shopId: string, identity: Identity, name: string) {
  const owner = listOwner(identity);
  return db.wishlistList.upsert({
    where: { shopId_owner_name: { shopId, owner, name } },
    create: { shopId, owner, name }, update: {},
  });
}
export async function getLists(shopId: string, identity: Identity) {
  const lists = await db.wishlistList.findMany({ where: { shopId, owner: listOwner(identity) }, orderBy: { createdAt: "asc" } });
  return [DEFAULT_LIST, ...lists.map((list) => list.name).filter((name) => name !== DEFAULT_LIST)];
}
export async function changeList(shopId: string, identity: Identity, operation: string, name: string, newName: string, productId?: string) {
  const owner = listOwner(identity);
  const scope = identityWhere(shopId, identity);
  if (operation === "create") {
    await ensureList(shopId, identity, name);
  } else if (operation === "move") {
    if (!productId) throw new ProxyError(422, "Choose a product to move.", "missing_product");
    await ensureList(shopId, identity, name);
    await db.wishlistItem.updateMany({ where: { ...scope, productId }, data: { listName: name } });
  } else if (operation === "rename" || operation === "delete") {
    if (name === DEFAULT_LIST) throw new ProxyError(422, "The default wishlist cannot be renamed or deleted.", "default_list");
    await db.$transaction(async (tx) => {
      const list = await tx.wishlistList.findUnique({ where: { shopId_owner_name: { shopId, owner, name } } });
      if (!list) throw new ProxyError(404, "Wishlist not found.", "missing_list");
      if (operation === "rename") {
        const exists = await tx.wishlistList.findUnique({ where: { shopId_owner_name: { shopId, owner, name: newName } } });
        if (newName === DEFAULT_LIST || exists) throw new ProxyError(409, "A wishlist already uses that name.", "duplicate_list");
        await tx.wishlistList.update({ where: { id: list.id }, data: { name: newName } });
      } else {
        await tx.wishlistList.delete({ where: { id: list.id } });
      }
      // Deleting a list keeps its products in the default wishlist.
      await tx.wishlistItem.updateMany({ where: { ...scope, listName: name }, data: { listName: operation === "rename" ? newName : DEFAULT_LIST } });
    });
  } else throw new ProxyError(422, "Unknown wishlist operation.", "invalid_operation");
}
